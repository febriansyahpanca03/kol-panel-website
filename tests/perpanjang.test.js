/**
 * Perpanjang kontrak: talent tetap satu, kontrak berurutan. Kontrak lama
 * diarsipkan utuh; sisa kuota & jadwal dihitung hanya dari kontrak berjalan;
 * biaya bulan lama tidak berubah.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import "../data/pantau-core.js";

const C = globalThis.PantauCore;

// Kontrak #1: 8 video, Rp480.000 (Rp60.000/video), 1–30 Sep.
const ACHMAD = {
  id: "t1", name: "Achmad", account: "LOXINS", platforms: ["TikTok"], platform: "TikTok", contentType: "video",
  quota: 8, value: 480000, startDate: "2026-09-01", endDate: "2026-09-30", uploadDays: "1,4", dpPercent: 30,
  phone: "0812", letters: [{ version: 1, createdAt: "x", data: { quota: 8, value: 480000 }, setelan: {} }],
  changeLog: [],
};
const sep = ["2026-09-03", "2026-09-07", "2026-09-10", "2026-09-14", "2026-09-17", "2026-09-21", "2026-09-24", "2026-09-28"];
const UP = sep.map((d, i) => ({ id: "s" + i, talentId: "t1", date: d, title: "", link: "" }));

describe("renewContract", () => {
  const { talent } = C.renewContract(ACHMAD, { quota: 10, value: 800000, startDate: "2026-10-05", endDate: "2026-11-04" }, "2026-10-15T00:00:00Z");

  it("kontrak lama diarsipkan utuh, termasuk suratnya", () => {
    expect(talent.kontrakLama).toHaveLength(1);
    expect(talent.kontrakLama[0]).toMatchObject({ no: 1, quota: 8, value: 480000, startDate: "2026-09-01", endDate: "2026-09-30" });
    expect(talent.kontrakLama[0].letters).toHaveLength(1);
  });

  it("kontrak baru = #2 dengan surat kosong; identitas tetap", () => {
    expect(talent).toMatchObject({ id: "t1", name: "Achmad", phone: "0812", kontrakNo: 2, quota: 10, value: 800000, letters: [] });
    expect(talent.changeLog[0]).toMatchObject({ field: "kontrak", label: "Perpanjang kontrak" });
  });

  it("menolak periode yang tidak setelah kontrak berjalan", () => {
    expect(C.renewContract(ACHMAD, { startDate: "2026-09-01", endDate: "2026-10-01" }, "x").error).toMatch(/harus mulai setelah/);
    expect(C.renewContract(ACHMAD, { startDate: "2026-10-05", endDate: "2026-10-01" }, "x").error).toMatch(/tidak valid/);
  });

  it("upload dibagi ke kontraknya; sela dua kontrak = di luar kontrak", () => {
    const up = [...UP, { id: "gap", talentId: "t1", date: "2026-10-02" }, { id: "n1", talentId: "t1", date: "2026-10-08" }];
    expect(C.uploadsForContract(talent, up, 1)).toHaveLength(8);
    expect(C.currentUploads(talent, up).map((u) => u.id)).toEqual(["n1"]);
    expect(C.outsideContractUploads(talent, up).map((u) => u.id)).toEqual(["gap"]);
  });

  it("sisa kuota kontrak baru mulai bersih", () => {
    const m = C.talentMetrics(talent, C.currentUploads(talent, UP), "2026-10-15");
    expect(m).toMatchObject({ quota: 10, uploaded: 0, remaining: 10 });
  });

  it("biaya bulan lama tetap memakai harga kontrak lama", () => {
    const sebelum = C.monthlyLedger([ACHMAD], UP).t1["2026-09"].biaya;
    const up = [...UP, { id: "n1", talentId: "t1", date: "2026-10-08" }];
    const L = C.monthlyLedger([talent], up).t1;
    expect(L["2026-09"].biaya).toBe(sebelum);
    expect(L["2026-09"].biaya).toBe(480000);
    expect(L["2026-10"].biaya).toBe(80000);
  });

  it("perpanjangan kedua menambah arsip, nomor naik", () => {
    const k3 = C.renewContract(talent, { startDate: "2026-11-05", endDate: "2026-12-04" }, "y").talent;
    expect(k3.kontrakLama.map((c) => c.no)).toEqual([1, 2]);
    expect(k3.kontrakNo).toBe(3);
  });

  it("data lama tanpa arsip = satu kontrak #1, semua upload miliknya", () => {
    expect(C.contractsOf(ACHMAD).map((c) => c.no)).toEqual([1]);
    const telat = [...UP, { id: "late", talentId: "t1", date: "2026-10-03" }];
    expect(C.currentUploads(ACHMAD, telat)).toHaveLength(9);
  });
});

// --------------------------------------------------------------------------

const html = readFileSync(new URL("../pantau-talent.html", import.meta.url), "utf8");
const coreSrc = readFileSync(new URL("../data/pantau-core.js", import.meta.url), "utf8");

function bukaHalaman(talents, uploads) {
  const store = new Map([["pantau-talent-data", JSON.stringify({ talents, uploads, setelan: {} })]]);
  return new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://kol-panel-website.vercel.app/pantau-talent.html",
    resources: undefined,
    beforeParse(window) {
      Object.defineProperty(window, "localStorage", {
        value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
        configurable: true,
      });
      window.Date.now = () => Date.parse("2026-10-15T03:00:00Z");
      window.confirm = vi.fn(() => true);
      window.alert = vi.fn();
      window.eval(coreSrc);
    },
  });
}

const simpanan = (dom) => JSON.parse(dom.window.localStorage.getItem("pantau-talent-data"));

describe("halaman: perpanjang kontrak", () => {
  it("tombol Perpanjang membuka formulir terisi dengan periode lanjutan", () => {
    const dom = bukaHalaman([ACHMAD], UP);
    const doc = dom.window.document;
    expect(doc.querySelector('[data-talent-id="t1"] .talent-card-quota-number').textContent.trim()).toBe("0");
    doc.querySelector('[data-renew-talent="t1"]').click();
    expect(doc.getElementById("talentModalTitle").textContent).toMatch(/Perpanjang Kontrak.*#2/);
    expect(doc.getElementById("talentStartDate").value).toBe("2026-10-01");
    expect(doc.getElementById("talentEndDate").value).toBe("2026-10-30");
    expect(doc.getElementById("talentQuota").value).toBe("8");
    expect(doc.getElementById("talentName").value).toBe("Achmad");
  });

  it("menyimpan perpanjangan: kartu jadi kontrak #2, sisa kuota baru, riwayat kontrak tampil", () => {
    const dom = bukaHalaman([ACHMAD], UP);
    const doc = dom.window.document;
    doc.querySelector('[data-renew-talent="t1"]').click();
    doc.getElementById("talentQuota").value = "10";
    doc.getElementById("talentValue").value = "800000";
    doc.getElementById("talentForm").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));

    const t = simpanan(dom).talents;
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kontrakNo: 2, quota: 10, value: 800000, startDate: "2026-10-01" });
    expect(simpanan(dom).uploads).toHaveLength(8);

    const kartu = doc.querySelector('[data-talent-id="t1"]');
    expect(kartu.querySelector("[data-kontrak-no]").textContent).toMatch(/Kontrak #2/);
    expect(kartu.querySelector(".talent-card-quota-number").textContent.trim()).toBe("10");
    const arsip = kartu.querySelector('[data-kontrak-arsip="1"]');
    expect(arsip.textContent).toMatch(/8 dari 8 video tayang/);
    expect(arsip.querySelector('[data-arsip-letter="t1|1|1"]')).not.toBeNull();
  });

  it("tab Biaya: bulan lama tidak berubah, nilai kontrak = jumlah semua kontrak", () => {
    const renewed = C.renewContract(ACHMAD, { quota: 10, value: 800000, startDate: "2026-10-01", endDate: "2026-10-30" }, "x").talent;
    const dom = bukaHalaman([renewed], UP);
    const doc = dom.window.document;
    const sel = doc.getElementById("biayaMonth");
    sel.value = "2026-09";
    sel.dispatchEvent(new dom.window.Event("change"));
    expect(doc.querySelector('[data-summary="biaya"]').textContent).toMatch(/480\.000/);
    expect(doc.querySelector("#biayaMatrix tfoot").textContent).toMatch(/1\.280\.000/);
  });
});
