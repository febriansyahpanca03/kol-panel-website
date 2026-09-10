/**
 * Relational data model for Pantau Talent.
 *
 * The shipped dashboard stores `{ talents, uploads, setelan }`, where one
 * talent IS one contract and an "upload" is a bare `{talentId, date, title,
 * link}`. That shape cannot express a talent with two contracts, a talent
 * with two accounts, a piece of content that is planned but not yet live, or
 * the difference between "we detected a video" and "we confirmed this video
 * satisfies a contract obligation. This module defines the shape that can.
 *
 * Nothing here touches the DOM or storage — it is pure data so the migration
 * can be tested against real-looking records before it is ever run on them.
 */

export const SCHEMA_VERSION = 1;

/**
 * Content lifecycle. Deliberately small, and deliberately separate from
 * "confirmed": a video can be TERDETEKSI (we found it on the account) long
 * before anyone has decided it fulfils a contract obligation.
 */
export const STATUS = {
  DIRENCANAKAN: "direncanakan",
  DIKERJAKAN: "dikerjakan",
  SIAP_UPLOAD: "siap_upload",
  SUDAH_TAYANG: "sudah_tayang",
  DIBATALKAN: "dibatalkan",
  /** Found by a scan, not yet matched to an obligation by a human. */
  TERDETEKSI: "terdeteksi",
};

export const ALL_STATUSES = Object.values(STATUS);

/** Where a record came from, so imports and scans stay distinguishable from
 * things a person typed. Needed to honour "tandai sumbernya". */
export const SOURCE = {
  MANUAL: "manual",
  MIGRASI: "migrasi",
  NOTION: "notion",
  EXTENSION: "extension",
};

export function emptyState(setelan = {}) {
  return {
    version: SCHEMA_VERSION,
    talents: [],
    accounts: [],
    contracts: [],
    obligations: [],
    contents: [],
    videos: [],
    measurements: [],
    events: [],
    setelan,
  };
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Creates an id factory. Tests inject a deterministic one; the browser gets
 * randomness. Ids are permanent — every relation is by id, never by name,
 * because two different people can share a name and one person can rename
 * their account.
 */
export function createIdFactory(seed = "") {
  let counter = 0;
  return (prefix) => {
    counter += 1;
    if (seed) return `${prefix}_${seed}${counter}`;
    const rand =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    return `${prefix}_${rand}${counter}`;
  };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const JAKARTA_OFFSET_MINUTES = 7 * 60;

/**
 * Today's date in Asia/Jakarta as YYYY-MM-DD.
 *
 * The shipped dashboard computes "today" in several places with
 * `new Date().toISOString().split("T")[0]`, which is UTC — so between 00:00
 * and 07:00 WIB it reports yesterday. Pinning the offset here keeps the
 * answer the same regardless of the machine's own timezone setting.
 */
export function todayInJakarta(now = new Date()) {
  const shifted = new Date(now.getTime() + JAKARTA_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Normalises whatever a date field holds into YYYY-MM-DD, or null. Never
 * throws — bad input in an imported row must not abort a whole import. */
export function toIsoDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return todayInJakarta(parsed);
}

// ---------------------------------------------------------------------------
// Video identity
// ---------------------------------------------------------------------------

/**
 * Extracts a stable `{platform, platformVideoId}` from a post URL.
 *
 * This is what makes re-scanning and re-importing safe: the same video always
 * resolves to the same key, so it can be recognised instead of appended
 * again. A URL we cannot parse returns null — the content record still keeps
 * the raw link, it just has no video identity yet, which is honest rather
 * than inventing one.
 */
export function parseVideoUrl(url) {
  if (typeof url !== "string" || url.trim() === "") return null;
  const clean = url.trim();

  const tiktok = clean.match(/tiktok\.com\/@([\w.\-]+)\/video\/(\d+)/i);
  if (tiktok) {
    return { platform: "tiktok", handle: tiktok[1], platformVideoId: tiktok[2] };
  }

  const instagram = clean.match(/instagram\.com\/(?:p|reel|reels)\/([\w-]+)/i);
  if (instagram) {
    return { platform: "instagram", handle: null, platformVideoId: instagram[1] };
  }

  const threads = clean.match(/threads\.(?:net|com)\/@([\w.\-]+)\/post\/([\w-]+)/i);
  if (threads) {
    return { platform: "threads", handle: threads[1], platformVideoId: threads[2] };
  }

  return null;
}

/** Composite key used to recognise a video across scans and imports. */
export function videoKey(platform, platformVideoId) {
  return `${platform}:${platformVideoId}`;
}

// ---------------------------------------------------------------------------
// Handles
// ---------------------------------------------------------------------------

/** Strips the decorations people type around a handle (@, full URL, spaces)
 * so lookups match. Used ONLY for lookup — never to merge two records. */
export function normalizeHandle(raw) {
  if (typeof raw !== "string") return "";
  let value = raw.trim().toLowerCase();
  const fromUrl = value.match(/(?:tiktok\.com|instagram\.com|threads\.net|threads\.com)\/@?([\w.\-]+)/);
  if (fromUrl) value = fromUrl[1];
  return value.replace(/^@/, "");
}

/**
 * Finds the account for a handle on a platform. Returns null when there is no
 * exact match — a near-miss is reported to the caller as "not found" so a
 * person decides, rather than silently attaching one creator's video to
 * another creator's contract.
 */
export function findAccount(state, platform, handle) {
  const wanted = normalizeHandle(handle);
  if (!wanted) return null;
  return (
    state.accounts.find(
      (a) => a.platform === platform && normalizeHandle(a.handle) === wanted,
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

/**
 * Appends an audit event. Confirmations get undone and contracts get
 * corrected; without a record of what changed, a recomputed quota is just a
 * number nobody can check.
 */
export function recordEvent(state, nextId, { type, entity, entityId, detail = {}, at = null }) {
  const event = {
    id: nextId("evt"),
    at: at ?? new Date().toISOString(),
    type,
    entity,
    entityId,
    detail,
  };
  state.events.push(event);
  return event;
}
