/**
 * Tahap 2 — edit kontrak talent.
 *
 * Aturan yang dijaga:
 *  - perubahan kuota/tanggal/hari upload hanya menggeser slot mendatang yang
 *    belum terisi; slot yang sudah lewat atau terisi tetap di tempatnya;
 *  - daftar upload tidak pernah disentuh oleh edit kontrak;
 *  - setiap perubahan tercatat (waktu, kolom, lama → baru);
 *  - surat yang sudah dibuat ditandai perlu dibuat ulang, versi lama tetap ada.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import "../data/pantau-core.js";

const C = globalThis.PantauCore;
const NOW = "2026-09-26T03:00:00.000Z";
const TODAY = "2026-09-26";

// Kontrak 10 video, Senin & Kamis, 1 Sep – 31 Okt 2026.
const RINA = {
  id: "t1", name: "Rina", account: "rina", platform: "TikTok", quota: 10,
  startDate: "2026-09-01", endDate: "2026-10-31", value: 5000000, uploadDays: "1,4",
  fullName: "", phone: "0812", address: "Bekasi", bank: "BCA", scheduleText: "", contractDate: "",
  dpPercent: "", notionName: "",
};
const UPLOADS = [
  { id: "u1", talentId: "t1", date: "2026-09-03", title: "Video 1", link: "https://t/1" },
  { id: "u2", talentId: "t1", date: "2026-09-07", title: "Video 2", link: "https://t/2" },
];

describe("buildSchedule dengan slot terpaku", () => {
  it("jadwal awal Senin & Kamis", () => {
    expect(C.buildSchedule(RINA)).toEqual([
      "2026-09-03", "2026-09-07", "2026-09-10", "2026-09-14", "2026-09-17",
      "2026-09-21", "2026-09-24", "2026-09-28", "2026-10-01", "2026-10-05",
    ]);
  });
});

describe("planContractEdit", () => {
  it("menaikkan kuota hanya menambah slot mendatang", () => {
    const r = C.planContractEdit(RINA, { quota: 12 }, UPLOADS, TODAY, NOW);
    expect(r.scheduleChanged).toBe(true);
    expect(r.kept).toBe(7); // 7 slot sebelum 26 Sep
    expect(r.removed).toEqual([]);
    expect(r.added).toEqual(["2026-10-08", "2026-10-12"]);
  });

  it("mengganti hari upload tidak menggeser slot yang sudah lewat", () => {
    const r = C.planContractEdit(RINA, { uploadDays: "3" }, UPLOADS, TODAY, NOW); // Rabu
    const baru = C.buildSchedule(r.talent);
    expect(baru.filter((d) => d < TODAY)).toEqual(C.buildSchedule(RINA).filter((d) => d < TODAY));
    expect(baru.filter((d) => d >= TODAY)).toEqual(["2026-09-30", "2026-10-07", "2026-10-14"]);
    expect(r.removed).toEqual(["2026-09-28", "2026-10-01", "2026-10-05"]);
    expect(r.added).toEqual(["2026-09-30", "2026-10-07", "2026-10-14"]);
  });

  it("slot mendatang yang sudah terisi upload ikut dipaku", () => {
    const awal = [...UPLOADS, { id: "u3", talentId: "t1", date: "2026-09-28", title: "", link: "" }];
    const r = C.planContractEdit(RINA, { uploadDays: "3" }, awal, TODAY, NOW);
    expect(C.buildSchedule(r.talent)).toContain("2026-09-28");
  });

  it("memperpendek periode menghapus slot mendatang saja", () => {
    const r = C.planContractEdit(RINA, { endDate: "2026-09-30" }, UPLOADS, TODAY, NOW);
    expect(r.removed).toEqual(["2026-10-01", "2026-10-05"]);
    expect(r.added).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/2 kuota tidak muat/);
  });

  it("kuota di bawah slot yang sudah lewat memberi peringatan, slot lama tetap", () => {
    const r = C.planContractEdit(RINA, { quota: 5 }, UPLOADS, TODAY, NOW);
    expect(C.buildSchedule(r.talent)).toHaveLength(7);
    expect(r.warnings.join(" ")).toMatch(/Kuota baru \(5\) lebih kecil dari 7/);
  });

  it("tidak pernah mengubah daftar upload", () => {
    const salinan = structuredClone(UPLOADS);
    C.planContractEdit(RINA, { quota: 3, startDate: "2026-09-20", uploadDays: "" }, UPLOADS, TODAY, NOW);
    expect(UPLOADS).toEqual(salinan);
  });

  it("perubahan non-jadwal tidak memaku jadwal", () => {
    const r = C.planContractEdit(RINA, { phone: "0813" }, UPLOADS, TODAY, NOW);
    expect(r.scheduleChanged).toBe(false);
    expect(r.talent.pinnedSlots).toBeUndefined();
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
  });

  it("mencatat riwayat: waktu, kolom, lama → baru; riwayat lama dipertahankan", () => {
    const pertama = C.planContractEdit(RINA, { quota: 12, value: 6000000 }, UPLOADS, TODAY, NOW).talent;
    const kedua = C.planContractEdit(pertama, { phone: "0813" }, UPLOADS, TODAY, "2026-09-27T01:00:00.000Z").talent;
    expect(kedua.changeLog).toEqual([
      { at: NOW, field: "quota", label: "Kuota", from: "10", to: "12" },
      { at: NOW, field: "value", label: "Nilai kontrak", from: "5000000", to: "6000000" },
      { at: "2026-09-27T01:00:00.000Z", field: "phone", label: "No. kontak", from: "0812", to: "0813" },
    ]);
  });

  it("urutan hari upload yang berbeda bukan perubahan", () => {
    expect(C.planContractEdit(RINA, { uploadDays: "4, 1" }, UPLOADS, TODAY, NOW).changes).toEqual([]);
  });

  it("tanpa perubahan: tidak ada catatan", () => {
    const r = C.planContractEdit(RINA, { ...RINA }, UPLOADS, TODAY, NOW);
    expect(r.changes).toEqual([]);
    expect(r.talent.changeLog).toEqual([]);
  });
});

describe("surat kontrak berversi", () => {
  const setelan = { companyName: "Senov Shop", companyRep: "Panca", dpPercent: 30 };
  const keys = ["companyName", "companyRep"];

  it("versi pertama menyalin isi kontrak saat dibuat", () => {
    const { talent, letter } = C.createLetterVersion(RINA, setelan, keys, 30, NOW);
    expect(letter.version).toBe(1);
    expect(letter.data.quota).toBe(10);
    expect(letter.data.dpPercent).toBe(30);
    expect(letter.setelan).toEqual({ companyName: "Senov Shop", companyRep: "Panca" });
    expect(talent.letters).toHaveLength(1);
    expect(talent.letterStale).toBe(false);
  });

  it("edit kontrak menandai surat perlu dibuat ulang; versi baru tidak menimpa versi lama", () => {
    const v1 = C.createLetterVersion(RINA, setelan, keys, 30, NOW).talent;
    const diedit = C.planContractEdit(v1, { value: 7000000 }, UPLOADS, TODAY, NOW).talent;
    expect(diedit.letterStale).toBe(true);

    const v2 = C.createLetterVersion(diedit, setelan, keys, 30, NOW).talent;
    expect(v2.letters.map((l) => l.version)).toEqual([1, 2]);
    expect(v2.letters[0].data.value).toBe(5000000);
    expect(v2.letters[1].data.value).toBe(7000000);
    expect(v2.letterStale).toBe(false);
  });

  it("mengubah Nama di Notion tidak membuat surat kedaluwarsa", () => {
    const v1 = C.createLetterVersion(RINA, setelan, keys, 30, NOW).talent;
    expect(C.planContractEdit(v1, { notionName: "Rina N" }, UPLOADS, TODAY, NOW).talent.letterStale).toBeFalsy();
  });

  it("belum pernah ada surat: edit tidak memunculkan tanda", () => {
    expect(C.planContractEdit(RINA, { value: 7000000 }, UPLOADS, TODAY, NOW).talent.letterStale).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// Di halaman sungguhan
// --------------------------------------------------------------------------

const html = readFileSync(new URL("../pantau-talent.html", import.meta.url), "utf8");
const coreSrc = readFileSync(new URL("../data/pantau-core.js", import.meta.url), "utf8");

function bukaHalaman(talent = RINA, uploads = UPLOADS) {
  return new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://kol-panel-website.vercel.app/pantau-talent.html",
    resources: undefined,
    beforeParse(window) {
      const store = new Map();
      store.set("pantau-talent-data", JSON.stringify({ talents: [talent], uploads, setelan: {} }));
      Object.defineProperty(window, "localStorage", {
        value: {
          getItem: (k) => (store.has(k) ? store.get(k) : null),
          setItem: (k, v) => store.set(k, String(v)),
          removeItem: (k) => store.delete(k),
        },
        configurable: true,
      });
      window.Date.now = () => Date.parse(NOW);
      window.confirm = vi.fn(() => true);
      window.alert = vi.fn();
      window.eval(coreSrc);
    },
  });
}

const simpanan = (dom) => JSON.parse(dom.window.localStorage.getItem("pantau-talent-data"));

function editKontrak(dom, isian) {
  const doc = dom.window.document;
  doc.querySelector('[data-edit-talent="t1"]').click();
  for (const [id, v] of Object.entries(isian)) doc.getElementById(id).value = v;
  doc.getElementById("talentForm").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
}

describe("halaman: edit kontrak", () => {
  it("tombol Edit membuka formulir yang sudah terisi", () => {
    const dom = bukaHalaman();
    const doc = dom.window.document;
    doc.querySelector('[data-edit-talent="t1"]').click();
    expect(doc.getElementById("talentModal").classList.contains("active")).toBe(true);
    expect(doc.getElementById("talentQuota").value).toBe("10");
    expect(doc.getElementById("talentUploadDays").value).toBe("1,4");
    expect(doc.getElementById("talentBank").value).toBe("BCA");
  });

  it("mengubah kuota menampilkan dampak dulu; belum tersimpan sebelum dikonfirmasi", () => {
    const dom = bukaHalaman();
    const doc = dom.window.document;
    editKontrak(dom, { talentQuota: "12" });

    expect(doc.getElementById("impactModal").classList.contains("active")).toBe(true);
    expect(doc.querySelector('[data-impact="added"]').textContent).toBe("+2");
    expect(doc.querySelector('[data-impact="removed"]').textContent).toBe("−0");
    expect(doc.querySelector('[data-impact="kept"]').textContent).toBe("7");
    expect(simpanan(dom).talents[0].quota).toBe(10);

    doc.getElementById("impactConfirmBtn").click();
    const t = simpanan(dom).talents[0];
    expect(t.quota).toBe(12);
    expect(t.changeLog).toHaveLength(1);
    expect(simpanan(dom).uploads).toEqual(UPLOADS);
  });

  it("Kembali ke formulir membatalkan tanpa menyimpan", () => {
    const dom = bukaHalaman();
    const doc = dom.window.document;
    editKontrak(dom, { talentEndDate: "2026-09-30" });
    doc.getElementById("impactBackBtn").click();
    expect(simpanan(dom).talents[0].endDate).toBe("2026-10-31");
    expect(doc.getElementById("talentModal").classList.contains("active")).toBe(true);
  });

  it("perubahan non-jadwal langsung tersimpan dan muncul di riwayat kartu", () => {
    const dom = bukaHalaman();
    const doc = dom.window.document;
    editKontrak(dom, { talentPhone: "0899" });
    expect(doc.getElementById("impactModal").classList.contains("active")).toBe(false);
    const log = doc.querySelector('[data-talent-id="t1"] .change-log');
    expect(log.textContent).toMatch(/No\. kontak/);
    expect(log.textContent).toMatch(/0812\s*→\s*0899/);
  });

  it("surat yang sudah dibuat ditandai perlu dibuat ulang setelah kontrak diubah", () => {
    const denganSurat = C.createLetterVersion(RINA, {}, [], 30, NOW).talent;
    const dom = bukaHalaman(denganSurat);
    const doc = dom.window.document;
    expect(doc.querySelector("[data-letter-stale]")).toBeNull();

    editKontrak(dom, { talentValue: "6000000" });
    const kartu = doc.querySelector('[data-talent-id="t1"]');
    expect(kartu.querySelector("[data-letter-stale]").textContent).toMatch(/perlu dibuat ulang/);
    expect(kartu.querySelector('[data-contract-pdf="t1"]').textContent).toMatch(/Buat Surat v2/);
    expect(kartu.querySelector('[data-letter-version="t1|1"]')).not.toBeNull();
  });
});

describe("halaman: entri riwayat upload", () => {
  it("bisa diedit (tanggal, judul, tautan) tanpa mengubah ID-nya", () => {
    const dom = bukaHalaman();
    const doc = dom.window.document;
    doc.querySelector('[data-edit-upload="u1"]').click();
    expect(doc.getElementById("recordUploadDate").value).toBe("2026-09-03");
    expect(doc.getElementById("recordUploadLink").value).toBe("https://t/1");

    doc.getElementById("recordUploadDate").value = "2026-09-04";
    doc.getElementById("recordUploadTitle").value = "Video 1 (revisi)";
    doc.getElementById("recordUploadLink").value = "https://t/1b";
    doc.getElementById("recordUploadForm").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));

    const u = simpanan(dom).uploads;
    expect(u).toHaveLength(2);
    expect(u.find((x) => x.id === "u1")).toMatchObject({ date: "2026-09-04", title: "Video 1 (revisi)", link: "https://t/1b" });
  });

  it("hapus meminta konfirmasi; dibatalkan berarti tidak terhapus", () => {
    const dom = bukaHalaman();
    const w = dom.window;
    w.confirm = vi.fn(() => false);
    w.document.querySelector('[data-delete-upload="u1"]').click();
    expect(w.confirm).toHaveBeenCalledOnce();
    expect(simpanan(dom).uploads).toHaveLength(2);

    w.confirm = vi.fn(() => true);
    w.document.querySelector('[data-delete-upload="u1"]').click();
    expect(simpanan(dom).uploads.map((u) => u.id)).toEqual(["u2"]);
  });
});
