// Optional dev utility: regenerates public/og-en.png and public/og-es.png (1200×630)
// from the built site. Requires Playwright: `npx playwright install chromium` then
// `npm run build && npx vite preview --port 4173 & node scripts/og-images.cjs`
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  for (const [l, path] of [["en", "/"], ["es", "/es/"]]) {
    const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await p.goto("http://localhost:4173" + path, { waitUntil: "networkidle" });
    await p.addStyleTag({ content: ".nav{display:none}.hero{padding-top:56px}.trust,.fine,.cta-row{display:none}" });
    await p.waitForTimeout(900);
    await p.keyboard.down("F5");
    await p.waitForTimeout(800);
    await p.screenshot({ path: `public/og-${l}.jpg`, type: "jpeg", quality: 86 });
    await p.keyboard.up("F5");
    await p.close();
  }
  await b.close();
})();
