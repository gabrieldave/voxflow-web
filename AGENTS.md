# AGENTS.md — VoxFlow Studio Web (`voxflow-web`)

> Reglas permanentes para este repositorio. Aplican junto a la constitución global
> `~/.config/opencode/AGENTS.md`. Respuesta final: **máximo 5 líneas**.

---

## 1. Cero secretos expuestos

- Localizar `secrets.env` dinámicamente desde `$HOME` (`Documents/VibeSystems`, `.config/vibesystems`,
  `VibeSystems`, `Documents`, `Downloads`) con parser **línea por línea**; nunca `source` global.
- Nunca imprimir `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET`, `VOXFLOW_ED25519_PRIVATE_KEY`, `DATABASE_URL`,
  `STRIPE_SECRET_KEY` ni `COOLIFY_API_TOKEN` en consola, logs o commits.
- Este repo es **privado**: verificar `git diff` antes de commitear y no versionar `.env*` ni llaves.

---

## 2. Arquitectura y reglas de código

- **Node server propio** (`server/server.mjs` + `server/admin.mjs`) sirviendo el build de **Vite** (`dist/`).
  No hay Next.js: las reglas de “middleware” se implementan en el servidor HTTP.
- **Idioma por país**: `SPANISH_COUNTRIES` (MX, ES, AR, CO, CL, PE, EC, VE, UY, PY, BO, CR, PA, DO, GT, HN, SV, NI, CU, PR, GQ)
  → `302` a `/es/`; `US` y resto → `/` en inglés. Cookie manual `voxflow-lang` (`en|es`) manda siempre.
  Redirecciones con `Cache-Control: private, no-store` + `Vary: CF-IPCountry, Cookie` (nunca `301`).
- **Producción sin sourcemaps**: `sourcemap: false` en `vite.config.ts` y `vite.preview.config.ts`;
  sin cabecera `X-Powered-By`.
- **Manifiestos sin caché**: `latest.json` y el `.dmg` se sirven con `Cache-Control: no-store`.

---

## 3. Pagos y precios

- Precios base **siempre en USD** (`Personal $29`, `Pro $49`, `Team $69`) y checkout delegado a
  `POST https://n8n.vibesystems.tech/webhook/payment` (respaldo Stripe directo si el gateway no responde).
- Nunca duplicar `currency_options[usd]` ni añadir pasarelas paralelas.
- Emisión de licencias `VFS1` firmadas con **Ed25519** en el servidor; la privada vive solo en Coolify.

---

## 4. Google OAuth y `/admin`

- Cliente **Promptvalue** del ecosistema:
  `GOOGLE_CLIENT_ID=1091222021847-ph8k6rbvkpkk9gf1j41v6hiiqje6vnlc.apps.googleusercontent.com`
  (secret solo en Coolify / `secrets.env`).
- Callback exacto: `https://voxflow.iareal.net/api/auth/callback/google`.
- `ADMIN_ALLOWED_EMAILS=david.del.rio.colin@gmail.com` (admite lista separada por comas).
- Gating **100 % en servidor** y fail-closed: `/admin`, `/api/admin/*` y `/api/auth/*`.
  Sin sesión Google válida ⇒ pantalla de login o `403`. Nunca roles/correos en `NEXT_PUBLIC_*`.
- Acciones del panel siempre por `POST` con validación de `Origin` (CSRF) y cookie `HttpOnly; Secure; SameSite=Lax`.

---

## 5. Build, GitHub y Coolify (obligatorio al cerrar)

1. `npm run build` → **0 errores** (`typecheck + prerender + vite build`) y `npm audit --omit=dev --audit-level=high` sin high/critical.
2. `git add -A && git commit -m "<tipo>: <resumen>" && git push origin main` al repo privado `gabrieldave/voxflow-web`.
3. Desplegar en **Coolify** (`POST /api/v1/deploy?uuid=ltmwpxfb8yaj8q0shlw5qiut&force=true` con
   `COOLIFY_API_TOKEN`, ejecutado desde el VPS si Cloudflare bloquea la API) y **esperar** a
   `status: finished` + contenedor `running/healthy`.
4. Verificar en vivo `GET https://voxflow.iareal.net/api/health` ⇒ `200 OK` con la versión publicada.
5. Sin build limpio, push y health check, la tarea no está terminada.

---

## 6. Verificación típica

```bash
npm run build
curl -fsS https://voxflow.iareal.net/api/health
curl -fsS https://voxflow.iareal.net/api/updates/latest
curl -sI -H "CF-IPCountry: MX" https://voxflow.iareal.net/   # 302 → /es/
```
