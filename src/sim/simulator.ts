/**
 * Hold-to-Type Simulator. Choreography uses the real constants from the Swift code:
 *  - AudioAndSpeechEngine.stopListening: 55 ms tail after release (Parakeet path)
 *  - transcribeWithParakeetANE: drop if samples ≤ 1,920 @16 kHz (≤120 ms) or peak ≤ 0.004
 *  - TextInjectorService.injectText: ⌘V keyDown → 18 ms → keyUp; clipboard restored at 450 ms
 *  - AppCoordinator: "Sin voz detectada" error HUD dismissed after 650 ms
 *  - FloatingHUDView colours and status labels
 * Transcription time is NOT shown as a number: we don't publish unmeasured latency.
 */
import { InputMeter, type Source } from "./audio";
import type { Keycap3D } from "./keycap3d";
import { c, getLocale, onLocale, tr } from "../ui/i18n";
import takeEn1 from "../assets/take-en-1.mp3";
import takeEn2 from "../assets/take-en-2.mp3";
import takeEn3 from "../assets/take-en-3.mp3";
import takeEs1 from "../assets/take-es-1.mp3";
import takeEs2 from "../assets/take-es-2.mp3";
import takeEs3 from "../assets/take-es-3.mp3";

const TAKES = { en: [takeEn1, takeEn2, takeEn3], es: [takeEs1, takeEs2, takeEs3] };

const COLORS = {
  idle: "#597399", // (0.35, 0.45, 0.60)
  listening: "#00F0FF", // (0.0, 0.94, 1.0)
  processing: "#FFB800", // (1.0, 0.72, 0.0)
  pasted: "#0FBA82", // (0.06, 0.73, 0.51)
  noVoice: "#FF453A", // systemRed (dark)
} as const;

const TAIL_MS = 55;
const FLOOR_MS = 120; // 1,920 samples at 16 kHz
const PEAK_FLOOR = 0.004;
const CLIP_MS = 450;
const ERROR_HOLD_MS = 650;
const PROCESS_VISUAL_MS = 260; // visual only, never labelled

type Phase = "idle" | "listening" | "processing" | "pasted" | "noVoice";
type Row = { mark: string; key: string; vars?: Record<string, string | number>; kind?: string };

