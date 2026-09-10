import { describe, expect, it } from "vitest";
import { migrate, needsMigration, previewMigration, rollback } from "../data/migrate.js";
import { SCHEMA_VERSION, STATUS, SOURCE } from "../data/model.js";

const NOW = "2026-09-10T03:00:00.000Z";

function legacy(overrides = {}) {
  return {
    talents: [
      {
        id: "talent-1",
        name: "Rina",
        account: "@rina_creator",
        platform: "tiktok",
        quota: 8,
        value: 4_000_000,
        dpPercent: 30,
        startDate: "2026-09-01",
        endDate: "2026-09-30",
        contractDate: "2026-08-28",
        fullName: "Rina Wijaya",
        phone: "0812",
        uploadDays: "1,4",
      },
    ],
    uploads: [
      { id: "upload-1", talentId: "talent-1", date: "2026-09-02", title: "Video A", link: "" },
      {
        id: "upload-2",
        talentId: "talent-1",
        date: "2026-09-05",
        title: "Video B",
        link: "https://www.tiktok.com/@rina_creator/video/7412345678901234567",
      },
    ],
    setelan: { dpPercent: 30, companyName: "Senov Shop" },
    ...overrides,
  };
}

describe("needsMigration", () => {
  it("recognises the legacy shape", () => {
    expect(needsMigration(legacy())).toBe(true);
  });

  it("leaves already-migrated state alone", () => {
    expect(needsMigration({ version: SCHEMA_VERSION, talents: [] })).toBe(false);
  });

  it("ignores junk instead of throwing", () => {
    expect(needsMigration(null)).toBe(false);
    expect(needsMigration("nonsense")).toBe(false);
    expect(needsMigration({})).toBe(false);
  });
});

describe("migrate", () => {
  it("splits one legacy talent into talent, account, contract and obligation", () => {
    const { state } = migrate(legacy(), { now: NOW });

    expect(state.talents).toHaveLength(1);
    expect(state.accounts).toHaveLength(1);
    expect(state.contracts).toHaveLength(1);
    expect(state.obligations).toHaveLength(1);

    expect(state.accounts[0].talentId).toBe("talent-1");
    expect(state.contracts[0].talentId).toBe("talent-1");
    expect(state.obligations[0].contractId).toBe(state.contracts[0].id);
    expect(state.obligations[0].quantity).toBe(8);
  });

  it("keeps the original talent id so nothing else has to be rewired", () => {
    const { state } = migrate(legacy(), { now: NOW });
    expect(state.talents[0].id).toBe("talent-1");
  });

  it("carries every upload across as a confirmed content", () => {
    const { state } = migrate(legacy(), { now: NOW });
    expect(state.contents).toHaveLength(2);
    for (const content of state.contents) {
      expect(content.confirmedAt).toBe(NOW);
      expect(content.status).toBe(STATUS.SUDAH_TAYANG);
      expect(content.source).toBe(SOURCE.MIGRASI);
    }
  });

  it("keeps history that never had a video link", () => {
    // Spec: old rows that already counted as uploads must survive even
    // without a link, and must not be counted again when one is added later.
    const { state } = migrate(legacy(), { now: NOW });
    const linkless = state.contents.find((c) => c.sourceId === "upload-1");
    expect(linkless).toBeDefined();
    expect(linkless.videoId).toBeNull();
    expect(linkless.confirmedAt).toBe(NOW);
  });

  it("gives a parseable link a stable video identity", () => {
    const { state } = migrate(legacy(), { now: NOW });
    expect(state.videos).toHaveLength(1);
    expect(state.videos[0].platformVideoId).toBe("7412345678901234567");
    expect(state.videos[0].platform).toBe("tiktok");
  });

  it("records agreed DP without inventing a payment", () => {
    // "Bedakan nilai kontrak, DP, dan pembayaran yang benar-benar tercatat."
    const { state } = migrate(legacy(), { now: NOW });
    expect(state.contracts[0].dpPercent).toBe(30);
    expect(state.contracts[0].payments).toEqual([]);
  });

  it("is idempotent — migrating twice does not duplicate anything", () => {
    const first = migrate(legacy(), { now: NOW }).state;
    const second = migrate(legacy(), { now: NOW }).state;
    expect(second.contents.map((c) => c.id)).toEqual(first.contents.map((c) => c.id));
    expect(second.contracts.map((c) => c.id)).toEqual(first.contracts.map((c) => c.id));
    expect(second.videos.map((v) => v.id)).toEqual(first.videos.map((v) => v.id));
  });

  it("preserves settings untouched", () => {
    const { state } = migrate(legacy(), { now: NOW });
    expect(state.setelan.companyName).toBe("Senov Shop");
  });

  it("handles a completely empty store", () => {
    const { state, warnings } = migrate({ talents: [], uploads: [], setelan: {} }, { now: NOW });
    expect(state.talents).toEqual([]);
    expect(state.contents).toEqual([]);
    expect(warnings).toEqual([]);
    expect(state.version).toBe(SCHEMA_VERSION);
  });

  it("survives missing and malformed fields rather than aborting", () => {
    const broken = {
      talents: [{ id: "t1" }, { name: "tanpa id" }],
      uploads: [{ id: "u1", talentId: "hantu", date: "bukan tanggal" }, { talentId: "t1" }],
      setelan: {},
    };
    const { state, warnings } = migrate(broken, { now: NOW });
    expect(state.talents).toHaveLength(1);
    expect(state.contents).toHaveLength(0);
    expect(warnings.length).toBeGreaterThanOrEqual(3);
  });

  it("warns rather than guessing when a talent has no account", () => {
    const noAccount = legacy({ talents: [{ id: "t1", name: "Tanpa Akun", quota: 4 }], uploads: [] });
    const { state, warnings } = migrate(noAccount, { now: NOW });
    expect(state.accounts).toHaveLength(0);
    expect(state.obligations[0].accountId).toBeNull();
    expect(warnings.join(" ")).toContain("belum punya akun");
  });

  it("never merges two talents that happen to share a name", () => {
    const twins = legacy({
      talents: [
        { id: "t1", name: "Rina", account: "@rina_a", platform: "tiktok", quota: 4 },
        { id: "t2", name: "Rina", account: "@rina_b", platform: "tiktok", quota: 6 },
      ],
      uploads: [],
    });
    const { state } = migrate(twins, { now: NOW });
    expect(state.talents).toHaveLength(2);
    expect(state.contracts).toHaveLength(2);
    expect(new Set(state.accounts.map((a) => a.handle)).size).toBe(2);
  });

  it("logs the migration in the audit trail", () => {
    const { state } = migrate(legacy(), { now: NOW });
    const event = state.events.find((e) => e.type === "state.migrated");
    expect(event).toBeDefined();
    expect(event.detail.contents).toBe(2);
  });
});

describe("previewMigration", () => {
  it("counts what would be produced without applying anything", () => {
    const preview = previewMigration(legacy());
    expect(preview).toMatchObject({ talents: 1, contracts: 1, contents: 2, videos: 1 });
  });
});

describe("rollback", () => {
  it("restores the untouched legacy snapshot", () => {
    const snapshot = JSON.stringify(legacy());
    const restored = rollback(snapshot);
    expect(restored.talents[0].quota).toBe(8);
    expect(restored.uploads).toHaveLength(2);
  });

  it("refuses corrupt input instead of returning half a state", () => {
    expect(rollback("{ bukan json")).toBeNull();
    expect(rollback("")).toBeNull();
    expect(rollback(null)).toBeNull();
  });
});
