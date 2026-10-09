/**
 * Jenis konten selain video, platform lebih dari satu (mirroring), dan
 * jadwal upload yang dipilih lewat tombol hari atau tanggal di kalender.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import "../data/pantau-core.js";

const C = globalThis.PantauCore;

describe("core: jenis konten & platform", () => {
  it("kontrak lama tanpa jenis dianggap video", () => {
    expect(C.contentTypeOf({}).id).toBe("video");
    expect(C.contentTypeOf({ contentType: "poster" }).unit).toBe("poster");
  });

  it("platform lama berupa satu string tetap terbaca; yang baru berupa daftar", () => {
    expect(C.platformsOf({ platform: "TikTok" })).toEqual(["TikTok"]);
    expect(C.platformsOf({ platform: "tiktok, Instagram" })).toEqual(["TikTok", "Instagram"]);
    expect(C.platformsOf({ platforms: ["Instagram", "TikTok", "Instagram"], platform: "Lainnya" })).toEqual(["Instagram", "TikTok"]);
  });

  it("'Lainnya' saja atau kosong = platform belum diisi", () => {
    expect(C.platformMissing({ platform: "Lainnya" })).toBe(true);
    expect(C.platformMissing({ platforms: [] })).toBe(true);
    expect(C.platformMissing({ platforms: ["TikTok", "Lainnya"] })).toBe(false);
  });

  it("mengubah platform/jenis tercatat dengan label yang bisa dibaca", () => {
    const before = { id: "t", platform: "Lainnya", quota: 5 };
    const r = C.planContractEdit(before, { platforms: ["TikTok", "Instagram"], contentType: "poster" }, [], "2026-10-09", "x");
    expect(r.changes).toEqual([
      { field: "platforms", label: "Platform", from: "Lainnya", to: "TikTok, Instagram" },
      { field: "contentType", label: "Jenis konten", from: "Video", to: "Poster / foto feed" },
    ]);
  });

  it("kontrak lama tanpa jenis yang disimpan ulang sebagai video bukan perubahan", () => {
    const r = C.planContractEdit({ id: "t", platform: "TikTok", quota: 5 }, { platforms: ["TikTok"], contentType: "video" }, [], "2026-10-09", "x");
    expect(r.changes).toEqual([]);
  });
});

describe("core: tanggal upload pilihan", () => {
  const T = { id: "t", quota: 3, startDate: "2026-10-01", endDate: "2026-10-31" };

  it("slot mengikuti tanggal yang dipilih, di dalam periode, maksimal sebanyak kuota", () => {
    expect(C.buildSchedule({ ...T, uploadDates: ["2026-10-20", "2026-10-05", "2026-11-02", "2026-10-05"] }))
      .toEqual(["2026-10-05", "2026-10-20"]);
    expect(C.buildSchedule({ ...T, uploadDates: ["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23"] }))
      .toEqual(["2026-10-02", "2026-10-09", "2026-10-16"]);
  });

  it("kurang tanggal dari kuota dilaporkan", () => {
    const m = C.talentMetrics({ ...T, uploadDates: ["2026-10-05"] }, [], "2026-10-01");
    expect(m.unscheduled).toBe(2);
    expect(m.scheduleMode).toBe("tanggal");
  });

  it("mengganti tanggal di tengah kontrak tidak menggeser slot yang sudah lewat", () => {
    const awal = { ...T, uploadDates: ["2026-10-02", "2026-10-09", "2026-10-16"] };
    const r = C.planContractEdit(awal, { uploadDates: ["2026-10-02", "2026-10-09", "2026-10-28"] }, [], "2026-10-12", "x");
    expect(C.buildSchedule(r.talent)).toEqual(["2026-10-02", "2026-10-09", "2026-10-28"]);
    expect(r.removed).toEqual(["2026-10-16"]);
    expect(r.added).toEqual(["2026-10-28"]);
  });
});

// --------------------------------------------------------------------------
// Formulir di halaman
// --------------------------------------------------------------------------

const html = readFileSync(new URL("../pantau-talent.html", import.meta.url), "utf8");
const coreSrc = readFileSync(new URL("../data/pantau-core.js", import.meta.url), "utf8");

function bukaHalaman(talents = []) {
  return new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://kol-panel-website.vercel.app/pantau-talent.html",
    resources: undefined,
    beforeParse(window) {
      const store = new Map();
      store.set("pantau-talent-data", JSON.stringify({ talents, uploads: [], setelan: {} }));
      Object.defineProperty(window, "localStorage", {
        value: {
          getItem: (k) => (store.has(k) ? store.get(k) : null),
          setItem: (k, v) => store.set(k, String(v)),
          removeItem: (k) => store.delete(k),
        },
        configurable: true,
      });
      window.Date.now = () => Date.parse("2026-10-09T03:00:00Z");
      window.confirm = vi.fn(() => true);
      window.alert = vi.fn();
      window.eval(coreSrc);
    },
  });
}

const simpanan = (dom) => JSON.parse(dom.window.localStorage.getItem("pantau-talent-data"));

function isiDasar(doc) {
  doc.getElementById("addTalentBtn").click();
  doc.getElementById("talentName").value = "Taufik";
  doc.getElementById("talentAccount").value = "MINECRAFTPEDIA";
  doc.getElementById("talentQuota").value = "4";
  doc.getElementById("talentStartDate").value = "2026-10-12";
  doc.getElementById("talentEndDate").value = "2026-10-31";
  doc.getElementById("talentValue").value = "600000";
}

const submit = (dom) =>
  dom.window.document.getElementById("talentForm").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));

describe("formulir tambah talent", () => {
  it("TikTok dan Instagram tercentang bawaan; bisa memilih lebih dari satu platform", () => {
    const dom = bukaHalaman();
    const doc = dom.window.document;
    isiDasar(doc);
    const dicentang = [...doc.querySelectorAll('[name="talentPlatform"]:checked')].map((c) => c.value);
    expect(dicentang).toEqual(["TikTok", "Instagram"]);

    doc.querySelector('[name="talentPlatform"][value="YouTube"]').checked = true;
    doc.querySelector('[data-day-chip="1"]').click();
    submit(dom);
    const t = simpanan(dom).talents[0];
    expect(t.platforms).toEqual(["TikTok", "Instagram", "YouTube"]);
    expect(t.platform).toBe("TikTok, Instagram, YouTube");
  });

  it("tanpa platform tidak bisa disimpan", () => {
    const dom = bukaHalaman();
    const doc = dom.window.document;
    isiDasar(doc);
    doc.querySelectorAll('[name="talentPlatform"]').forEach((c) => { c.checked = false; });
    doc.querySelector('[data-day-chip="1"]').click();
    submit(dom);
    expect(simpanan(dom).talents).toHaveLength(0);
    expect(doc.getElementById("talentPlatformsError").hidden).toBe(false);
  });

  it("jenis konten poster tersimpan dan tampil di kartu", () => {
    const dom = bukaHalaman();
    const doc = dom.window.document;
    isiDasar(doc);
    doc.getElementById("talentContentType").value = "poster";
    doc.getElementById("talentContentType").dispatchEvent(new dom.window.Event("change"));
    expect(doc.getElementById("talentQuotaLabel").textContent).toBe("Kuota Poster / foto feed");
    doc.querySelector('[data-day-chip="3"]').click();
    submit(dom);

    expect(simpanan(dom).talents[0].contentType).toBe("poster");
    const kartu = doc.querySelector(".talent-card");
    expect(kartu.querySelector(".quota-caption").textContent).toMatch(/0 dari 4 poster/);
    expect(kartu.textContent).toMatch(/Poster \/ foto feed/);
  });

  it("hari upload dipilih lewat tombol, bukan diketik", () => {
    const dom = bukaHalaman();
    const doc = dom.window.document;
    isiDasar(doc);
    doc.querySelector('[data-day-chip="0"]').click(); // Minggu
    doc.querySelector('[data-day-chip="3"]').click(); // Rabu
    doc.querySelector('[data-day-chip="5"]').click(); // Jumat
    doc.querySelector('[data-day-chip="5"]').click(); // batal Jumat
    expect(doc.querySelector('[data-day-chip="3"]').getAttribute("aria-pressed")).toBe("true");
    expect(doc.getElementById("talentSchedPreview").textContent).toMatch(/4 jadwal video/);
    submit(dom);
    expect(simpanan(dom).talents[0].uploadDays).toBe("0,3");
  });

  it("mode tetap 'hari' tapi belum ada hari dipilih: ditolak", () => {
    const dom = bukaHalaman();
    isiDasar(dom.window.document);
    submit(dom);
    expect(simpanan(dom).talents).toHaveLength(0);
    expect(dom.window.document.getElementById("talentSchedPreview").textContent).toMatch(/Pilih minimal satu hari/);
  });

  it("tanggal dipilih langsung di kalender mini; klik nama hari memilih semua hari itu", () => {
    const dom = bukaHalaman();
    const doc = dom.window.document;
    isiDasar(doc);
    doc.querySelector('[data-sched-mode="tanggal"]').click();

    expect(doc.querySelector('[data-pick-date="2026-10-05"]').disabled).toBe(true); // sebelum periode
    doc.querySelector('[data-pick-date="2026-10-14"]').click();
    doc.querySelector('[data-pick-date="2026-10-20"]').click();
    doc.querySelector('[data-pick-date="2026-10-20"]').click(); // batal
    expect(doc.getElementById("talentUploadDates").value).toBe("2026-10-14");

    doc.querySelector('[data-pick-weekday="6"]').click(); // semua Sabtu: 17, 24, 31
    expect(doc.getElementById("talentUploadDates").value).toBe("2026-10-14,2026-10-17,2026-10-24,2026-10-31");

    submit(dom);
    const t = simpanan(dom).talents[0];
    expect(t.uploadDates).toEqual(["2026-10-14", "2026-10-17", "2026-10-24", "2026-10-31"]);
    expect(t.uploadDays).toBe("");
  });

  it("talent lama berplatform Lainnya diberi penanda dan bisa disaring", () => {
    const lama = { id: "t1", name: "Abyan", account: "AZET MC", platform: "Lainnya", quota: 5,
      startDate: "2026-10-01", endDate: "2026-10-31", value: 1, uploadDays: "" };
    const dom = bukaHalaman([lama]);
    const doc = dom.window.document;
    expect(doc.querySelector("[data-platform-missing]")).not.toBeNull();

    doc.querySelector('[data-edit-talent="t1"]').click();
    expect([...doc.querySelectorAll('[name="talentPlatform"]:checked')].map((c) => c.value)).toEqual(["Lainnya"]);
    expect(doc.querySelector('[data-sched-mode="rata"]').classList.contains("active")).toBe(true);
  });
});
