/**
 * Layak lanjut, pembayaran, ringkasan harian, penjualan (ROAS), anggaran,
 * "sudah tayang sebelum didata", impor Notion berstatus, dan endpoint
 * Telegram (manual + cron).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import "../data/pantau-core.js";
import notify from "../api/notify.js";
import reminder, { todayJakarta } from "../api/reminder.js";
import { KEY } from "../api/data.js";

const C = globalThis.PantauCore;
const TODAY = "2026-10-20";

// Senin tiap minggu, 4 video, Rp400rb (Rp100rb/video), Oktober 2026 → 5, 12, 19, 26.
const RINA = { id: "t1", name: "Rina", account: "rina", platforms: ["TikTok"], platform: "TikTok", contentType: "video",
  quota: 4, value: 400000, startDate: "2026-10-01", endDate: "2026-10-31", uploadDays: "1", dpPercent: 30 };
const UP = [
  { id: "a", talentId: "t1", date: "2026-10-05", views: 3000, interaksi: 150, link: "" },
  { id: "b", talentId: "t1", date: "2026-10-14", views: 2000, interaksi: 80, link: "" }, // jadwal 12 → telat 2 hari
  { id: "c", talentId: "t1", date: "2026-10-19", views: 4000, interaksi: 200, link: "" },
];
const OPTS = { today: TODAY, toleransi: 1, targetCpm: 100000, overpricePercent: 50, peerEr: [3, 4, 5] };

describe("renewalScore", () => {
  it("menghitung komponen dan saran", () => {
    const r = C.renewalScore(RINA, UP, OPTS);
    expect(r.komponen.harga).toBe(100);           // Rp100rb vs wajar Rp300rb
    expect(Math.round(r.komponen.disiplin)).toBe(67); // 2 dari 3 tepat waktu
    expect(r.komponen.kuota).toBe(100);
    expect(r.saran).toBe("lanjut");
    expect(r.alasan.join(" ")).toMatch(/1 dari 3 jadwal telat lebih dari 1 hari/);
  });

  it("toleransi lebih longgar menaikkan disiplin", () => {
    expect(C.renewalScore(RINA, UP, { ...OPTS, toleransi: 2 }).komponen.disiplin).toBe(100);
  });

  it("talent mahal → negosiasi/stop dengan harga usulan lebih rendah", () => {
    const mahal = { ...RINA, value: 2400000 }; // Rp600rb/video vs wajar Rp300rb → 2×
    const r = C.renewalScore(mahal, UP, OPTS);
    expect(r.komponen.harga).toBe(0);
    expect(["negosiasi", "stop"]).toContain(r.saran);
    expect(r.hargaUsulan).toBe(1200000);
  });

  it("harga usulan tidak pernah di atas nilai sekarang", () => {
    expect(C.renewalScore(RINA, UP, OPTS).hargaUsulan).toBe(400000);
  });

  it("data views < 3 konten → data belum cukup", () => {
    const r = C.renewalScore(RINA, UP.slice(0, 2), OPTS);
    expect(r.saran).toBe("data-kurang");
  });
});

describe("paymentsOf", () => {
  it("jadwal DP & pelunasan dengan status, termasuk tanda lunas", () => {
    const p = C.paymentsOf({ ...RINA, bayar: { "k1-DP": { tgl: "2026-10-02", catatan: "BCA" } } }, () => 30, TODAY);
    expect(p.map((x) => [x.key, x.jumlah, x.status])).toEqual([
      ["k1-DP", 120000, "lunas"],
      ["k1-Pelunasan", 280000, "bulan-ini"],
    ]);
    expect(C.paymentsOf(RINA, () => 30, "2026-11-05").map((x) => x.status)).toEqual(["terlambat", "terlambat"]);
  });
});

describe("dailySummary", () => {
  it("memuat upload hari ini, jadwal terlewat, kontrak berakhir, dan pembayaran", () => {
    const t = C.dailySummary({ talents: [RINA], uploads: UP.slice(0, 1) }, "2026-10-26", { dpOf: () => 30, contractEndingSoon: 14 });
    expect(t).toMatch(/Senin, 2026-10-26/);
    expect(t).toMatch(/Upload hari ini\n• Rina \(rina\)/);
    expect(t).toMatch(/Jadwal terlewat\n• Rina — 2 jadwal/);
    expect(t).toMatch(/Rina — 5 hari lagi/);
    expect(t).toMatch(/DP Rp120\.000/);
  });

  it("tanpa apa pun → semua aman", () => {
    expect(C.dailySummary({ talents: [], uploads: [] }, TODAY, {})).toMatch(/Semua aman/);
  });
});

describe("salesFromCsv", () => {
  it("menjumlah GMV per talent per bulan, angka format Indonesia", () => {
    const csv = 'Creator Username,GMV,Orders,Date\n@rina,"1.500.000",12,2026-10-03\nrina,"500.000",3,2026-10-20\nlain,10,1,2026-10-03';
    const r = C.salesFromCsv(csv, [RINA], "2026-10");
    expect(r.hasil.t1["2026-10"]).toEqual({ gmv: 2000000, orders: 15 });
    expect(r.asing).toEqual(["lain"]);
  });

  it("kolom tidak dikenal → error", () => {
    expect(C.salesFromCsv("a,b\n1,2", [RINA], "2026-10").error).toBe("kolom");
  });
});

describe("backfillUploads", () => {
  it("mengisi jadwal terlewat paling awal", () => {
    const b = C.backfillUploads(RINA, [], 2, TODAY, "x-");
    expect(b.map((u) => u.date)).toEqual(["2026-10-05", "2026-10-12"]);
    expect(b[0]).toMatchObject({ talentId: "t1", awal: true });
  });

  it("lebih banyak dari jadwal terlewat → sisanya di tanggal mulai", () => {
    expect(C.backfillUploads(RINA, [], 4, TODAY, "x-").map((u) => u.date)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-01"]);
  });
});

describe("impor Notion berstatus + judul/tautan", () => {
  const T = { ...RINA, notionName: "" };
  const CSV = [
    "Content name,Film date,Status,Judul,Link",
    "rina,2026-10-05,Done,Review sepatu,https://tiktok.com/@rina/video/111",
    "rina,2026-10-12,Draft,Belum jadi,",
  ].join("\n");

  it("status bukan tayang tidak dihitung; judul & tautan ikut", () => {
    const plan = C.planNotionImport([T], [], C.rowsFromNotionCsv(CSV).rows, TODAY);
    expect(plan.baru).toHaveLength(1);
    expect(plan.baru[0]).toMatchObject({ date: "2026-10-05", title: "Review sepatu", link: "https://tiktok.com/@rina/video/111" });
    expect(plan.belumTayang).toBe(1);
  });

  it("entri lama tanpa judul/tautan dilengkapi, tidak digandakan", () => {
    const lama = [{ id: "old", talentId: "t1", date: "2026-10-05", title: "Dari Notion Content Calendar", link: "" }];
    const plan = C.planNotionImport([T], lama, C.rowsFromNotionCsv(CSV).rows, TODAY);
    expect(plan.baru).toHaveLength(0);
    expect(plan.lengkapi).toEqual([{ uploadId: "old", title: "Review sepatu", link: "https://tiktok.com/@rina/video/111" }]);
  });
});

// --------------------------------------------------------------------------
// Endpoint Telegram
// --------------------------------------------------------------------------

function panggil(h, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const res = {
      setHeader() {}, statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; },
    };
    h({ method, headers, body }, res);
  });
}

describe("api/notify & api/reminder", () => {
  let terkirim;
  beforeEach(() => {
    terkirim = [];
    vi.stubEnv("EDIT_PASSPHRASE", "sandi-edit");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:abc");
    vi.stubEnv("TELEGRAM_CHAT_ID", "999");
    vi.stubEnv("CRON_SECRET", "cron-rahasia");
    vi.stubEnv("KV_REST_API_URL", "https://fake.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "tok");
    const doc = JSON.stringify({ version: 1, data: { talents: [RINA], uploads: [], setelan: { dpPercent: 30 } } });
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      if (String(url).includes("api.telegram.org")) {
        terkirim.push(JSON.parse(init.body));
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      const cmds = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => cmds.map(([c, k]) => ({ result: c === "GET" && k === KEY ? doc : null })) };
    }));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("notify: hanya pemilik, teks terkirim ke chat yang disetel", async () => {
    expect((await panggil(notify, { method: "POST", headers: {}, body: { text: "x" } })).status).toBe(401);
    const r = await panggil(notify, { method: "POST", headers: { "x-edit-key": "sandi-edit" }, body: { text: "Halo tim" } });
    expect(r.status).toBe(200);
    expect(terkirim).toEqual([{ chat_id: "999", text: "Halo tim", disable_web_page_preview: true }]);
  });

  it("notify: Telegram belum disetel → pesan jelas", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const r = await panggil(notify, { method: "POST", headers: { "x-edit-key": "sandi-edit" }, body: { text: "x" } });
    expect(r.body.detail).toMatch(/TELEGRAM_BOT_TOKEN/);
  });

  it("reminder: dipicu cron, membaca data online, mengirim ringkasan", async () => {
    expect((await panggil(reminder, { headers: {} })).status).toBe(401);
    const r = await panggil(reminder, { headers: { authorization: "Bearer cron-rahasia" } });
    expect(r.status).toBe(200);
    expect(terkirim[0].text).toMatch(/Jadwal KOL/);
    expect(terkirim[0].text).toMatch(/Rina/);
  });

  it("tanggal Jakarta: 20:00 UTC = besok paginya di WIB", () => {
    expect(todayJakarta(Date.parse("2026-10-19T20:00:00Z"))).toBe("2026-10-20");
  });
});

// --------------------------------------------------------------------------
// Halaman
// --------------------------------------------------------------------------

const html = readFileSync(new URL("../pantau-talent.html", import.meta.url), "utf8");
const coreSrc = readFileSync(new URL("../data/pantau-core.js", import.meta.url), "utf8");

function bukaHalaman(talents, uploads, setelan = {}) {
  const store = new Map([["pantau-talent-data", JSON.stringify({ talents, uploads, setelan })]]);
  return new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://kol-panel-website.vercel.app/pantau-talent.html",
    resources: undefined,
    beforeParse(window) {
      Object.defineProperty(window, "localStorage", {
        value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
        configurable: true,
      });
      window.Date.now = () => Date.parse("2026-10-20T03:00:00Z");
      window.confirm = vi.fn(() => true);
      window.alert = vi.fn();
      window.prompt = vi.fn((q, def) => def);
      window.open = vi.fn();
      window.eval(coreSrc);
    },
  });
}
const simpanan = (dom) => JSON.parse(dom.window.localStorage.getItem("pantau-talent-data"));

describe("halaman", () => {
  it("tabel Layak Lanjut tampil dengan saran; kartu juga", () => {
    const dom = bukaHalaman([RINA], UP);
    const doc = dom.window.document;
    expect(doc.querySelector('#layakTable [data-layak="t1"] [data-saran]').dataset.saran).toBe("lanjut");
    expect(doc.querySelector('[data-talent-id="t1"] [data-card-layak] [data-saran]')).not.toBeNull();
  });

  it("Tandai dibayar mencatat tanggal; status berubah lunas", () => {
    const dom = bukaHalaman([RINA], UP);
    const doc = dom.window.document;
    doc.querySelector('#bayarTable [data-bayar="t1|k1-DP"]').click();
    expect(simpanan(dom).talents[0].bayar["k1-DP"]).toEqual({ tgl: "2026-10-20", catatan: "" });
    expect(doc.querySelector('#bayarTable [data-bayar-row="t1|k1-DP"] [data-bayar-status]').dataset.bayarStatus).toBe("lunas");
  });

  it("tab Hari Ini: grup pembayaran dan perpanjang, plus tombol ringkasan WA", () => {
    const dom = bukaHalaman([{ ...RINA, endDate: "2026-10-25" }], UP);
    const doc = dom.window.document;
    expect(doc.querySelector('[data-alert-bayar="t1"]')).not.toBeNull();
    expect(doc.querySelector('[data-alert-perpanjang="t1"]')).not.toBeNull();
    doc.querySelector("[data-ringkasan]").click();
    expect(doc.getElementById("ringkasanText").value).toMatch(/Jadwal KOL/);
    doc.getElementById("ringkasanWaBtn").click();
    expect(dom.window.open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/wa\.me\/\?text=/), "_blank", "noopener");
  });

  it("anggaran terlewati → peringatan di Hari Ini dan kartu di Biaya", () => {
    const dom = bukaHalaman([RINA], UP, { budgetBulanan: 300000 });
    const doc = dom.window.document;
    expect(doc.querySelector("[data-alert-budget]").textContent).toMatch(/Anggaran bulan ini terlewati/);
    expect(doc.querySelector('[data-summary="budget"]').textContent).toBe("133%");
  });

  it("penjualan → ROAS per talent dan ringkasan", () => {
    const dom = bukaHalaman([{ ...RINA, penjualan: { "2026-10": { gmv: 900000, orders: 9 } } }], UP);
    const doc = dom.window.document;
    expect(doc.querySelector('[data-biaya-talent="t1"] [data-col="roas"]').textContent).toBe("3,0×");
    expect(doc.querySelector('[data-summary="roas"]').textContent).toBe("3,0×");
  });

  it("tambah talent dengan 'sudah tayang sebelum didata' mengisi jadwal terlewat", () => {
    const dom = bukaHalaman([], []);
    const doc = dom.window.document;
    doc.getElementById("addTalentBtn").click();
    doc.getElementById("talentName").value = "Baru";
    doc.getElementById("talentAccount").value = "baru";
    doc.getElementById("talentQuota").value = "4";
    doc.getElementById("talentStartDate").value = "2026-10-01";
    doc.getElementById("talentEndDate").value = "2026-10-31";
    doc.getElementById("talentValue").value = "400000";
    doc.querySelector('[data-day-chip="1"]').click();
    doc.getElementById("talentUploadAwal").value = "2";
    doc.getElementById("talentForm").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    const u = simpanan(dom).uploads;
    expect(u.map((x) => x.date)).toEqual(["2026-10-05", "2026-10-12"]);
    expect(doc.querySelector(".talent-card .talent-card-quota-number").textContent.trim()).toBe("2");
  });
});
