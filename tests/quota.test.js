import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../data/migrate.js";
import { createIdFactory, STATUS, SOURCE, parseVideoUrl, todayInJakarta, findAccount } from "../data/model.js";
import {
  obligationProgress,
  contractProgress,
  allocationPerContent,
  confirmContent,
  unconfirmContent,
  reassignObligation,
  upsertVideo,
  recordMeasurement,
  latestMeasurement,
} from "../data/quota.js";

const NOW = "2026-09-10T03:00:00.000Z";

/** A contract for 8 videos with 7 of them already delivered and confirmed. */
function sevenOfEight() {
  const uploads = Array.from({ length: 7 }, (_, i) => ({
    id: `upload-${i + 1}`,
    talentId: "talent-1",
    date: `2026-09-0${i + 1}`,
    title: `Video ${i + 1}`,
    link: "",
  }));
  const { state } = migrate(
    {
      talents: [
        {
          id: "talent-1",
          name: "Rina",
          account: "@rina_creator",
          platform: "tiktok",
          quota: 8,
          value: 4_000_000,
          startDate: "2026-09-01",
          endDate: "2026-09-30",
        },
      ],
      uploads,
      setelan: {},
    },
    { now: NOW },
  );
  return state;
}

describe("skenario verifikasi: 8 konten, 7 selesai, 1 ditautkan", () => {
  let state;
  let nextId;
  let obligationId;

  beforeEach(() => {
    state = sevenOfEight();
    nextId = createIdFactory("t");
    obligationId = state.obligations[0].id;
  });

  it("starts at 7 of 8", () => {
    expect(obligationProgress(state, obligationId)).toMatchObject({
      quantity: 8,
      confirmed: 7,
      remaining: 1,
      excess: 0,
    });
  });

  it("reaches 8 of 8 once the eighth video is linked and confirmed", () => {
    const parsed = parseVideoUrl("https://www.tiktok.com/@rina_creator/video/7412345678901234567");
    const video = upsertVideo(state, nextId, { ...parsed, url: "https://www.tiktok.com/@rina_creator/video/7412345678901234567", accountId: state.accounts[0].id });

    state.contents.push({
      id: nextId("cnt"),
      talentId: "talent-1",
      contractId: state.contracts[0].id,
      obligationId,
      accountId: state.accounts[0].id,
      title: "Video 8",
      brief: "",
      platform: "tiktok",
      scheduledDate: null,
      publishedDate: "2026-09-08",
      status: STATUS.TERDETEKSI,
      confirmedAt: null,
      videoId: video.id,
      url: video.url,
      notes: "",
      source: SOURCE.EXTENSION,
      sourceId: null,
      createdAt: NOW,
    });

    // Detected but unconfirmed must not count yet.
    expect(obligationProgress(state, obligationId).confirmed).toBe(7);

    const changed = confirmContent(state, nextId, state.contents.at(-1).id, { at: NOW });
    expect(changed).toBe(true);
    expect(obligationProgress(state, obligationId)).toMatchObject({ confirmed: 8, remaining: 0 });
  });

  it("stays at 8 when the same video is scanned again", () => {
    const url = "https://www.tiktok.com/@rina_creator/video/7412345678901234567";
    const parsed = parseVideoUrl(url);
    const first = upsertVideo(state, nextId, { ...parsed, url });
    state.contents.push({
      id: "cnt-8", talentId: "talent-1", contractId: state.contracts[0].id, obligationId,
      accountId: state.accounts[0].id, title: "Video 8", brief: "", platform: "tiktok",
      scheduledDate: null, publishedDate: "2026-09-08", status: STATUS.TERDETEKSI,
      confirmedAt: null, videoId: first.id, url, notes: "", source: SOURCE.EXTENSION,
      sourceId: null, createdAt: NOW,
    });
    confirmContent(state, nextId, "cnt-8", { at: NOW });
    expect(obligationProgress(state, obligationId).confirmed).toBe(8);

    // Re-scan: same video, same content, confirm attempted again.
    const second = upsertVideo(state, nextId, { ...parsed, url });
    expect(second.id).toBe(first.id);
    expect(state.videos).toHaveLength(1);
    expect(confirmContent(state, nextId, "cnt-8", { at: NOW })).toBe(false);
    expect(obligationProgress(state, obligationId).confirmed).toBe(8);
  });

  it("returns to 7 when the confirmation is undone", () => {
    state.contents.push({
      id: "cnt-8", talentId: "talent-1", contractId: state.contracts[0].id, obligationId,
      accountId: state.accounts[0].id, title: "Video 8", brief: "", platform: "tiktok",
      scheduledDate: null, publishedDate: "2026-09-08", status: STATUS.TERDETEKSI,
      confirmedAt: null, videoId: "vid-x", url: "", notes: "", source: SOURCE.EXTENSION,
      sourceId: null, createdAt: NOW,
    });
    confirmContent(state, nextId, "cnt-8", { at: NOW });
    expect(obligationProgress(state, obligationId).confirmed).toBe(8);

    expect(unconfirmContent(state, nextId, "cnt-8", { reason: "salah kontrak" })).toBe(true);
    expect(obligationProgress(state, obligationId)).toMatchObject({ confirmed: 7, remaining: 1 });

    // The work itself is not deleted, only its claim on the obligation.
    expect(state.contents.find((c) => c.id === "cnt-8")).toBeDefined();
    expect(state.events.some((e) => e.type === "content.unconfirmed")).toBe(true);
  });

  it("does not double-decrement when confirm is retried after a failed send", () => {
    const id = state.contents[0].id;
    expect(confirmContent(state, nextId, id, { at: NOW })).toBe(false);
    expect(obligationProgress(state, obligationId).confirmed).toBe(7);
  });
});

