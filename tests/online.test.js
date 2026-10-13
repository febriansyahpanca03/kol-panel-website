/**
 * Simpan online: hanya pemilik (sandi edit) yang bisa menyimpan; sandi lihat
 * hanya membaca dan data pribadi talent tidak ikut terkirim; perubahan dari
 * dua perangkat tidak saling menimpa diam-diam.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import handler, { KEY, BACKUP_KEY, stripPrivate } from "../api/data.js";

// --- Upstash tiruan di memori --------------------------------------------
let db;
function fakeUpstash() {
  db = new Map();
  return vi.fn(async (url, init) => {
    const commands = JSON.parse(init.body);
    const result = commands.map(([cmd, key, ...args]) => {
      if (cmd === "GET") return { result: db.has(key) ? db.get(key) : null };
      if (cmd === "SET") { db.set(key, args[0]); return { result: "OK" }; }
      if (cmd === "LPUSH") { db.set(key, [args[0], ...(db.get(key) || [])]); return { result: db.get(key).length }; }
      if (cmd === "LTRIM") { db.set(key, (db.get(key) || []).slice(args[0], args[1] + 1)); return { result: "OK" }; }
      return { error: "unknown " + cmd };
    });
    return { ok: true, status: 200, json: async () => result };
  });
}

function panggil({ method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; },
    };
    handler({ method, headers, body }, res);
  });
}

const DATA = {
  talents: [{ id: "t1", name: "Rina", account: "rina", phone: "0812", address: "Bekasi", bank: "BCA 123", fullName: "Rina W",
    letters: [{ version: 1, data: { phone: "0812", bank: "BCA 123", quota: 8 } }],
    changeLog: [{ field: "phone", from: "0811", to: "0812" }, { field: "quota", from: "6", to: "8" }] }],
  uploads: [{ id: "u1", talentId: "t1", date: "2026-10-01" }],
  setelan: { targetCpm: 100000 },
};

beforeEach(() => {
  vi.stubEnv("EDIT_PASSPHRASE", "sandi-edit-panjang");
  vi.stubEnv("VIEW_PASSPHRASE", "sandi-lihat");
  vi.stubEnv("KV_REST_API_URL", "https://fake.upstash.io");
  vi.stubEnv("KV_REST_API_TOKEN", "tok");
  vi.stubGlobal("fetch", fakeUpstash());
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const OWNER = { "x-edit-key": "sandi-edit-panjang" };
const VIEWER = { "x-view-key": "sandi-lihat" };

describe("api/data", () => {
  it("tanpa sandi atau sandi salah → 401", async () => {
    expect((await panggil()).status).toBe(401);
    expect((await panggil({ headers: { "x-edit-key": "salah" } })).status).toBe(401);
    expect((await panggil({ headers: { "x-view-key": "sandi-edit-panjang" } })).status).toBe(401);
  });

  it("env belum disetel → pesan yang jelas", async () => {
    vi.stubEnv("EDIT_PASSPHRASE", "");
    const r = await panggil({ headers: OWNER });
    expect(r.status).toBe(500);
    expect(r.body.detail).toMatch(/EDIT_PASSPHRASE/);
  });

  it("pemilik menyimpan lalu membaca data lengkap", async () => {
    const put = await panggil({ method: "PUT", headers: OWNER, body: { data: DATA, baseVersion: 0 } });
    expect(put).toMatchObject({ status: 200, body: { version: 1 } });
    const get = await panggil({ headers: OWNER });
    expect(get.body).toMatchObject({ version: 1, role: "owner" });
    expect(get.body.data.talents[0].phone).toBe("0812");
  });

  it("sandi lihat: baca saja, data pribadi dihapus, tidak bisa menyimpan", async () => {
    await panggil({ method: "PUT", headers: OWNER, body: { data: DATA, baseVersion: 0 } });
    const get = await panggil({ headers: VIEWER });
    const t = get.body.data.talents[0];
    expect(get.body.role).toBe("viewer");
    expect([t.phone, t.address, t.bank, t.fullName]).toEqual(["", "", "", ""]);
    expect(t.letters[0].data.phone).toBe("");
    expect(t.letters[0].data.quota).toBe(8);
    expect(t.changeLog.map((c) => c.field)).toEqual(["quota"]);
    expect(JSON.stringify(get.body)).not.toMatch(/0812|BCA 123|Bekasi/);

    const put = await panggil({ method: "PUT", headers: VIEWER, body: { data: DATA, baseVersion: 1 } });
    expect(put.status).toBe(403);
  });

  it("versi kedaluwarsa ditolak 409, tidak menimpa", async () => {
    await panggil({ method: "PUT", headers: OWNER, body: { data: DATA, baseVersion: 0 } });
    await panggil({ method: "PUT", headers: OWNER, body: { data: DATA, baseVersion: 1 } });
    const basi = await panggil({ method: "PUT", headers: OWNER, body: { data: { ...DATA, talents: [] }, baseVersion: 1 } });
    expect(basi.status).toBe(409);
    expect(basi.body.version).toBe(2);
    expect(JSON.parse(db.get(KEY)).data.talents).toHaveLength(1);
  });

  it("menyimpan maksimal 5 versi sebelumnya sebagai cadangan", async () => {
    for (let v = 0; v < 8; v++) await panggil({ method: "PUT", headers: OWNER, body: { data: DATA, baseVersion: v } });
    expect(db.get(BACKUP_KEY)).toHaveLength(5);
    expect(JSON.parse(db.get(BACKUP_KEY)[0]).version).toBe(7);
  });

  it("data tidak valid ditolak", async () => {
    expect((await panggil({ method: "PUT", headers: OWNER, body: { data: { foo: 1 } } })).status).toBe(400);
  });

  it("stripPrivate tidak mengubah aslinya", () => {
    stripPrivate(DATA);
    expect(DATA.talents[0].phone).toBe("0812");
  });
});

// --------------------------------------------------------------------------
// Halaman, dengan fetch diarahkan ke fungsi server di atas
// --------------------------------------------------------------------------

const html = readFileSync(new URL("../pantau-talent.html", import.meta.url), "utf8");
const coreSrc = readFileSync(new URL("../data/pantau-core.js", import.meta.url), "utf8");

function bukaHalaman({ lokal = null, online = null } = {}) {
  const store = new Map();
  if (lokal) store.set("pantau-talent-data", JSON.stringify(lokal));
  if (online) store.set("pantau-talent-online", JSON.stringify(online));
  return new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://kol-panel-website.vercel.app/pantau-talent.html",
    resources: undefined,
    beforeParse(window) {
      Object.defineProperty(window, "localStorage", {
        value: {
          getItem: (k) => (store.has(k) ? store.get(k) : null),
          setItem: (k, v) => store.set(k, String(v)),
          removeItem: (k) => store.delete(k),
        },
        configurable: true,
      });
      window.Date.now = () => Date.parse("2026-10-13T03:00:00Z");
      window.confirm = vi.fn(() => true);
      window.alert = vi.fn();
      window.URL.createObjectURL = () => "blob:x";
      window.fetch = async (url, init = {}) => {
        const r = await panggil({ method: init.method || "GET", headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined });
        return { ok: r.status < 400, status: r.status, json: async () => r.body };
      };
      window.eval(coreSrc);
    },
  });
}

const tunggu = () => new Promise((r) => setTimeout(r, 20));
const lokalDari = (dom) => JSON.parse(dom.window.localStorage.getItem("pantau-talent-data"));
const TALENT = { id: "t1", name: "Rina", account: "rina", platform: "TikTok", quota: 4, value: 400000,
  startDate: "2026-10-01", endDate: "2026-10-31", uploadDays: "1", phone: "0812", bank: "BCA 123" };

describe("halaman: simpan online", () => {
  it("menghubungkan sebagai pemilik mengunggah data browser ini bila server kosong", async () => {
    const dom = bukaHalaman({ lokal: { talents: [TALENT], uploads: [], setelan: {} } });
    const doc = dom.window.document;
    doc.getElementById("onlineMode").value = "owner";
    doc.getElementById("onlineKey").value = "sandi-edit-panjang";
    doc.getElementById("onlineConnectBtn").click();
    await tunggu();
    expect(JSON.parse(db.get(KEY)).data.talents[0].name).toBe("Rina");
    expect(doc.getElementById("syncPill").textContent).toMatch(/Tersimpan online/);
    // Frasa sandi tidak tertinggal di kolom isian.
    expect(doc.getElementById("onlineKey").value).toBe("");
  });

  it("perangkat lain sebagai pemilik memuat data online", async () => {
    await panggil({ method: "PUT", headers: OWNER, body: { data: { talents: [TALENT], uploads: [], setelan: {} }, baseVersion: 0 } });
    const dom = bukaHalaman({ online: { mode: "owner", key: "sandi-edit-panjang", version: 0, dirty: false } });
    await tunggu();
    expect(dom.window.document.querySelector('[data-talent-id="t1"]')).not.toBeNull();
    expect(lokalDari(dom).talents[0].phone).toBe("0812");
  });

  it("edit oleh pemilik langsung terkirim ke server", async () => {
    await panggil({ method: "PUT", headers: OWNER, body: { data: { talents: [TALENT], uploads: [], setelan: {} }, baseVersion: 0 } });
    const dom = bukaHalaman({ online: { mode: "owner", key: "sandi-edit-panjang", version: 0, dirty: false } });
    await tunggu();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const w = dom.window;
      w.eval("state").uploads.push({ id: "u9", talentId: "t1", date: "2026-10-05", title: "", link: "" });
      w.saveData();
      await vi.advanceTimersByTimeAsync(1500);
    } finally { vi.useRealTimers(); }
    await tunggu();
    expect(JSON.parse(db.get(KEY)).data.uploads).toHaveLength(1);
    expect(JSON.parse(db.get(KEY)).version).toBe(2);
  });

  it("mode lihat: tanpa data pribadi, tombol ubah hilang, tidak menulis ke browser", async () => {
    await panggil({ method: "PUT", headers: OWNER, body: { data: { talents: [TALENT], uploads: [], setelan: {} }, baseVersion: 0 } });
    const dom = bukaHalaman({ online: { mode: "viewer", key: "sandi-lihat", version: 0 } });
    await tunggu();
    const doc = dom.window.document;
    expect(doc.body.classList.contains("mode-lihat")).toBe(true);
    expect(doc.querySelector('[data-talent-id="t1"]')).not.toBeNull();
    expect(dom.window.eval("state").talents[0].phone).toBe("");
    expect(lokalDari(dom)).toBeNull();
    dom.window.saveData();
    expect(lokalDari(dom)).toBeNull();
    expect(JSON.parse(db.get(KEY)).version).toBe(1);
  });

  it("server lebih baru saat ada perubahan lokal → ditanya; OK = pakai online + unduh cadangan", async () => {
    await panggil({ method: "PUT", headers: OWNER, body: { data: { talents: [TALENT], uploads: [], setelan: {} }, baseVersion: 0 } });
    await panggil({ method: "PUT", headers: OWNER, body: { data: { talents: [{ ...TALENT, name: "Rina (HP)" }], uploads: [], setelan: {} }, baseVersion: 1 } });
    const dom = bukaHalaman({
      lokal: { talents: [{ ...TALENT, name: "Rina (laptop)" }], uploads: [], setelan: {} },
      online: { mode: "owner", key: "sandi-edit-panjang", version: 1, dirty: true },
    });
    await tunggu();
    await tunggu();
    expect(dom.window.confirm).toHaveBeenCalled();
    expect(dom.window.eval("state").talents[0].name).toBe("Rina (HP)");
    expect(JSON.parse(db.get(KEY)).data.talents[0].name).toBe("Rina (HP)");
  });

  it("sandi salah → status jelas, tetap memakai data browser", async () => {
    const dom = bukaHalaman({ lokal: { talents: [TALENT], uploads: [], setelan: {} }, online: { mode: "owner", key: "salah", version: 0 } });
    await tunggu();
    expect(dom.window.document.getElementById("syncPill").textContent).toMatch(/frasa sandi salah/);
    expect(dom.window.document.querySelector('[data-talent-id="t1"]')).not.toBeNull();
  });
});
