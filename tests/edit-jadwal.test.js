/**
 * Edit jadwal per slot: geser tanggal satu jadwal tanpa mengubah yang lain;
 * jadwal yang sudah terisi upload terkunci; tanggal di luar periode ditolak.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import "../data/pantau-core.js";

const C = globalThis.PantauCore;

// Selasa tiap minggu, 3 video, Oktober 2026 → 6, 13, 20 Okt.
const T = { id: "t1", name: "Hezel", account: "MIMIN CHINDO", platforms: ["TikTok"], platform: "TikTok", contentType: "video",
  quota: 3, value: 300000, startDate: "2026-10-01", endDate: "2026-10-31", uploadDays: "2" };
const UP = [{ id: "u1", talentId: "t1", date: "2026-10-06", title: "Disahkan dari kalender", link: "" }];

describe("rescheduleSlots", () => {
  it("menggeser satu jadwal, yang lain tetap", () => {
    const r = C.rescheduleSlots(T, UP, [{ from: "2026-10-13", to: "2026-10-15" }], "2026-10-10", "x");
    expect(C.buildSchedule(r.talent)).toEqual(["2026-10-06", "2026-10-15", "2026-10-20"]);
    expect(r.talent.changeLog).toEqual([{ at: "x", field: "jadwal", label: "Pindah jadwal", from: "2026-10-13", to: "2026-10-15" }]);
    expect(C.talentMetrics(r.talent, UP, "2026-10-10").slots[0].status).toBe("done");
  });

  it("jadwal terlewat juga bisa digeser (mis. talent minta mundur)", () => {
    const r = C.rescheduleSlots(T, UP, [{ from: "2026-10-13", to: "2026-10-22" }], "2026-10-19", "x");
    expect(r.error).toBeUndefined();
    expect(C.talentMetrics(r.talent, UP, "2026-10-19").behind).toBe(0);
  });

  it("jadwal yang sudah terisi upload terkunci", () => {
    expect(C.rescheduleSlots(T, UP, [{ from: "2026-10-06", to: "2026-10-08" }], "2026-10-10", "x").error).toMatch(/sudah terisi/);
  });

  it("tanggal di luar periode ditolak", () => {
    expect(C.rescheduleSlots(T, UP, [{ from: "2026-10-20", to: "2026-11-02" }], "2026-10-10", "x").error).toMatch(/di luar periode/);
  });

  it("surat yang sudah dibuat ditandai perlu dibuat ulang", () => {
    const r = C.rescheduleSlots({ ...T, letters: [{ version: 1 }] }, UP, [{ from: "2026-10-20", to: "2026-10-21" }], "2026-10-10", "x");
    expect(r.talent.letterStale).toBe(true);
  });

  it("tanpa perubahan: tidak ada catatan", () => {
    expect(C.rescheduleSlots(T, UP, [{ from: "2026-10-20", to: "2026-10-20" }], "2026-10-10", "x").moved).toBe(0);
  });
});

const html = readFileSync(new URL("../pantau-talent.html", import.meta.url), "utf8");
const coreSrc = readFileSync(new URL("../data/pantau-core.js", import.meta.url), "utf8");

function bukaHalaman() {
  const store = new Map([["pantau-talent-data", JSON.stringify({ talents: [T], uploads: UP, setelan: {} })]]);
  return new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://kol-panel-website.vercel.app/pantau-talent.html",
    resources: undefined,
    beforeParse(window) {
      Object.defineProperty(window, "localStorage", {
        value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
        configurable: true,
      });
      window.Date.now = () => Date.parse("2026-10-10T03:00:00Z");
      window.confirm = vi.fn(() => true);
      window.alert = vi.fn();
      window.eval(coreSrc);
    },
  });
}

const simpanan = (dom) => JSON.parse(dom.window.localStorage.getItem("pantau-talent-data"));

describe("halaman: Edit Jadwal", () => {
  it("dari kartu: jadwal terisi terkunci, sisanya bisa diubah dan disimpan", () => {
    const dom = bukaHalaman();
    const doc = dom.window.document;
    doc.querySelector('[data-edit-jadwal="t1"]').click();
    expect(doc.getElementById("jadwalModal").classList.contains("active")).toBe(true);
    const inputs = [...doc.querySelectorAll("#jadwalList [data-jadwal-from]")];
    expect(inputs.map((i) => i.value)).toEqual(["2026-10-13", "2026-10-20"]); // 6 Okt terkunci

    inputs[0].value = "2026-10-15";
    doc.getElementById("jadwalSaveBtn").click();
    const t = simpanan(dom).talents[0];
    expect(t.uploadDates).toEqual(["2026-10-06", "2026-10-15", "2026-10-20"]);
    expect(simpanan(dom).uploads).toEqual(UP);
    expect(doc.getElementById("jadwalModal").classList.contains("active")).toBe(false);
  });

  it("tanggal di luar periode → pesan error, tidak tersimpan", () => {
    const dom = bukaHalaman();
    const doc = dom.window.document;
    doc.querySelector('[data-edit-jadwal="t1"]').click();
    doc.querySelector('#jadwalList [data-jadwal-from="2026-10-20"]').value = "2026-11-03";
    doc.getElementById("jadwalSaveBtn").click();
    expect(doc.getElementById("jadwalError").textContent).toMatch(/di luar periode/);
    expect(simpanan(dom).talents[0].uploadDates).toBeUndefined();
  });

  it("dari kalender: tombol Geser jadwal membuka editor dengan tanggal itu disorot", () => {
    const dom = bukaHalaman();
    const doc = dom.window.document;
    doc.querySelector('[data-tab="kalender"]').click();
    doc.querySelector('[data-cal-talent="t1"][data-cal-date="2026-10-13"]').click();
    expect(doc.getElementById("calDetailEditJadwalBtn").style.display).toBe("");
    doc.getElementById("calDetailEditJadwalBtn").click();
    expect(doc.querySelector("#jadwalList .is-focus [data-jadwal-from]").value).toBe("2026-10-13");
  });
});