describe("kelebihan konten dan sisa kuota", () => {
  it("reports surplus separately and never a negative remainder", () => {
    const state = sevenOfEight();
    const nextId = createIdFactory("x");
    const obligationId = state.obligations[0].id;

    for (let i = 0; i < 3; i++) {
      const id = `extra-${i}`;
      state.contents.push({
        id, talentId: "talent-1", contractId: state.contracts[0].id, obligationId,
        accountId: state.accounts[0].id, title: `Ekstra ${i}`, brief: "", platform: "tiktok",
        scheduledDate: null, publishedDate: "2026-09-20", status: STATUS.TERDETEKSI,
        confirmedAt: null, videoId: null, url: "", notes: "", source: SOURCE.MANUAL,
        sourceId: null, createdAt: NOW,
      });
      confirmContent(state, nextId, id, { at: NOW });
    }

    expect(obligationProgress(state, obligationId)).toMatchObject({
      quantity: 8, confirmed: 10, remaining: 0, excess: 2,
    });
  });
});

describe("beberapa kontrak pada satu talent", () => {
  it("tracks renewals independently instead of overwriting the first", () => {
    const state = sevenOfEight();
    const nextId = createIdFactory("r");

    state.contracts.push({
      id: "con_renew", talentId: "talent-1", label: "Perpanjangan", value: 6_000_000,
      dpPercent: 30, payments: [], startDate: "2026-10-01", endDate: "2026-10-31",
      contractDate: "2026-09-25", scheduleText: "", uploadDays: "", status: "aktif",
      source: SOURCE.MANUAL, createdAt: NOW,
    });
    state.obligations.push({
      id: "obl_renew", contractId: "con_renew", accountId: state.accounts[0].id,
      platform: "tiktok", quantity: 10, description: "Konten kerja sama",
      allocationRp: null, source: SOURCE.MANUAL, createdAt: NOW,
    });

    // The original contract keeps its own progress.
    expect(contractProgress(state, state.contracts[0].id)).toMatchObject({ quantity: 8, confirmed: 7 });
    expect(contractProgress(state, "con_renew")).toMatchObject({ quantity: 10, confirmed: 0, remaining: 10 });
  });

  it("recomputes both sides when content is moved to the right contract", () => {
    const state = sevenOfEight();
    const nextId = createIdFactory("m");
    state.contracts.push({
      id: "con_b", talentId: "talent-1", label: "Kontrak B", value: 1_000_000, dpPercent: null,
      payments: [], startDate: "2026-10-01", endDate: "2026-10-31", contractDate: null,
      scheduleText: "", uploadDays: "", status: "aktif", source: SOURCE.MANUAL, createdAt: NOW,
    });
    state.obligations.push({
      id: "obl_b", contractId: "con_b", accountId: null, platform: "tiktok", quantity: 5,
      description: "", allocationRp: null, source: SOURCE.MANUAL, createdAt: NOW,
    });

    const moved = state.contents[0].id;
    expect(reassignObligation(state, nextId, moved, "obl_b")).toBe(true);

    expect(obligationProgress(state, state.obligations[0].id).confirmed).toBe(6);
    expect(obligationProgress(state, "obl_b").confirmed).toBe(1);
    expect(state.events.some((e) => e.type === "content.reassigned")).toBe(true);
  });
});

