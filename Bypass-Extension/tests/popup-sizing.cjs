const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    args: ['--no-sandbox', '--disable-gpu'],
    headless: true,
  });
  try {
    for (const width of [25, 376]) {
      const page = await browser.newPage({ viewport: { width, height: 600 } });
      await page.route('**/*', (r) => r.abort());
      const root = path.resolve(__dirname, '../ui');
      await page.setContent(
        fs
          .readFileSync(path.join(root, 'popup.html'), 'utf8')
          .replace(/<script[^>]*><\/script>/g, '')
          .replace(/<link[^>]+href="popup.css"[^>]*>/g, '')
      );
      await page.addStyleTag({ content: fs.readFileSync(path.join(root, 'popup.css'), 'utf8') });
      const size = await page.evaluate(() => ({
        html: document.documentElement.getBoundingClientRect().width,
        body: document.body.getBoundingClientRect().width,
        content: document.body.scrollWidth,
      }));
      assert.equal(size.html, 376);
      assert.equal(size.body, 376);
      assert.equal(size.content, 376);
      console.log('PASS: intrinsic popup width from viewport', width, size);
      if (width === 376)
        await page.screenshot({ path: path.join(__dirname, 'popup-sizing.png'), fullPage: true });
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
