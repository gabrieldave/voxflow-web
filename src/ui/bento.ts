import { c, getLocale, onLocale, tr } from "./i18n";
import { initChart } from "./chart";

export function initBento(bus: EventTarget) {
  initMute(bus);
  initGuard();
  initCatalog(bus);
  initVocab();
  const plot = document.querySelector<HTMLElement>("[data-chart]");
  if (plot) initChart(plot, getLocale, () => c().bento.stats.words);
}

/* Auto-mute: mirrors SystemAudioMuteService (save volume+mute → 0 → restore exact values). */
function initMute(bus: EventTarget) {
  const cell = document.querySelector<HTMLElement>("#mute");
  if (!cell) return;
  const player = cell.querySelector<HTMLElement>(".player")!;
  const fill = cell.querySelector<HTMLElement>(".player-vol-fill")!;
  const num = cell.querySelector<HTMLElement>(".player-vol-num")!;
  const status = cell.querySelector<HTMLElement>(".player-status")!;
  const btn = cell.querySelector<HTMLButtonElement>(".hold-btn")!;
  const caMute = cell.querySelector<HTMLElement>(".ca-mute")!;
  const caVol = cell.querySelector<HTMLElement>(".ca-vol")!;
  const caSaved = cell.querySelector<HTMLElement>(".ca-saved")!;
  const saved = 64;
  let restoreTimer = 0;

  const set = (on: boolean) => {
    clearTimeout(restoreTimer);
    player.dataset.state = on ? "muted" : "playing";
    fill.style.transform = `scaleX(${on ? 0 : saved / 100})`;
    num.textContent = `${on ? 0 : saved}%`;
    status.textContent = on ? tr("bento.mute.muted") : tr("bento.mute.restored", { v: saved });
    caMute.textContent = on ? "1" : "0";
    caVol.textContent = on ? "0.00" : (saved / 100).toFixed(2);
    caSaved.textContent = on ? (saved / 100).toFixed(2) : "nil";
    cell.dataset.muted = String(on);
    if (!on) restoreTimer = window.setTimeout(() => (status.textContent = ""), 2400);
  };
  fill.style.transform = `scaleX(${saved / 100})`;

  bus.addEventListener("mute", (e) => set((e as CustomEvent<boolean>).detail));
  btn.addEventListener("pointerdown", (e) => {
    try {
      btn.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    btn.classList.add("is-down");
    set(true);
  });
  const up = () => {
    if (!btn.classList.contains("is-down")) return;
    btn.classList.remove("is-down");
    set(false);
  };
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
  btn.addEventListener("keydown", (e) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      btn.classList.add("is-down");
      set(true);
    }
  });
  btn.addEventListener("keyup", (e) => {
    if (e.key === " " || e.key === "Enter") up();
  });
}

/* Anti-chat guard: polishDictation races Refine against a 1.6 s timeout and rejects chat-like replies. */
function initGuard() {
  const cell = document.querySelector<HTMLElement>("#guard");
  if (!cell) return;
  const bar = cell.querySelector<HTMLElement>(".race-bar")!;
  const time = cell.querySelector<HTMLElement>(".race-time")!;
  const out = cell.querySelector<HTMLElement>(".guard-out")!;
  const res = cell.querySelector<HTMLElement>(".guard-res")!;
  const btns = cell.querySelectorAll<HTMLButtonElement>("[data-scn]");
  const SCALE = 2.4;
  const DEADLINE = 1.6;
  const scn = { fast: 0.42, slow: 2.1, chatty: 0.6 } as const;
  let current: keyof typeof scn = "fast";
  let raf = 0;

  const outcome = (k: keyof typeof scn) => {
    const g = c().bento.guard;
    if (k === "fast") return { text: g.refined, res: g.resFast, ok: true };
    if (k === "slow") return { text: g.local, res: g.resSlow, ok: false };
    return { text: g.local, res: g.resChatty, ok: false };
  };

  const run = (k: keyof typeof scn, animate = true) => {
    current = k;
    cancelAnimationFrame(raf);
    const end = Math.min(scn[k], DEADLINE);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches || !animate;
    cell.dataset.result = "";
    out.textContent = "…";
    res.textContent = "";
    const start = performance.now();
    const tick = (now: number) => {
      const s = reduced ? end : Math.min(end, (now - start) / 1000);
      bar.style.transform = `scaleX(${(s / SCALE).toFixed(4)})`;
      time.textContent = `${s.toFixed(2)} s`;
      if (s < end) raf = requestAnimationFrame(tick);
      else {
        const o = outcome(k);
        if (k === "chatty") out.innerHTML = `<s>${c().bento.guard.chat}</s><br>${o.text}`;
        else out.textContent = o.text;
        res.textContent = o.res;
        cell.dataset.result = o.ok ? "ok" : k;
      }
    };
    raf = requestAnimationFrame(tick);
  };

  btns.forEach((b) =>
    b.addEventListener("click", () => {
      btns.forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      run(b.dataset.scn as keyof typeof scn);
    })
  );
  onLocale(() => run(current, false));
  run("fast", false);
}

/* Model catalog: one-click switch; tells the simulator which engine is "active". */
function initCatalog(bus: EventTarget) {
  const btns = document.querySelectorAll<HTMLButtonElement>("#catalog .model");
  btns.forEach((b) =>
    b.addEventListener("click", () => {
      btns.forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      bus.dispatchEvent(new CustomEvent("model", { detail: b.dataset.model }));
    })
  );
}

/* Custom Phonetic Vocabulary: <1 ms alias & phonetic skeleton matcher. */
function initVocab() {
  const cell = document.querySelector<HTMLElement>("#vocab");
  if (!cell) return;
  const heard = cell.querySelector<HTMLElement>(".vocab-heard")!;
  const fixed = cell.querySelector<HTMLElement>(".vocab-fixed")!;
  const rule = cell.querySelector<HTMLElement>(".vocab-rule")!;
  const btns = cell.querySelectorAll<HTMLButtonElement>("[data-voc]");
  let current: "1" | "2" | "3" = "1";

  const paint = (k: "1" | "2" | "3") => {
    current = k;
    const v = c().bento.vocab;
    heard.textContent = v[`h${k}`];
    fixed.textContent = v[`f${k}`];
    rule.textContent = v[`r${k}`];
  };

  btns.forEach((b) =>
    b.addEventListener("click", () => {
      const k = (b.dataset.voc as "1" | "2" | "3") || "1";
      btns.forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      paint(k);
    })
  );
  onLocale(() => paint(current));
  paint("1");
}
