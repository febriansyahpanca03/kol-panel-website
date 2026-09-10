/**
 * Migration from the shipped `{ talents, uploads, setelan }` shape to the
 * relational model.
 *
 * Two properties matter more than anything else here:
 *
 * 1. Nothing is lost. Every old talent and every old upload comes across, and
 *    the untouched original is kept alongside so the move can be undone.
 * 2. Running it twice is harmless. Ids for the derived records are *derived
 *    from* the source record's id rather than generated fresh, so a second
 *    run recognises what it already produced instead of duplicating it.
 *
 * The old shape folds contract data into the talent, so each legacy talent
 * becomes exactly one talent + one account + one contract + one obligation.
 * That is a faithful reading of what was stored — not a guess — and it leaves
 * room for the second contract the old shape could never hold.
 */

import { SCHEMA_VERSION, SOURCE, STATUS, emptyState, parseVideoUrl, toIsoDate } from "./model.js";

export const BACKUP_KEY = "pantau-talent-data-backup-v0";

/** Deterministic ids, so migrating twice converges instead of duplicating. */
const contractIdFor = (talentId) => `con_${talentId}`;
const accountIdFor = (talentId) => `acc_${talentId}`;
const obligationIdFor = (talentId) => `obl_${talentId}`;
const contentIdFor = (uploadId) => `cnt_${uploadId}`;
const videoIdFor = (platform, platformVideoId) => `vid_${platform}_${platformVideoId}`;

export function needsMigration(raw) {
  if (!raw || typeof raw !== "object") return false;
  if (raw.version === SCHEMA_VERSION) return false;
  // The legacy shape is recognisable by having talents/uploads and no version.
  return Array.isArray(raw.talents) || Array.isArray(raw.uploads);
}

/**
 * Converts a legacy state into the relational model.
 *
 * `now` is injected so tests are deterministic and so every record produced by
 * one run shares a timestamp.
 */
