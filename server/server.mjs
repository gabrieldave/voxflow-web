import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createAdmin } from "./admin.mjs";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const STORAGE = process.env.STORAGE_LOCAL_DIR || "/app/storage";
const RELEASES = path.join(STORAGE, "releases");
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://voxflow.iareal.net").replace(/\/$/, "");
const N8N_URL = (process.env.N8N_PAYMENT_URL || "https://n8n.vibesystems.tech/webhook/payment").replace(/\/$/, "");
const N8N_EMAIL_URL = (process.env.N8N_EMAIL_URL || "https://n8n.vibesystems.tech/webhook/email/send").replace(/\/$/, "");
const EMAIL_FROM = process.env.EMAIL_FROM || "VoxFlow Studio <soporte@voxflow.iareal.net>";
const DB_URL = process.env.DATABASE_URL || process.env.APP_VOXFLOW_DATABASE_URL || "";
const VERSION = "2.3.4";

const PLANS = {
  personal: { tier: "Personal", price: 2900, maxDevices: 1 },
  pro: { tier: "Pro", price: 4900, maxDevices: 3 },
  team: { tier: "Team", price: 6900, maxDevices: 5 },
};

const pool = DB_URL ? new pg.Pool({ connectionString: DB_URL }) : null;

async function migrate() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL, tier TEXT NOT NULL, max_devices INT NOT NULL,
    amount_cents INT NOT NULL, currency TEXT DEFAULT 'usd', status TEXT DEFAULT 'pending',
    stripe_session_id TEXT UNIQUE, stripe_payment_intent TEXT, license_id TEXT, license_token TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(), paid_at TIMESTAMPTZ)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS license_activations (
    id BIGSERIAL PRIMARY KEY, license_id TEXT NOT NULL, email TEXT NOT NULL, tier TEXT NOT NULL,
    max_devices INT NOT NULL, hardware_hash TEXT NOT NULL, device_name TEXT, app_version TEXT,
    activated_at TIMESTAMPTZ DEFAULT NOW(), last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (license_id, hardware_hash))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS trial_leads (
    id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL, locale TEXT, country TEXT, version_downloaded TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW())`);
  // Ancla de trial por hardware: el reloj válido es SIEMPRE el del servidor (NOW()).
  await pool.query(`CREATE TABLE IF NOT EXISTS hardware_trials (
    hardware_hash TEXT PRIMARY KEY,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    app_version TEXT)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS orders_email_idx ON orders (lower(email))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS activations_license_idx ON license_activations (license_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS trial_leads_email_idx ON trial_leads (lower(email))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS hardware_trials_last_seen_idx ON hardware_trials (last_seen_at DESC)`);
}

// --- Ed25519 con crypto nativo (DER PKCS8 para seed raw) ---
function signEd25519(payloadB64URL, privSeedB64) {
  const seed = Buffer.from(privSeedB64, "base64");
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const key = crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const sig = crypto.sign(null, Buffer.from(payloadB64URL), key);
  return sig.toString("base64url");
}
function b64url(buf) { return Buffer.from(buf).toString("base64url"); }
function jsonPayload(obj) { return b64url(Buffer.from(JSON.stringify(obj, Object.keys(obj).sort()))); }

function verifyToken(token, pubSeedB64) {
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3 || parts[0] !== "VFS1") return null;
    const [, payloadB64, sigB64] = parts;
    const der = Buffer.concat([Buffer.from("30??".replace("?", "2a") + "020100300506032b6570034200", "hex"), Buffer.from(pubSeedB64, "base64")]);
    // Clave pública SPKI Ed25519: prefijo DER fijo + 32 bytes
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pubSeedB64, "base64")]);
    const key = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
    const ok = crypto.verify(null, Buffer.from(payloadB64), key, Buffer.from(sigB64, "base64url"));
    if (!ok) return null;
    return JSON.parse(Buffer.from(payloadB64, "base64url").toString());
  } catch { return null; }
}

function signLicense(email, tier, maxDevices) {
  const priv = process.env.VOXFLOW_ED25519_PRIVATE_KEY;
  if (!priv) throw new Error("missing VOXFLOW_ED25519_PRIVATE_KEY");
  const payload = {
    licenseId: "BE-" + crypto.randomBytes(4).toString("hex").toUpperCase(),
    email, tier, maxDevices, issuedAt: new Date().toISOString(),
    product: "com.blackeye.voxflowstudio",
  };
  const payloadB64 = jsonPayload(payload);
  const sig = signEd25519(payloadB64, priv);
  return { token: `VFS1.${payloadB64}.${sig}`, payload };
}

function signReceipt(payload) {
  const priv = process.env.VOXFLOW_ED25519_PRIVATE_KEY;
  if (!priv) throw new Error("missing key");
  const payloadB64 = jsonPayload(payload);
  const sig = signEd25519(payloadB64, priv);
  return `VFS1R.${payloadB64}.${sig}`;
}

/** Sello genérico Ed25519: `<prefix>.<payloadB64url>.<sigB64url>` */
function signSeal(prefix, payload) {
  const priv = process.env.VOXFLOW_ED25519_PRIVATE_KEY;
  if (!priv) throw new Error("missing signing key");
  const payloadB64 = jsonPayload(payload);
  return `${prefix}.${payloadB64}.${signEd25519(payloadB64, priv)}`;
}

// rate-limit mínimo por IP
const hits = new Map();
function rateLimited(ip, max = 60, windowMs = 60000) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(ip, arr);
  return arr.length > max;
}
function clientIp(req) { return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").toString().split(",")[0].trim(); }

/* ---------- Geolocalización de idioma (CF-IPCountry → /es) ---------- */
const SPANISH_COUNTRIES = new Set([
  "MX", "ES", "AR", "CO", "CL", "PE", "EC", "VE", "UY", "PY", "BO",
  "CR", "PA", "DO", "GT", "HN", "SV", "NI", "CU", "PR", "GQ",
]);

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function manualLang(req) {
  const v = cookies(req)["voxflow-lang"];
  return v === "en" || v === "es" ? v : "";
}

function countryFrom(req) {
  const raw = req.headers["cf-ipcountry"] || req.headers["x-vercel-ip-country"] || req.headers["x-country"] || "";
  const c = String(raw).trim().toUpperCase();
  return !c || c === "XX" || c === "T1" ? "" : c;
}

function acceptsSpanish(req) {
  return /(^|,)\s*es\b/i.test(String(req.headers["accept-language"] || ""));
}

function redirectLocalized(res, location) {
  res.writeHead(302, {
    location,
    "cache-control": "private, no-cache, no-store, must-revalidate",
    vary: "CF-IPCountry, Cookie",
    "cdn-cache-control": "no-store",
  });
  res.end();
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => resolve(d));
  });
}
function securityHeaders(res) {
  res.removeHeader("X-Powered-By");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
}

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".txt": "text/plain", ".xml": "application/xml", ".webmanifest": "application/manifest+json" };

function serveStatic(req, res, pathname) {
  // /es -> /es/index.html
  let p = decodeURIComponent(pathname);
  if (p === "/es") p = "/es/";
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(DIST, p);
  if (!file.startsWith(DIST)) return false;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
  if (req.method === "HEAD") {
    res.setHeader("content-length", String(fs.statSync(file).size));
    res.end();
    return true;
  }
  fs.createReadStream(file).pipe(res);
  return true;
}

const admin = createAdmin({
  pool,
  appUrl: APP_URL,
  n8nEmailUrl: N8N_EMAIL_URL,
  emailFrom: EMAIL_FROM,
  version: VERSION,
  signLicense,
  sendJson,
  readBody,
});

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const ip = clientIp(req);
  try {
    if (admin.isAdminPath(p)) {
      const handled = await admin.handle(req, res, url, p);
      if (handled !== false) return;
    }
    if (p === "/api/health") return sendJson(res, 200, { ok: true, version: VERSION });
    if (p === "/api/updates/latest" && (req.method === "GET" || req.method === "HEAD")) {
      const manifestPath = path.join(RELEASES, "latest.json");
      if (fs.existsSync(manifestPath)) {
        // El manifiesto cambia con cada release: nunca servir una copia cacheada.
        res.setHeader("cache-control", "no-store, max-age=0");
        res.setHeader("cdn-cache-control", "no-store");
        return sendJson(res, 200, JSON.parse(fs.readFileSync(manifestPath, "utf8")));
      }
      return sendJson(res, 404, { error: "no release" });
    }
    if (p === "/api/download/latest" && (req.method === "GET" || req.method === "HEAD")) {
      const candidates = [
        path.join(RELEASES, "VoxFlowStudio-2.3.4.dmg"),
        path.join(RELEASES, "VoxFlowStudio-2.3.2.dmg"),
        path.join(RELEASES, "VoxFlowStudio-Installer.dmg"),
      ];
      const f = candidates.find((c) => fs.existsSync(c)) || null;
      if (!f) return sendJson(res, 404, { error: "dmg not published" });
      const fileName = path.basename(f);
      res.setHeader("content-type", "application/x-apple-diskimage");
      res.setHeader("content-disposition", `attachment; filename="${fileName}"`);
      res.setHeader("cache-control", "no-store, max-age=0");
      res.setHeader("cdn-cache-control", "no-store");
      if (req.method === "HEAD") { res.setHeader("content-length", String(fs.statSync(f).size)); return res.end(); }
      return fs.createReadStream(f).pipe(res);
    }
    if (p === "/api/checkout" && (req.method === "GET" || req.method === "POST")) {
      if (rateLimited(ip, 30)) return sendJson(res, 429, { error: "too many requests" });
      const bodyText = req.method === "POST" ? await readBody(req) : "";
      const body = bodyText ? JSON.parse(bodyText) : {};
      const tier = (url.searchParams.get("tier") || body.tier || "").toLowerCase();
      const locale = (url.searchParams.get("lang") || url.searchParams.get("locale") || body.locale || "es").toLowerCase();
      const email = body.email || "";
      const plan = PLANS[tier];
      if (!plan) return sendJson(res, 400, { error: "invalid tier" });
      // Registrar pedido pendiente
      if (pool) {
        try { await pool.query("INSERT INTO orders(email,tier,max_devices,amount_cents,currency,status) VALUES($1,$2,$3,$4,'usd','pending')", [email || "checkout", plan.tier, plan.maxDevices, plan.price]); } catch {}
      }
      const serviceId = tier;
      const payload = {
        appId: "voxflow", event: "payment.create_checkout_session",
        data: {
          amount: plan.price / 100, currency: "usd",
          serviceTitle: `VoxFlow Studio ${plan.tier}`, serviceId,
          customerEmail: email || undefined,
          successUrl: `${APP_URL}/pago/success?session_id={CHECKOUT_SESSION_ID}&lang=${locale}`,
          cancelUrl: `${APP_URL}/#pricing`,
          metadata: { appId: "voxflow", tier, lang: locale },
        },
      };
      let stripeUrl = null;
      try {
        const gw = await fetch(N8N_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        const gwData = await gw.json().catch(() => ({}));
        stripeUrl = gwData?.data?.url || gwData?.url || gwData?.checkoutUrl || gwData?.checkout_url || null;
      } catch {}
      // Respaldo directo Stripe si el gateway n8n aún no tiene appId voxflow
      if (!stripeUrl && process.env.STRIPE_SECRET_KEY) {
        const form = new URLSearchParams();
        form.set("mode", "payment");
        form.set("success_url", `${APP_URL}/pago/success?session_id={CHECKOUT_SESSION_ID}&lang=${locale}`);
        form.set("cancel_url", `${APP_URL}/#pricing`);
        if (email) form.set("customer_email", email);
        form.set("line_items[0][quantity]", "1");
        form.set("line_items[0][price_data][currency]", "usd");
        form.set("line_items[0][price_data][unit_amount]", String(plan.price));
        form.set("line_items[0][price_data][product_data][name]", `VoxFlow Studio ${plan.tier}`);
        form.set("metadata[appId]", "voxflow"); form.set("metadata[tier]", tier); form.set("metadata[lang]", locale);
        const r = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" }, body: form.toString() });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j.url) stripeUrl = j.url;
      }
      if (!stripeUrl) return sendJson(res, 503, { error: "payment gateway unavailable", detail: "registra appId voxflow en Payment Gateway - Universal (n8n) o define STRIPE_SECRET_KEY" });
      if (req.method === "GET") { res.writeHead(303, { location: stripeUrl }); return res.end(); }
      return sendJson(res, 200, { url: stripeUrl });
    }
    if (p === "/api/webhooks/stripe" && req.method === "POST") {
      const raw = await readBody(req);
      const data = JSON.parse(raw || "{}");
      const session = data.data?.object || data;
      const sessionId = session.id || session.checkout_session_id;
      const email = session.customer_email || session.email || data.email;
      const tier = (session.metadata?.tier || data.tier || "pro").toLowerCase();
      const plan = PLANS[tier] || PLANS.pro;
      if (!sessionId || !email) return sendJson(res, 400, { error: "missing session/email" });
      // Idempotencia
      if (pool) {
        const { rows } = await pool.query("SELECT license_token FROM orders WHERE stripe_session_id=$1 AND status='paid'", [sessionId]);
        if (rows.length && rows[0].license_token) return sendJson(res, 200, { ok: true, duplicate: true });
      }
      const { token, payload } = signLicense(email, plan.tier, plan.maxDevices);
      if (pool) {
        await pool.query("UPDATE orders SET status='paid', paid_at=NOW(), license_id=$1, license_token=$2, stripe_session_id=$3 WHERE stripe_session_id IS NULL OR stripe_session_id<>$3", [payload.licenseId, token, sessionId]).catch(() => {});
        await pool.query("INSERT INTO orders(email,tier,max_devices,amount_cents,currency,status,stripe_session_id,license_id,license_token,paid_at) VALUES($1,$2,$3,$4,'usd','paid',$5,$6,$7,NOW()) ON CONFLICT (stripe_session_id) DO UPDATE SET status='paid', paid_at=NOW(), license_id=EXCLUDED.license_id, license_token=EXCLUDED.license_token", [email, plan.tier, plan.maxDevices, plan.price, sessionId, payload.licenseId, token]);
      }
      // Email vía n8n/Resend si configurado
      if (N8N_EMAIL_URL) {
        try {
          await fetch(N8N_EMAIL_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: email, subject: "Tu licencia VoxFlow Studio", licenseKey: token, downloadUrl: `${APP_URL}/api/download/latest`, lang: "es" }) });
        } catch {}
      }
      return sendJson(res, 200, { ok: true });
    }
    if (p === "/api/license/activate" && req.method === "POST") {
      if (rateLimited(ip, 30)) return sendJson(res, 429, { error: "too many requests" });
      const { licenseKey, hardwareHash, chip, appVersion } = JSON.parse((await readBody(req)) || "{}");
      const pub = process.env.VOXFLOW_ED25519_PUBLIC_KEY;
      if (!pub || !licenseKey || !hardwareHash) return sendJson(res, 400, { error: "missing fields" });
      const payload = verifyToken(licenseKey, pub);
      if (!payload || payload.product !== "com.blackeye.voxflowstudio") return sendJson(res, 401, { error: "invalid license signature" });
      if (!pool) return sendJson(res, 503, { error: "database unavailable" });

      // Claves emitidas por CLI (p.ej. Founder BE-21A37127) se indexan en `orders`
      // la primera vez que se activan, para que aparezcan siempre en /admin.
      await pool.query(
        `INSERT INTO orders(email,tier,max_devices,amount_cents,currency,status,license_id,license_token,paid_at)
         SELECT $1,$2,$3,0,'usd','paid',$4,$5,NOW()
          WHERE NOT EXISTS (SELECT 1 FROM orders WHERE license_id=$4)`,
        [payload.email, payload.tier, payload.maxDevices, payload.licenseId, String(licenseKey).trim()]
      ).catch(() => {});

      const { rows: existing } = await pool.query(
        "SELECT id FROM license_activations WHERE license_id=$1 AND hardware_hash=$2",
        [payload.licenseId, hardwareHash]
      );
      if (existing.length === 0) {
        const { rows: usedRows } = await pool.query(
          "SELECT COUNT(*)::int c FROM license_activations WHERE license_id=$1",
          [payload.licenseId]
        );
        const used = usedRows[0].c;
        if (used >= payload.maxDevices) {
          return sendJson(res, 409, {
            error: "seat limit reached",
            message: `Límite de Macs alcanzado (${used}/${payload.maxDevices}). Desvincula la Mac anterior.`,
            seatsUsed: used,
            maxDevices: payload.maxDevices,
          });
        }
      }

      await pool.query(
        `INSERT INTO license_activations(license_id,email,tier,max_devices,hardware_hash,device_name,app_version,last_seen_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (license_id, hardware_hash) DO UPDATE
           SET last_seen_at = NOW(),
               device_name = EXCLUDED.device_name,
               app_version = EXCLUDED.app_version`,
        [payload.licenseId, payload.email, payload.tier, payload.maxDevices, hardwareHash, chip || "", appVersion || ""]
      );
      const { rows: c2 } = await pool.query(
        "SELECT COUNT(*)::int c FROM license_activations WHERE license_id=$1",
        [payload.licenseId]
      );
      const seatsUsed = c2[0].c;
      const receipt = signReceipt({ licenseId: payload.licenseId, hardwareHash, tier: payload.tier, maxDevices: payload.maxDevices, email: payload.email, product: "com.blackeye.voxflowstudio" });
      return sendJson(res, 200, {
        ok: true,
        seatsUsed,
        occupiedSeats: seatsUsed,
        maxDevices: payload.maxDevices,
        licenseId: payload.licenseId,
        tier: payload.tier,
        email: payload.email,
        activationReceipt: receipt,
      });
    }
    if (p === "/api/license/status" && req.method === "POST") {
      if (rateLimited(ip, 45)) return sendJson(res, 429, { error: "too many requests" });
      const { licenseKey, hardwareHash } = JSON.parse((await readBody(req)) || "{}");
      const pub = process.env.VOXFLOW_ED25519_PUBLIC_KEY;
      const payload = pub && licenseKey ? verifyToken(licenseKey, pub) : null;
      if (!payload) return sendJson(res, 401, { error: "invalid license signature" });
      if (!pool) return sendJson(res, 503, { error: "database unavailable" });
      const { rows: c } = await pool.query("SELECT COUNT(*)::int c FROM license_activations WHERE license_id=$1", [payload.licenseId]);
      let activeHere = false;
      if (hardwareHash) {
        const { rows: own } = await pool.query(
          "SELECT 1 FROM license_activations WHERE license_id=$1 AND hardware_hash=$2",
          [payload.licenseId, hardwareHash]
        );
        activeHere = own.length > 0;
      }
      return sendJson(res, 200, {
        ok: true,
        seatsUsed: c[0].c,
        maxDevices: payload.maxDevices,
        licenseId: payload.licenseId,
        tier: payload.tier,
        email: payload.email,
        activeOnThisDevice: activeHere,
      });
    }
    if (p === "/api/license/deactivate" && req.method === "POST") {
      if (rateLimited(ip, 30)) return sendJson(res, 429, { error: "too many requests" });
      const { licenseKey, hardwareHash } = JSON.parse((await readBody(req)) || "{}");
      const pub = process.env.VOXFLOW_ED25519_PUBLIC_KEY;
      const payload = pub && licenseKey ? verifyToken(licenseKey, pub) : null;
      if (!payload || !hardwareHash) return sendJson(res, 401, { error: "invalid license" });
      if (!pool) return sendJson(res, 503, { error: "database unavailable" });
      await pool.query("DELETE FROM license_activations WHERE license_id=$1 AND hardware_hash=$2", [payload.licenseId, hardwareHash]);
      const { rows: c } = await pool.query("SELECT COUNT(*)::int c FROM license_activations WHERE license_id=$1", [payload.licenseId]);
      return sendJson(res, 200, { ok: true, seatsUsed: c[0].c, maxDevices: payload.maxDevices, licenseId: payload.licenseId, tier: payload.tier, email: payload.email });
    }
    if (p === "/api/trial/start" && req.method === "POST") {
      if (rateLimited(ip, 20)) return sendJson(res, 429, { error: "too many requests" });
      const { email, locale, country } = JSON.parse(await readBody(req));
      if (!email || !String(email).includes("@")) return sendJson(res, 400, { error: "invalid email" });
      if (pool) {
        try { await pool.query("INSERT INTO trial_leads(email,locale,country,version_downloaded) VALUES($1,$2,$3,$4)", [email, locale || "es", country || "", VERSION]); } catch {}
      }
      if (N8N_EMAIL_URL) {
        try { await fetch(N8N_EMAIL_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: email, type: "trial_welcome", lang: locale || "es", downloadUrl: `${APP_URL}/api/download/latest` }) }); } catch {}
      }
      return sendJson(res, 200, { ok: true, downloadUrl: "/api/download/latest" });
    }
    // Ancla de trial por hardware: 14 días contados SIEMPRE por el reloj del VPS/PostgreSQL.
    // Respuesta firmada Ed25519 (VFST) para que no se pueda falsificar con /etc/hosts o proxy local.
    if (p === "/api/trial/verify" && req.method === "POST") {
      if (rateLimited(ip, 30)) return sendJson(res, 429, { error: "too many requests" });
      const body = JSON.parse((await readBody(req)) || "{}");
      const hardwareHash = String(body.hardwareHash || "").trim();
      const appVersion = String(body.appVersion || "").slice(0, 32);
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(hardwareHash)) return sendJson(res, 400, { error: "invalid hardwareHash" });
      if (!pool) return sendJson(res, 503, { error: "database unavailable" });
      if (!process.env.VOXFLOW_ED25519_PRIVATE_KEY) return sendJson(res, 503, { error: "signing unavailable" });
      const { rows } = await pool.query(
        `INSERT INTO hardware_trials (hardware_hash, first_seen_at, last_seen_at, app_version)
         VALUES ($1, NOW(), NOW(), $2)
         ON CONFLICT (hardware_hash) DO UPDATE
           SET last_seen_at = NOW(),
               app_version = COALESCE(EXCLUDED.app_version, hardware_trials.app_version)
         RETURNING EXTRACT(EPOCH FROM first_seen_at)::bigint AS start_epoch,
                   EXTRACT(EPOCH FROM NOW())::bigint          AS now_epoch,
                   GREATEST(0, EXTRACT(EPOCH FROM (first_seen_at + INTERVAL '14 days' - NOW())))::bigint AS remaining_epoch`,
        [hardwareHash, appVersion || null]
      );
      const r = rows[0];
      const remainingSeconds = Number(r.remaining_epoch);
      const payload = {
        product: "com.blackeye.voxflowstudio",
        hardwareHash,
        serverTimestamp: Number(r.now_epoch),
        trialStartTimestamp: Number(r.start_epoch),
        remainingSeconds,
        expired: remainingSeconds <= 0,
      };
      const seal = signSeal("VFST", payload);
      return sendJson(res, 200, { ok: true, ...payload, seal });
    }
    if (p === "/pago/success" && req.method === "GET") {
      const sessionId = url.searchParams.get("session_id");
      const lang = url.searchParams.get("lang") || "es";
      let keyHtml = "";
      if (sessionId && pool) {
        const { rows } = await pool.query("SELECT license_token FROM orders WHERE stripe_session_id=$1 AND status='paid'", [sessionId]);
        if (rows.length && rows[0].license_token) {
          const k = rows[0].license_token;
          keyHtml = `<p><code id="k">${k}</code></p><button onclick="navigator.clipboard.writeText(document.getElementById('k').textContent)">Copiar Licencia / Copy</button>`;
        } else {
          keyHtml = `<p>Cargando tu licencia… / Loading your license…</p><script>setTimeout(()=>location.reload(),2500)</script>`;
        }
      }
      const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>VoxFlow Studio — Pago completado</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui;max-width:640px;margin:60px auto;padding:0 20px"><h1>${lang === "en" ? "Payment successful" : "Pago completado"}</h1>${keyHtml}<p><a href="/api/download/latest">Descargar VoxFlowStudio-2.3.4.dmg / Download</a></p><ol><li>${lang==="en"?"Download the DMG":"Descarga el DMG"}</li><li>${lang==="en"?"Open VoxFlow Studio and paste the key":"Abre VoxFlow Studio y pega la clave"}</li><li>${lang==="en"?"Done — offline forever":"Listo — offline para siempre"}</li></ol></body></html>`;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(html);
    }
    // Idioma por país/cookie: "/" (inglés) y "/es/" (español).
    // Nunca 301: la respuesta depende de CF-IPCountry y de la cookie.
    if ((req.method === "GET" || req.method === "HEAD") && (p === "/" || p === "/es" || p === "/es/")) {
      const lang = manualLang(req);
      const country = countryFrom(req);
      res.setHeader("vary", "CF-IPCountry, Cookie");

      if (lang === "en") {
        if (p !== "/") return redirectLocalized(res, "/");
      } else if (lang === "es") {
        if (p === "/") return redirectLocalized(res, "/es/");
      } else {
        // Prioridad 2: país real (Cloudflare) y, solo si viene vacío/XX/T1, accept-language.
        const spanish = country ? SPANISH_COUNTRIES.has(country) : acceptsSpanish(req);
        if (spanish && p === "/") return redirectLocalized(res, "/es/");
      }

      // HTML dependiente de geolocalización: no dejar que Cloudflare lo comparta entre países.
      res.setHeader("cache-control", "private, no-cache, no-store, must-revalidate");
      res.setHeader("cdn-cache-control", "no-store");
      if (serveStatic(req, res, p)) return;
    }
    // Estáticos
    if (serveStatic(req, res, p)) return;
    return sendJson(res, 404, { error: "not found" });
  } catch (e) {
    return sendJson(res, 500, { error: "internal error" });
  }
});

await migrate().catch((e) => console.error("migrate failed", e.message));
server.listen(PORT, HOST, () => console.log(`voxflow-web listening on ${HOST}:${PORT}`));
