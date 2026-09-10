import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../data/migrate.js";
import { createIdFactory, SOURCE, STATUS } from "../data/model.js";
import {
  projectToLegacy,
  activeContract,
  upsertTalentFromLegacy,
  removeTalentCascade,
  recordDeliveredContent,
  removeContent,
} from "../data/projection.js";
import { obligationProgress, confirmContent } from "../data/quota.js";

const NOW = "2026-09-10T03:00:00.000Z";
const TODAY = "2026-09-10";

function baseState() {
  const { state } = migrate(
    {
      talents: [
        {
          id: "talent-1", name: "Rina", account: "@rina_creator", platform: "tiktok",
          quota: 8, value: 4_000_000, dpPercent: 30,
          startDate: "2026-09-01", endDate: "2026-09-30", fullName: "Rina Wijaya",
        },
      ],
      uploads: [{ id: "upload-1", talentId: "talent-1", date: "2026-09-02", title: "A", link: "" }],
      setelan: { companyName: "Senov Shop" },
    },
    { now: NOW },
  );
  return state;
}

describe("projectToLegacy", () => {
  let state;

  beforeEach(() => {
    state = baseState();
  });

  it("renders the relational model in the shape the old screens read", () => {
    const legacy = projectToLegacy(state, TODAY);
    expect(legacy.talents[0]).toMatchObject({
      id: "talent-1", name: "Rina", account: "@rina_creator",
      platform: "tiktok", quota: 8, value: 4_000_000, dpPercent: 30,
      startDate: "2026-09-01", endDate: "2026-09-30",
    });
    expect(legacy.uploads).toHaveLength(1);
    expect(legacy.setelan.companyName).toBe("Senov Shop");
  });

  it("shows only confirmed content as an upload", () => {
    // A detected-but-unmatched video must not quietly count towards quota.
    state.contents.push({
      id: "cnt-detected", talentId: "talent-1", contractId: state.contracts[0].id,
      obligationId: state.obligations[0].id, accountId: state.accounts[0].id,
      title: "Terdeteksi", brief: "", platform: "tiktok", scheduledDate: null,
      publishedDate: "2026-09-06", status: STATUS.TERDETEKSI, confirmedAt: null,
      videoId: null, url: "", notes: "", source: SOURCE.EXTENSION, sourceId: null, createdAt: NOW,
    });

    expect(projectToLegacy(state, TODAY).uploads).toHaveLength(1);

    confirmContent(state, createIdFactory("p"), "cnt-detected", { at: NOW });
    expect(projectToLegacy(state, TODAY).uploads).toHaveLength(2);
  });

  it("reports how many contracts a talent really has", () => {
    state.contracts.push({
      id: "con_b", talentId: "talent-1", label: "Perpanjangan", value: 6_000_000,
      dpPercent: null, payments: [], startDate: "2026-10-01", endDate: "2026-10-31",
      contractDate: null, scheduleText: "", uploadDays: "", status: "aktif",
      source: SOURCE.MANUAL, createdAt: NOW,
    });
    // The legacy shape can only carry one, so the count travels alongside it
    // rather than the extra contract disappearing without trace.
    expect(projectToLegacy(state, TODAY).talents[0]._contractCount).toBe(2);
  });

  it("survives a talent with no contract at all", () => {
    state.talents.push({ id: "t-baru", name: "Belum kontrak", fullName: "", phone: "", address: "", bank: "", notionName: "", source: SOURCE.MANUAL, createdAt: NOW });
    const legacy = projectToLegacy(state, TODAY);
    const fresh = legacy.talents.find((t) => t.id === "t-baru");
    expect(fresh.quota).toBe(0);
    expect(fresh.value).toBeNull();
  });
});

describe("activeContract", () => {
  it("prefers the contract covering today", () => {
    const state = baseState();
    state.contracts.push({
      id: "con_lama", talentId: "talent-1", label: "Lama", value: 1_000_000, dpPercent: null,
      payments: [], startDate: "2026-07-01", endDate: "2026-07-31", contractDate: null,
      scheduleText: "", uploadDays: "", status: "selesai", source: SOURCE.MANUAL, createdAt: NOW,
    });
    expect(activeContract(state, "talent-1", TODAY).id).toBe(state.contracts[0].id);
  });

  it("falls back to the latest-ending contract when none covers today", () => {
    const state = baseState();
    state.contracts[0].endDate = "2026-08-31";
    state.contracts.push({
      id: "con_baru", talentId: "talent-1", label: "Berikutnya", value: 2_000_000, dpPercent: null,
      payments: [], startDate: "2026-11-01", endDate: "2026-11-30", contractDate: null,
      scheduleText: "", uploadDays: "", status: "aktif", source: SOURCE.MANUAL, createdAt: NOW,
    });
    expect(activeContract(state, "talent-1", TODAY).id).toBe("con_baru");
  });

  it("returns null for a talent with no contract", () => {
    expect(activeContract(baseState(), "hantu", TODAY)).toBeNull();
  });
});