export function initSimulator(root: HTMLElement, bus: EventTarget) {
  const $ = <T extends Element>(s: string) => root.querySelector<T>(s)!;
  const hud = $<HTMLElement>(".hud");
  const hudStatus = $<HTMLElement>(".hud-status");
  const hudSub = $<HTMLElement>(".hud-sub");
  const ring = $<HTMLElement>(".hud-ring");
  const wave = $<HTMLCanvasElement>(".hud-wave");
  const keyBtn = $<HTMLButtonElement>(".keycap");
  const keyCanvas = $<HTMLCanvasElement>(".keycap-canvas");
  const edBody = $<HTMLElement>(".win-body");
  const clipVal = $<HTMLElement>(".clip-val");
  const clip = $<HTMLElement>(".clip");
  const volFill = $<HTMLElement>(".mb-vol-fill");
  const mbVox = $<HTMLElement>(".mb-vox");
  const timeline = $<HTMLOListElement>(".timeline");
  const live = document.getElementById("sim-live")!;
  const h1 = document.querySelector<HTMLElement>("#hero-title")!;
  const srcBtns = root.querySelectorAll<HTMLButtonElement>("[data-src]");
  const srcNote = $<HTMLElement>(".src-note");

  const meter = new InputMeter();
  let keycap: Keycap3D | null = null;
  // Three.js loads after first paint so it never blocks the headline.
  import("./keycap3d")
    .then(({ Keycap3D }) => {
      keycap = new Keycap3D(keyCanvas);
      keyBtn.classList.add("has-3d");
      keycap.setColor(COLORS[phase]);
    })
    .catch(() => keyBtn.classList.add("no-3d"));

  let phase: Phase = "idle";
  let source: Source = "take";
  let model = "Parakeet Ultra";
  let t0 = 0;
  let sentence = 0;
  let timers: number[] = [];
  let clipTimer = 0;
  let clipOriginal = c().sim.clipboardInitial;
  let rows: Row[] = [];
  let history: number[] = new Array(30).fill(0);
  let raf = 0;
  let level = 0;
  let phaseTimer = 0;

  const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  /* ---------------- HUD ---------------- */
  const subIdle = () => `${model} · ${c().sim.hud.direct}`;

  function setPhase(p: Phase) {
    phase = p;
    hud.dataset.state = p;
    mbVox.dataset.state = p;
    hud.style.setProperty("--accent", COLORS[p]);
    hudStatus.textContent = c().sim.hud[p];
    if (p !== "listening") hudSub.textContent = subIdle();
    keycap?.setColor(COLORS[p]);
    if (p === "idle") keycap?.setIdleGlow(0.15);
    if (p === "processing") keycap?.setIdleGlow(0.6);
    if (p === "pasted") keycap?.setIdleGlow(0.7);
    if (p === "noVoice") keycap?.setIdleGlow(0.6);
  }

  function setH1(state: "idle" | "hold" | "talk" | "letgo" | "typed") {
    h1.dataset.phase = state;
  }

  function drawWave() {
    const g = wave.getContext("2d");
    if (!g) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wave.clientWidth;
    const h = wave.clientHeight;
    if (wave.width !== Math.round(w * dpr)) {
      wave.width = Math.round(w * dpr);
      wave.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = getComputedStyle(hud).getPropertyValue("--accent") || COLORS.idle;
    const n = history.length;
    const bw = 2;
    const gap = (w - n * bw) / (n - 1);
    for (let i = 0; i < n; i++) {
      const v = history[i];
      const bh = Math.max(2, v * (h - 4));
      g.globalAlpha = 0.35 + 0.65 * (i / n);
      g.beginPath();
      g.roundRect(i * (bw + gap), (h - bh) / 2, bw, bh, 1);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  let frameCount = 0;
  function loop() {
    level = phase === "listening" ? meter.level() : level * 0.85;
    if (frameCount++ % 2 === 0) {
      history.push(level);
      history.shift();
    }
    ring.style.transform = `scale(${(1 + level * 0.45).toFixed(3)})`;
    if (phase === "listening") {
      keycap?.setLevel(level);
      if (model === "Apple Speech") {
        // Apple Speech is the only engine with live partial results in the HUD.
        const words = c().sim.lines[sentence % 3].split(" ");
        const n = Math.min(words.length, Math.floor(((performance.now() - t0) / 1000) * 2.6));
        hudSub.textContent = n > 0 ? words.slice(0, n).join(" ") : subIdle();
      }
    }
    drawWave();
    if (phase === "listening" || level > 0.004) raf = requestAnimationFrame(loop);
    else {
      history = history.map(() => 0);
      drawWave();
      ring.style.transform = "scale(1)";
      raf = 0;
    }
  }
  const startLoop = () => {
    if (!raf) raf = requestAnimationFrame(loop);
  };

  /* ---------------- Timeline ---------------- */
  function renderRows() {
    timeline.dataset.empty = String(rows.length === 0);
    if (!rows.length) {
      timeline.innerHTML = `<li class="tl-empty">${tr("sim.tl.empty")}</li>`;
      return;
    }
    timeline.innerHTML = rows
      .map((r) => `<li class="tl-row is-in" data-kind="${r.kind ?? ""}"><span class="tl-mark mono">${r.mark}</span><span class="tl-text">${tr(r.key, r.vars)}</span></li>`)
      .join("");
  }
  function addRow(r: Row) {
    rows.push(r);
    if (timeline.dataset.empty === "true") timeline.innerHTML = "";
    timeline.dataset.empty = "false";
    const li = document.createElement("li");
    li.className = "tl-row";
    li.dataset.kind = r.kind ?? "";
    li.innerHTML = `<span class="tl-mark mono">${r.mark}</span><span class="tl-text">${tr(r.key, r.vars)}</span>`;
    timeline.appendChild(li);
    requestAnimationFrame(() => li.classList.add("is-in"));
  }

  /* ---------------- Editor & clipboard ---------------- */
  function paste(text: string) {
    const active = edBody.querySelector<HTMLElement>(".ed-active")!;
    const ins = active.querySelector<HTMLElement>(".ed-ins")!;
    let target = ins;
    if (ins.textContent) {
      const n = edBody.querySelectorAll(".ed-line").length + 1;
      active.classList.remove("ed-active");
      active.querySelector(".caret")?.remove();
      const line = document.createElement("div");
      line.className = "ed-line ed-active";
      line.innerHTML = `<span class="ln">${n}</span><span class="tx"><span class="ed-prefix">- </span><span class="ed-ins"></span><span class="caret"></span></span>`;
      edBody.appendChild(line);
      target = line.querySelector(".ed-ins")!;
      // keep the editor compact: drop the oldest pasted line beyond 3
      const pasted = edBody.querySelectorAll(".ed-line:nth-child(n+5)");
      if (pasted.length > 3) {
        pasted[0].remove();
        edBody.querySelectorAll(".ed-line .ln").forEach((ln, i) => (ln.textContent = String(i + 1)));
      }
    }
    target.textContent = text;
    target.classList.remove("is-new");
    void target.offsetWidth;
    target.classList.add("is-new");
  }

  function setClipboard(text: string, restored = false) {
    clipVal.textContent = text;
    clip.dataset.state = restored ? "restored" : "pasted";
  }

  /* ---------------- Mute (CoreAudio) ---------------- */
  function mute(on: boolean) {
    volFill.style.transform = `scaleX(${on ? 0 : 0.64})`;
    bus.dispatchEvent(new CustomEvent("mute", { detail: on }));
  }

  /* ---------------- Press / release ---------------- */
  async function press() {
    if (phase === "listening") return;
    if (phase === "processing") {
      addRow({ mark: "…", key: "sim.tl.busy", kind: "warn" });
      return;
    }
    clearTimers();
    rows = [];
    renderRows();
    t0 = performance.now();
    setPhase("listening");
    setH1("hold");
    phaseTimer = window.setTimeout(() => phase === "listening" && setH1("talk"), 320);
    keycap?.setPressed(true);
    keycap?.setLive(true);
    keyBtn.classList.add("is-down");
    mute(true);
    live.textContent = tr("sim.live.listening");
    startLoop();
    if (source === "mic") meter.startMic();
    else {
      const urls = TAKES[getLocale()];
      void meter.preload(urls);
      await meter.startTake(urls[sentence % 3]);
      if ((phase as Phase) !== "listening") meter.stop(); // released before decode finished
    }
  }

  function release() {
    if (phase !== "listening") return;
    clearTimeout(phaseTimer);
    const held = Math.round(performance.now() - t0);
    const audioMs = held + TAIL_MS;
    keycap?.setPressed(false);
    keyBtn.classList.remove("is-down");
    setH1("letgo");
    addRow({ mark: "F5", key: "sim.tl.held", vars: { ms: held } });

    later(TAIL_MS, () => {
      const peak = meter.peak;
      meter.stop();
      keycap?.setLive(false);
      addRow({ mark: `+${TAIL_MS} ms`, key: "sim.tl.tail" });

      const silent = source === "mic" && peak <= PEAK_FLOOR;
      if (audioMs <= FLOOR_MS || silent) {
        setPhase("noVoice");
        mute(false);
        addRow(
          audioMs <= FLOOR_MS
            ? { mark: `${audioMs} ms`, key: "sim.tl.discarded", vars: { audio: audioMs }, kind: "drop" }
            : { mark: "−48 dB", key: "sim.tl.noVoice", kind: "drop" }
        );
        live.textContent = tr("sim.live.discarded");
        later(ERROR_HOLD_MS, () => {
          setPhase("idle");
          setH1("idle");
        });
        return;
      }

      setPhase("processing");
      live.textContent = tr("sim.live.processing");
      addRow({ mark: "ANE", key: "sim.tl.transcribe", vars: { model } });

      later(PROCESS_VISUAL_MS, () => {
        const text = c().sim.lines[sentence % 3];
        sentence++;
        mute(false); // restoreAfterDictation() runs before the paste
        // injectText: cancel a pending restore, put text on the clipboard, ⌘V
        clearTimeout(clipTimer);
        clipOriginal = c().sim.clipboardInitial;
        setClipboard(text);
        paste(text);
        setPhase("pasted");
        setH1("typed");
        live.textContent = tr("sim.live.pasted", { text });
        addRow({ mark: "⌘V", key: "sim.tl.paste" });
        clipTimer = window.setTimeout(() => {
          setClipboard(clipOriginal, true);
          addRow({ mark: `+${CLIP_MS} ms`, key: "sim.tl.clipboard", vars: { clip: clipOriginal }, kind: "ok" });
        }, CLIP_MS);
        later(1400, () => {
          setPhase("idle");
          setH1("idle");
        });
      });
    });
  }

  /* ---------------- Input bindings ---------------- */
  const isF5 = (e: KeyboardEvent) => e.key === "F5" || e.code === "F5";
  const typing = (e: Event) => (e.target as HTMLElement)?.closest("input, textarea, [contenteditable], dialog[open]");

  window.addEventListener("keydown", (e) => {
    if (isF5(e)) {
      e.preventDefault(); // F5 would reload the page
      if (typing(e)) return;
      if (!e.repeat) void press();
    } else if ((e.key === " " || e.key === "Enter") && document.activeElement === keyBtn) {
      e.preventDefault();
      if (!e.repeat) void press();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (isF5(e) || ((e.key === " " || e.key === "Enter") && document.activeElement === keyBtn)) {
      e.preventDefault();
      release();
    }
  });
  window.addEventListener("blur", release);

  keyBtn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    try {
      keyBtn.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointer */
    }
    void press();
  });
  keyBtn.addEventListener("pointerup", release);
  keyBtn.addEventListener("pointercancel", release);
  keyBtn.addEventListener("lostpointercapture", release);
  keyBtn.addEventListener("contextmenu", (e) => e.preventDefault());

  root.addEventListener("pointermove", (e) => {
    const r = root.getBoundingClientRect();
    keycap?.tilt(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
  });
  root.addEventListener("pointerleave", () => keycap?.tilt(0, 0));

  srcBtns.forEach((b) =>
    b.addEventListener("click", async () => {
      const want = b.dataset.src as Source;
      if (want === source) return;
      if (want === "mic") {
        const ok = await meter.openMic();
        if (!ok) {
          srcNote.hidden = false;
          srcNote.removeAttribute("data-i18n");
          srcNote.textContent = tr("sim.micDenied");
          return;
        }
        srcNote.setAttribute("data-i18n", "sim.micNote");
        srcNote.innerHTML = tr("sim.micNote");
        srcNote.hidden = false;
      } else {
        meter.closeMic();
        srcNote.hidden = true;
      }
      source = want;
      srcBtns.forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    })
  );

  bus.addEventListener("model", (e) => {
    model = (e as CustomEvent<string>).detail;
    if (phase !== "listening") hudSub.textContent = subIdle();
  });

  onLocale(() => {
    hudStatus.textContent = c().sim.hud[phase];
    if (phase !== "listening") hudSub.textContent = subIdle();
    if (phase === "idle" && clip.dataset.state !== "pasted") {
      clipOriginal = c().sim.clipboardInitial;
      clipVal.textContent = clipOriginal;
    }
    renderRows();
  });

  // initial paint
  setPhase("idle");
  volFill.style.transform = "scaleX(0.64)";
  drawWave();
}
