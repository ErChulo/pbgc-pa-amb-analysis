const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const v = browser.version();
  const page = await browser.newPage();
  await page.goto('about:blank');
  const ua = await page.evaluate(() => navigator.userAgent);
  console.log('browser version:', v);
  console.log('userAgent:', ua);
  console.log('SMOKE PASS');
  await browser.close();
})().catch(e => { console.error('SMOKE FAIL:', e.message); process.exit(1); });
