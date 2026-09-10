/**
 * Bridge between the relational model and the shipped dashboard's shape.
 *
 * The dashboard has ~30 places that read `state.talents[i].quota` and
 * `state.uploads`. Rewriting all of them at once, in a file holding real
 * contracts, is not a change anyone can review safely. So instead the
 * relational model becomes the source of truth and this module projects it
 * back into the legacy shape the render code already understands.
 *
 * The projection is lossy by design — the legacy shape cannot express a
 * second contract — so `projectToLegacy` picks the *active* contract and says
 * so. That loss is confined to the view; the underlying state keeps every
 * contract, and the UI can be ported one screen at a time.
 */

import { SOURCE, STATUS, parseVideoUrl, recordEvent, toIsoDate, todayInJakarta } from "./model.js";

const contractIdFor = (talentId) => `con_${talentId}`;
const accountIdFor = (talentId) => `acc_${talentId}`;
const obligationIdFor = (talentId) => `obl_${talentId}`;

/**
 * Chooses which contract represents a talent in the legacy view: the one
 * covering today, else the one that ends latest. Deterministic, so the
 * dashboard does not appear to change contract between renders.
 */
export function activeContract(state, talentId, today = todayInJakarta()) {
  const contracts = state.contracts.filter((c) => c.talentId === talentId);
  if (contracts.length === 0) return null;

  const current = contracts.filter(
    (c) => (!c.startDate || c.startDate <= today) && (!c.endDate || c.endDate >= today),
  );
  const pool = current.length > 0 ? current : contracts;

  return [...pool].sort((a, b) => String(b.endDate ?? "").localeCompare(String(a.endDate ?? "")))[0];
}

/** Total agreed quantity across a contract's obligations. */
function contractQuantity(state, contractId) {
  return state.obligations
    .filter((o) => o.contractId === contractId)
    .reduce((sum, o) => sum + (o.quantity ?? 0), 0);
}

/**
 * Renders the relational state in the legacy `{talents, uploads, setelan}`
 * shape. Only *confirmed* contents become uploads — a detected-but-unmatched
 * video must not silently count towards quota, which is the whole point of
 * separating the two.
 */
export function projectToLegacy(state, today = todayInJakarta()) {
  const talents = state.talents.map((talent) => {
    const contract = activeContract(state, talent.id, today);
    const account = state.accounts.find((a) => a.talentId === talent.id) ?? null;
    const obligation = contract
      ? state.obligations.find((o) => o.contractId === contract.id) ?? null
      : null;

    return {
      id: talent.id,
      name: talent.name,
      fullName: talent.fullName,
      phone: talent.phone,
      address: talent.address,
      bank: talent.bank,
      notionName: talent.notionName,
      account: account?.handle ?? "",
      platform: account?.platform ?? obligation?.platform ?? "tiktok",
      quota: contract ? contractQuantity(state, contract.id) : 0,
      value: contract?.value ?? null,
      dpPercent: contract?.dpPercent ?? "",
      startDate: contract?.startDate ?? "",
      endDate: contract?.endDate ?? "",
      contractDate: contract?.contractDate ?? "",
      scheduleText: contract?.scheduleText ?? "",
      uploadDays: contract?.uploadDays ?? "",
      /** Not part of the legacy shape — lets ported screens know there is more. */
      _contractCount: state.contracts.filter((c) => c.talentId === talent.id).length,
      _contractId: contract?.id ?? null,
    };
  });

  const uploads = state.contents
    .filter((c) => c.confirmedAt !== null)
    .map((c) => ({
      id: c.id,
      talentId: c.talentId,
      date: c.publishedDate ?? "",
      title: c.title ?? "",
      link: c.url ?? "",
    }));

  return { talents, uploads, setelan: state.setelan };
}

// ---------------------------------------------------------------------------
// Writes coming back from the legacy UI
// ---------------------------------------------------------------------------

/**
 * Applies an add/edit from the legacy talent form.
 *
 * Editing touches the *active* contract rather than creating a new one — the
 * old form has no concept of a second contract, so treating every edit as a
 * renewal would multiply contracts on every save. Adding a renewal is a
 * deliberate action the ported UI will offer separately.
 */
export function upsertTalentFromLegacy(state, nextId, form, { now = new Date().toISOString() } = {}) {
  const id = form.id;
  if (!id) return null;

  let talent = state.talents.find((t) => t.id === id);
  if (!talent) {
    talent = { id, source: SOURCE.MANUAL, createdAt: now };
    state.talents.push(talent);
  }
  Object.assign(talent, {
    name: form.name ?? "",
    fullName: form.fullName ?? "",
    phone: form.phone ?? "",
    address: form.address ?? "",
    bank: form.bank ?? "",
    notionName: form.notionName ?? "",
  });

  // Account: keyed by talent so an edit renames rather than adds a second one.
  const accountId = accountIdFor(id);
  let account = state.accounts.find((a) => a.id === accountId);
  if (form.account) {
    if (!account) {
      account = { id: accountId, talentId: id, source: SOURCE.MANUAL, createdAt: now };
      state.accounts.push(account);
    }
    account.handle = form.account;
    account.platform = form.platform ?? "tiktok";
  } else if (account) {
    state.accounts = state.accounts.filter((a) => a.id !== accountId);
  }

  const existing = activeContract(state, id);
  const contractId = existing?.id ?? contractIdFor(id);
  let contract = state.contracts.find((c) => c.id === contractId);
  if (!contract) {
    contract = {
      id: contractId,
      talentId: id,
      label: "Kontrak awal",
      payments: [],
      status: "aktif",
      source: SOURCE.MANUAL,
      createdAt: now,
    };
    state.contracts.push(contract);
  }
  Object.assign(contract, {
    value: Number.isFinite(form.value) ? form.value : null,
    dpPercent: form.dpPercent === "" || form.dpPercent === undefined ? null : form.dpPercent,
    startDate: toIsoDate(form.startDate),
    endDate: toIsoDate(form.endDate),
    contractDate: toIsoDate(form.contractDate),
    scheduleText: form.scheduleText ?? "",
    uploadDays: form.uploadDays ?? "",
  });

  const obligationId =
    state.obligations.find((o) => o.contractId === contract.id)?.id ?? obligationIdFor(id);
  let obligation = state.obligations.find((o) => o.id === obligationId);
  if (!obligation) {
    obligation = {
      id: obligationId,
      contractId: contract.id,
      description: "Konten kerja sama",
      allocationRp: null,
      source: SOURCE.MANUAL,
      createdAt: now,
    };
    state.obligations.push(obligation);
  }
  obligation.accountId = form.account ? accountId : null;
  obligation.platform = form.platform ?? "tiktok";
  obligation.quantity = Number.isFinite(form.quota) ? form.quota : 0;

  return talent;
}

