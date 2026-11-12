import { c, getLocale, onLocale, tr } from "./i18n";
import { initChart } from "./chart";
import { eqPath, fmtSigned, PRESETS } from "./studio";

export function initBento(bus: EventTarget) {
  initMute(bus);
  initGuard();
  initCatalog(bus);
  initStudio();
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
    // SystemAudioMuteService: save → mute + volume 0 → restore exact values → clear saved
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
  const SCALE = 2.4; // seconds shown on the track
  const DEADLINE = 1.6;
  // Example finish times. Only the deadline is real.
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

/* Voice Studio presets with the real values from VoicePreset. */
function initStudio() {
  const cell = document.querySelector<HTMLElement>("#studio");
  if (!cell) return;
  const path = cell.querySelector<SVGPathElement>(".eq-line")!;
  const vw = cell.querySelector<HTMLElement>(".v-warmth")!;
  const vp = cell.querySelector<HTMLElement>(".v-pitch")!;
  const btns = cell.querySelectorAll<HTMLButtonElement>("[data-preset]");
  btns.forEach((b) =>
    b.addEventListener("click", () => {
      const p = PRESETS.find((x) => x.key === b.dataset.preset)!;
      btns.forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      path.setAttribute("d", eqPath(p.warmth));
      vw.textContent = fmtSigned(p.warmth, " dB");
      vp.textContent = fmtSigned(p.pitch, " ct");
    })
  );
}