export function migrate(legacy, { now = new Date().toISOString() } = {}) {
  const state = emptyState(legacy?.setelan ? { ...legacy.setelan } : {});
  const warnings = [];

  const legacyTalents = Array.isArray(legacy?.talents) ? legacy.talents : [];
  const legacyUploads = Array.isArray(legacy?.uploads) ? legacy.uploads : [];

  for (const old of legacyTalents) {
    if (!old || !old.id) {
      warnings.push("Satu baris talent dilewati karena tidak punya id.");
      continue;
    }

    state.talents.push({
      id: old.id,
      name: old.name ?? "",
      fullName: old.fullName ?? "",
      phone: old.phone ?? "",
      address: old.address ?? "",
      bank: old.bank ?? "",
      notionName: old.notionName ?? "",
      source: SOURCE.MIGRASI,
      createdAt: now,
    });

    // The legacy row holds a single handle. An empty one still produces a
    // talent — a talent without a known account is a real situation, and
    // inventing a handle would be worse than leaving it blank.
    if (old.account) {
      state.accounts.push({
        id: accountIdFor(old.id),
        talentId: old.id,
        platform: old.platform ?? "tiktok",
        handle: old.account,
        source: SOURCE.MIGRASI,
        createdAt: now,
      });
    } else {
      warnings.push(`Talent "${old.name ?? old.id}" belum punya akun sosial.`);
    }

    const quota = Number.isFinite(old.quota) ? old.quota : parseInt(old.quota, 10);
    const value = Number.isFinite(old.value) ? old.value : parseInt(old.value, 10);

    state.contracts.push({
      id: contractIdFor(old.id),
      talentId: old.id,
      label: "Kontrak awal",
      value: Number.isFinite(value) ? value : null,
      dpPercent: old.dpPercent === "" || old.dpPercent === undefined ? null : old.dpPercent,
      // The legacy shape never recorded actual payments, only a DP percentage.
      // Leaving this empty keeps "agreed" and "paid" distinguishable instead
      // of presenting an assumption as a payment record.
      payments: [],
      startDate: toIsoDate(old.startDate),
      endDate: toIsoDate(old.endDate),
      contractDate: toIsoDate(old.contractDate),
      scheduleText: old.scheduleText ?? "",
      uploadDays: old.uploadDays ?? "",
      status: "aktif",
      source: SOURCE.MIGRASI,
      createdAt: now,
    });

    state.obligations.push({
      id: obligationIdFor(old.id),
      contractId: contractIdFor(old.id),
      accountId: old.account ? accountIdFor(old.id) : null,
      platform: old.platform ?? "tiktok",
      quantity: Number.isFinite(quota) ? quota : 0,
      description: "Konten kerja sama",
      // Single like-for-like obligation, so per-content cost is derivable from
      // the contract value; no explicit split was ever recorded.
      allocationRp: null,
      source: SOURCE.MIGRASI,
      createdAt: now,
    });
  }

  const knownTalents = new Set(state.talents.map((t) => t.id));

  for (const upload of legacyUploads) {
    if (!upload || !upload.id) {
      warnings.push("Satu catatan upload dilewati karena tidak punya id.");
      continue;
    }
    if (!knownTalents.has(upload.talentId)) {
      warnings.push(`Catatan upload "${upload.title ?? upload.id}" menunjuk talent yang tidak ada.`);
      continue;
    }

    const parsed = parseVideoUrl(upload.link);
    let videoId = null;

    if (parsed) {
      videoId = videoIdFor(parsed.platform, parsed.platformVideoId);
      const already = state.videos.some((v) => v.id === videoId);
      if (!already) {
        state.videos.push({
          id: videoId,
          platform: parsed.platform,
          platformVideoId: parsed.platformVideoId,
          url: upload.link,
          publishedAt: toIsoDate(upload.date),
          accountId: accountIdFor(upload.talentId),
          firstSeenAt: now,
          lastSeenAt: now,
        });
      }
    }

    state.contents.push({
      id: contentIdFor(upload.id),
      talentId: upload.talentId,
      contractId: contractIdFor(upload.talentId),
      obligationId: obligationIdFor(upload.talentId),
      accountId: accountIdFor(upload.talentId),
      title: upload.title ?? "",
      brief: "",
      platform: state.obligations.find((o) => o.id === obligationIdFor(upload.talentId))?.platform ?? "tiktok",
      scheduledDate: null,
      publishedDate: toIsoDate(upload.date),
      status: STATUS.SUDAH_TAYANG,
      // These already counted towards quota in the old dashboard, so they
      // arrive confirmed. History that was true yesterday stays true.
      confirmedAt: now,
      videoId,
      url: upload.link ?? "",
      notes: "",
      source: SOURCE.MIGRASI,
      sourceId: upload.id,
      createdAt: now,
    });
  }

  state.events.push({
    id: `evt_migrasi_${now}`,
    at: now,
    type: "state.migrated",
    entity: "state",
    entityId: null,
    detail: {
      fromVersion: legacy?.version ?? 0,
      toVersion: SCHEMA_VERSION,
      talents: state.talents.length,
      contracts: state.contracts.length,
      contents: state.contents.length,
      videos: state.videos.length,
      warnings,
    },
  });

  return { state, warnings };
}

/**
 * Reverses the migration by reading back the untouched legacy snapshot. The
 * new records are discarded rather than converted back — a one-way rebuild
 * would risk mangling the very data the rollback exists to protect.
 */
export function rollback(backupJson) {
  if (typeof backupJson !== "string" || backupJson.trim() === "") return null;
  try {
    const parsed = JSON.parse(backupJson);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Counts what a migration would produce without applying it, for a
 * confirmation prompt.
 */
export function previewMigration(legacy) {
  const { state, warnings } = migrate(legacy, { now: "preview" });
  return {
    talents: state.talents.length,
    accounts: state.accounts.length,
    contracts: state.contracts.length,
    obligations: state.obligations.length,
    contents: state.contents.length,
    videos: state.videos.length,
    warnings,
  };
}
