/**
 * Server-side (build-time) renderer. Produces complete, crawlable HTML for each
 * locale. Every translatable node carries data-i18n so the client can swap
 * languages instantly without a reload.
 */
import { copy, funnel, LOCALE_PATH, type Copy, type Locale } from "./config/funnel";
import { chartSVG, chartTable } from "./ui/chart";

export type RenderMode = "site" | "single";

function lookup(c: Copy, path: string): string {
  const v = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], c);
  if (typeof v !== "string") throw new Error(`Missing copy key: ${path}`);
  return v;
}

const PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function renderPage(locale: Locale, mode: RenderMode): string {
  const c = copy[locale];
  const t = (p: string) => lookup(c, p);
  /** element with translatable inner HTML */
  const T = (tag: string, p: string, attrs = "") => `<${tag} data-i18n="${p}"${attrs ? " " + attrs : ""}>${t(p)}</${tag}>`;

  const site = funnel.siteUrl;
  const url = (l: Locale) => site + LOCALE_PATH[l];
  const href = (l: Locale) => (mode === "single" ? `#${l}` : LOCALE_PATH[l]);
  const plan = (id: "personal" | "pro" | "team") => funnel.plans.find((p) => p.id === id)!;
  const ogLocale = locale === "en" ? "en_US" : "es_MX";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: funnel.product.name,
    operatingSystem: `macOS ${funnel.trust.minMacOS}+`,
    applicationCategory: "BusinessApplication",
    softwareVersion: funnel.product.version,
    description: c.meta.description,
    publisher: { "@type": "Organization", name: funnel.product.company },
    offers: funnel.plans.map((p) => ({
      "@type": "Offer",
      name: `${funnel.product.name} ${p.id[0].toUpperCase()}${p.id.slice(1)}`,
      price: p.price.toFixed(2),
      priceCurrency: "USD",
      url: funnel.stripe[p.id],
    })),
  };

  const check = `<svg class="ico-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const mark = `<svg class="brand-mark" viewBox="0 0 28 28" aria-hidden="true"><rect x="0.5" y="0.5" width="27" height="27" rx="7.5" fill="#16161A" stroke="rgba(255,255,255,.14)"/><g stroke="#E9E9EC" stroke-width="2" stroke-linecap="round"><path d="M8 12v4"/><path d="M11.5 9v10"/><path d="M15 11v6"/><path d="M18.5 7.5v13"/><path d="M22 12v4"/></g></svg>`;
  const mic = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3Z" fill="currentColor"/><path d="M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  const globe = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><ellipse cx="12" cy="12" rx="4.2" ry="8.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.8 12h16.4M5.2 8.2h13.6M5.2 15.8h13.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
  const stop = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor"/></svg>`;

  const models = [
    { id: "parakeetUltra", name: "Parakeet Ultra", size: "595 MB", d: "bento.catalog.m1" },
    { id: "parakeetV3", name: "Parakeet V3", size: "480 MB", d: "bento.catalog.m2" },
    { id: "parakeetRedux", name: "Parakeet Redux", size: "220 MB", d: "bento.catalog.m3" },
    { id: "parakeetV2", name: "Parakeet V2", size: "474 MB", d: "bento.catalog.m4" },
    { id: "appleSpeech", name: "Apple Speech", size: "0 MB", d: "bento.catalog.m5" },
  ];

  const sha = funnel.download.sha256;

  // The single-file preview entry inlines all 10 screenshots before booting main.ts.
  const scriptTag = `<script type="module" src="/src/${mode === "single" ? "preview-entry" : "main"}.ts"></script>`;

  const shots = ["flow", "catalog", "vocab", "stats", "license"] as const;
  const shotSrc = (l: Locale, k: string) => `/screens/${l}-${k}.webp`;

  return `<!doctype html>
<html lang="${locale}" data-locale="${locale}" data-mode="${mode}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title data-i18n="meta.title">${t("meta.title")}</title>
<meta name="description" content="${esc(c.meta.description)}" data-i18n-attr="content:meta.description">
<meta name="theme-color" content="#09090B">
<meta name="color-scheme" content="dark">
${
  mode === "site"
    ? `<link rel="canonical" href="${url(locale)}">
