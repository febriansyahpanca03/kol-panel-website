/**
 * Notion Content Calendar import.
 *
 * The shipped importer treats every row whose date falls inside a contract
 * window as a delivered upload, dedupes on date alone, and applies itself
 * without showing anyone what it is about to do. That means: a status of
 * "Draft" counts as published, a talent who posted twice in one day loses the
 * second video, and a mis-mapped name is only discovered afterwards.
 *
 * This module separates *deciding* from *applying*. `planImport` returns a
 * plan describing every row and what would happen to it; nothing changes
 * until `applyImport` is handed that plan.
 */

import { SOURCE } from "./model.js";
import { recordDeliveredContent } from "./projection.js";

/**
 * Default status mapping. Only statuses listed as published are treated as
 * delivered — anything else is carried in for review rather than silently
 * counted, because a date alone never means a video went live.
 *
 * Callers override this once the workspace's real status names are known.
 */
export const DEFAULT_STATUS_MAP = {
  published: ["published", "posted", "sudah tayang", "tayang", "done", "selesai", "uploaded"],
  cancelled: ["cancelled", "canceled", "dibatalkan", "batal"],
};

export const ROW_OUTCOME = {
  BARU: "baru",
  DUPLIKAT: "duplikat",
  BELUM_TAYANG: "belum_tayang",
  DIBATALKAN: "dibatalkan",
  TALENT_TIDAK_DIKENAL: "talent_tidak_dikenal",
  DI_LUAR_PERIODE: "di_luar_periode",
  TANGGAL_TIDAK_VALID: "tanggal_tidak_valid",
};

function classifyStatus(raw, map) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "") return "tidak_diketahui";
  if (map.published.some((s) => value === s)) return "published";
  if (map.cancelled.some((s) => value === s)) return "cancelled";
  return "tidak_diketahui";
}

/**
 * Resolves a Notion row's talent by exact name match.
 *
 * Notion carries no talent id, so a name is the only join available — but it
 * is used strictly as an exact lookup and every match is shown in the preview
 * for a person to confirm. Nothing is merged on resemblance.
 */
function resolveTalent(state, rowName) {
  const wanted = String(rowName ?? "").trim().toLowerCase();
  if (!wanted) return null;

  return (
    state.talents.find((t) => {
      const byNotion = String(t.notionName ?? "").trim().toLowerCase();
      if (byNotion && byNotion === wanted) return true;
      const account = state.accounts.find((a) => a.talentId === t.id);
      const byAccount = String(account?.handle ?? "").replace(/^@/, "").trim().toLowerCase();
      return byAccount !== "" && byAccount === wanted;
    }) ?? null
  );
}

/**
 * Builds a plan without touching state.
 *
 * `rows` are `{ nama, tgl, judul?, status?, tautan? }`.
 */
export function planImport(state, rows, { statusMap = DEFAULT_STATUS_MAP, today } = {}) {
  const entries = [];
  const unknownNames = new Set();

  for (const row of Array.isArray(rows) ? rows : []) {
    const base = { row, talent: null, outcome: null, reason: "" };
    const talent = resolveTalent(state, row?.nama);

    if (!talent) {
      unknownNames.add(String(row?.nama ?? "").trim());
      entries.push({ ...base, outcome: ROW_OUTCOME.TALENT_TIDAK_DIKENAL, reason: "Nama tidak cocok dengan talent mana pun." });
      continue;
    }
    base.talent = talent;

    const date = String(row?.tgl ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      entries.push({ ...base, outcome: ROW_OUTCOME.TANGGAL_TIDAK_VALID, reason: "Tanggal tidak terbaca." });
      continue;
    }

    const status = classifyStatus(row?.status, statusMap);
    if (status === "cancelled") {
      entries.push({ ...base, outcome: ROW_OUTCOME.DIBATALKAN, reason: "Status dibatalkan di Notion." });
      continue;
    }
    if (status !== "published") {
      entries.push({
        ...base,
        outcome: ROW_OUTCOME.BELUM_TAYANG,
        reason: row?.status
          ? `Status "${row.status}" bukan status tayang.`
          : "Baris tidak punya status, jadi tidak dianggap sudah tayang.",
      });
      continue;
    }

    const contract = state.contracts.find(
      (c) => c.talentId === talent.id && (!c.startDate || date >= c.startDate) && (!c.endDate || date <= c.endDate),
    );
    if (!contract) {
      entries.push({ ...base, outcome: ROW_OUTCOME.DI_LUAR_PERIODE, reason: "Tanggal di luar periode kontrak mana pun." });
      continue;
    }
    if (today && date > today) {
      entries.push({ ...base, outcome: ROW_OUTCOME.DI_LUAR_PERIODE, reason: "Tanggal masih di masa depan." });
      continue;
    }

    // Dedup key includes the title, so two videos on one day both survive —
    // the legacy date-only check silently dropped the second.
    const sourceId = `${talent.id}|${date}|${String(row?.judul ?? "").trim()}`;
    const already = state.contents.some((c) => c.source === SOURCE.NOTION && c.sourceId === sourceId);

    entries.push({
      ...base,
      contract,
      sourceId,
      outcome: already ? ROW_OUTCOME.DUPLIKAT : ROW_OUTCOME.BARU,
      reason: already ? "Sudah pernah diimpor." : "",
    });
  }

  const count = (outcome) => entries.filter((e) => e.outcome === outcome).length;

  return {
    entries,
    unknownNames: [...unknownNames].filter(Boolean),
    ringkasan: {
      total: entries.length,
      baru: count(ROW_OUTCOME.BARU),
      duplikat: count(ROW_OUTCOME.DUPLIKAT),
      belumTayang: count(ROW_OUTCOME.BELUM_TAYANG),
      dibatalkan: count(ROW_OUTCOME.DIBATALKAN),
      talentTidakDikenal: count(ROW_OUTCOME.TALENT_TIDAK_DIKENAL),
      diLuarPeriode: count(ROW_OUTCOME.DI_LUAR_PERIODE),
      tanggalTidakValid: count(ROW_OUTCOME.TANGGAL_TIDAK_VALID),
    },
  };
}

/**
 * Applies only the rows the plan marked as new. Everything else is left
 * alone: nothing is deleted, nothing already imported is touched again.
 */
export function applyImport(state, nextId, plan, { now = new Date().toISOString() } = {}) {
  let added = 0;
  const skipped = [];

  for (const entry of plan.entries) {
    if (entry.outcome !== ROW_OUTCOME.BARU) continue;

    const { content, duplicate } = recordDeliveredContent(
      state,
      nextId,
      {
        talentId: entry.talent.id,
        date: entry.row.tgl,
        title: String(entry.row.judul ?? "").trim() || "Dari Notion Content Calendar",
        link: String(entry.row.tautan ?? "").trim(),
        source: SOURCE.NOTION,
        sourceId: entry.sourceId,
      },
      { now },
    );

    if (duplicate || !content) {
      skipped.push(entry.sourceId);
      continue;
    }
    added += 1;
  }

  return { added, skipped };
}
