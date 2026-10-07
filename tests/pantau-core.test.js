/**
 * Tahap 1 — angka yang saling bertentangan.
 *
 * Kasus nyata: Abyan Zandra Widhyadana (AZET MC). Kuota 30, kontrak
 * 29 Jun – 27 Sep 2026, hari upload kosong, 31 riwayat dari Notion pada
 * Rabu/Jumat/Minggu 1 Jul – 9 Sep. Dashboard lama menampilkan 103%, SISA 0,
 * 20 jadwal terlewat, dan tertinggal 0 — sekaligus.
 */

import { describe, expect, it } from "vitest";
import "../data/pantau-core.js";

const C = globalThis.PantauCore;

const ABYAN = {
  id: "talent-1",
  name: "Abyan Zandra Widhyadana",
  account: "AZET MC",
  platform: "Lainnya",
  quota: 30,
  startDate: "2026-06-29",
  endDate: "2026-09-27",
  uploadDays: "",
  notionName: "",
};

/** Rabu, Jumat, Minggu dari 1 Jul sampai 9 Sep 2026: 31 tanggal. */
function abyanUploads() {
  const out = [];
  for (let d = "2026-07-01"; d <= "2026-09-09"; d = C.addDays(d, 1)) {
    const dow = new Date(d + "T00:00:00Z").getUTCDay();
    if ([0, 3, 5].includes(dow)) {
      out.push({ id: `upload-notion-1-${out.length + 1}`, talentId: "talent-1", date: d, title: "Dari Notion Content Calendar", link: "" });
    }
  }
  return out;
}

const TODAY = "2026-09-25";

describe("talentMetrics — kasus Abyan", () => {
  const uploads = abyanUploads();
  const m = C.talentMetrics(ABYAN, uploads, TODAY);

  it("fixture sesuai data asli: 31 upload untuk kuota 30", () => {
    expect(uploads).toHaveLength(31);
  });

  it("kelebihan ditampilkan sebagai +1, bukan dipotong jadi sisa 0 saja", () => {
    expect(m.percent).toBe(103);
    expect(m.remaining).toBe(0);
    expect(m.over).toBe(1);
  });

  it("kuota penuh berarti tidak ada jadwal terlewat", () => {
    expect(m.pendingDates).toEqual([]);
    expect(m.behind).toBe(0);
  });

  it("tertinggal dan jadwal terlewat adalah angka yang sama", () => {
    expect(m.behind).toBe(m.pendingDates.length);
  });

  it("satu upload mengisi paling banyak satu slot", () => {
    const ids = m.slots.map((s) => s.uploadId).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(30);
  });

  it("upload yang tanggalnya sama dengan slot mengesahkan slot itu", () => {
    const byDate = m.slots.filter((s) => s.matchedBy === "tanggal");
    // Slot sebar-rata yang kebetulan jatuh di Rab/Jum/Min.
    expect(byDate.length).toBe(9);
    byDate.forEach((s) => {
      const u = uploads.find((x) => x.id === s.uploadId);
      expect(u.date).toBe(s.date);
    });
  });

  it("jadwal berasal dari sebar-rata karena hari upload kosong", () => {
    expect(m.scheduleMode).toBe("rata");
    expect(m.slots).toHaveLength(30);
    expect(m.slots[0].date).toBe("2026-06-30");
    expect(m.slots[29].date).toBe("2026-09-26");
  });

  it("sisa hari kontrak dihitung dari hari ini WIB", () => {
    expect(m.daysLeft).toBe(2);
  });
});

describe("talentMetrics — pencocokan slot", () => {
  const T = { id: "t", quota: 3, startDate: "2026-09-01", endDate: "2026-09-30", uploadDays: "1" }; // Senin

  it("slot mengikuti hari upload", () => {
    expect(C.buildSchedule(T)).toEqual(["2026-09-07", "2026-09-14", "2026-09-21"]);
  });

  it("upload di hari lain tetap mengisi slot terlewat paling awal", () => {
    const m = C.talentMetrics(T, [{ id: "u1", talentId: "t", date: "2026-09-09" }], "2026-09-22");
    expect(m.slots[0]).toMatchObject({ date: "2026-09-07", status: "done", matchedBy: "urutan" });
    expect(m.pendingDates).toEqual(["2026-09-14", "2026-09-21"]);
    expect(m.behind).toBe(2);
    expect(m.remaining).toBe(2);
  });

  it("dua upload di tanggal slot yang sama: satu mengesahkan slot itu, satu mengisi slot berikutnya", () => {
    const up = [
      { id: "a", talentId: "t", date: "2026-09-07" },
      { id: "b", talentId: "t", date: "2026-09-07" },
    ];
    const m = C.talentMetrics(T, up, "2026-09-22");
    expect(m.slots.map((s) => s.uploadId)).toEqual(["a", "b", null]);
    expect(m.behind).toBe(1);
  });

  it("slot hari ini belum dihitung terlewat", () => {
    const m = C.talentMetrics(T, [], "2026-09-14");
    expect(m.pendingDates).toEqual(["2026-09-07"]);
    expect(m.todaySlotOpen).toBe(true);
    expect(m.target).toBe(2);
  });

  it("kuota yang tidak muat di jadwal dilaporkan", () => {
    const m = C.talentMetrics({ ...T, quota: 6 }, [], "2026-09-01");
    expect(m.slots).toHaveLength(4);
    expect(m.unscheduled).toBe(2);
  });

  it("upload talent lain tidak ikut terhitung", () => {
    const m = C.talentMetrics(T, [{ id: "x", talentId: "lain", date: "2026-09-07" }], "2026-09-22");
    expect(m.uploaded).toBe(0);
  });
});

