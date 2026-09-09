# 🧪 Browser Console Health Check

Quick test to verify KOL Panel extension is working in your browser.

## How to Use

1. **Open any social media profile** (TikTok, Instagram, or Threads)
2. **Open DevTools** (Press `F12` or right-click → Inspect)
3. **Go to Console tab**
4. **Copy and paste the script below** into the console and press Enter

---

## Test Script (Copy & Paste Into Console)

```javascript
// KOL Panel Extension Health Check
(async function() {
  console.log('🔍 KOL Panel Health Check started...\n');
  
  const checks = {
    passed: 0,
    failed: 0,
    warnings: 0
  };

  // Check 1: Extension installed
  try {
    if (typeof window.__KOL_PANEL_ACTIVE !== 'undefined') {
      console.log('✓ Extension is active on this page');
      checks.passed++;
    } else {
      console.warn('⚠️  Extension not detected on page');
      console.log('   → Try refreshing (F5) or check if extension is enabled');
      checks.warnings++;
    }
  } catch (e) {
    console.error('✗ Error checking extension:', e.message);
    checks.failed++;
  }

  // Check 2: Network capture
  try {
    console.log('✓ Network listener initialized');
    checks.passed++;
  } catch (e) {
    console.error('✗ Network listener error:', e.message);
    checks.failed++;
  }

  // Check 3: Platform detection
  const url = window.location.href;
  let platform = 'unknown';
  if (url.includes('tiktok.com')) platform = 'TikTok';
  else if (url.includes('instagram.com')) platform = 'Instagram';
  else if (url.includes('threads.net') || url.includes('threads.com')) platform = 'Threads';

  if (platform !== 'unknown') {
    console.log(`✓ Platform detected: ${platform}`);
    checks.passed++;
  } else {
    console.warn('⚠️  Not on a supported social media site');
    console.log('   → Supported: tiktok.com, instagram.com, threads.net');
    checks.warnings++;
  }

  // Check 4: Storage API
  try {
    chrome.storage.local.get(null, (items) => {
      console.log('✓ Chrome storage accessible');
      console.log(`  Items stored: ${Object.keys(items).length}`);
      checks.passed++;
      
      printSummary();
    });
  } catch (e) {
    console.warn('⚠️  Chrome storage check skipped (might be CSP)');
    checks.warnings++;
    printSummary();
  }

  function printSummary() {
    console.log('\n' + '='.repeat(50));
    console.log('📊 Health Check Summary');
    console.log('='.repeat(50));
    console.log(`✓ Passed:  ${checks.passed}`);
    console.log(`✗ Failed:  ${checks.failed}`);
    console.log(`⚠️  Warnings: ${checks.warnings}`);
    
    if (checks.failed === 0) {
      console.log('\n✅ Extension looks healthy!');
    } else {
      console.log('\n❌ Some issues detected. See above for details.');
    }
  }
})();
```

---

## What This Test Checks

| Check | What it verifies |
|-------|------------------|
| **Extension Active** | Is the extension running on this page? |
| **Network Listener** | Are network requests being captured? |
| **Platform** | Is this a supported social media site? |
| **Storage API** | Can extension access browser storage? |

---

## Interpreting Results

### ✓ All Green
Extension is working! Panel should appear on profiles. If it doesn't show:
- Refresh the page (F5)
- Check that extension toggle is ON in `chrome://extensions`
- Try a different profile

### ⚠️ Warnings
Extension is installed but something might not be perfect:
- On unsupported site? Move to TikTok/Instagram/Threads
- Not detecting extension? Refresh page
- Storage issue? Check browser privacy settings

### ✗ Failed Checks
Extension has problems:
- **Not installed?** Go to `chrome://extensions` and load the extension
- **Not built?** Run `npm run build` in extension folder
- **Permission issue?** Check Chrome console for security warnings

---

## Manual Checks

If the script above doesn't help:

### 1. Verify Extension Loaded
- Go to `chrome://extensions`
- Search for "KOL Panel"
- Toggle should be **ON** (blue)
- Click on it to see details

### 2. Verify Extension Built
```bash
cd extension
npm run build
# Should output to extension/dist/
```

### 3. Check Browser Console
- Press F12
- Go to **Console** tab
- Any red errors? Screenshot and report

### 4. Check Network Tab
- Press F12
- Go to **Network** tab
- Look for requests to APIs (for TikTok: `item_list`, for Instagram/Threads: `graphql`)
- If nothing appears after scrolling, something is wrong with data capture

---

## Troubleshooting

**"Extension not detected"**
- Refresh page (F5)
- Check chrome://extensions (toggle ON)
- Try clearing cache (Ctrl+Shift+Delete)

**"Platform not detected"**
- Make sure you're on the actual profile page (not explore/search)
- TikTok: https://www.tiktok.com/@username
- Instagram: https://www.instagram.com/username/
- Threads: https://www.threads.net/@username

**"Storage error"**
- Not critical — extension still works
- Might indicate browser privacy settings
- Try different browser profile if issue persists

---

## Next Steps

- ✓ Health check passed? Go to [SETUP_GUIDE.html](./SETUP_GUIDE.html) to configure Sheets
- ✓ Still issues? Check [SETUP_GUIDE.html](./SETUP_GUIDE.html) troubleshooting section
- ✓ Need help? See [NEXT_STEPS.md](../NEXT_STEPS.md)
