# ✅ KOL Panel Setup Checklist

Print this or use as reference while setting up. Check off each item as you complete it.

---

## Stage 1: Extension Loading ✓ (DONE)

- [x] Extension built with `npm run build`
- [x] Loaded unpacked in `chrome://extensions`
- [x] Toggle is ON (enabled)
- [x] Icon visible in address bar

---

## Stage 2-4: Google Sheets + Apps Script Setup

### Step 2a: Create Spreadsheet
- [ ] Open https://sheets.new
- [ ] Name the spreadsheet "KOL Panel"
- [ ] Spreadsheet is created and accessible

### Step 2b: Add Apps Script Files
- [ ] Open **Extensions → Apps Script**
- [ ] Delete default `Code.gs`
- [ ] Create 4 new files:
  - [ ] `Config.gs` — copy from repo
  - [ ] `Logic.gs` — copy from repo
  - [ ] `Code.gs` — copy from repo
  - [ ] `SheetSetup.gs` — copy from repo
- [ ] All files saved (Ctrl+S)
- [ ] Refresh spreadsheet (F5) to load menu

### Step 2c: Setup Sheets Automatically
- [ ] Go back to spreadsheet
- [ ] Click **KOL Panel → Setup Sheets**
- [ ] Click OK/Continue
- [ ] Wait 10-20 seconds
- [ ] Verify 6 new sheets created:
  - [ ] KOL
  - [ ] Post
  - [ ] Campaign
  - [ ] Kalender
  - [ ] Dashboard
  - [ ] Config

### Step 2d: Deploy as Web App
- [ ] In Apps Script editor, click **Deploy → New deployment**
- [ ] Select type: **Web app**
- [ ] Execute as: Your email (default OK)
- [ ] Who has access: **Anyone**
- [ ] Click **Deploy**
- [ ] Copy the deployment URL
- [ ] Save URL somewhere safe (Notepad, password manager, etc.)

**URL Format:** `https://script.google.com/macros/d/[DEPLOYMENT_ID]/userweb`

### Step 3: Get Token from Sheet
- [ ] Open **Config** sheet (rightmost tab)
- [ ] Find row with Key = "Token"
- [ ] Copy the Value (long random string)
- [ ] Save it somewhere safe next to the Web App URL

### Step 4: Configure Extension Settings
- [ ] Click **KOL Panel icon** in address bar
- [ ] Click **⚙️ Options** (or right-click icon → Opsi)
- [ ] Paste **Web App URL** into the form
- [ ] Paste **Token** into the form
- [ ] Click **Test Connection**
- [ ] Should show green "Connection successful" ✓
- [ ] If red error, check:
  - [ ] URL is exact (no typos, no extra spaces)
  - [ ] Token is exact (no typos, no extra spaces)
  - [ ] Web App deployed successfully
- [ ] Click **Save Settings**

---

## Stage 5: Live Testing

### Test 1: Panel Rendering
- [ ] Open https://www.tiktok.com/@nasa (or any public TikTok profile)
- [ ] Wait 3-5 seconds
- [ ] Panel appears on right side showing:
  - [ ] Profile name
  - [ ] Follower count
  - [ ] Verified badge (if any)
  - [ ] ER (Engagement Rate) or "no data"
  - [ ] Posting rhythm
  - [ ] "Kirim ke Sheets" button

**If no panel:** 
- [ ] Refresh page (F5)
- [ ] Check chrome://extensions, toggle ON
- [ ] Check Console (F12) for errors

### Test 2: Instagram/Threads (Optional)
- [ ] Open https://www.instagram.com/nasa/
- [ ] Panel should appear (may need to wait longer)
- [ ] If not, try https://www.threads.net/@zuck

### Test 3: Send to Sheets
- [ ] On a profile page with panel visible
- [ ] Click **"Kirim ke Sheets"** button
- [ ] Wait for confirmation (should turn green, say "Tersimpan")
- [ ] Open your spreadsheet
- [ ] Go to **KOL** sheet
- [ ] Should see new row with:
  - [ ] Username
  - [ ] Follower count
  - [ ] ER (or blank if no data)
  - [ ] Timestamps
  - [ ] Other profile data

---

## Optional: Capture Real Data

**When:** After confirming everything works (Step 5)
**How:** Follow [CAPTURE_REAL_DATA.md](./CAPTURE_REAL_DATA.md)
**Why:** Verify parser works with real API data, not just synthetic fixtures

- [ ] Capture TikTok item_list (5 min)
- [ ] Capture Instagram GraphQL (5 min)  
- [ ] Capture Threads GraphQL (5 min)
- [ ] (Optional) Submit to repo as issue/PR

---

## Troubleshooting Quick Reference

| Problem | Solution |
|---------|----------|
| **No panel on page** | Refresh (F5), check toggle ON in extensions |
| **Connection failed** | Verify URL and token (no typos, no spaces) |
| **"Sheets not found"** | Run Setup Sheets menu again |
| **"Send to Sheets" doesn't work** | Check connection first (green "successful") |
| **Data shows but no followers** | Normal if profile has <2 posts or data not loaded |
| **Permission error on Sheets** | Make sure Web App set to "Anyone" access |

**More help:** See [SETUP_GUIDE.html](./extension/docs/SETUP_GUIDE.html) Troubleshooting section.

---

## Estimated Time

- Step 2a-c (Setup Sheets): 5 min
- Step 2d (Deploy Web App): 3 min
- Step 3 (Get token): 2 min
- Step 4 (Configure extension): 5 min
- Step 5 (Live test): 10 min

**Total: ~25 minutes**

---

## After Setup is Done

✅ Extension ready for daily use  
✅ Data auto-saves to Google Sheets  
✅ Dashboard shows analytics  

**Next optional steps:**
- Review Dashboard for insights
- Try different creator profiles
- Set up filters/formulas in Sheets for custom reporting
- Capture real data for verification (see CAPTURE_REAL_DATA.md)

---

## Support

- **Setup help:** SETUP_GUIDE.html
- **Capture help:** CAPTURE_REAL_DATA.md
- **Apps Script help:** apps-script/README.md
- **Bug report:** Open GitHub issue with details

---

**You're all set! 🎉**
