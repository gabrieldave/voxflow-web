# VoxFlow Studio · Sales site (Página 1 · Arquetipo 01 Cupertino Hardware Noir) · v2

Static, prerendered, bilingual (EN `/` · ES `/es/`) landing for VoxFlow Studio by BLACK EYE.
Vite + TypeScript + Three.js. No framework runtime, no Inter/Roboto/Arial, no neon glows.

## Quick start

```bash
npm ci
npm run dev            # http://localhost:5173  (and /es/)
npm run build          # typecheck + prerender + vite build → dist/
npm run build:preview  # one self-contained file → dist-preview/VoxFlow-Preview.html
```

## The only file marketing edits: `src/config/funnel.ts`

| Key | What to set |
|---|---|
| `siteUrl` | Pass `SITE_URL=https://your-domain.com` at build time (canonical, hreflang, sitemap, OG) |
| `stripe.personal / pro / team` | Stripe Payment Links ($29 / $49 / $69) |
| `n8n.trialWebhookUrl` | n8n webhook. Receives `POST {email, locale, plan:"trial", trialDays, source, page, referrer, ts}` |
| `download.dmgUrl` / `fileName` | URL of the notarized `.dmg` |
| `download.sha256` | `shasum -a 256 VoxFlowStudio-2.0.0.dmg` (left empty until the first notarized build) |
| `links.*` | Privacy, Terms, Contact |
| `copy.en` / `copy.es` | Every string on the page, SEO title/description, OG |

While any URL still contains `REPLACE` or `example.com`, the download modal runs in **demo mode**
(no request, no download) and says so.

## Deploy on Coolify

1. New resource → Dockerfile → point at this repo.
2. Build arg `SITE_URL=https://your-domain.com`.
3. Port 80. Healthcheck is built into the image.
4. Put the `.dmg` at `/usr/share/nginx/html/downloads/` (volume) or host it on R2/S3 and set `dmgUrl`.

## What is real vs. simulated in the hero

- Real constants from the Swift code: 55 ms tail, 120 ms / 1,920-sample floor, 0.004 peak floor,
  ⌘V keyUp after 18 ms, clipboard restored at 450 ms, HUD colours and labels, 650 ms error HUD.
- Transcription happens on the visitor's Mac in the app, not in the browser: pasted sentences are scripted,
  and no latency number is shown.
- Demo voice: `src/assets/take-*.mp3` are synthetic placeholders (espeak). Replace them with real recordings
  of the founder (same file names, mono, ~3 s each). They are analysed silently to drive the waveform.
- Mic mode only reads levels with Web Audio. Nothing is recorded or sent.
- Stats chart uses example data and is labelled as such.

## App screenshots (tour section)

- Sources: `src/assets/screens/{en,es}-{flow,catalog,vocab,cv,studio,stats,license}.webp` (14 files,
  cropped to the window, rounded corners with alpha). The license email and ID are blurred.
- `npm run prerender` copies them to `public/screens/` for the site build; the single-file preview inlines
  them through `src/screens-inline.ts`. The page language picks the EN or ES set.
- To replace one, keep the same name and size (1152×742).

## Art direction layers (v2)

`src/styles/art.css`: titanium gradient type, kinetic hero entrance, studio light + grid, ~2 % grain,
cursor spotlight on bento and plans (`@property --mx/--my`, non-inherited), glass HUD over an SVG wallpaper,
polished aluminium CTA with sheen, scroll reveal. `src/ui/motion.ts`: reveal, count-up, spotlight.
All of it is disabled or simplified under `prefers-reduced-motion` / `prefers-reduced-transparency`.

## Regenerate OG images (optional)

```bash
npm run build && npx vite preview --port 4173 &
node scripts/og-images.cjs   # needs Playwright + Chromium
```

## Structure

```
src/config/funnel.ts   commercial engine + EN/ES copy
src/render.ts          build-time HTML renderer (SEO, hreflang, JSON-LD)
src/main.ts            client boot
src/sim/               simulator, Web Audio meter, Three.js keycap
src/ui/                i18n switch, bento demos, chart, modal
scripts/prerender.ts   writes index.html, es/index.html, preview.html, sitemap, robots
Dockerfile, nginx.conf Coolify runtime
```
