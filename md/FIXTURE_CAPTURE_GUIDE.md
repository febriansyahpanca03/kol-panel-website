# How to Capture and Add Real Fixtures

This guide walks you through capturing real payload data from Instagram, TikTok, or Threads, anonymizing it safely, and adding it to the test suite.

## Why we need real captures

The parser fixtures currently in `extension/tests/fixtures/` are synthetic approximations. While we've verified TikTok's profile shape against a real capture, the post/item data, and all of Instagram/Threads, still rely on educated guesses. Real captures let us confirm field names, edge cases (hidden like counts, null vs absent fields), and catch any surprises the platform's schema has changed to.

## Before you start

- **Use a normal browser session** (logged into your own account, human browsing). Not an automated script — that triggers bot-detection and defeats the purpose.
- **Pick a public account or one you own**. No personal data from other people.
- **No credentials needed**. Just your normal login.

## Step 1: Open DevTools and navigate to the profile

1. Open your browser's **Developer Tools** (F12 or Right-click → Inspect).
2. Go to the **Network** tab.
3. Navigate to a profile page:
   - **TikTok**: `https://www.tiktok.com/@nasa` (or any public creator)
   - **Instagram**: `https://www.instagram.com/nasa/` (or any public account)
   - **Threads**: `https://www.threads.net/@zuck` (or any public creator)
4. Wait for the page to load completely.

## Step 2: Capture the right API response

### TikTok: Look for `item_list`

Scroll down the profile's video grid. In DevTools → Network, filter for requests containing `item_list`:

- Look for a request to something like `/api/post/item_list/` or `/api/v1/feed/`
- Click on it, go to **Response** tab
- Copy the entire JSON response
- Paste into a file, e.g., `tiktok-item-list-capture.json`

**Why this one?** The initial HTML only has profile data (which we've already verified). Post/video data only arrives here.

### Instagram: Look for GraphQL `User` query

Instagram serves data via GraphQL. In DevTools → Network:

- Filter for XHR or Fetch requests
- Look for a request to `/graphql/` containing `User` or profile data
- Go to **Response** tab
- The response is usually wrapped — look for the `data` object inside
- Copy just the user/post data portion (strip the GraphQL wrapper if needed)
- Paste into a file, e.g., `instagram-profile-capture.json`

**Why?** Instagram doesn't server-render data into initial HTML (login wall). All data comes via API.

### Threads: Look for `/api/graphql/`

Same as Instagram:

- Filter for XHR/Fetch to `/graphql/`
- Find the request with user/profile data
- Copy the response's `data` section
- Paste into a file, e.g., `threads-profile-capture.json`

## Step 3: Anonymize the capture

Before adding the capture to the repo, strip all auth tokens, session IDs, and personal info:

```bash
cd extension
node scripts/anonymize-fixture.mjs \
  ../tiktok-item-list-capture.json \
  tests/fixtures/tiktok/item-list-real-capture.json \
  --platform tiktok
```

The script will:
- Replace real usernames with `fake_user_1`, `fake_user_2`, etc.
- Replace real post IDs with `fake_id_1`, `fake_id_2`, etc.
- Strip auth tokens, signatures, and signed CDN URLs
- Keep all field names intact (that's what matters for parser correctness)

**Output checklist:**
```
✓ Real username → nasa=fake_user_1
  Real ID (first 3) → 7664638705177... = fake_id_1, ...

REVIEW THIS BEFORE COMMITTING:
  - [ ] No real usernames/account names visible?
  - [ ] No personal info (email, phone, address)?
  - [ ] No auth tokens, session IDs, or signatures?
  - [ ] Field names preserved (shape still correct)?
```

Take a moment to visually scan the anonymized JSON and confirm the checklist. Use `grep` if unsure:

```bash
grep -i "token\|session\|auth\|secret\|bearer\|csrf" tests/fixtures/tiktok/item-list-real-capture.json
# Should return nothing
```

## Step 4: Add a test case

Once the fixture is in place, add a test to the corresponding test file:

**For TikTok posts** (`extension/tests/parser/tiktok.test.ts`):
```typescript
describe("parseTikTok — real item_list capture", () => {
  const entries = [entryFrom(loadFixture("item-list-real-capture.json"))];
  const result = parseTikTok(entries, 1_700_000_000_000);

  it("parses posts with the expected field names from a real API response", () => {
    expect(result.posts.length).toBeGreaterThan(0);
    // Add assertions on actual post structure found
    const firstPost = result.posts[0];
    if (firstPost) {
      expect(typeof firstPost.id).toBe("string");
      expect(typeof firstPost.likes).toBe("number" || "null");
    }
  });
});
```

Run tests:
```bash
npm test -- tests/parser/tiktok.test.ts
```

## Step 5: Update the fixture README

Document what you found. Edit the relevant README (e.g., `tests/fixtures/tiktok/README.md`):

```markdown
## Real capture (date)

**Post shape (`TIKTOK_POST_CONFIG`)** is now confirmed. `item-list-real-capture.json`
is an actual `/api/post/item_list/` response from a real public TikTok account.
It confirmed:

- `id` and `createTime` (timestamp) are present on every post
- `diggCount` (likes) is never `null` for public videos — always a number
- `video.videoMeta.width` and `height` are on every video (not used by parser, but present)

Still unverified:
- Hidden-likes scenario (TikTok doesn't support it like Instagram does — all counts visible)
- Paid post format (if any)
```

## Step 6: Commit and submit

```bash
git add extension/tests/fixtures/tiktok/item-list-real-capture.json
git add extension/tests/parser/tiktok.test.ts
git commit -m "Add real TikTok item_list API capture to test suite

This is an actual response from /api/post/item_list/ on a public account,
anonymized to strip auth and real usernames. Confirms TIKTOK_POST_CONFIG
field aliases are correct.

Co-Authored-By: [Your Name] <your@email.com>"
```

## Troubleshooting capture

### "I don't see the API request in Network tab"

- **TikTok**: The video grid is lazy-loaded. Scroll down to trigger more API calls.
- **Instagram**: The page may be cached. Hard-refresh (Ctrl+Shift+R).
- **Threads**: Same as Instagram — hard-refresh and scroll.
- All: DevTools might not have Network recording on. Click the red circle icon to start recording, then navigate.

### "The response is huge; how do I know what to copy?"

The Network tab shows you the raw JSON. For the response:

- Right-click the request → **Copy > Copy response**
- Or click **Response** tab and manually select/copy the JSON

If the structure looks overwhelming, paste it into an editor and search for known field names (e.g., `followerCount`, `diggCount`, `username`) to orient yourself.

### "I see a GraphQL `errors` field — does that mean the query failed?"

If you see both `errors` and `data`, copy just the `data` section. GraphQL returns errors even when the data fetch succeeds (e.g., partial failures in a larger query). As long as `data` has the profile/post info you need, it's good.

## After adding the capture

The team (or CI) will run the test suite:

```bash
cd extension
npm test
```

If the parser's aliases don't match the real field names, tests will fail with something like:

```
Expected profile.followers to be 1000, got null
```

That means the field name in the real capture is different from what `TIKTOK_PROFILE_CONFIG` or similar expects. Check the fixture, find the actual field name, add an alias, and re-test.

---

**Questions?** Check:
- [`extension/tests/fixtures/tiktok/README.md`](extension/tests/fixtures/tiktok/README.md) — current TikTok verification status
- [`apps-script/README.md`](apps-script/README.md) — full setup and troubleshooting for Sheets
- `src/parser/tiktok.ts`, `src/parser/instagram.ts`, `src/parser/threads.ts` — the actual alias lists