<link rel="alternate" hreflang="en" href="${url("en")}">
<link rel="alternate" hreflang="es" href="${url("es")}">
<link rel="alternate" hreflang="x-default" href="${url("en")}">`
    : ""
}
<meta property="og:type" content="website">
<meta property="og:site_name" content="${funnel.product.name}">
<meta property="og:title" content="${esc(c.meta.ogTitle)}">
<meta property="og:description" content="${esc(c.meta.ogDescription)}">
<meta property="og:url" content="${url(locale)}">
<meta property="og:image" content="${site}/og-${locale}.jpg">
<meta property="og:locale" content="${ogLocale}">
<meta property="og:locale:alternate" content="${locale === "en" ? "es_MX" : "en_US"}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(mark.replace('class="brand-mark" ', 'xmlns="http://www.w3.org/2000/svg" '))}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<a class="skip" href="#main" data-i18n="nav.skip">${t("nav.skip")}</a>

<header class="nav" id="nav">
  <div class="nav-inner">
    <a class="brand" href="${href(locale)}" aria-label="${funnel.product.name}">${mark}<span>VoxFlow Studio</span></a>
    <nav class="nav-links" aria-label="Primary">
      <a href="#how" data-i18n="nav.how">${t("nav.how")}</a>
      <a href="#tour" data-i18n="nav.tour">${t("nav.tour")}</a>
      <a href="#details" data-i18n="nav.features">${t("nav.features")}</a>
      <a href="#pricing" data-i18n="nav.pricing">${t("nav.pricing")}</a>
      <a href="#faq" data-i18n="nav.faq">${t("nav.faq")}</a>
    </nav>
    <div class="nav-right">
      <div class="lang" role="group" aria-label="${t("nav.langLabel")}" data-i18n-attr="aria-label:nav.langLabel">
        <a href="${href("en")}" hreflang="en" lang="en" data-lang="en" aria-current="${locale === "en" ? "true" : "false"}">EN</a>
        <a href="${href("es")}" hreflang="es" lang="es" data-lang="es" aria-current="${locale === "es" ? "true" : "false"}">ES</a>
      </div>
      <button class="btn btn-sm btn-light" type="button" data-open-download data-i18n="nav.download">${t("nav.download")}</button>
    </div>
  </div>
</header>

<main id="main">

<section class="hero" id="top" aria-labelledby="hero-title">
  <div class="hero-copy">
    <p class="eyebrow"><span class="eyebrow-dot" aria-hidden="true"></span><span data-i18n="hero.eyebrow">${t("hero.eyebrow")}</span></p>
    <h1 id="hero-title" class="display" data-phase="idle">
      <span class="h-line" data-line="1" data-i18n="hero.l1">${t("hero.l1")}</span>
      <span class="h-line" data-line="2" data-i18n="hero.l2">${t("hero.l2")}</span>
      <span class="h-line" data-line="3" data-i18n="hero.l3">${t("hero.l3")}</span>
      <span class="h-line" data-line="4" data-i18n="hero.l4">${t("hero.l4")}</span>
    </h1>
    ${T("p", "hero.sub", 'class="lede"')}
    <div class="cta-row">
      <button class="btn btn-light" type="button" data-open-download data-i18n="hero.ctaPrimary">${t("hero.ctaPrimary")}</button>
      <a class="btn btn-ghost" href="#pricing" data-i18n="hero.ctaSecondary">${t("hero.ctaSecondary")}</a>
    </div>
    ${T("p", "hero.trialNote", 'class="fine"')}
    <ul class="trust">
      <li>${T("span", "hero.trust1")}</li>
      <li><span class="mono">${t("hero.trust2")}</span></li>
      <li>${T("span", "hero.trust3")}</li>
    </ul>
  </div>

  <div class="stage" id="sim">
    <div class="screen">
      <div class="wallpaper" aria-hidden="true">
        <svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">
          <defs>
            <radialGradient id="wp-glow" cx="22%" cy="-8%" r="75%"><stop offset="0" stop-color="#5a73aa" stop-opacity=".55"/><stop offset="1" stop-color="#5a73aa" stop-opacity="0"/></radialGradient>
            <linearGradient id="wp-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22345c"/><stop offset=".55" stop-color="#131c33"/><stop offset="1" stop-color="#0a0e19"/></linearGradient>
            <linearGradient id="wp-b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3b5487" stop-opacity=".0"/><stop offset=".45" stop-color="#4a62a0" stop-opacity=".55"/><stop offset="1" stop-color="#26385f" stop-opacity=".15"/></linearGradient>
            <linearGradient id="wp-c" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2b3448"/><stop offset="1" stop-color="#0d111b"/></linearGradient>
            <filter id="wp-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="22"/></filter>
            <filter id="wp-edge" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="1.6"/></filter>
          </defs>
          <rect width="800" height="600" fill="#090c14"/>
          <rect width="800" height="600" fill="url(#wp-glow)"/>
          <path d="M-120 330 C 140 170 380 430 920 140 L 920 700 L -120 700 Z" fill="url(#wp-a)"/>
          <path d="M-120 300 C 160 120 400 380 920 110 L 920 190 C 400 450 150 230 -120 380 Z" fill="url(#wp-b)" filter="url(#wp-soft)"/>
          <path d="M-120 330 C 140 170 380 430 920 140" fill="none" stroke="#a9bbe6" stroke-opacity=".28" stroke-width="1.6" filter="url(#wp-edge)"/>
          <path d="M-120 520 C 200 400 470 600 920 430 L 920 700 L -120 700 Z" fill="url(#wp-c)" opacity=".9"/>
          <path d="M-120 520 C 200 400 470 600 920 430" fill="none" stroke="#8fa0c8" stroke-opacity=".16" stroke-width="1.2" filter="url(#wp-edge)"/>
        </svg>
      </div>
      <div class="menubar" aria-hidden="true">
        <span class="mb-app">Editor</span>
        <span class="mb-spacer"></span>
        <span class="mb-vox" data-state="idle"><svg viewBox="0 0 20 14"><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 5v4"/><path d="M5.5 2.5v9"/><path d="M9 4.5v5"/><path d="M12.5 1.5v11"/><path d="M16 5v4"/></g></svg></span>
        <span class="mb-vol"><svg viewBox="0 0 18 14"><path d="M2 5h3l4-3v10L5 9H2z" fill="currentColor"/></svg><span class="mb-vol-track"><span class="mb-vol-fill"></span></span></span>
        <span class="mb-clock mono">10:24</span>
      </div>

      <div class="hud" data-state="idle" aria-hidden="true">
        <div class="hud-orb">
          <span class="hud-ring"></span>
          <span class="hud-core"><span class="hud-ico hud-ico-mic">${mic}</span><span class="hud-ico hud-ico-stop">${stop}</span></span>
        </div>
        <div class="hud-text">
          <span class="hud-status">${t("sim.hud.idle")}</span>
          <span class="hud-sub">Parakeet Ultra · ${t("sim.hud.direct")}</span>
        </div>
        <canvas class="hud-wave" width="120" height="36"></canvas>
      </div>

      <div class="window" role="img" aria-label="${esc(t("sim.windowTitle"))}">
        <div class="win-bar">
          <span class="lights"><i></i><i></i><i></i></span>
          <span class="win-title mono" data-i18n="sim.windowTitle">${t("sim.windowTitle")}</span>
        </div>
        <div class="win-body mono">
          <div class="ed-line"><span class="ln">1</span><span class="tx" data-i18n="sim.editor1">${t("sim.editor1")}</span></div>
          <div class="ed-line"><span class="ln">2</span><span class="tx"></span></div>
          <div class="ed-line"><span class="ln">3</span><span class="tx" data-i18n="sim.editor2">${t("sim.editor2")}</span></div>
          <div class="ed-line ed-active"><span class="ln">4</span><span class="tx"><span class="ed-prefix">- </span><span class="ed-ins"></span><span class="caret"></span></span></div>
        </div>
      </div>

      <div class="clip mono" aria-hidden="true">
        <span class="clip-label" data-i18n="sim.clipboard">${t("sim.clipboard")}</span>
        <span class="clip-val">${t("sim.clipboardInitial")}</span>
      </div>
    </div>

    <div class="deck">
      <button class="keycap" type="button" aria-describedby="sim-hint" aria-label="${esc(t("sim.keyLabel"))}" data-i18n-attr="aria-label:sim.keyLabel">
        <canvas class="keycap-canvas" aria-hidden="true"></canvas>
        <span class="keycap-fallback" aria-hidden="true"><span class="kf-ico">${globe}</span><span>fn</span></span>
      </button>
      <div class="deck-side">
        <p id="sim-hint" class="hint" data-i18n="sim.hint">${t("sim.hint")}</p>
        <div class="src" role="radiogroup" aria-label="${esc(t("sim.sourceLabel"))}" data-i18n-attr="aria-label:sim.sourceLabel">
          <button type="button" role="radio" aria-checked="true" data-src="take" data-i18n="sim.sourceTake">${t("sim.sourceTake")}</button>
          <button type="button" role="radio" aria-checked="false" data-src="mic" data-i18n="sim.sourceMic">${t("sim.sourceMic")}</button>
        </div>
        <p class="src-note" data-i18n="sim.micNote" hidden>${t("sim.micNote")}</p>
      </div>
    </div>

    <ol class="timeline" aria-live="polite" data-empty="true">
      <li class="tl-empty" data-i18n="sim.tl.empty">${t("sim.tl.empty")}</li>
    </ol>
    <p class="sr-only" aria-live="assertive" id="sim-live"></p>
  </div>
</section>

<section class="how band" id="how" aria-labelledby="how-title">
  <h2 id="how-title" class="h2" data-i18n="how.title">${t("how.title")}</h2>
  <ol class="steps">
    ${[1, 2, 3, 4]
      .map(
        (n) => `<li class="step">
      <span class="step-n mono">${n}</span>
      ${T("h3", `how.s${n}t`)}
      ${T("p", `how.s${n}b`)}
    </li>`
      )
      .join("")}
  </ol>
</section>

<section class="tour band" id="tour" aria-labelledby="tour-title">
  <div class="sec-head">
    ${T("h2", "tour.title", 'id="tour-title" class="h2"')}
    ${T("p", "tour.sub", 'class="sec-sub"')}
  </div>
  <div class="tour-wrap">
    <div class="tour-tabs" role="tablist" aria-label="${esc(t("tour.tabsLabel"))}" data-i18n-attr="aria-label:tour.tabsLabel">
      ${shots
        .map(
          (k, i) => `<button type="button" role="tab" class="tour-tab" id="tab-${k}" data-shot="${k}" aria-selected="${i === 0}" aria-controls="tour-panel" tabindex="${i === 0 ? 0 : -1}">
        <span class="tt-name" data-i18n="tour.t_${k}">${t(`tour.t_${k}`)}</span>
        <span class="tt-cap"><span data-i18n="tour.c_${k}">${t(`tour.c_${k}`)}</span></span>
      </button>`
        )
        .join("")}
    </div>
    <div class="tour-stage" id="tour-panel" role="tabpanel" aria-labelledby="tab-flow">
      <div class="tour-frame">
        ${shots
          .map(
            (k, i) => `<img class="shot${i === 0 ? " is-on" : ""}" data-key="${k}" src="${mode === "single" ? PIXEL : shotSrc(locale, k)}" data-src-en="${mode === "single" ? "" : shotSrc("en", k)}" data-src-es="${mode === "single" ? "" : shotSrc("es", k)}" alt="${esc(t(`tour.c_${k}`))}" data-i18n-attr="alt:tour.c_${k}" width="1152" height="742" loading="${i === 0 ? "eager" : "lazy"}" decoding="async">`
          )
          .join("")}
      </div>
      <p class="tour-cap" aria-hidden="true">${t("tour.c_flow")}</p>
    </div>
  </div>
  ${T("p", "tour.note", 'class="fine tour-note"')}
</section>

<section class="details band" id="details" aria-labelledby="details-title">
  <div class="sec-head">
    ${T("h2", "bento.title", 'id="details-title" class="h2"')}
    ${T("p", "bento.sub", 'class="sec-sub"')}
  </div>

  <div class="bento">
    <article class="cell cell-mute" id="mute">
      <div class="cell-text">
        ${T("h3", "bento.mute.title")}
        ${T("p", "bento.mute.body")}
      </div>
      <div class="player" data-state="playing">
        <div class="player-art" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
        <div class="player-meta">
          ${T("span", "bento.mute.track", 'class="player-track"')}
          <span class="player-vol-label"><span data-i18n="bento.mute.volume">${t("bento.mute.volume")}</span> <span class="mono player-vol-num">64%</span></span>
          <span class="player-vol"><span class="player-vol-fill"></span></span>
          <span class="player-status" aria-live="polite"></span>
        </div>
      </div>
      <dl class="ca mono" aria-label="CoreAudio">
        <div><dt>kAudioDevicePropertyMute</dt><dd class="ca-mute">0</dd></div>
        <div><dt>VirtualMainVolume</dt><dd class="ca-vol">0.64</dd></div>
        <div><dt>savedVolume</dt><dd class="ca-saved">nil</dd></div>
      </dl>
      <button class="btn btn-sm btn-ghost hold-btn" type="button" data-i18n="bento.mute.hold">${t("bento.mute.hold")}</button>
    </article>

    <article class="cell cell-guard" id="guard">
      <div class="cell-text">
        ${T("h3", "bento.guard.title")}
        ${T("p", "bento.guard.body")}
      </div>
      <div class="seg" role="radiogroup" aria-label="Refine">
        <button type="button" role="radio" aria-checked="true" data-scn="fast" data-i18n="bento.guard.fast">${t("bento.guard.fast")}</button>
        <button type="button" role="radio" aria-checked="false" data-scn="slow" data-i18n="bento.guard.slow">${t("bento.guard.slow")}</button>
        <button type="button" role="radio" aria-checked="false" data-scn="chatty" data-i18n="bento.guard.chatty">${t("bento.guard.chatty")}</button>
      </div>
      <div class="race" aria-hidden="true">
        <span class="race-track"><span class="race-bar"></span></span>
        <span class="race-deadline"><span class="mono" data-i18n="bento.guard.deadline">${t("bento.guard.deadline")}</span></span>
        <span class="race-time mono">0.00 s</span>
      </div>
      <dl class="guard-io">
        <div><dt data-i18n="bento.guard.heard">${t("bento.guard.heard")}</dt><dd class="mono" data-i18n="bento.guard.raw">${t("bento.guard.raw")}</dd></div>
        <div><dt data-i18n="bento.guard.pasted">${t("bento.guard.pasted")}</dt><dd class="mono guard-out">${t("bento.guard.refined")}</dd></div>
      </dl>
      <p class="guard-res" aria-live="polite">${t("bento.guard.resFast")}</p>
      ${T("p", "bento.guard.note", 'class="fine"')}
    </article>

    <article class="cell cell-catalog" id="catalog">
      <div class="cell-text">
        ${T("h3", "bento.catalog.title")}
        ${T("p", "bento.catalog.body")}
      </div>
      <ul class="models" role="radiogroup" aria-label="${esc(t("bento.catalog.title"))}" data-i18n-attr="aria-label:bento.catalog.title">
        ${models
          .map(
            (m, i) => `<li><button type="button" role="radio" class="model" aria-checked="${i === 0}" data-model="${m.name}">
          <span class="model-name">${m.name}</span>
          <span class="model-size mono">${m.size}</span>
          <span class="model-desc" data-i18n="${m.d}">${t(m.d)}</span>
          <span class="model-state" data-i18n="bento.catalog.active">${t("bento.catalog.active")}</span>
        </button></li>`
          )
          .join("")}
      </ul>
    </article>

    <article class="cell cell-vocab" id="vocab">
      <div class="cell-text">
        ${T("h3", "bento.vocab.title")}
        ${T("p", "bento.vocab.body")}
      </div>
      <div class="seg" role="radiogroup" aria-label="${esc(t("bento.vocab.title"))}" data-i18n-attr="aria-label:bento.vocab.title">
        <button type="button" role="radio" aria-checked="true" data-voc="1" data-i18n="bento.vocab.s1">${t("bento.vocab.s1")}</button>
        <button type="button" role="radio" aria-checked="false" data-voc="2" data-i18n="bento.vocab.s2">${t("bento.vocab.s2")}</button>
        <button type="button" role="radio" aria-checked="false" data-voc="3" data-i18n="bento.vocab.s3">${t("bento.vocab.s3")}</button>
      </div>
      <dl class="guard-io vocab-io">
        <div><dt data-i18n="bento.vocab.heard">${t("bento.vocab.heard")}</dt><dd class="mono vocab-heard">${t("bento.vocab.h1")}</dd></div>
        <div><dt data-i18n="bento.vocab.fixed">${t("bento.vocab.fixed")}</dt><dd class="mono vocab-fixed">${t("bento.vocab.f1")}</dd></div>
        <div><dt data-i18n="bento.vocab.rule">${t("bento.vocab.rule")}</dt><dd class="mono vocab-rule">${t("bento.vocab.r1")}</dd></div>
      </dl>
      ${T("p", "bento.vocab.note", 'class="fine"')}
    </article>

    <article class="cell cell-stats" id="stats">
      <div class="cell-text">
        ${T("h3", "bento.stats.title")}
        ${T("p", "bento.stats.body")}
      </div>
      <div class="kpis">
        <div class="kpi"><span class="kpi-l" data-i18n="bento.stats.pace">${t("bento.stats.pace")}</span><span class="kpi-v mono"><span data-count>132</span> <small data-i18n="bento.stats.paceUnit">${t("bento.stats.paceUnit")}</small></span></div>
        <div class="kpi"><span class="kpi-l" data-i18n="bento.stats.streak">${t("bento.stats.streak")}</span><span class="kpi-v mono"><span data-count>10</span> <small data-i18n="bento.stats.streakUnit">${t("bento.stats.streakUnit")}</small></span></div>
        <div class="kpi"><span class="kpi-l" data-i18n="bento.stats.peak">${t("bento.stats.peak")}</span><span class="kpi-v mono">10:00</span></div>
      </div>
      <figure class="chart">
        <figcaption><span data-i18n="bento.stats.chartTitle">${t("bento.stats.chartTitle")}</span><span class="sample" data-i18n="bento.stats.sample">${t("bento.stats.sample")}</span></figcaption>
        <div class="chart-plot" data-chart>${chartSVG(locale, t("bento.stats.chartTitle"), t("bento.stats.words"))}<div class="viz-tip" data-show="false" role="status"></div></div>
        <details class="chart-table"><summary data-i18n="bento.stats.table">${t("bento.stats.table")}</summary><div class="chart-table-body">${chartTable(locale, t("bento.stats.day"), t("bento.stats.words"))}</div></details>
      </figure>
    </article>
  </div>
</section>

<section class="faq band" id="faq" aria-labelledby="faq-title">
  <div class="sec-head">${T("h2", "faq.title", 'id="faq-title" class="h2"')}</div>
  <div class="faq-list">
    ${[1, 2, 3, 4]
      .map(
        (n) => `<details class="qa"${n === 1 ? " open" : ""}>
      <summary>${T("span", `faq.q${n}`)}<span class="qa-x" aria-hidden="true"></span></summary>
      ${T("p", `faq.a${n}`)}
    </details>`
      )
      .join("")}
  </div>
  ${T("p", "faq.req", 'class="req"')}
</section>

<section class="pro-suite band" id="pro-suite" aria-labelledby="pro-suite-title">
  <div class="sec-head">
    ${T("h2", "pro.title", 'id="pro-suite-title" class="h2"')}
    ${T("p", "pro.sub", 'class="sec-sub"')}
  </div>
  <div class="ps-grid">
    <article class="ps-card">
      ${T("span", "pro.p1Tag", 'class="ps-eyebrow mono"')}
      ${T("h3", "pro.p1Title")}
      ${T("p", "pro.p1Body")}
      <ul class="ps-list">${[1, 2, 3].map((n) => `<li>${check}${T("span", `pro.p1_${n}`)}</li>`).join("")}</ul>
    </article>
    <article class="ps-card is-hot">
      ${T("span", "pro.p2Tag", 'class="ps-eyebrow mono"')}
      ${T("h3", "pro.p2Title")}
      ${T("p", "pro.p2Body")}
      <ul class="ps-list">${[1, 2, 3].map((n) => `<li>${check}${T("span", `pro.p2_${n}`)}</li>`).join("")}</ul>
    </article>
  </div>
  <div class="ps-cta">
    <p class="ps-price"><span class="price-n mono">$49</span> ${T("span", "pro.once", 'class="price-u"')}</p>
    <a class="btn btn-light" href="#pricing" data-i18n="pro.cta">${t("pro.cta")}</a>
  </div>
</section>

<section class="compare band" id="compare" aria-labelledby="compare-title">
  <div class="sec-head">
    ${T("h2", "compare.title", 'id="compare-title" class="h2"')}
    ${T("p", "compare.sub", 'class="sec-sub"')}
  </div>
  <div class="table-wrap">
    <table class="cmp">
      <thead><tr><td></td>${T("th", "compare.c1", 'scope="col"')}${T("th", "compare.c2", 'scope="col"')}${T("th", "compare.c3", 'scope="col" class="is-us"')}</tr></thead>
      <tbody>
        ${(
          [
            ["Price", true],
            ["Three", true],
            ["Privacy", false],
            ["Dictionary", false],
            ["Translate", false],
            ["Clipboard", false],
            ["Trial", false],
          ] as const
        )
          .map(
            ([r, num]) => {
              const cnt = r === "Three" ? " data-count" : "";
              return `<tr>${T("th", `compare.r${r}`, 'scope="row"')}${T("td", `compare.v1${r}`, (num ? 'class="mono"' : "") + cnt)}${T("td", `compare.v2${r}`, (num ? 'class="mono"' : "") + cnt)}${T("td", `compare.v3${r}`, `class="is-us${num ? " mono" : ""}"${cnt}`)}</tr>`;
            }
          )
          .join("")}
      </tbody>
    </table>
  </div>
  ${T("p", "compare.foot", 'class="fine"')}
</section>

<section class="pricing band" id="pricing" aria-labelledby="pricing-title">
  <div class="sec-head">
    ${T("h2", "pricing.title", 'id="pricing-title" class="h2"')}
    ${T("p", "pricing.sub", 'class="sec-sub"')}
  </div>
  <div class="plans">
    ${(
      [
        ["personal", "macs1", ["pf1", "pf2", "pf3", "pf4"], "buyPersonal"],
        ["pro", "macs3", ["rf1", "rf2", "rf3", "rf4"], "buyPro"],
        ["team", "macs5", ["tf1", "tf2", "tf3"], "buyTeam"],
      ] as const
    )
      .map(([id, macs, feats, buy]) => {
        const p = plan(id);
        return `<article class="plan${p.popular ? " is-popular" : ""}" id="plan-${id}">
      <header class="plan-head">
        ${T("h3", `pricing.${id}`)}
        ${p.popular ? T("span", "pricing.popular", 'class="badge badge-light"') : ""}
      </header>
      <p class="price"><span class="price-n mono">$${p.price}</span> <span class="price-u" data-i18n="pricing.once">${t("pricing.once")}</span></p>
      ${T("p", `pricing.${macs}`, 'class="plan-macs"')}
      <ul class="feats">${feats.map((f) => `<li>${check}${T("span", `pricing.${f}`)}</li>`).join("")}</ul>
      <a class="btn ${p.popular ? "btn-light" : "btn-ghost"} btn-block" href="${funnel.stripe[id]}" data-plan="${id}" data-i18n="pricing.${buy}">${t(`pricing.${buy}`)}</a>
    </article>`;
      })
      .join("")}
  </div>
  <aside class="day15">
    ${T("h3", "pricing.day15t")}
    ${T("p", "pricing.day15b")}
  </aside>
</section>

<section class="final band" aria-labelledby="final-title">
  ${T("h2", "final.title", 'id="final-title" class="display display-sm"')}
  ${T("p", "final.body", 'class="lede"')}
  <button class="btn btn-light" type="button" data-open-download data-i18n="final.cta">${t("final.cta")}</button>
</section>

</main>

<footer class="foot">
  <div class="foot-inner">
    <div class="foot-brand">${mark}${T("p", "footer.about")}</div>
    <dl class="foot-trust mono">
      <div><dt data-i18n="footer.teamId">${t("footer.teamId")}</dt><dd>${funnel.trust.appleTeamId}</dd></div>
      <div><dt data-i18n="footer.sha">${t("footer.sha")}</dt><dd class="sha">${sha ? sha : `<span data-i18n="footer.shaPending">${t("footer.shaPending")}</span>`}</dd></div>
    </dl>
    <nav class="foot-links" aria-label="Legal">
      <a href="${funnel.links.privacy}" data-i18n="footer.privacy">${t("footer.privacy")}</a>
      <a href="${funnel.links.terms}" data-i18n="footer.terms">${t("footer.terms")}</a>
      <a href="${funnel.links.contact}" data-i18n="footer.contact">${t("footer.contact")}</a>
      <a href="${href(locale === "en" ? "es" : "en")}" data-lang="${locale === "en" ? "es" : "en"}" class="foot-lang">${locale === "en" ? "Español" : "English"}</a>
    </nav>
  </div>
</footer>

<dialog class="modal" id="download" aria-labelledby="dl-title">
  <form class="modal-card" method="dialog" novalidate>
    <button class="modal-x" type="button" data-close aria-label="${esc(t("modal.close"))}" data-i18n-attr="aria-label:modal.close"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
    <div class="modal-step" data-step="form">
      ${T("h2", "modal.title", 'id="dl-title" class="h3"')}
      ${T("p", "modal.body")}
      <label class="field">
        <span data-i18n="modal.emailLabel">${t("modal.emailLabel")}</span>
        <input type="email" name="email" autocomplete="email" inputmode="email" required placeholder="${esc(t("modal.emailPh"))}" data-i18n-attr="placeholder:modal.emailPh" aria-describedby="dl-err">
      </label>
      <p class="field-err" id="dl-err" role="alert"></p>
      <button class="btn btn-light btn-block" type="submit" data-i18n="modal.submit">${t("modal.submit")}</button>
      ${T("p", "modal.privacy", 'class="fine center"')}
    </div>
    <div class="modal-step" data-step="done" hidden>
      ${T("h2", "modal.okTitle", 'class="h3"')}
      <p class="modal-msg">${t("modal.okBody")}</p>
      <div class="verify">
        ${T("h3", "modal.verify")}
        <dl class="mono">
          <div><dt>Team ID</dt><dd>${funnel.trust.appleTeamId}</dd></div>
          <div><dt>SHA-256</dt><dd class="sha">${sha ? sha : `<span data-i18n="footer.shaPending">${t("footer.shaPending")}</span>`}</dd></div>
        </dl>
        <pre class="cmd mono"><code>shasum -a 256 ~/Downloads/${funnel.download.fileName}
spctl -a -vv -t install ~/Downloads/${funnel.download.fileName}</code></pre>
      </div>
      <button class="btn btn-ghost btn-block" type="button" data-close data-i18n="modal.close">${t("modal.close")}</button>
    </div>
  </form>
</dialog>

${scriptTag}
</body>
</html>
`;
}
