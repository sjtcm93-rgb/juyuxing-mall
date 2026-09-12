// Single-process renderer: HTTP server + Playwright screenshots, all in one node process
// so the server stays alive for the whole run.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = __dirname;
const OUT = process.env.JUYUXING_OUT || '/Users/orange/.codex/visualizations/2026/08/10/019fe971-c172-7c11-aeb7-4a8465720bab';
const PORT = 7842;

const PAGES = [
  { name: 'home',     file: 'home.html',     title: 'Home · Apothecary' },
  { name: 'product',  file: 'product.html',  title: 'Product · Ritual'   },
  { name: 'category', file: 'category.html', title: 'Discover · Category' },
  { name: 'cart',     file: 'cart.html',     title: 'Bag · Cart'         },
  { name: 'user',     file: 'user.html',     title: 'Account · Member'   },
  { name: 'index',    file: 'index.html',    title: 'All · Showcase'     },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function safeJoin(base, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const resolved = path.normalize(path.join(base, decoded));
  if (!resolved.startsWith(base)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  const urlPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = safeJoin(ROOT, urlPath);
  if (!filePath) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

async function shot(browser, url, outPath, opts) {
  const ctx = await browser.newContext({
    viewport: opts.viewport,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  // wait fonts
  await page.evaluate(() => document.fonts ? document.fonts.ready : Promise.resolve());
  await page.waitForTimeout(800);
  await page.screenshot({ path: outPath, fullPage: opts.fullPage !== false });
  await ctx.close();
}

(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  console.log('http server listening on', PORT);
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true, executablePath: "/Users/orange/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell" });
  try {
    for (const p of PAGES) {
      const url = `http://127.0.0.1:${PORT}/${p.file}`;
      const isShowcase = p.file === 'index.html';
      const out = path.join(OUT, `${p.name}.png`);
      console.log('->', url);
      await shot(browser, url, out, {
        viewport: isShowcase ? { width: 2400, height: 1400 } : { width: 390, height: 844 },
        fullPage: !isShowcase,
      });
      console.log('   wrote', out);
    }
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