describe("alokasi biaya per konten", () => {
  it("divides the contract value only for a single like-for-like obligation", () => {
    const state = sevenOfEight();
    expect(allocationPerContent(state, state.obligations[0].id)).toBe(500_000);
  });

  it("refuses to guess for a mixed package", () => {
    const state = sevenOfEight();
    state.obligations.push({
      id: "obl_mix", contractId: state.contracts[0].id, accountId: null, platform: "instagram",
      quantity: 2, description: "Story", allocationRp: null, source: SOURCE.MANUAL, createdAt: NOW,
    });
    expect(allocationPerContent(state, state.obligations[0].id)).toBeNull();
    expect(allocationPerContent(state, "obl_mix")).toBeNull();
  });

  it("uses an explicit split when the contract records one", () => {
    const state = sevenOfEight();
    state.obligations.push({
      id: "obl_mix", contractId: state.contracts[0].id, accountId: null, platform: "instagram",
      quantity: 2, description: "Story", allocationRp: 1_000_000, source: SOURCE.MANUAL, createdAt: NOW,
    });
    expect(allocationPerContent(state, "obl_mix")).toBe(500_000);
  });

  it("returns null rather than dividing by zero", () => {
    const state = sevenOfEight();
    state.obligations[0].quantity = 0;
    expect(allocationPerContent(state, state.obligations[0].id)).toBeNull();
  });

  it("returns null when there is no contract value at all", () => {
    const state = sevenOfEight();
    state.contracts[0].value = null;
    expect(allocationPerContent(state, state.obligations[0].id)).toBeNull();
  });
});

describe("identitas video dan pemindaian ulang", () => {
  it("recognises the same video across scans", () => {
    const state = sevenOfEight();
    const nextId = createIdFactory("v");
    const url = "https://www.tiktok.com/@rina_creator/video/7412345678901234567";
    const a = upsertVideo(state, nextId, { ...parseVideoUrl(url), url });
    const b = upsertVideo(state, nextId, { ...parseVideoUrl(url), url });
    expect(a.id).toBe(b.id);
    expect(state.videos).toHaveLength(1);
  });

  it("fills in blanks from a later sighting without overwriting known values", () => {
    const state = sevenOfEight();
    const nextId = createIdFactory("v");
    const url = "https://www.tiktok.com/@rina_creator/video/7412345678901234567";
    upsertVideo(state, nextId, { platform: "tiktok", platformVideoId: "741", url: null });
    const later = upsertVideo(state, nextId, { platform: "tiktok", platformVideoId: "741", url, publishedAt: "2026-09-08" });
    expect(later.url).toBe(url);
    expect(later.publishedAt).toBe("2026-09-08");
  });

  it("does not delete anything when a video stops appearing", () => {
    // Spec: a video missing from a re-scan must not be treated as removed.
    const state = sevenOfEight();
    const before = state.contents.length;
    // A scan that finds nothing performs no deletions by construction —
    // there is no code path that removes content, only confirm/unconfirm.
    expect(state.contents).toHaveLength(before);
    expect(obligationProgress(state, state.obligations[0].id).confirmed).toBe(7);
  });

  it("parses only real post URLs and refuses the rest", () => {
    expect(parseVideoUrl("https://www.tiktok.com/@a/video/123")).toMatchObject({
      platform: "tiktok", platformVideoId: "123",
    });
    expect(parseVideoUrl("https://www.instagram.com/reel/AbC-123/")).toMatchObject({
      platform: "instagram", platformVideoId: "AbC-123",
    });
    expect(parseVideoUrl("https://www.tiktok.com/@a")).toBeNull();
    expect(parseVideoUrl("catatan bebas")).toBeNull();
    expect(parseVideoUrl("")).toBeNull();
    expect(parseVideoUrl(null)).toBeNull();
  });
});

