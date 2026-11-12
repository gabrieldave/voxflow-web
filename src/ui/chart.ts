/**
 * Stats chart (mirrors StatsPanelView "Palabras · últimos 14 días").
 * Single series, so no legend box: the title names it. Example data only.
 */

export const STATS_SAMPLE = [820, 1140, 960, 0, 1310, 1580, 1220, 640, 1490, 1720, 1380, 1650, 1900, 1240];
/** 14 days ending on this date (example window). */
const END = Date.UTC(2026, 10, 11);

export function dayLabels(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", timeZone: "UTC" });
  return STATS_SAMPLE.map((_, i) => fmt.format(new Date(END - (13 - i) * 86_400_000)));
}

const W = 560;
const H = 180;
const PAD = { t: 12, r: 8, b: 26, l: 40 };

export function chartSVG(locale: string, title: string, wordsLabel: string): string {
  const labels = dayLabels(locale);
  const max = 2000;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const step = iw / STATS_SAMPLE.length;
  const bw = Math.min(22, step - 6);
  const nf = new Intl.NumberFormat(locale);
  const ticks = [0, 1000, 2000];

  const grid = ticks
    .map((v) => {
      const y = PAD.t + ih - (v / max) * ih;
      return `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}" class="viz-grid"/>
<text x="${PAD.l - 8}" y="${y + 4}" class="viz-axis" text-anchor="end">${v === 0 ? "0" : nf.format(v / 1000) + "k"}</text>`;
    })
    .join("");

  const bars = STATS_SAMPLE.map((v, i) => {
    const x = PAD.l + i * step + (step - bw) / 2;
    const h = Math.max((v / max) * ih, v > 0 ? 2 : 0);
    const y = PAD.t + ih - h;
    const r = Math.min(4, h / 2);
    // Rounded data-end only (top), square at the baseline.
    const path =
      h <= 0
        ? ""
        : `M${x},${PAD.t + ih} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${PAD.t + ih} Z`;
    const label = `${labels[i]}: ${nf.format(v)} ${wordsLabel}`;
    return `<g class="viz-bar" data-i="${i}" tabindex="0" role="img" aria-label="${label}">
<rect x="${PAD.l + i * step}" y="${PAD.t}" width="${step}" height="${ih}" class="viz-hit"/>
${path ? `<path d="${path}" class="viz-mark"/>` : `<line x1="${x}" x2="${x + bw}" y1="${PAD.t + ih - 0.5}" y2="${PAD.t + ih - 0.5}" class="viz-zero"/>`}
</g>`;
  }).join("");

  const xlabels = STATS_SAMPLE.map((_, i) => {
    if (i % 2 !== 1 && i !== 13) return "";
    const x = PAD.l + i * step + step / 2;
    return `<text x="${x}" y="${H - 8}" class="viz-axis" text-anchor="middle">${labels[i].replace(/\.$/, "")}</text>`;
  }).join("");

  return `<svg class="viz" viewBox="0 0 ${W} ${H}" role="group" aria-label="${title}">
${grid}
<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${PAD.t + ih}" y2="${PAD.t + ih}" class="viz-base"/>
${bars}${xlabels}
</svg>`;
}

export function chartTable(locale: string, dayLabel: string, wordsLabel: string): string {
  const labels = dayLabels(locale);
  const nf = new Intl.NumberFormat(locale);
  const rows = STATS_SAMPLE.map((v, i) => `<tr><td>${labels[i]}</td><td>${nf.format(v)}</td></tr>`).join("");
  return `<table class="viz-table"><thead><tr><th scope="col">${dayLabel}</th><th scope="col">${wordsLabel}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** Client: hover/focus tooltip + table toggle. */
export function initChart(root: HTMLElement, getLocale: () => string, getWords: () => string) {
  const svg = root.querySelector<SVGSVGElement>("svg.viz");
  const tip = root.querySelector<HTMLElement>(".viz-tip");
  if (!svg || !tip) return;

  const show = (g: SVGGElement) => {
    const i = Number(g.dataset.i);
    const labels = dayLabels(getLocale());
    const nf = new Intl.NumberFormat(getLocale());
    tip.innerHTML = `<span>${labels[i]}</span><strong>${nf.format(STATS_SAMPLE[i])}</strong> ${getWords()}`;
    const hit = g.querySelector("rect")!.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    const x = hit.left - box.left + hit.width / 2;
    tip.style.transform = `translate(${Math.round(x)}px, 0) translateX(-50%)`;
    tip.dataset.show = "true";
    svg.querySelectorAll(".viz-bar").forEach((b) => b.classList.toggle("is-dim", b !== g));
  };
  const hide = () => {
    tip.dataset.show = "false";
    svg.querySelectorAll(".viz-bar").forEach((b) => b.classList.remove("is-dim"));
  };

  svg.querySelectorAll<SVGGElement>(".viz-bar").forEach((g) => {
    g.addEventListener("pointerenter", () => show(g));
    g.addEventListener("focus", () => show(g));
    g.addEventListener("blur", hide);
  });
  svg.addEventListener("pointerleave", hide);
}
