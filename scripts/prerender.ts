/**
 * Writes the Vite HTML entry points from src/render.ts:
 *   index.html     → English  ("/")
 *   es/index.html  → Spanish  ("/es/")
 *   preview.html   → single-file preview entry (language switch without routes)
 * plus public/sitemap.xml and public/robots.txt.
 */
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPage } from "../src/render";
import { funnel, LOCALE_PATH } from "../src/config/funnel";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = (p: string, s: string) => {
  const f = resolve(root, p);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, s);
  console.log("  wrote", p);
};

// App screenshots → public/screens (served as static files by the site build)
const shotsDir = resolve(root, "src/assets/screens");
mkdirSync(resolve(root, "public/screens"), { recursive: true });
for (const f of readdirSync(shotsDir).filter((f) => f.endsWith(".webp"))) {
  copyFileSync(resolve(shotsDir, f), resolve(root, "public/screens", f));
}
console.log("  copied screenshots → public/screens");

out("index.html", renderPage("en", "site"));
out("es/index.html", renderPage("es", "site"));
out("preview.html", renderPage("en", "single"));

const site = funnel.siteUrl;
const alt = `<xhtml:link rel="alternate" hreflang="en" href="${site}${LOCALE_PATH.en}"/><xhtml:link rel="alternate" hreflang="es" href="${site}${LOCALE_PATH.es}"/><xhtml:link rel="alternate" hreflang="x-default" href="${site}${LOCALE_PATH.en}"/>`;
out(
  "public/sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url><loc>${site}${LOCALE_PATH.en}</loc>${alt}</url>
  <url><loc>${site}${LOCALE_PATH.es}</loc>${alt}</url>
</urlset>
`
);
out("public/robots.txt", `User-agent: *\nAllow: /\nSitemap: ${site}/sitemap.xml\n`);