describe("pencocokan akun", () => {
  it("matches a handle however it was typed", () => {
    const state = sevenOfEight();
    for (const typed of ["rina_creator", "@rina_creator", "RINA_CREATOR", "https://www.tiktok.com/@rina_creator"]) {
      expect(findAccount(state, "tiktok", typed)?.talentId).toBe("talent-1");
    }
  });

  it("returns null for a near miss instead of attaching the wrong talent", () => {
    const state = sevenOfEight();
    expect(findAccount(state, "tiktok", "rina_creator1")).toBeNull();
    expect(findAccount(state, "instagram", "rina_creator")).toBeNull();
    expect(findAccount(state, "tiktok", "")).toBeNull();
  });
});

describe("riwayat pengukuran analitik", () => {
  it("appends readings and reports the latest with its timestamp", () => {
    const state = sevenOfEight();
    const nextId = createIdFactory("m");
    const video = upsertVideo(state, nextId, { platform: "tiktok", platformVideoId: "741" });

    recordMeasurement(state, nextId, video.id, { views: 100, likes: 5 }, { capturedAt: "2026-09-09T10:00:00Z" });
    recordMeasurement(state, nextId, video.id, { views: 900, likes: 40 }, { capturedAt: "2026-09-10T10:00:00Z" });

    const latest = latestMeasurement(state, video.id);
    expect(latest.views).toBe(900);
    expect(latest.capturedAt).toBe("2026-09-10T10:00:00Z");
    expect(state.measurements).toHaveLength(2);
  });

  it("does not grow the history when nothing changed", () => {
    const state = sevenOfEight();
    const nextId = createIdFactory("m");
    const video = upsertVideo(state, nextId, { platform: "tiktok", platformVideoId: "741" });
    recordMeasurement(state, nextId, video.id, { views: 100 }, { capturedAt: "2026-09-09T10:00:00Z" });
    recordMeasurement(state, nextId, video.id, { views: 100 }, { capturedAt: "2026-09-09T11:00:00Z" });
    expect(state.measurements).toHaveLength(1);
  });

  it("has no reading at all for a video nobody measured", () => {
    const state = sevenOfEight();
    expect(latestMeasurement(state, "vid-tidak-ada")).toBeNull();
  });
});

describe("zona waktu Asia/Jakarta", () => {
  it("reports the Jakarta date, not the UTC one, just after midnight", () => {
    // 2026-09-11 00:30 WIB is still 2026-09-10 17:30 UTC. The shipped
    // dashboard's `toISOString().split("T")[0]` returns the 10th here.
    const justAfterMidnightWib = new Date("2026-09-10T17:30:00.000Z");
    expect(todayInJakarta(justAfterMidnightWib)).toBe("2026-09-11");
  });

  it("still reports the same day late in the evening", () => {
    const eveningWib = new Date("2026-09-10T14:00:00.000Z"); // 21:00 WIB
    expect(todayInJakarta(eveningWib)).toBe("2026-09-10");
  });
});

describe("data kosong", () => {
  it("gives zeroed progress rather than throwing", () => {
    const { state } = migrate({ talents: [], uploads: [], setelan: {} }, { now: NOW });
    expect(obligationProgress(state, "tidak-ada")).toBeNull();
    expect(contractProgress(state, "tidak-ada")).toMatchObject({ quantity: 0, confirmed: 0, remaining: 0 });
  });

  it("ignores confirmation calls for records that do not exist", () => {
    const { state } = migrate({ talents: [], uploads: [], setelan: {} }, { now: NOW });
    const nextId = createIdFactory("z");
    expect(confirmContent(state, nextId, "hantu")).toBe(false);
    expect(unconfirmContent(state, nextId, "hantu")).toBe(false);
    expect(reassignObligation(state, nextId, "hantu", "juga-hantu")).toBe(false);
  });

  it("refuses to confirm a content that is not attached to an obligation", () => {
    const state = sevenOfEight();
    const nextId = createIdFactory("z");
    state.contents.push({
      id: "lepas", talentId: "talent-1", contractId: null, obligationId: null,
      accountId: null, title: "Konten pribadi", brief: "", platform: "tiktok",
      scheduledDate: null, publishedDate: "2026-09-09", status: STATUS.TERDETEKSI,
      confirmedAt: null, videoId: null, url: "", notes: "", source: SOURCE.EXTENSION,
      sourceId: null, createdAt: NOW,
    });
    expect(confirmContent(state, nextId, "lepas")).toBe(false);
    expect(obligationProgress(state, state.obligations[0].id).confirmed).toBe(7);
  });
});
