/**
 * Voice Studio presets and an approximate magnitude response of the EQ stage.
 * Values copied from VoicePreset (AppModels.swift) and VoiceStudioEngine.swift:
 *  band 0: high-pass 85 Hz · band 1: parametric 180 Hz, bw 1.0 oct, gain = warmth
 *  band 2: parametric 4.2 kHz, bw 0.8 oct, +3 dB · reverb wet 8 % default
 */

export const PRESETS = [
  { key: "p1", pitch: -40, warmth: 3.0 },
  { key: "p2", pitch: -220, warmth: 6.5 },
  { key: "p3", pitch: -480, warmth: -2.0 },
  { key: "p4", pitch: 180, warmth: 1.5 },
] as const;

export const ROOM_WET = 8;

const W = 300;
const H = 96;
const FMIN = 20;
const FMAX = 20000;
const DB = 12; // ± range shown

function bell(f: number, f0: number, gain: number, bwOct: number) {
  const oct = Math.log2(f / f0);
  const sigma = bwOct / 2.355; // FWHM → sigma
  return gain * Math.exp(-(oct * oct) / (2 * sigma * sigma));
}

function hpf(f: number, fc: number) {
  // 2nd-order Butterworth magnitude in dB
  const r = f / fc;
  return 10 * Math.log10(Math.pow(r, 4) / (1 + Math.pow(r, 4)));
}

export function eqPath(warmth: number): string {
  const pts: string[] = [];
  for (let i = 0; i <= 120; i++) {
    const f = FMIN * Math.pow(FMAX / FMIN, i / 120);
    let db = hpf(f, 85) + bell(f, 180, warmth, 1.0) + bell(f, 4200, 3, 0.8);
    db = Math.max(-DB, Math.min(DB, db));
    const x = (i / 120) * W;
    const y = H / 2 - (db / DB) * (H / 2 - 6);
    pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

export function eqSVG(warmth: number, label: string): string {
  const fx = (f: number) => ((Math.log(f / FMIN) / Math.log(FMAX / FMIN)) * W).toFixed(1);
  const marks = [85, 180, 4200]
    .map((f) => `<line x1="${fx(f)}" x2="${fx(f)}" y1="4" y2="${H - 4}" class="eq-mark"/>`)
    .join("");
  return `<svg class="eq" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="eq-zero"/>
${marks}
<path d="${eqPath(warmth)}" class="eq-line"/>
<text x="${fx(85)}" y="${H - 2}" class="eq-axis" text-anchor="middle">85</text>
<text x="${fx(180)}" y="${H - 2}" class="eq-axis" text-anchor="start" dx="4">180</text>
<text x="${fx(4200)}" y="${H - 2}" class="eq-axis" text-anchor="middle">4.2k</text>
</svg>`;
}

export const fmtSigned = (n: number, unit: string) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}${unit}`;
