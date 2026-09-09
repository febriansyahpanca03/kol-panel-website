# 🚀 Langkah Berikutnya — KOL Panel Ready for Setup

**Status:** Tahap 1 selesai ✓ — Extension sudah loaded di Chrome. Siap untuk tahap 2-4 (Setup Google Sheets dan testing).

---

## 📍 Di Mana Kita Sekarang?

- ✓ **Stage 1:** Extension MV3 built, loaded di `chrome://extensions`, icon visible di address bar
- ✓ **Code:** 247 tests passing. 8 modules complete (parser, stats, UI, network)
- ✓ **Documentation:** SETUP_GUIDE.html, FIXTURE_CAPTURE_GUIDE.md, CAPTURE_REAL_DATA.md siap
- → **Next:** Manual setup Steps 2-4 (Google Sheets + Apps Script + testing)

---

## 🎯 Langkah Selanjutnya (Prioritas)

### **Step 1: Setup Google Sheets & Apps Script** ← **MULAI DI SINI**

**File:** [`extension/docs/SETUP_GUIDE.html`](./extension/docs/SETUP_GUIDE.html)

**Waktu:** ~15-20 menit

**Apa yang akan dilakukan:**
1. Buat spreadsheet baru di `sheets.new`
2. Deploy 4 file Apps Script (`Code.gs`, `Logic.gs`, `Config.gs`, `SheetSetup.gs`)
3. Jalankan setup menu → Sheet otomatis terbuat (KOL, Post, Campaign, dll)
4. Deploy sebagai Web App
5. Copy Web App URL + Token
6. Paste ke extension settings

**Checklist:**
- [ ] Spreadsheet buat dan punya 6 sheet baru
- [ ] Apps Script sudah di-deploy (ada URL dengan deployment ID)
- [ ] Token ada di `Config!B2`
- [ ] Extension settings terisi, "Tes koneksi" hijau ✓

---

### **Step 2: Test Live Data Capture**

**File:** [`extension/docs/SETUP_GUIDE.html`](./extension/docs/SETUP_GUIDE.html) → Bagian "Step 5"

**Apa yang akan dilakukan:**
1. Navigate ke profil TikTok, Instagram, atau Threads (coba @nasa atau akun publik lain)
2. Tunggu 3-5 detik sampai panel muncul
3. Lihat data: followers, ER, posting rhythm, price gate
4. Klik "Kirim ke Sheets" → tunggu konfirmasi hijau
5. Buka spreadsheet → Sheet KOL sudah ada baris baru

**Checklist:**
- [ ] Panel muncul di minimal 1 platform (TikTok / Instagram / Threads)
- [ ] Data terlihat (followers, ER, posting info)
- [ ] "Kirim ke Sheets" berhasil (hijau "Tersimpan")
- [ ] Baris muncul di Sheet KOL dengan data lengkap

---

### **Step 3: Capture Real API Data** (Parallel)

**File:** [`CAPTURE_REAL_DATA.md`](./CAPTURE_REAL_DATA.md) (user-friendly) atau [`extension/docs/FIXTURE_CAPTURE_GUIDE.md`](./extension/docs/FIXTURE_CAPTURE_GUIDE.md) (technical)

**Waktu:** ~5 menit per capture

**Apa yang akan dilakukan:**
1. Buka profil publik di TikTok / Instagram / Threads
2. Buka DevTools (F12) → Network tab
3. Scroll/refresh sampai muncul request `item_list` (TikTok) atau `graphql` (Instagram/Threads)
4. Copy response → paste ke text editor → save `.json` file
5. Kirim file ke repository (issue/PR dengan keterangan platform + username publik)

**Output:** Real fixtures untuk verification parser

---

## 📚 Dokumentasi (Reference)

| File | Untuk Siapa | Konten |
|------|------------|---------|
| [`SETUP_GUIDE.html`](./extension/docs/SETUP_GUIDE.html) | **End Users** | Step-by-step setup, troubleshooting |
| [`CAPTURE_REAL_DATA.md`](./CAPTURE_REAL_DATA.md) | **End Users / Contributors** | How to capture real API data (visual, non-technical) |
| [`extension/docs/FIXTURE_CAPTURE_GUIDE.md`](./extension/docs/FIXTURE_CAPTURE_GUIDE.md) | **Developers** | Technical walkthrough, anonymization script |
| [`apps-script/README.md`](./apps-script/README.md) | **Setup Reference** | Sheet structure, security model, token management |
| [`extension/README.md`](./extension/README.md) | **Development** | How to build, test, load unpacked |
| [`SPEC.md`](./SPEC.md) | **Architecture** | 9 stages, design decisions, field specs |
| [`TODO.md`](./TODO.md) | **Release Checklist** | Security audit, QA, pre-release tasks |

