import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../data/migrate.js";
import { createIdFactory, SOURCE } from "../data/model.js";
import { planImport, applyImport, ROW_OUTCOME } from "../data/import.js";
import { obligationProgress, attachVideoToContent, upsertVideo } from "../data/quota.js";
import { projectToLegacy } from "../data/projection.js";

const NOW = "2026-09-10T03:00:00.000Z";
const TODAY = "2026-09-10";

function baseState() {
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
          notionName: "Rina Wijaya",
        },
      ],
      uploads: [],
      setelan: {},
    },
    { now: NOW },
  );
  return state;
}

describe("planImport", () => {
  let state;

  beforeEach(() => {
    state = baseState();
  });

  it("does not change state — planning is not applying", () => {
    const before = JSON.stringify(state);
    planImport(state, [{ nama: "Rina Wijaya", tgl: "2026-09-05", status: "Published" }], { today: TODAY });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("only treats an explicitly published status as delivered", () => {
    const plan = planImport(
      state,
      [
        { nama: "Rina Wijaya", tgl: "2026-09-02", status: "Published", judul: "A" },
        { nama: "Rina Wijaya", tgl: "2026-09-03", status: "Draft", judul: "B" },
        { nama: "Rina Wijaya", tgl: "2026-09-04", judul: "C" },
      ],
      { today: TODAY },
    );

    expect(plan.ringkasan).toMatchObject({ baru: 1, belumTayang: 2 });
  });

  it("says why a row was not counted", () => {
    const plan = planImport(state, [{ nama: "Rina Wijaya", tgl: "2026-09-03", status: "Draft" }], { today: TODAY });
    expect(plan.entries[0].reason).toContain("Draft");
  });

  it("keeps both videos when a talent posted twice in one day", () => {
    // The legacy importer deduped on date alone and lost the second.
    const plan = planImport(
      state,
      [
        { nama: "Rina Wijaya", tgl: "2026-09-05", status: "Published", judul: "Pagi" },
        { nama: "Rina Wijaya", tgl: "2026-09-05", status: "Published", judul: "Sore" },
      ],
      { today: TODAY },
    );
    expect(plan.ringkasan.baru).toBe(2);
  });

  it("matches on the Notion name or the account handle, exactly", () => {
    const plan = planImport(
      state,
      [
        { nama: "Rina Wijaya", tgl: "2026-09-02", status: "Published", judul: "A" },
        { nama: "rina_creator", tgl: "2026-09-03", status: "Published", judul: "B" },
        { nama: "Rina Wijaya Kusuma", tgl: "2026-09-04", status: "Published", judul: "C" },
      ],
      { today: TODAY },
    );
    expect(plan.ringkasan.baru).toBe(2);
    expect(plan.ringkasan.talentTidakDikenal).toBe(1);
    expect(plan.unknownNames).toEqual(["Rina Wijaya Kusuma"]);
  });

  it("flags rows outside any contract period and in the future", () => {
    const plan = planImport(
      state,
      [
        { nama: "Rina Wijaya", tgl: "2026-08-20", status: "Published", judul: "Sebelum" },
        { nama: "Rina Wijaya", tgl: "2026-09-20", status: "Published", judul: "Nanti" },
      ],
      { today: TODAY },
    );
    expect(plan.ringkasan.diLuarPeriode).toBe(2);
  });

  it("marks cancelled rows as cancelled, not as delivered", () => {
    const plan = planImport(state, [{ nama: "Rina Wijaya", tgl: "2026-09-05", status: "Dibatalkan" }], { today: TODAY });
    expect(plan.entries[0].outcome).toBe(ROW_OUTCOME.DIBATALKAN);
  });

  it("reports an unreadable date instead of skipping it silently", () => {
    const plan = planImport(state, [{ nama: "Rina Wijaya", tgl: "kemarin", status: "Published" }], { today: TODAY });
    expect(plan.entries[0].outcome).toBe(ROW_OUTCOME.TANGGAL_TIDAK_VALID);
  });

  it("handles junk input without throwing", () => {
    expect(() => planImport(state, null, { today: TODAY })).not.toThrow();
    expect(planImport(state, [null, {}], { today: TODAY }).ringkasan.total).toBe(2);
  });
});

describe("applyImport", () => {
  let state;
  let nextId;

  beforeEach(() => {
    state = baseState();
    nextId = createIdFactory("i");
  });

  const rows = [
    { nama: "Rina Wijaya", tgl: "2026-09-02", status: "Published", judul: "A" },
    { nama: "Rina Wijaya", tgl: "2026-09-03", status: "Published", judul: "B" },
    { nama: "Rina Wijaya", tgl: "2026-09-04", status: "Draft", judul: "C" },
  ];

  it("adds only the rows the plan approved", () => {
    const plan = planImport(state, rows, { today: TODAY });
    const result = applyImport(state, nextId, plan, { now: NOW });
    expect(result.added).toBe(2);
    expect(state.contents).toHaveLength(2);
    expect(obligationProgress(state, state.obligations[0].id).confirmed).toBe(2);
  });

  it("is safe to run twice — a re-import adds nothing", () => {
    applyImport(state, nextId, planImport(state, rows, { today: TODAY }), { now: NOW });
    const second = planImport(state, rows, { today: TODAY });

    expect(second.ringkasan).toMatchObject({ baru: 0, duplikat: 2 });
    const result = applyImport(state, nextId, second, { now: NOW });
    expect(result.added).toBe(0);
    expect(obligationProgress(state, state.obligations[0].id).confirmed).toBe(2);
  });

  it("marks what it created as coming from Notion", () => {
    applyImport(state, nextId, planImport(state, rows, { today: TODAY }), { now: NOW });
    expect(state.contents.every((c) => c.source === SOURCE.NOTION)).toBe(true);
  });

  it("keeps imported history that has no video link", () => {
    applyImport(state, nextId, planImport(state, rows, { today: TODAY }), { now: NOW });
    expect(state.contents.every((c) => c.videoId === null)).toBe(true);
    expect(state.contents.every((c) => c.confirmedAt !== null)).toBe(true);
  });

  it("lets a video be attached later without counting a second upload", () => {
    applyImport(state, nextId, planImport(state, rows, { today: TODAY }), { now: NOW });
    const before = obligationProgress(state, state.obligations[0].id).confirmed;

    const video = upsertVideo(state, nextId, {
      platform: "tiktok",
      platformVideoId: "7412345678901234567",
      url: "https://www.tiktok.com/@rina_creator/video/7412345678901234567",
    });
    expect(attachVideoToContent(state, nextId, state.contents[0].id, video.id)).toBe(true);

    expect(obligationProgress(state, state.obligations[0].id).confirmed).toBe(before);
    expect(state.contents).toHaveLength(2);
    expect(state.events.some((e) => e.type === "content.video_attached")).toBe(true);
  });

  it("refuses to overwrite a video that is already attached", () => {
    applyImport(state, nextId, planImport(state, rows, { today: TODAY }), { now: NOW });
    const a = upsertVideo(state, nextId, { platform: "tiktok", platformVideoId: "111" });
    const b = upsertVideo(state, nextId, { platform: "tiktok", platformVideoId: "222" });
    const contentId = state.contents[0].id;

    expect(attachVideoToContent(state, nextId, contentId, a.id)).toBe(true);
    expect(attachVideoToContent(state, nextId, contentId, b.id)).toBe(false);
    expect(state.contents.find((c) => c.id === contentId).videoId).toBe(a.id);
  });

  it("shows up in the legacy projection so existing screens keep working", () => {
    applyImport(state, nextId, planImport(state, rows, { today: TODAY }), { now: NOW });
    const legacy = projectToLegacy(state, TODAY);
    expect(legacy.uploads).toHaveLength(2);
    expect(legacy.talents[0].quota).toBe(8);
  });
});
