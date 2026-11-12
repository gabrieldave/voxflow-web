/**
 * Scroll choreography (reveal + count-up) and the Linear-style cursor spotlight.
 * Everything here is progressive: without JS or with reduced motion, content is simply visible.
 */
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const REVEAL = ".step, .cell, .table-wrap, .plan, .day15, .tour-wrap";

export function initReveal() {
  if (reduced() || !("IntersectionObserver" in window)) return;
  const items = [...document.querySelectorAll<HTMLElement>(REVEAL)];
  items.forEach((el) => {
    const sibs = [...(el.parentElement?.children ?? [])].filter((c) => c.matches(REVEAL));
    el.style.setProperty("--i", String(Math.max(0, sibs.indexOf(el))));
  });
  document.documentElement.classList.add("js-reveal");
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("is-revealed");
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.1 }
  );
  items.forEach((el) => io.observe(el));
}

export function initCountUp() {
  const els = [...document.querySelectorAll<HTMLElement>("[data-count]")];
  if (!els.length || !("IntersectionObserver" in window) || reduced()) return;
  const run = (el: HTMLElement) => {
    const final = el.innerHTML;
    const m = final.match(/\d[\d,]*(?:\.\d+)?/);
    if (!m) return;
    const target = parseFloat(m[0].replace(/,/g, ""));
    const dec = (m[0].split(".")[1] ?? "").length;
    const t0 = performance.now();
    const D = 1200;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / D);
      if (p >= 1) {
        el.innerHTML = final;
        return;
      }
      const eased = 1 - Math.pow(2, -10 * p);
      el.innerHTML = final.replace(m[0], (target * eased).toFixed(dec));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        run(e.target as HTMLElement);
      }
    },
    { threshold: 0.6 }
  );
  els.forEach((el) => io.observe(el));
}

/** Border + inner reflection follow the cursor across neighbouring cards. */
export function initSpotlight(container: HTMLElement | null, selector: string) {
  if (!container || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const cards = [...container.querySelectorAll<HTMLElement>(selector)];
  let raf = 0;
  let x = 0;
  let y = 0;
  const update = () => {
    raf = 0;
    const rects = cards.map((c) => c.getBoundingClientRect()); // read all first
    cards.forEach((c, i) => {
      c.style.setProperty("--mx", `${(x - rects[i].left).toFixed(1)}px`);
      c.style.setProperty("--my", `${(y - rects[i].top).toFixed(1)}px`);
    });
  };
  container.addEventListener("pointermove", (e) => {
    x = e.clientX;
    y = e.clientY;
    if (!raf) raf = requestAnimationFrame(update);
  });
  container.addEventListener("pointerleave", () => {
    cancelAnimationFrame(raf);
    raf = 0;
    cards.forEach((c) => {
      c.style.setProperty("--mx", "-1000px");
      c.style.setProperty("--my", "-1000px");
    });
  });
}