describe("upsertTalentFromLegacy", () => {
  let state;
  let nextId;

  beforeEach(() => {
    state = baseState();
    nextId = createIdFactory("u");
  });

  it("creates talent, account, contract and obligation from one form", () => {
    upsertTalentFromLegacy(state, nextId, {
      id: "talent-2", name: "Budi", account: "@budi", platform: "tiktok",
      quota: 12, value: 6_000_000, startDate: "2026-09-01", endDate: "2026-10-31",
    }, { now: NOW });

    expect(state.talents).toHaveLength(2);
    expect(state.accounts.find((a) => a.talentId === "talent-2").handle).toBe("@budi");
    expect(state.obligations.find((o) => o.contractId === "con_talent-2").quantity).toBe(12);
  });

  it("edits the active contract instead of stacking a new one on every save", () => {
    const before = state.contracts.length;
    for (let i = 0; i < 3; i++) {
      upsertTalentFromLegacy(state, nextId, {
        id: "talent-1", name: "Rina", account: "@rina_creator", platform: "tiktok",
        quota: 9, value: 4_500_000, startDate: "2026-09-01", endDate: "2026-09-30",
      }, { now: NOW });
    }
    expect(state.contracts).toHaveLength(before);
    expect(state.obligations.find((o) => o.contractId === state.contracts[0].id).quantity).toBe(9);
  });

  it("renames an account rather than adding a second one", () => {
    upsertTalentFromLegacy(state, nextId, {
      id: "talent-1", name: "Rina", account: "@rina_baru", platform: "tiktok", quota: 8,
    }, { now: NOW });
    const accounts = state.accounts.filter((a) => a.talentId === "talent-1");
    expect(accounts).toHaveLength(1);
    expect(accounts[0].handle).toBe("@rina_baru");
  });

  it("keeps confirmed work when the quota is edited", () => {
    const obligationId = state.obligations[0].id;
    expect(obligationProgress(state, obligationId).confirmed).toBe(1);

    upsertTalentFromLegacy(state, nextId, {
      id: "talent-1", name: "Rina", account: "@rina_creator", platform: "tiktok",
      quota: 20, value: 4_000_000, startDate: "2026-09-01", endDate: "2026-09-30",
    }, { now: NOW });

    expect(obligationProgress(state, obligationId)).toMatchObject({ quantity: 20, confirmed: 1, remaining: 19 });
  });
});

describe("recordDeliveredContent", () => {
  let state;
  let nextId;

  beforeEach(() => {
    state = baseState();
    nextId = createIdFactory("d");
  });

  it("records a delivery and counts it towards the obligation", () => {
    const { content, duplicate } = recordDeliveredContent(state, nextId, {
      talentId: "talent-1", date: "2026-09-06", title: "Video baru", link: "",
    }, { now: NOW });

    expect(duplicate).toBe(false);
    expect(content.confirmedAt).toBe(NOW);
    expect(obligationProgress(state, state.obligations[0].id).confirmed).toBe(2);
  });

  it("refuses a second record of the same video URL", () => {
    const link = "https://www.tiktok.com/@rina_creator/video/7412345678901234567";
    const first = recordDeliveredContent(state, nextId, { talentId: "talent-1", date: "2026-09-06", link }, { now: NOW });
    const second = recordDeliveredContent(state, nextId, { talentId: "talent-1", date: "2026-09-07", link }, { now: NOW });

    expect(second.duplicate).toBe(true);
    expect(second.content.id).toBe(first.content.id);
    expect(obligationProgress(state, state.obligations[0].id).confirmed).toBe(2);
  });

  it("allows two different videos on the same day", () => {
    recordDeliveredContent(state, nextId, { talentId: "talent-1", date: "2026-09-06", title: "Pagi" }, { now: NOW });
    recordDeliveredContent(state, nextId, { talentId: "talent-1", date: "2026-09-06", title: "Sore" }, { now: NOW });
    expect(obligationProgress(state, state.obligations[0].id).confirmed).toBe(3);
  });

  it("does nothing for a talent that does not exist", () => {
    const result = recordDeliveredContent(state, nextId, { talentId: "hantu", date: "2026-09-06" }, { now: NOW });
    expect(result.content).toBeNull();
  });

  it("records content for a talent with no contract, but leaves it unconfirmed", () => {
    state.talents.push({ id: "t-baru", name: "Tanpa kontrak", fullName: "", phone: "", address: "", bank: "", notionName: "", source: SOURCE.MANUAL, createdAt: NOW });
    const { content } = recordDeliveredContent(state, nextId, { talentId: "t-baru", date: "2026-09-06" }, { now: NOW });
    // Nothing to fulfil, so nothing is claimed as fulfilled.
    expect(content.confirmedAt).toBeNull();
    expect(content.obligationId).toBeNull();
  });
});

describe("removeContent dan removeTalentCascade", () => {
  it("removing a content frees the obligation slot again", () => {
    const state = baseState();
    const nextId = createIdFactory("r");
    const id = state.contents[0].id;
    expect(obligationProgress(state, state.obligations[0].id).confirmed).toBe(1);

    expect(removeContent(state, nextId, id)).toBe(true);
    expect(obligationProgress(state, state.obligations[0].id).confirmed).toBe(0);
    expect(state.events.some((e) => e.type === "content.removed")).toBe(true);
  });

  it("removing a talent takes its contracts and contents with it, and says so", () => {
    const state = baseState();
    const nextId = createIdFactory("r");
    expect(removeTalentCascade(state, nextId, "talent-1")).toBe(true);

    expect(state.talents).toHaveLength(0);
    expect(state.accounts).toHaveLength(0);
    expect(state.contracts).toHaveLength(0);
    expect(state.obligations).toHaveLength(0);
    expect(state.contents).toHaveLength(0);

    const event = state.events.find((e) => e.type === "talent.removed");
    expect(event.detail).toMatchObject({ name: "Rina", contracts: 1, contents: 1 });
  });

  it("ignores a delete for something that is not there", () => {
    const state = baseState();
    const nextId = createIdFactory("r");
    expect(removeTalentCascade(state, nextId, "hantu")).toBe(false);
    expect(removeContent(state, nextId, "hantu")).toBe(false);
  });
});
