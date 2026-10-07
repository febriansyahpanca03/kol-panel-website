/**
 * Tahap 1 di halaman sungguhan: kartu, tab Hari Ini, dan kalender harus
 * menampilkan angka yang sama untuk kasus Abyan, dan impor CSV yang sama dua
 * kali tidak boleh menambah entri.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import "../data/pantau-core.js";

const html = readFileSync(new URL("../pantau-talent.html", import.meta.url), "utf8");
const coreSrc = readFileSync(new URL("../data/pantau-core.js", import.meta.url), "utf8");
const C = globalThis.PantauCore;

const ABYAN = {
  id: "talent-1", name: "Abyan Zandra Widhyadana", account: "AZET MC", platform: "Lainnya",
  quota: 30, startDate: "2026-06-29", endDate: "2026-09-27", value: 1500000, uploadDays: "",
  fullName: "", phone: "", address: "", bank: "", scheduleText: "", contractDate: "2026-06-29",
  dpPercent: 20, notionName: "",
};

function abyanUploads() {
  const out = [];
  for (let d = "2026-07-01"; d <= "2026-09-09"; d = C.addDays(d, 1)) {
    if ([0, 3, 5].includes(new Date(d + "T00:00:00Z").getUTCDay())) {
      out.push({ id: `upload-notion-1-${out.length + 1}`, talentId: "talent-1", date: d, title: "Dari Notion Content Calendar", link: "" });
    }
  }
  return out;
}

// 25 Sep 2026, 10:00 WIB.
const NOW = Date.parse("2026-09-25T03:00:00Z");

function bukaHalaman(uploads) {
  return new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://kol-panel-website.vercel.app/pantau-talent.html",
    resources: undefined,
    beforeParse(window) {
      const store = new Map();
      store.set("pantau-talent-data", JSON.stringify({ talents: [ABYAN], uploads, setelan: {} }));
      Object.defineProperty(window, "localStorage", {
        value: {
          getItem: (k) => (store.has(k) ? store.get(k) : null),
          setItem: (k, v) => store.set(k, String(v)),
          removeItem: (k) => store.delete(k),
        },
        configurable: true,
      });
      window.Date.now = () => NOW;
      window.confirm = vi.fn(() => true);
      window.alert = vi.fn();
      window.eval(coreSrc);
    },
  });
}

const simpanan = (dom) => JSON.parse(dom.window.localStorage.getItem("pantau-talent-data"));

describe("kartu talent Abyan", () => {
  const dom = bukaHalaman(abyanUploads());
  const doc = dom.window.document;
  const kartu = doc.querySelector('[data-talent-id="talent-1"]');

  it("menampilkan +1 melebihi kuota, bukan SISA 0", () => {
    expect(kartu.querySelector(".talent-card-quota-number").textContent.trim()).toBe("+1");
    expect(kartu.querySelector(".talent-card-quota-label").textContent).toMatch(/melebihi kuota/i);
    expect(kartu.querySelector(".quota-caption").textContent).toMatch(/31 dari 30 video · 103% · \+1 melebihi kuota/);
  });

  it("bar progres tidak melebar melewati 100%", () => {
    expect(kartu.querySelector(".progress-bar-fill").style.width).toBe("100%");
  });

  it("tertinggal dan jadwal terlewat sama-sama nol", () => {
    expect(kartu.querySelector('[data-metric="behind"]').textContent.trim()).toBe("Tidak ada");
    expect(kartu.querySelector('[data-metric="progress"]').textContent).toMatch(/29 dari 29 slot terisi/);
  });

  it("tab Hari Ini tidak lagi melaporkan jadwal terlewat", () => {
    const hariIni = doc.getElementById("todayContainer").textContent;
    expect(hariIni).not.toMatch(/Jadwal Terlewat/);
    expect(hariIni).not.toMatch(/Tertinggal/);
  });

  it("kalender tidak menggambar slot yang sudah terisi sebagai terlewat", () => {
    expect(doc.querySelectorAll(".cal-chip.pending")).toHaveLength(0);
  });
});

describe("impor CSV Notion dua kali lewat halaman", () => {
  const CSV = [
    "Content name,Film date,Status",
    'AZET MC,"September 11, 2026",Done',
    'AZET MC,"September 13, 2026",Done',
  ].join("\n");

  it("impor kedua menghasilkan nol entri baru", () => {
    const dom = bukaHalaman(abyanUploads());
    const w = dom.window;

    const pertama = w.importCsvNotion(CSV);
    expect(pertama.baru).toHaveLength(2);
    expect(simpanan(dom).uploads).toHaveLength(33);

    const kedua = w.importCsvNotion(CSV);
    expect(kedua.baru).toHaveLength(0);
    expect(simpanan(dom).uploads).toHaveLength(33);
    expect(w.alert).toHaveBeenLastCalledWith(expect.stringMatching(/Tidak ada riwayat baru/));
  });

  it("CSV yang tanggalnya sudah ada di riwayat tidak menambah apa pun", () => {
    const dom = bukaHalaman(abyanUploads());
    const csv = "Content name,Film date\nAZET MC,2026-07-01\nAZET MC,2026-09-09";
    expect(dom.window.importCsvNotion(csv).baru).toHaveLength(0);
    expect(simpanan(dom).uploads).toHaveLength(31);
  });
});
