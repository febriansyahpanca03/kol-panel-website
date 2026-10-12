/**
 * Biaya & performa: pengeluaran per talent per bulan, CPM/CPV/CPC, penilaian
 * harga (wajar / di atas target / overprice), dan impor performa dari sheet
 * "Post" milik KOL Panel.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import "../data/pantau-core.js";

const C = globalThis.PantauCore;

const TAUFIK = {
  id: "t1", name: "Taufik", account: "MINECRAFTPEDIA", platforms: ["TikTok", "Instagram"], contentType: "video",
  quota: 4, value: 600000, startDate: "2026-09-20", endDate: "2026-10-31", uploadDays: "0,3", dpPercent: 30,
};
const UP = [
  { id: "a", talentId: "t1", date: "2026-09-27", views: 2000, interaksi: 100, klik: 10, link: "https://www.tiktok.com/@minecraftpedia/video/7400000000000000001" },
  { id: "b", talentId: "t1", date: "2026-10-04", views: 4000, interaksi: 300, klik: null, link: "" },
  { id: "c", talentId: "t1", date: "2026-10-11", views: null, link: "" },
  { id: "d", talentId: "t1", date: "2026-10-14", views: 1000, link: "" },
  { id: "e", talentId: "t1", date: "2026-10-18", views: 500, link: "" }, // di atas kuota 4 → bonus
];

describe("buku biaya per bulan", () => {
  const L = C.monthlyLedger([TAUFIK], UP).t1;

  it("biaya = harga per konten × konten tayang bulan itu", () => {
    expect(C.pricePerContent(TAUFIK)).toBe(150000);
    expect(L["2026-09"]).toMatchObject({ konten: 1, biaya: 150000, views: 2000, denganViews: 1 });
    expect(L["2026-10"]).toMatchObject({ konten: 3, biaya: 450000 });
  });

  it("konten di atas kuota adalah bonus, tidak menambah biaya", () => {
    expect(L["2026-10"].bonus).toBe(1);
    const total = Object.values(L).reduce((s, a) => s + a.biaya, 0);
    expect(total).toBe(600000);
  });

  it("views kosong tidak dihitung nol", () => {
    expect(L["2026-10"].denganViews).toBe(3); // b, d, e — c kosong
    expect(L["2026-10"].views).toBe(5500);
  });

  it("jadwal bayar: DP di bulan mulai, pelunasan di bulan berakhir", () => {
    expect(C.paymentSchedule(TAUFIK, 30)).toEqual([
      { month: "2026-09", date: "2026-09-20", jenis: "DP", jumlah: 180000 },
      { month: "2026-10", date: "2026-10-31", jenis: "Pelunasan", jumlah: 420000 },
    ]);
    expect(C.paymentSchedule(TAUFIK, 0)).toHaveLength(1);
  });
});

describe("costMetrics", () => {
  it("menghitung CPM, CPV, CPC, CPE, ER, CTR", () => {
    expect(C.costMetrics({ biaya: 300000, views: 6000, klik: 30, interaksi: 400 })).toEqual({
      cpm: 50000, cpv: 50, cpc: 10000, cpe: 750, er: 400 / 6000 * 100, ctr: 0.5,
    });
  });

  it("tanpa data → null, bukan Rp0", () => {
    expect(C.costMetrics({ biaya: 300000, views: "", klik: 0 })).toMatchObject({ cpm: null, cpv: null, cpc: null });
  });

  it("angka berformat Indonesia terbaca benar", () => {
    expect(C.numOrNull("1.200")).toBe(1200);
    expect(C.numOrNull("Rp 12.500.000")).toBe(12500000);
    expect(C.numOrNull("1,5")).toBe(1.5);
  });
});

describe("priceVerdict", () => {
  const opts = { targetCpm: 100000, overpricePercent: 50 };
  const T = { id: "t", quota: 10, value: 1000000 }; // Rp100.000/konten
  const ups = (views) => views.map((v, i) => ({ id: "u" + i, talentId: "t", date: "2026-10-0" + (i + 1), views: v }));

  it("wajar bila harga ≤ median views/1000 × CPM", () => {
    const v = C.priceVerdict(T, ups([1000, 1200, 900]), opts);
    expect(v.medianViews).toBe(1000);
    expect(v.hargaWajar).toBe(100000);
    expect(v.status).toBe("wajar");
  });

  it("di atas target bila lebih mahal tapi masih di bawah batas", () => {
    expect(C.priceVerdict(T, ups([800, 800, 800]), opts).status).toBe("di-atas"); // 1,25×
  });

  it("overprice bila melewati batas", () => {
    const v = C.priceVerdict(T, ups([500, 400, 600]), opts); // 2×
    expect(v.status).toBe("overprice");
    expect(v.rasio).toBe(2);
  });

  it("satu video viral tidak membuat harga terlihat murah (pakai median)", () => {
    expect(C.priceVerdict(T, ups([400, 500, 90000]), opts).status).toBe("overprice");
  });

  it("data sedikit diberi catatan", () => {
    expect(C.priceVerdict(T, ups([2000]), opts).catatan.join(" ")).toMatch(/Baru 1 konten/);
  });

  it("tanpa views: dibandingkan dengan talent lain sejenis", () => {
    const v = C.priceVerdict(T, [], { ...opts, peerPrices: [30000, 40000, 45000] });
    expect(v.status).toBe("cek");
    expect(v.catatan.join(" ")).toMatch(/2,5× median talent lain/);
    expect(C.priceVerdict(T, [], { ...opts, peerPrices: [90000, 110000] }).status).toBe("tanpa-data");
  });
});

describe("impor performa dari KOL Panel", () => {
  const CSV = [
    "Platform,Username,Post ID,Tanggal,Likes,Comments,Views,Shares,Saves,Replies,Is Paid,Is Pinned,Last Updated",
    "tiktok,minecraftpedia,7400000000000000001,27/09/2026 19:00:00,\"1.000\",50,\"12.000\",20,,,FALSE,FALSE,",
    "instagram,minecraftpedia,3456789,27/09/2026,300,10,\"5.000\",,,,FALSE,FALSE,",
    "tiktok,minecraftpedia,7400000000000000099,04/10/2026,10,1,800,,,,FALSE,FALSE,",
    "tiktok,orang_lain,111111,04/10/2026,1,1,100,,,,FALSE,FALSE,",
  ].join("\n");

  it("membaca CSV: angka ribuan, tanggal hari/bulan/tahun, interaksi = jumlah", () => {
    const { rows } = C.rowsFromKolCsv(CSV);
    expect(rows[0]).toMatchObject({ platform: "tiktok", postId: "7400000000000000001", tgl: "2026-09-27", views: 12000, interaksi: 1070 });
    expect(rows[1].interaksi).toBe(310);
  });

  it("cocok lewat ID di tautan, atau akun + tanggal; mirroring dijumlah per platform", () => {
    const uploads = structuredClone(UP);
    const { rows } = C.rowsFromKolCsv(CSV);
    const plan = C.planKolImport([TAUFIK], uploads, rows);
    expect(plan.cocok.map((c) => [c.uploadId, c.platform, c.via])).toEqual([
      ["a", "tiktok", "tautan"],
      ["a", "instagram", "akun+tanggal"],
      ["b", "tiktok", "akun+tanggal"],
    ]);
    expect(plan.tidakCocok.map((r) => r.username)).toEqual(["orang_lain"]);

    C.applyKolImport(uploads, plan, "x");
    const a = uploads.find((u) => u.id === "a");
    expect(a.views).toBe(17000);
    expect(a.interaksi).toBe(1380);

    // Impor ulang tidak menggandakan: per platform ditimpa, bukan ditambah.
    C.applyKolImport(uploads, C.planKolImport([TAUFIK], uploads, rows), "y");
    expect(uploads.find((u) => u.id === "a").views).toBe(17000);
  });

  it("kolom wajib tidak ada → error yang jelas", () => {
    expect(C.rowsFromKolCsv("Nama,Tanggal\nx,1").error).toBe("kolom");
  });
});

// --------------------------------------------------------------------------
// Halaman
// --------------------------------------------------------------------------

const html = readFileSync(new URL("../pantau-talent.html", import.meta.url), "utf8");
const coreSrc = readFileSync(new URL("../data/pantau-core.js", import.meta.url), "utf8");

function bukaHalaman(talents, uploads, setelan = {}) {
  return new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://kol-panel-website.vercel.app/pantau-talent.html",
    resources: undefined,
    beforeParse(window) {
      const store = new Map();
      store.set("pantau-talent-data", JSON.stringify({ talents, uploads, setelan }));
      Object.defineProperty(window, "localStorage", {
        value: {
          getItem: (k) => (store.has(k) ? store.get(k) : null),
          setItem: (k, v) => store.set(k, String(v)),
          removeItem: (k) => store.delete(k),
        },
        configurable: true,
      });
      window.Date.now = () => Date.parse("2026-10-12T03:00:00Z");
      window.confirm = vi.fn(() => true);
      window.alert = vi.fn();
      window.eval(coreSrc);
    },
  });
}

const simpanan = (dom) => JSON.parse(dom.window.localStorage.getItem("pantau-talent-data"));

describe("tab Biaya & Performa", () => {
  const MAHAL = { ...TAUFIK, id: "t2", name: "Mahal", account: "mahal", value: 2000000, quota: 4 }; // Rp500rb/konten
  const upMahal = [
    { id: "m1", talentId: "t2", date: "2026-10-01", views: 1000, link: "" },
    { id: "m2", talentId: "t2", date: "2026-10-05", views: 1200, link: "" },
    { id: "m3", talentId: "t2", date: "2026-10-08", views: 900, link: "" },
  ];

  it("ringkasan bulan berjalan: biaya konten tayang dan jadwal bayar", () => {
    const dom = bukaHalaman([TAUFIK], UP);
    const doc = dom.window.document;
    expect(doc.getElementById("biayaMonth").value).toBe("2026-10");
    expect(doc.querySelector('[data-summary="biaya"]').textContent).toMatch(/450\.000/);
    expect(doc.querySelector('[data-summary="kas"]').textContent).toMatch(/420\.000/); // pelunasan Okt
  });

  it("ganti bulan mengubah angka", () => {
    const dom = bukaHalaman([TAUFIK], UP);
    const doc = dom.window.document;
    const sel = doc.getElementById("biayaMonth");
    sel.value = "2026-09";
    sel.dispatchEvent(new dom.window.Event("change"));
    expect(doc.querySelector('[data-summary="biaya"]').textContent).toMatch(/150\.000/);
    expect(doc.querySelector('[data-summary="kas"]').textContent).toMatch(/180\.000/); // DP Sep
  });

  it("matriks per bulan menjumlah ke nilai kontrak", () => {
    const dom = bukaHalaman([TAUFIK], UP);
    const foot = dom.window.document.querySelector("#biayaMatrix tfoot").textContent;
    expect(foot).toMatch(/600\.000/);
  });

  it("talent overprice diberi catatan di tab Biaya dan di kartu", () => {
    const dom = bukaHalaman([TAUFIK, MAHAL], [...UP, ...upMahal]);
    const doc = dom.window.document;
    const baris = doc.querySelector('[data-biaya-talent="t2"]');
    expect(baris.querySelector('[data-price-status]').dataset.priceStatus).toBe("overprice");
    expect(baris.textContent).toMatch(/Lebih mahal 400% dari harga wajar/);
    const kartu = doc.querySelector('[data-talent-id="t2"] [data-card-price]');
    expect(kartu.querySelector('[data-price-status]').dataset.priceStatus).toBe("overprice");
  });

  it("target CPM dari setelan dipakai", () => {
    const dom = bukaHalaman([MAHAL], upMahal, { targetCpm: 500000 });
    const st = dom.window.document.querySelector('[data-biaya-talent="t2"] [data-price-status]').dataset.priceStatus;
    expect(st).toBe("wajar");
  });

  it("kalkulator menghitung CPM/CPV/CPC dan menilai harga per konten", () => {
    const dom = bukaHalaman([TAUFIK], UP);
    const doc = dom.window.document;
    const isi = (id, v) => { doc.getElementById(id).value = v; doc.getElementById(id).dispatchEvent(new dom.window.Event("input")); };
    isi("calcBiaya", "600.000");
    isi("calcViews", "12.000");
    isi("calcKlik", "60");
    isi("calcKonten", "4");
    expect(doc.querySelector('[data-calc="cpm"]').textContent).toMatch(/50\.000/);
    expect(doc.querySelector('[data-calc="cpv"]').textContent).toMatch(/50/);
    expect(doc.querySelector('[data-calc="cpc"]').textContent).toMatch(/10\.000/);
    // 3.000 views/konten × Rp100rb/1000 = Rp300rb wajar; harga Rp150rb → wajar
    expect(doc.querySelector("#calcResults [data-price-status]").dataset.priceStatus).toBe("wajar");
  });

  it("kalkulator bisa diisi dari talent", () => {
    const dom = bukaHalaman([TAUFIK], UP);
    const doc = dom.window.document;
    const sel = doc.getElementById("calcTalent");
    sel.value = "t1";
    sel.dispatchEvent(new dom.window.Event("change"));
    expect(doc.getElementById("calcKonten").value).toBe("4"); // 4 upload ber-views
    expect(doc.getElementById("calcViews").value).toBe("7500");
    expect(doc.getElementById("calcBiaya").value).toBe("450000"); // upload ke-5 bonus, Rp0
  });
});

describe("entri upload menyimpan performa", () => {
  it("views/interaksi/klik bisa diisi saat mengedit; kosong tetap kosong", () => {
    const dom = bukaHalaman([TAUFIK], [{ id: "x", talentId: "t1", date: "2026-10-04", title: "", link: "" }]);
    const doc = dom.window.document;
    doc.querySelector('[data-edit-upload="x"]').click();
    doc.getElementById("recordUploadViews").value = "12.500";
    doc.getElementById("recordUploadKlik").value = "40";
    doc.getElementById("recordUploadForm").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    expect(simpanan(dom).uploads[0]).toMatchObject({ views: 12500, klik: 40, interaksi: null });
  });
});
