/**
 * Obligation-based progress.
 *
 * The shipped dashboard computes remaining quota as
 * `talent.quota - uploads.filter(byTalent).length`, which means any duplicate
 * row — a re-import, a retry after a failed send, a second scan — silently
 * eats a slot. Progress here is instead the number of *confirmed* contents
 * attached to a specific obligation, so counting the same video twice is not
 * possible: a content links to one obligation, and confirming it twice is a
 * no-op.
 */

import { STATUS, recordEvent, videoKey } from "./model.js";

/**
 * Progress for one obligation.
 *
 * `remaining` never goes below zero and surplus is reported separately, so an
 * over-delivering talent does not read as "-2 left" (spec: "Tampilkan
 * kelebihan konten terpisah; sisa kuota tidak negatif").
 */
export function obligationProgress(state, obligationId) {
  const obligation = state.obligations.find((o) => o.id === obligationId);
  if (!obligation) return null;

  const confirmed = state.contents.filter(
    (c) => c.obligationId === obligationId && c.confirmedAt !== null,
  ).length;

  return {
    obligationId,
    quantity: obligation.quantity,
    confirmed,
    remaining: Math.max(0, obligation.quantity - confirmed),
    excess: Math.max(0, confirmed - obligation.quantity),
  };
}

/** Roll-up across every obligation on a contract. */
export function contractProgress(state, contractId) {
  const obligations = state.obligations.filter((o) => o.contractId === contractId);
  const parts = obligations.map((o) => obligationProgress(state, o.id));

  return {
    contractId,
    obligations: parts,
    quantity: parts.reduce((sum, p) => sum + p.quantity, 0),
    confirmed: parts.reduce((sum, p) => sum + p.confirmed, 0),
    remaining: parts.reduce((sum, p) => sum + p.remaining, 0),
    excess: parts.reduce((sum, p) => sum + p.excess, 0),
  };
}

/**
 * Per-content cost allocation.
 *
 * Only defined when the contract is a single obligation of like-for-like
 * content, or when the obligation carries its own `allocationRp`. A mixed
 * package divided by a headline number would be a made-up figure, so this
 * returns null and the caller must say "belum tersedia" rather than print it
 * (spec: "jika tidak tersedia, jangan mengarang nilai").
 */
