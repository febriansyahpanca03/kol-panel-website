/**
 * Storage bootstrap for the relational model.
 *
 * Deliberately additive. The shipped dashboard keeps reading and writing
 * `pantau-talent-data` exactly as before; this writes the migrated model to a
 * separate key and never touches the legacy one. A working tool that people
 * have real contracts in is not something to rewrite underneath them.
 *
 * IMPORTANT — this is not yet shared storage. localStorage is bound to the
 * dashboard's own origin, so the extension (running on tiktok.com) cannot
 * read it. Moving to a store both sides can reach is a separate decision;
 * see the notes in README. Until then the relational state is derived from
 * the legacy state on every load, which is safe precisely because `migrate`
 * is deterministic and idempotent — but it also means anything created only
 * in the new model would not survive. Nothing writes new-model-only data yet.
 */

import { migrate, needsMigration, previewMigration, BACKUP_KEY } from "./migrate.js";
import { SCHEMA_VERSION } from "./model.js";

export const LEGACY_KEY = "pantau-talent-data";
export const V1_KEY = "pantau-talent-v1";

function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // A corrupt entry must not take the dashboard down with it.
    return null;
  }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota exceeded or storage disabled — the legacy data is untouched
    // either way, so failing quietly here loses nothing.
    return false;
  }
}

/**
 * Takes a one-time snapshot of the legacy data before anything else happens.
 * Never overwritten: the point of a pre-migration backup is that it predates
 * every migration, including the ones that went wrong.
 */
export function ensureBackup(storage) {
  if (storage.getItem(BACKUP_KEY) !== null) return false;
  const legacyRaw = storage.getItem(LEGACY_KEY);
  if (legacyRaw === null) return false;
  try {
    storage.setItem(BACKUP_KEY, legacyRaw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Derives the relational state from whatever is in legacy storage.
 *
 * Returns a report rather than throwing, so a page load never fails because
 * of a bad record — the dashboard keeps working on the legacy path regardless.
 */
export function bootstrap(storage, { now = new Date().toISOString() } = {}) {
  const legacy = readJson(storage, LEGACY_KEY);

  if (legacy === null) {
    return { status: "no-data", state: null, warnings: [], backedUp: false };
  }
  if (!needsMigration(legacy)) {
    return { status: "already-current", state: legacy, warnings: [], backedUp: false };
  }

  const backedUp = ensureBackup(storage);
  const { state, warnings } = migrate(legacy, { now });
  const written = writeJson(storage, V1_KEY, state);

  return {
    status: written ? "migrated" : "migrated-not-saved",
    state,
    warnings,
    backedUp,
    counts: {
      talents: state.talents.length,
      accounts: state.accounts.length,
      contracts: state.contracts.length,
      obligations: state.obligations.length,
      contents: state.contents.length,
      videos: state.videos.length,
    },
  };
}

/** Restores the untouched pre-migration snapshot over the legacy key and
 * discards the derived state. */
export function restoreBackup(storage) {
  const backup = storage.getItem(BACKUP_KEY);
  if (backup === null) return false;
  try {
    JSON.parse(backup);
  } catch {
    return false;
  }
  storage.setItem(LEGACY_KEY, backup);
  storage.removeItem(V1_KEY);
  return true;
}

export { previewMigration, SCHEMA_VERSION, BACKUP_KEY };
