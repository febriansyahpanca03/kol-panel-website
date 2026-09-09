# KOL Panel — Pre-Release Checklist

Tasks that must be completed before the first release to end users.

## Security & Stability

- [ ] **Verify origin on postMessage between MAIN and ISOLATED worlds**
  - File: `extension/src/inject/inject.ts` (MAIN world → content script)
  - File: `extension/src/content/network-listener.ts` (receive side)
  - Check: `event.origin` must match the current site's origin; MAIN-world code must validate `event.source` is the current window's content script. Document in code comment the security rationale.
  - Test: Write a unit test that forges a postMessage with wrong origin and verify it's rejected.

- [ ] **Apps Script token security audit: blast radius if token leaks**
  - Scenario: User's token from sheet `Config!B2` gets compromised (shared accidentally, leaked in logs, etc.).
  - Question: Can an attacker with the token write to *any* Google Sheet, or only the one the token was deployed to?
  - Research/verify against Apps Script Web App security model — write findings in a comment in `apps-script/Code.gs` at the `doPost` function.
  - Expected answer: Web App URL is tied to a specific spreadsheet (via `getActiveSpreadsheet()` in Apps Script). Stealing the token only gives access to that one sheet, not others. Document this assumption clearly.
  - Action: If assumption is wrong (token gives broader access than expected), implement tighter scoping (e.g., restrict token to specific user email, sheet ID, etc.).

## Parser Verification

- [ ] **Capture real TikTok `item_list` API response**
  - Currently: Profile shape verified (TIKTOK_PROFILE_CONFIG). Post shape (TIKTOK_POST_CONFIG) still synthetic.
  - Use: `FIXTURE_CAPTURE_GUIDE.md` for step-by-step.
  - Deliverable: Add `extension/tests/fixtures/tiktok/item-list-real-capture.json` and a test case to `tiktok.test.ts`.
  - Accept: Test passes, fixture is anonymized, README is updated.

- [ ] **Capture real Instagram profile or post query**
  - Currently: Fixture is synthetic; Instagram serves login wall on logged-out requests, so verification halted there.
  - Use: FIXTURE_CAPTURE_GUIDE.md + your logged-in Instagram session.
  - Deliverable: Add real fixture (profile page JSON or GraphQL response) anonymized, test case, README update.
  - Accept: Test passes, no personal data, README notes the capture date.

- [ ] **Capture real Threads profile or post query**
  - Same as Instagram (same Meta infrastructure, same login-wall issue).
  - Deliverable: Real fixture, test, README update.

## Documentation

- [ ] **Write quick-start guide for end users**
  - Cover: How to install extension, paste Web App URL + token into options, navigate to a profile, see the panel.
  - Include: Screenshots (or GIF) of panel in action on each platform (TikTok, IG, Threads).
  - Destination: Root-level README or a new `USER_GUIDE.md`.

- [ ] **Document known limitations**
  - No self-initiated requests (extension is passive, only reads HTML/API already on the page).
  - Post list only shows a sample (default 30), not all posts.
  - Instagram/Threads fixtures unverified until real captures added.
  - Hidden metrics show as blank cells, not zeros (matches SPEC.md's null-not-zero rule).

## QA

- [ ] **Manual test on each platform: profile rendering**
  - Load TikTok profile → panel shows followers, verified status, ER (or "no data" if not enough posts).
  - Load Instagram profile → same.
  - Load Threads profile → same.
  - Log any unexpected behavior or parsing errors (include screenshot + DevTools console).

- [ ] **Manual test: send to Sheets**
  - Set up a test Google Sheet (follow `apps-script/README.md`).
  - Paste Web App URL + token into extension settings, click "Tes koneksi" → should show "Koneksi berhasil".
  - On a profile page, click "Kirim ke Sheets" → wait for confirmation.
  - Check the Sheets: KOL row added/updated, Dashboard shows the new data, Campaign formulas work.

- [ ] **Test on at least two browser profiles**
  - Extension should work independently in each browser profile (separate chrome.storage.local per profile).
  - No cross-profile data leakage.

---

## Optional, post-release

- [ ] Build and publish to Chrome Web Store (requires account, review, publishing fee).
- [ ] Set up CI/CD to run test suite on every commit.
- [ ] Add analytics (opt-in) to track common errors or usage patterns.
