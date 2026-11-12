/** App screen tour: accessible tabs, crossfading screenshots, EN/ES image swap. */
import { onLocale, getLocale, tr } from "./i18n";

export function initTour() {
  const root = document.querySelector<HTMLElement>("#tour");
  if (!root) return;
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const shots = [...root.querySelectorAll<HTMLImageElement>("img.shot")];
  const panel = root.querySelector<HTMLElement>('[role="tabpanel"]')!;
  const cap = root.querySelector<HTMLElement>(".tour-cap")!;
  let current = tabs[0]?.dataset.shot ?? "flow";

  const select = (key: string, focus = false) => {
    current = key;
    tabs.forEach((t) => {
      const on = t.dataset.shot === key;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
      if (on) panel.setAttribute("aria-labelledby", t.id);
    });
    shots.forEach((img) => {
      const on = img.dataset.key === key;
      if (on && img.loading === "lazy") img.loading = "eager";
      img.classList.toggle("is-on", on);
    });
    cap.textContent = tr(`tour.c_${key}`);
  };

  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(t.dataset.shot!));
    t.addEventListener("keydown", (e) => {
      const n = tabs.length;
      let j = -1;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") j = (i + 1) % n;
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") j = (i - 1 + n) % n;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = n - 1;
      if (j >= 0) {
        e.preventDefault();
        select(tabs[j].dataset.shot!, true);
      }
    });
  });

  const swap = () => {
    const l = getLocale();
    shots.forEach((img) => {
      const src = l === "es" ? img.dataset.srcEs : img.dataset.srcEn;
      if (src && img.getAttribute("src") !== src) img.src = src;
    });
    cap.textContent = tr(`tour.c_${current}`);
  };
  onLocale(swap);
}