export function allocationPerContent(state, obligationId) {
  const obligation = state.obligations.find((o) => o.id === obligationId);
  if (!obligation) return null;

  if (typeof obligation.allocationRp === "number") {
    return obligation.quantity > 0 ? obligation.allocationRp / obligation.quantity : null;
  }

  const contract = state.contracts.find((c) => c.id === obligation.contractId);
  if (!contract || typeof contract.value !== "number") return null;

  const siblings = state.obligations.filter((o) => o.contractId === contract.id);
  // More than one obligation and no explicit split: the contract value cannot
  // be attributed to any one of them.
  if (siblings.length !== 1) return null;
  if (obligation.quantity <= 0) return null;

  return contract.value / obligation.quantity;
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

/**
 * Marks a content as fulfilling its obligation. Idempotent: confirming an
 * already-confirmed content changes nothing and records nothing, so a retry
 * after a dropped connection cannot decrement the quota twice.
 *
 * Returns true when this call actually changed something.
 */
export function confirmContent(state, nextId, contentId, { at = null, by = "manual" } = {}) {
  const content = state.contents.find((c) => c.id === contentId);
  if (!content) return false;
  if (content.confirmedAt !== null) return false;
  if (!content.obligationId) return false;

  content.confirmedAt = at ?? new Date().toISOString();
  content.status = STATUS.SUDAH_TAYANG;

  recordEvent(state, nextId, {
    type: "content.confirmed",
    entity: "content",
    entityId: contentId,
    detail: { obligationId: content.obligationId, by },
  });
  return true;
}

/**
 * Undoes a confirmation. The content itself is kept — an unconfirmed piece of
 * work still happened — only its claim on the obligation is released, and the
 * event log keeps why (spec: "simpan riwayat perubahan").
 */
export function unconfirmContent(state, nextId, contentId, { reason = "", by = "manual" } = {}) {
  const content = state.contents.find((c) => c.id === contentId);
  if (!content) return false;
  if (content.confirmedAt === null) return false;

  const was = content.confirmedAt;
  content.confirmedAt = null;
  // Back to "found but unmatched" rather than planned: the video still exists.
  content.status = content.videoId ? STATUS.TERDETEKSI : STATUS.SIAP_UPLOAD;

  recordEvent(state, nextId, {
    type: "content.unconfirmed",
    entity: "content",
    entityId: contentId,
    detail: { obligationId: content.obligationId, previousConfirmedAt: was, reason, by },
  });
  return true;
}

/**
 * Moves a content to a different obligation, recomputing both sides. Used when
 * a video was matched against the wrong contract.
 */
export function reassignObligation(state, nextId, contentId, newObligationId, { by = "manual" } = {}) {
  const content = state.contents.find((c) => c.id === contentId);
  const obligation = state.obligations.find((o) => o.id === newObligationId);
  if (!content || !obligation) return false;
  if (content.obligationId === newObligationId) return false;

  const previous = content.obligationId;
  content.obligationId = newObligationId;
  content.contractId = obligation.contractId;

  recordEvent(state, nextId, {
    type: "content.reassigned",
    entity: "content",
    entityId: contentId,
    detail: { from: previous, to: newObligationId, by },
  });
  return true;
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

/**
 * Inserts a video, or returns the existing one with the same
 * platform+platformVideoId. This is the single place that guarantees a
 * re-scan cannot create a second record for one video.
 */
export function upsertVideo(state, nextId, { platform, platformVideoId, url = null, publishedAt = null, accountId = null, seenAt = null }) {
  if (!platform || !platformVideoId) return null;
  const key = videoKey(platform, platformVideoId);

  const existing = state.videos.find((v) => videoKey(v.platform, v.platformVideoId) === key);
  if (existing) {
    // Fill blanks from the newer sighting without overwriting what we know.
    if (existing.url === null && url) existing.url = url;
    if (existing.publishedAt === null && publishedAt) existing.publishedAt = publishedAt;
    if (existing.accountId === null && accountId) existing.accountId = accountId;
    existing.lastSeenAt = seenAt ?? new Date().toISOString();
    return existing;
  }

  const video = {
    id: nextId("vid"),
    platform,
    platformVideoId,
    url,
    publishedAt,
    accountId,
    firstSeenAt: seenAt ?? new Date().toISOString(),
    lastSeenAt: seenAt ?? new Date().toISOString(),
  };
  state.videos.push(video);
  return video;
}

/**
 * Appends an analytics reading. Measurements are an append-only history, so
 * the panel can say when a number was taken instead of implying it is live.
 * A reading identical to the previous one for the same video is skipped, so
 * reopening a profile repeatedly does not inflate the history.
 */
export function recordMeasurement(state, nextId, videoId, metrics, { capturedAt = null } = {}) {
  const video = state.videos.find((v) => v.id === videoId);
  if (!video) return null;

  const previous = state.measurements
    .filter((m) => m.videoId === videoId)
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    .at(-1);

  const fields = ["views", "likes", "comments", "shares", "saves"];
  const unchanged =
    previous && fields.every((f) => (previous[f] ?? null) === (metrics[f] ?? null));
  if (unchanged) return previous;

  const measurement = {
    id: nextId("msr"),
    videoId,
    capturedAt: capturedAt ?? new Date().toISOString(),
    views: metrics.views ?? null,
    likes: metrics.likes ?? null,
    comments: metrics.comments ?? null,
    shares: metrics.shares ?? null,
    saves: metrics.saves ?? null,
  };
  state.measurements.push(measurement);
  return measurement;
}

/** Most recent reading for a video, or null. Callers show its `capturedAt`
 * so a stale number is never presented as current. */
export function latestMeasurement(state, videoId) {
  return (
    state.measurements
      .filter((m) => m.videoId === videoId)
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
      .at(-1) ?? null
  );
}
