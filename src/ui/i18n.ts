import { copy, LOCALE_PATH, type Copy, type Locale } from "../config/funnel";

let current: Locale = (document.documentElement.dataset.locale as Locale) || "en";
const listeners = new Set<(l: Locale) => void>();
const mode = document.documentElement.dataset.mode === "single" ? "single" : "site";

export const getLocale = () => current;
export const c = (): Copy => copy[current];
export const onLocale = (fn: (l: Locale) => void) => listeners.add(fn);

export function tr(path: string, vars: Record<string, string | number> = {}): string {
  const v = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], copy[current]);
  let s = typeof v === "string" ? v : path;
  for (const [k, val] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(val));
  return s;
}

function apply(locale: Locale) {
  current = locale;
  const html = document.documentElement;
  html.lang = locale;
  html.dataset.locale = locale;

  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const v = tr(el.dataset.i18n!);
    if (el.tagName === "TITLE") document.title = v;
    else el.innerHTML = v;
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-attr]").forEach((el) => {
    el.dataset.i18nAttr!.split(";").forEach((pair) => {
      const [attr, path] = pair.split(":");
      el.setAttribute(attr, tr(path));
    });
  });
  document.querySelectorAll<HTMLElement>(".lang [data-lang]").forEach((a) => {
    a.setAttribute("aria-current", String(a.dataset.lang === locale));
  });
  const foot = document.querySelector<HTMLAnchorElement>(".foot-lang");
  if (foot) {
    const other: Locale = locale === "en" ? "es" : "en";
    foot.dataset.lang = other;
    foot.textContent = other === "es" ? "Español" : "English";
    foot.href = mode === "single" ? `#${other}` : LOCALE_PATH[other];
  }
  listeners.forEach((fn) => fn(locale));
}

export function initI18n() {
  document.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-lang]");
    if (!a) return;
    e.preventDefault();
    const next = a.dataset.lang as Locale;
    if (next === current) return;
    apply(next);
    if (mode === "site") history.pushState({ locale: next }, "", LOCALE_PATH[next] + location.hash);
    else history.replaceState(null, "", `#${next}`);
  });

  if (mode === "site") {
    window.addEventListener("popstate", () => {
      const l: Locale = location.pathname.startsWith("/es") ? "es" : "en";
      if (l !== current) apply(l);
    });
  } else if (location.hash === "#es" && current !== "es") {
    apply("es");
  }
}