---

## ✅ Pre-Release Checklist

Sebelum release ke end users, hal-hal yang harus dicek:

### **Security (Critical)**
- [x] postMessage origin validation (DONE + tested)
- [ ] Apps Script token blast-radius verification
  - **Task:** Verify token hanya bisa akses sheet ini, bukan user's entire Drive
  - **Reference:** See `TODO.md` for full details

### **Parser Verification (High Priority)**
- [ ] Real TikTok item_list capture (currently synthetic)
- [ ] Real Instagram GraphQL capture (currently synthetic)
- [ ] Real Threads GraphQL capture (currently synthetic)
- **Current Status:** Fixtures work with synthetic data; need real data to be 100% sure

### **Manual QA (Required)**
- [ ] Load extension on TikTok profile → panel renders ✓
- [ ] Load extension on Instagram profile → panel renders
- [ ] Load extension on Threads profile → panel renders
- [ ] "Kirim ke Sheets" works end-to-end ✓ (if setup done)
- [ ] Test di 2+ browser profiles (no data leakage)

---

## 🔐 Security Notes

**Token Storage:** 
- Stored locally in `chrome.storage.local` (browser profile only, not synced to Google Account)
- Never leaves your computer except for HTTPS POST to your own Web App
- Can be rotated from Sheet → KOL Panel menu

**Origin Validation:**
- postMessage between MAIN (inject.ts) and ISOLATED (content.ts) worlds validated ✓
- Token scope limited to single spreadsheet via `getActiveSpreadsheet()` ✓

**What's Public (Safe to Send):**
- Profile name, follower count, post counts (all public data you see in browser)
- Engagement metrics (likes, comments, shares — public)
- Posting times (derived from timestamps)

**What's NOT Captured:**
- Private DMs, private posts
- Auth tokens or cookies (only public API responses)
- Personal data beyond username

---

## 🤔 FAQ

**Q: Apa kalau saya tidak punya Google Account?**  
A: Butuh satu untuk bikin spreadsheet dan Apps Script. Gratis — cukup email saja.

**Q: Apakah extension bisa digunakan tanpa Sheets?**  
A: Ya, tapi hanya lokal di browser (follower history, badge di panel). Untuk menyimpan ke spreadsheet, butuh setup Sheets + Apps Script.

**Q: Kapan bisa di-release ke Web Store?**  
A: Setelah Steps 2-3 selesai + security review + manual QA. Rencana: 1-2 minggu.

**Q: Bagaimana kalau saya menemukan bug?**  
A: Buka GitHub issue dengan:
- Platform (TikTok/IG/Threads)
- Username yang dicek
- Screenshot dari DevTools Console
- Expected vs actual behavior

---

## 🎯 Timeline Estimasi

| Step | Estimasi | Blocker |
|------|----------|---------|
| 1. Setup Sheets (Step 2) | 20 min | None — bisa langsung |
| 2. Live testing (Step 3) | 10 min | None — tergantung internet |
| 3. Capture real data | 5 min/capture | User browsing normal (no CAPTCHA) |
| **Security review** | 30 min | Internal verification |
| **Manual QA** | 30 min | Testing di 3 platform |
| **Ready for Release** | ~1 week | Blocks: real captures + review |

---

## 📞 Support

- **Setup issues?** → See `SETUP_GUIDE.html` Troubleshooting
- **Capture questions?** → See `CAPTURE_REAL_DATA.md` FAQ
- **Code/test questions?** → See repo README.md files
- **Security concerns?** → Check `TODO.md` security section

---

## 🎊 Next Action

**👉 Open [`extension/docs/SETUP_GUIDE.html`](./extension/docs/SETUP_GUIDE.html) and follow Steps 2-5.**

Ini adalah tahap terakhir sebelum extension bisa digunakan untuk capturing data yang akan disimpan ke Sheets. Setelah ini, extension siap untuk live testing dan data capture.

**Good luck! 🚀**