/**
 * Removes a talent and everything hanging off it.
 *
 * Contents are removed too, because the legacy UI's delete meant exactly
 * that. The event log keeps a record of how much went with it, so a deletion
 * that turns out to be a mistake is at least visible afterwards.
 */
export function removeTalentCascade(state, nextId, talentId) {
  const talent = state.talents.find((t) => t.id === talentId);
  if (!talent) return false;

  const contracts = state.contracts.filter((c) => c.talentId === talentId).map((c) => c.id);
  const removedContents = state.contents.filter((c) => c.talentId === talentId).length;

  state.talents = state.talents.filter((t) => t.id !== talentId);
  state.accounts = state.accounts.filter((a) => a.talentId !== talentId);
  state.contracts = state.contracts.filter((c) => c.talentId !== talentId);
  state.obligations = state.obligations.filter((o) => !contracts.includes(o.contractId));
  state.contents = state.contents.filter((c) => c.talentId !== talentId);

  recordEvent(state, nextId, {
    type: "talent.removed",
    entity: "talent",
    entityId: talentId,
    detail: { name: talent.name, contracts: contracts.length, contents: removedContents },
  });
  return true;
}

/**
 * Records a delivered piece of content from the legacy "catat upload" form.
 *
 * Returns `{ content, duplicate }`. When the same video URL is already
 * recorded for that talent it returns the existing content with
 * `duplicate: true` instead of adding a second one — the guard the legacy
 * date-only check could not provide.
 */
export function recordDeliveredContent(
  state,
  nextId,
  { talentId, date, title = "", link = "", source = SOURCE.MANUAL, sourceId = null },
  { now = new Date().toISOString() } = {},
) {
  const talent = state.talents.find((t) => t.id === talentId);
  if (!talent) return { content: null, duplicate: false };

  const contract = activeContract(state, talentId);
  const obligation = contract
    ? state.obligations.find((o) => o.contractId === contract.id) ?? null
    : null;

  const parsed = parseVideoUrl(link);
  let videoId = null;

  if (parsed) {
    videoId = `vid_${parsed.platform}_${parsed.platformVideoId}`;
    // Same video already logged for this talent: not a second delivery.
    const clash = state.contents.find((c) => c.talentId === talentId && c.videoId === videoId);
    if (clash) return { content: clash, duplicate: true };

    if (!state.videos.some((v) => v.id === videoId)) {
      state.videos.push({
        id: videoId,
        platform: parsed.platform,
        platformVideoId: parsed.platformVideoId,
        url: link,
        publishedAt: toIsoDate(date),
        accountId: accountIdFor(talentId),
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }
  }

  if (sourceId) {
    const seen = state.contents.find((c) => c.source === source && c.sourceId === sourceId);
    if (seen) return { content: seen, duplicate: true };
  }

  const content = {
    id: nextId("cnt"),
    talentId,
    contractId: contract?.id ?? null,
    obligationId: obligation?.id ?? null,
    accountId: state.accounts.find((a) => a.talentId === talentId)?.id ?? null,
    title,
    brief: "",
    platform: obligation?.platform ?? "tiktok",
    scheduledDate: null,
    publishedDate: toIsoDate(date),
    status: STATUS.SUDAH_TAYANG,
    // The legacy form only ever recorded things that had already gone live,
    // so these arrive confirmed — matching what the button has always meant.
    confirmedAt: obligation ? now : null,
    videoId,
    url: link,
    notes: "",
    source,
    sourceId,
    createdAt: now,
  };
  state.contents.push(content);

  recordEvent(state, nextId, {
    type: "content.recorded",
    entity: "content",
    entityId: content.id,
    detail: { talentId, source, obligationId: content.obligationId },
  });

  return { content, duplicate: false };
}

/** Deletes a content outright — what the legacy "hapus upload" button did. */
export function removeContent(state, nextId, contentId) {
  const content = state.contents.find((c) => c.id === contentId);
  if (!content) return false;
  state.contents = state.contents.filter((c) => c.id !== contentId);
  recordEvent(state, nextId, {
    type: "content.removed",
    entity: "content",
    entityId: contentId,
    detail: { talentId: content.talentId, publishedDate: content.publishedDate },
  });
  return true;
}