describe("impor Notion — dedupe", () => {
  const CSV_TANPA_ID = [
    "Content name,Film date,Status",
    "AZET MC,\"July 1, 2026\",Done",
    "AZET MC,\"July 3, 2026\",Done",
    "AZET MC,\"July 3, 2026\",Done",
    "Orang Lain,\"July 3, 2026\",Done",
  ].join("\n");

  const CSV_DENGAN_ID = [
    "Content name,Film date,URL",
    "AZET MC,2026-07-01,https://www.notion.so/Video-1-0123456789abcdef0123456789abcdef",
    "AZET MC,2026-07-01,https://www.notion.so/Video-2-fedcba9876543210fedcba9876543210",
    "AZET MC,2026-07-03,https://www.notion.so/Video-3-11111111222222223333333344444444",
  ].join("\n");

  function impor(uploads, csv) {
    const { rows } = C.rowsFromNotionCsv(csv);
    const plan = C.planNotionImport([ABYAN], uploads, rows, TODAY);
    plan.klaim.forEach((k) => { uploads.find((u) => u.id === k.uploadId).notionId = k.notionId; });
    uploads.push(...plan.baru);
    return plan;
  }

  it("CSV tanpa ID: dedupe talent + tanggal, dua kali impor = nol entri baru", () => {
    const uploads = [];
    const pertama = impor(uploads, CSV_TANPA_ID);
    expect(pertama.baru).toHaveLength(2);
    expect(pertama.asing).toEqual(["Orang Lain"]);

    const kedua = impor(uploads, CSV_TANPA_ID);
    expect(kedua.baru).toHaveLength(0);
    expect(uploads).toHaveLength(2);
  });

  it("CSV ber-ID: dua halaman di tanggal yang sama tetap dua video", () => {
    const uploads = [];
    const pertama = impor(uploads, CSV_DENGAN_ID);
    expect(pertama.baru).toHaveLength(3);
    expect(uploads.map((u) => u.notionId)).toContain("0123456789abcdef0123456789abcdef");

    const kedua = impor(uploads, CSV_DENGAN_ID);
    expect(kedua.baru).toHaveLength(0);
    expect(kedua.duplikat).toBe(3);
    expect(uploads).toHaveLength(3);
  });

  it("riwayat lama tanpa ID diklaim, bukan digandakan, saat CSV ber-ID pertama kali diimpor", () => {
    const uploads = [
      { id: "lama-1", talentId: "talent-1", date: "2026-07-01", title: "Dari Notion Content Calendar", link: "" },
      { id: "lama-2", talentId: "talent-1", date: "2026-07-03", title: "Dari Notion Content Calendar", link: "" },
    ];
    const plan = impor(uploads, CSV_DENGAN_ID);
    // 7/1 punya dua halaman: satu mengklaim entri lama, satu benar-benar baru.
    expect(plan.klaim).toHaveLength(2);
    expect(plan.baru).toHaveLength(1);
    expect(uploads).toHaveLength(3);

    expect(impor(uploads, CSV_DENGAN_ID).baru).toHaveLength(0);
  });

  it("baris di luar periode kontrak atau di masa depan tidak masuk", () => {
    const csv = "Content name,Film date\nAZET MC,2026-06-01\nAZET MC,2026-09-26";
    const plan = C.planNotionImport([ABYAN], [], C.rowsFromNotionCsv(csv).rows, TODAY);
    expect(plan.baru).toHaveLength(0);
    expect(plan.diLuarPeriode).toBe(2);
  });

  it("ID halaman dikenali dari UUID bertanda hubung maupun ujung URL", () => {
    expect(C.normalizeNotionId("01234567-89ab-cdef-0123-456789abcdef")).toBe("0123456789abcdef0123456789abcdef");
    expect(C.normalizeNotionId("https://www.notion.so/ws/Judul-0123456789ABCDEF0123456789ABCDEF?pvs=4"))
      .toBe("0123456789abcdef0123456789abcdef");
    expect(C.normalizeNotionId("CC-12")).toBe("CC-12");
  });
});

describe("findDuplicateUploads", () => {
  it("menemukan salinan dengan ID Notion sama dan salinan persis", () => {
    const up = [
      { id: "1", talentId: "t", date: "2026-07-01", notionId: "abc" },
      { id: "2", talentId: "t", date: "2026-07-01", notionId: "abc" },
      { id: "3", talentId: "t", date: "2026-07-02", title: "x", link: "l" },
      { id: "4", talentId: "t", date: "2026-07-02", title: "x", link: "l" },
      { id: "5", talentId: "t", date: "2026-07-02", title: "y", link: "m" },
    ];
    expect(C.findDuplicateUploads(up).map((u) => u.id)).toEqual(["2", "4"]);
  });

  it("riwayat Abyan tidak punya salinan ganda", () => {
    expect(C.findDuplicateUploads(abyanUploads())).toEqual([]);
  });
});
