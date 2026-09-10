/**
 * Behavioural tests for the calendar chip.
 *
 * Until now a single click on a chip either confirmed an upload or deleted
 * one. A mis-click destroyed history, and the only guard was a `confirm()`
 * that appeared after the decision had already been framed. These tests load
 * the real page and assert that clicking only ever *opens* something.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const html = readFileSync(new URL("../pantau-talent.html", import.meta.url), "utf8");

const TALENT = {
  id: "talent-1",
  name: "Rina",
  account: "@rina_creator",
  platform: "tiktok",
  quota: 8,
  value: 4_000_000,
  startDate: "2026-09-01",
  endDate: "2026-09-30",
  uploadDays: "",
  fullName: "Rina Wijaya",
  phone: "",
  address: "",
  bank: "",
  scheduleText: "",
  contractDate: "2026-08-28",
  dpPercent: "",
  notionName: "",
};

function bukaHalaman({ uploads = [] } = {}) {
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "https://kol-panel-website.vercel.app/pantau-talent.html",
    // The page pulls jsPDF from a CDN and imports ES modules; neither is
    // needed for the calendar, and fetching them would make tests flaky.
    resources: undefined,
    beforeParse(window) {
      const store = new Map();
      store.set("pantau-talent-data", JSON.stringify({ talents: [TALENT], uploads, setelan: {} }));
      Object.defineProperty(window, "localStorage", {
        value: {
          getItem: (k) => (store.has(k) ? store.get(k) : null),
          setItem: (k, v) => store.set(k, String(v)),
          removeItem: (k) => store.delete(k),
        },
        configurable: true,
      });
      window.confirm = vi.fn(() => true);
      window.alert = vi.fn();
    },
  });
  return dom;
}

function simpanan(dom) {
  return JSON.parse(dom.window.localStorage.getItem("pantau-talent-data"));
}

/** Switches to the calendar tab and returns the chips rendered there. */
function chipKalender(dom) {
  const doc = dom.window.document;
  const tab = doc.querySelector('[data-tab="kalender"]');
  if (tab) tab.click();
  return [...doc.querySelectorAll("[data-cal-talent]")];
}

describe("chip kalender", () => {
  let dom;
  let doc;

  beforeEach(() => {
    dom = bukaHalaman();
    doc = dom.window.document;
  });

  it("memuat halaman tanpa error skrip", () => {
    // A thrown error during load would leave the dashboard blank.
    expect(doc.getElementById("calDetailModal")).not.toBeNull();
    expect(doc.querySelectorAll("[data-tab]").length).toBeGreaterThan(0);
  });

  it("klik chip membuka detail, bukan mengubah data", () => {
    const chips = chipKalender(dom);
    expect(chips.length).toBeGreaterThan(0);

    const sebelum = JSON.stringify(simpanan(dom));
    chips[0].click();

    expect(doc.getElementById("calDetailModal").classList.contains("active")).toBe(true);
    expect(JSON.stringify(simpanan(dom))).toBe(sebelum);
    expect(dom.window.confirm).not.toHaveBeenCalled();
  });

  it("detail menyebut talent dan tanggal yang diklik", () => {
    const chips = chipKalender(dom);
    const tanggal = chips[0].dataset.calDate;
    chips[0].click();

    expect(doc.getElementById("calDetailTalent").textContent).toContain("Rina");
    expect(doc.getElementById("calDetailDate").textContent).toBe(tanggal);
  });

  it("tombol sahkan menambah catatan hanya setelah ditekan", () => {
    const chips = chipKalender(dom);
    const tanggal = chips[0].dataset.calDate;
    chips[0].click();

    expect(simpanan(dom).uploads).toHaveLength(0);

    doc.getElementById("calDetailConfirmBtn").click();

    const uploads = simpanan(dom).uploads;
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({ talentId: "talent-1", date: tanggal });
    expect(doc.getElementById("calDetailModal").classList.contains("active")).toBe(false);
  });

  it("menutup detail tidak mengubah apa pun", () => {
    const chips = chipKalender(dom);
    chips[0].click();
    const sebelum = JSON.stringify(simpanan(dom));

    doc.getElementById("calDetailCloseBtn").click();

    expect(doc.getElementById("calDetailModal").classList.contains("active")).toBe(false);
    expect(JSON.stringify(simpanan(dom))).toBe(sebelum);
  });
});

describe("chip kalender pada tanggal yang sudah ada catatannya", () => {
  let dom;
  let doc;
  const upload = {
    id: "upload-1",
    talentId: "talent-1",
    date: "2026-09-05",
    title: "Video A",
    link: "https://www.tiktok.com/@rina_creator/video/7412345678901234567",
  };

  beforeEach(() => {
    dom = bukaHalaman({ uploads: [upload] });
    doc = dom.window.document;
  });

  function chipTanggal(tanggal) {
    return chipKalender(dom).find((c) => c.dataset.calDate === tanggal);
  }

  it("menampilkan judul dan tautan yang tersimpan", () => {
    const chip = chipTanggal("2026-09-05");
    expect(chip).toBeDefined();
    chip.click();

    expect(doc.getElementById("calDetailStatus").textContent).toContain("Sudah tayang");
    expect(doc.getElementById("calDetailTitle").textContent).toBe("Video A");
    expect(doc.getElementById("calDetailLink").textContent).toContain("7412345678901234567");
  });

  it("hanya menawarkan tindakan yang masuk akal untuk keadaannya", () => {
    chipTanggal("2026-09-05").click();
    expect(doc.getElementById("calDetailConfirmBtn").style.display).toBe("none");
    expect(doc.getElementById("calDetailUndoBtn").style.display).not.toBe("none");
  });

  it("klik saja tidak menghapus catatan yang punya tautan", () => {
    // This is the exact accident the old one-click handler allowed.
    chipTanggal("2026-09-05").click();
    expect(simpanan(dom).uploads).toHaveLength(1);
    expect(dom.window.confirm).not.toHaveBeenCalled();
  });

  it("pembatalan hanya terjadi lewat tombolnya, dan tetap minta konfirmasi", () => {
    chipTanggal("2026-09-05").click();
    doc.getElementById("calDetailUndoBtn").click();

    expect(dom.window.confirm).toHaveBeenCalledTimes(1);
    expect(dom.window.confirm.mock.calls[0][0]).toContain("2026-09-05");
    expect(simpanan(dom).uploads).toHaveLength(0);
  });

  it("menolak konfirmasi berarti catatan tetap utuh", () => {
    dom.window.confirm = vi.fn(() => false);
    chipTanggal("2026-09-05").click();
    doc.getElementById("calDetailUndoBtn").click();

    expect(simpanan(dom).uploads).toHaveLength(1);
  });
});
