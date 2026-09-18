import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

assert.notEqual(process.getuid(), 0, 'Chromium must run as non-root');
const browser = await chromium.launch({
  // ponytail: CPU rendering for W0; validate a GPU profile before GPU-dependent pages.
  headless: false, chromiumSandbox: true, args: ['--enable-automation', '--disable-gpu'],
});
try {
  const session = await browser.newBrowserCDPSession();
  const { arguments: args } = await session.send('Browser.getBrowserCommandLine');
  assert(!args.some(arg => /--(?:no-sandbox|disable-namespace-sandbox|disable-seccomp-filter-sandbox)/.test(arg)));
  const page = await browser.newPage({ viewport: { width: 1180, height: 740 } });
  const screenshotErrors = [];
  const screenshot = async (path) => {
    try {
      await page.screenshot({ path });
    } catch (error) {
      screenshotErrors.push({ path, error: error.message });
      console.error('SCREENSHOT_FAILED', path, error.message);
    }
  };
  await page.goto('chrome://sandbox');
  const sandbox = await page.locator('body').innerText();
  await writeFile('/evidence/sandbox.txt', sandbox);
  console.log(sandbox);
  assert.match(sandbox, /Layer 1 Sandbox\s+Namespace/i);
  assert.match(sandbox, /PID namespaces\s+Yes/i);
  assert.match(sandbox, /Network namespaces\s+Yes/i);
  assert.match(sandbox, /Seccomp-BPF sandbox\s+Yes/i);
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
  assert.equal(await page.title(), 'Example Domain');
  await screenshot('/evidence/example.png');
  await page.setContent(`<h1>W0: same Chromium instance</h1>
    <p>Type human-w0 below through noVNC. The probe only observes while waiting.</p>
    <label>Human input <input id="human"></label><p id="status">Waiting for human</p>
    <a download="w0.txt" href="data:text/plain,W0%20download">Download evidence</a>`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('a').click()]);
  await download.saveAs('/evidence/download.txt');
  assert.equal(await readFile('/evidence/download.txt', 'utf8'), 'W0 download');
  console.log('READY_FOR_NOVNC: enter human-w0 within 300 seconds');
  await page.waitForFunction(() => document.querySelector('#human').value === 'human-w0', null, { timeout: 300_000 });
  await page.locator('#status').evaluate(el => { el.textContent = 'Agent resumed after human input'; });
  await screenshot('/evidence/takeover.png');
  await writeFile('/evidence/result.json', JSON.stringify({
    chromium: browser.version(), uid: process.getuid(), chromiumSandbox: true,
    namespaceSandbox: true, seccompSandbox: true, downloaded: true, sameInstanceInput: true,
    screenshotErrors,
  }, null, 2));
  assert.equal(screenshotErrors.length, 0, 'Screenshot check failed; see result.json');
  console.log('PASS: sandbox, page, download, same-instance noVNC input');
} finally {
  await browser.close();
}
