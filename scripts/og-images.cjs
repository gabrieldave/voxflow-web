// Optional dev utility: regenerates public/og-en.jpg and public/og-es.jpg (1200×630)
// from the built site using the Fn (🌐) 3D keycap press state.
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  for (const [l, path] of [["en", "/"], ["es", "/es/"]]) {
    const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await p.goto("http://localhost:4173" + path, { waitUntil: "networkidle" });
    await p.addStyleTag({ content: ".nav{display:none}.hero{padding-top:56px}.trust,.fine,.cta-row{display:none}" });
    await p.waitForTimeout(900);
    const box = await p.locator(".keycap").boundingBox();
    if (box) await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down();
    await p.waitForTimeout(800);
    await p.screenshot({ path: `public/og-${l}.jpg`, type: "jpeg", quality: 86 });
    await p.mouse.up();
    await p.close();
  }
  await b.close();
})();
