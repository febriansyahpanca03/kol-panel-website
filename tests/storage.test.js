import { beforeEach, describe, expect, it } from "vitest";
import { bootstrap, ensureBackup, restoreBackup, LEGACY_KEY, V1_KEY } from "../data/storage.js";
import { BACKUP_KEY } from "../data/migrate.js";

/** Minimal localStorage stand-in, with a switch to simulate a full quota. */
function makeStorage(initial = {}, { failWrites = false } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (failWrites) throw new Error("QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

const legacyJson = JSON.stringify({
  talents: [{ id: "talent-1", name: "Rina", account: "@rina", platform: "tiktok", quota: 8, value: 4_000_000 }],
  uploads: [{ id: "upload-1", talentId: "talent-1", date: "2026-09-02", title: "A", link: "" }],
  setelan: { companyName: "Senov Shop" },
});

describe("bootstrap", () => {
  it("migrates legacy data and writes it under a separate key", () => {
    const storage = makeStorage({ [LEGACY_KEY]: legacyJson });
    const report = bootstrap(storage);

    expect(report.status).toBe("migrated");
    expect(report.counts).toMatchObject({ talents: 1, contracts: 1, contents: 1 });
    expect(storage.getItem(V1_KEY)).not.toBeNull();
  });

  it("leaves the legacy key exactly as it found it", () => {
    const storage = makeStorage({ [LEGACY_KEY]: legacyJson });
    bootstrap(storage);
    expect(storage.getItem(LEGACY_KEY)).toBe(legacyJson);
  });

  it("takes a backup before migrating", () => {
    const storage = makeStorage({ [LEGACY_KEY]: legacyJson });
    const report = bootstrap(storage);
    expect(report.backedUp).toBe(true);
    expect(storage.getItem(BACKUP_KEY)).toBe(legacyJson);
  });

  it("never overwrites an existing backup", () => {
    // The pre-migration snapshot must predate every migration, including a
    // later one that produced bad data.
    const original = JSON.stringify({ talents: [], uploads: [], setelan: {} });
    const storage = makeStorage({ [LEGACY_KEY]: legacyJson, [BACKUP_KEY]: original });
    bootstrap(storage);
    expect(storage.getItem(BACKUP_KEY)).toBe(original);
  });

  it("reports no-data for a first-time visitor", () => {
    const report = bootstrap(makeStorage());
    expect(report.status).toBe("no-data");
    expect(report.state).toBeNull();
  });

  it("does not re-migrate state that is already current", () => {
    const storage = makeStorage({ [LEGACY_KEY]: JSON.stringify({ version: 1, talents: [] }) });
    expect(bootstrap(storage).status).toBe("already-current");
  });

  it("survives a corrupt legacy entry instead of taking the page down", () => {
    const storage = makeStorage({ [LEGACY_KEY]: "{ rusak" });
    expect(() => bootstrap(storage)).not.toThrow();
    expect(bootstrap(storage).status).toBe("no-data");
  });

  it("reports when the derived state could not be saved", () => {
    const storage = makeStorage({ [LEGACY_KEY]: legacyJson }, { failWrites: true });
    const report = bootstrap(storage);
    expect(report.status).toBe("migrated-not-saved");
    // Still returns the migrated state so the caller can use it in memory.
    expect(report.state.talents).toHaveLength(1);
  });

  it("is safe to run on every page load", () => {
    const storage = makeStorage({ [LEGACY_KEY]: legacyJson });
    bootstrap(storage, { now: "2026-09-10T00:00:00.000Z" });
    const first = storage.getItem(V1_KEY);
    bootstrap(storage, { now: "2026-09-10T00:00:00.000Z" });
    expect(storage.getItem(V1_KEY)).toBe(first);
  });
});

describe("ensureBackup", () => {
  it("does nothing when there is no legacy data to protect", () => {
    const storage = makeStorage();
    expect(ensureBackup(storage)).toBe(false);
    expect(storage.getItem(BACKUP_KEY)).toBeNull();
  });
});

describe("restoreBackup", () => {
  let storage;

  beforeEach(() => {
    storage = makeStorage({ [LEGACY_KEY]: legacyJson });
    bootstrap(storage);
  });

  it("puts the original data back and drops the derived state", () => {
    storage.setItem(LEGACY_KEY, JSON.stringify({ talents: [], uploads: [], setelan: {} }));
    expect(restoreBackup(storage)).toBe(true);
    expect(storage.getItem(LEGACY_KEY)).toBe(legacyJson);
    expect(storage.getItem(V1_KEY)).toBeNull();
  });

  it("refuses when there is no backup", () => {
    expect(restoreBackup(makeStorage())).toBe(false);
  });

  it("refuses to restore a corrupt backup over good data", () => {
    const bad = makeStorage({ [LEGACY_KEY]: legacyJson, [BACKUP_KEY]: "{ rusak" });
    expect(restoreBackup(bad)).toBe(false);
    expect(bad.getItem(LEGACY_KEY)).toBe(legacyJson);
  });
});
