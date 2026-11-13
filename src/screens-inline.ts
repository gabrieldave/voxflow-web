// Single-file preview only: inlines all 10 app screenshots (EN + ES) as data URIs.
const files = import.meta.glob("./assets/screens/*.webp", { eager: true, import: "default" }) as Record<string, string>;
const map: Record<string, string> = {};
for (const [path, url] of Object.entries(files)) map[path.split("/").pop()!.replace(".webp", "")] = url;

const lang = location.hash === "#es" ? "es" : document.documentElement.lang;
document.querySelectorAll<HTMLImageElement>("img.shot").forEach((img) => {
  const k = img.dataset.key!;
  img.dataset.srcEn = map[`en-${k}`];
  img.dataset.srcEs = map[`es-${k}`];
  img.src = (lang === "es" ? img.dataset.srcEs : img.dataset.srcEn) ?? "";
});
