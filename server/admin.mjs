/**
 * VoxFlow Studio — Admin privado (/admin)
 * Google OAuth (Promptvalue) + gating server-side exclusivo del CEO.
 * Sin Auth.js ni dependencias nuevas: OAuth + cookie de sesión HMAC.
 */
import crypto from "node:crypto";

const SESSION_COOKIE = "vfs_admin";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;

const PLAN_OPTIONS = {
  personal: { tier: "Personal", price: 2900, maxDevices: 1, label: "Personal · 1 Mac — $29" },
  pro: { tier: "Pro", price: 4900, maxDevices: 3, label: "Pro Studio · 3 Macs — $49" },
  team: { tier: "Team", price: 6900, maxDevices: 5, label: "Team · 5 Macs — $69" },
  founder: { tier: "Founder", price: 0, maxDevices: 5, label: "Founder · 5 Macs — $0" },
};

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function licenseEmailHtml({ email, token, tier, maxDevices, licenseId }) {
  const key = escapeHtml(token);
  return `<!doctype html><html><body style="margin:0;background:#0a0b0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f4f5f7">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <div style="font-size:12px;letter-spacing:.14em;font-weight:800;color:#00f0ff">VOXFLOW STUDIO</div>
    <h1 style="font-size:22px;margin:14px 0 6px">Tu licencia está lista</h1>
    <p style="color:#a2a6b3;font-size:14px;line-height:1.6;margin:0 0 18px">
      Plan <strong style="color:#f4f5f7">${escapeHtml(tier)}</strong> · ${maxDevices} Mac${maxDevices > 1 ? "s" : ""} · ${escapeHtml(email)}
    </p>
    <div style="background:#111318;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:16px">
      <div style="font-size:11px;letter-spacing:.1em;color:#a2a6b3;font-weight:700;text-transform:uppercase;margin-bottom:8px">Clave de licencia</div>
      <code style="display:block;font-size:12px;line-height:1.6;word-break:break-all;color:#d8fdff">${key}</code>
      <div style="font-size:11px;color:#a2a6b3;margin-top:10px">ID: ${escapeHtml(licenseId)}</div>
    </div>
    <p style="margin:20px 0 8px"><a href="https://voxflow.iareal.net/api/download/latest" style="display:inline-block;background:#00f0ff;color:#001417;text-decoration:none;font-weight:800;font-size:13px;padding:12px 18px;border-radius:10px">Descargar VoxFlow Studio</a></p>
    <p style="color:#a2a6b3;font-size:12px;line-height:1.6">Pega la clave en VoxFlow Studio → Licencia. Si cambias de Mac, escribe a soporte y liberamos tu asiento.</p>
    <p style="color:#6f7480;font-size:11px;margin-top:22px">BLACK EYE · Team YH6W55MP95 · voxflow.iareal.net</p>
  </div></body></html>`;
}

function hmac(data, secret) {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function createAdmin(ctx) {
  const { pool, appUrl, n8nEmailUrl, emailFrom, version, signLicense, sendJson, readBody } = ctx;

  const clientId = (process.env.GOOGLE_CLIENT_ID || process.env.AUTH_GOOGLE_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET || "").trim();
  const sessionSecret = (process.env.AUTH_SECRET || process.env.ADMIN_SESSION_SECRET || "").trim();
  const allowedEmails = (process.env.ADMIN_ALLOWED_EMAILS || process.env.ADMIN_EMAIL || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const redirectUri = `${appUrl}/api/auth/callback/google`;
  const missing = [];
  if (!clientId) missing.push("GOOGLE_CLIENT_ID");
  if (!clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (!sessionSecret) missing.push("AUTH_SECRET");
  if (!allowedEmails.length) missing.push("ADMIN_ALLOWED_EMAILS");
  if (!pool) missing.push("DATABASE_URL");
  const configured = missing.length === 0;

  function setCookie(res, value, maxAgeSeconds) {
    const parts = [
      `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      `Max-Age=${maxAgeSeconds}`,
    ];
    res.setHeader("Set-Cookie", parts.join("; "));
  }

  function makeToken(payload, ttl) {
    const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + ttl }));
    return `${body}.${hmac(body, sessionSecret)}`;
  }

  function readToken(token) {
    if (!sessionSecret || !token) return null;
    const i = String(token).lastIndexOf(".");
    if (i < 0) return null;
    const body = token.slice(0, i);
    const sig = token.slice(i + 1);
    if (!safeEqual(sig, hmac(body, sessionSecret))) return null;
    try {
      const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (!data || typeof data.exp !== "number" || data.exp < Date.now()) return null;
      return data;
    } catch {
      return null;
    }
  }

  function sessionFrom(req) {
    if (!configured) return null;
    const data = readToken(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    if (!data || !data.email) return null;
    if (!allowedEmails.includes(String(data.email).toLowerCase())) return null;
    return data;
  }

  function isAdminPath(p) {
    return p === "/admin" || p === "/admin/" || p.startsWith("/api/admin/") || p.startsWith("/api/auth/");
  }

  function deny(res, code, message) {
    sendJson(res, code, { error: message });
  }

  function sameOrigin(req) {
    const origin = req.headers.origin || req.headers.referer || "";
    if (!origin) return false;
    try {
      const host = new URL(origin).host;
      return host === req.headers.host;
    } catch {
      return false;
    }
  }

  async function handle(req, res, url, p) {
    // ---------- OAuth ----------
    if (p === "/api/auth/google/login" && req.method === "GET") {
      if (!configured) return deny(res, 503, "admin not configured");
      const state = makeToken({ n: crypto.randomBytes(8).toString("hex") }, STATE_TTL_MS);
      const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      auth.searchParams.set("client_id", clientId);
      auth.searchParams.set("redirect_uri", redirectUri);
      auth.searchParams.set("response_type", "code");
      auth.searchParams.set("scope", "openid email profile");
      auth.searchParams.set("state", state);
      auth.searchParams.set("prompt", "select_account");
      auth.searchParams.set("access_type", "online");
      res.writeHead(303, { location: auth.toString(), "cache-control": "no-store" });
      return res.end();
    }

    if (p === "/api/auth/callback/google" && req.method === "GET") {
      if (!configured) return deny(res, 503, "admin not configured");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const valid = state ? readToken(state) : null;
      if (!code || !valid) return redirectTo(res, "/admin?error=state");
      let email = "";
      try {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }).toString(),
        });
        const tok = await tokenRes.json();
        if (!tokenRes.ok || !tok.access_token) return redirectTo(res, "/admin?error=token");
        const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { authorization: `Bearer ${tok.access_token}` },
        });
        const info = await infoRes.json();
        if (!infoRes.ok || !info?.email) return redirectTo(res, "/admin?error=userinfo");
        if (info.email_verified === false) return redirectTo(res, "/admin?error=unverified");
        email = String(info.email).toLowerCase();
      } catch {
        return redirectTo(res, "/admin?error=google");
      }
      if (!allowedEmails.includes(email)) {
        setCookie(res, "", 0);
        return redirectTo(res, "/admin?error=forbidden");
      }
      setCookie(res, makeToken({ email }, SESSION_TTL_MS), Math.floor(SESSION_TTL_MS / 1000));
      return redirectTo(res, "/admin");
    }

    if (p === "/api/auth/logout" && req.method === "POST") {
      if (!sameOrigin(req)) return deny(res, 403, "forbidden");
      setCookie(res, "", 0);
      return sendJson(res, 200, { ok: true });
    }

    // ---------- /admin ----------
    if (p === "/admin" || p === "/admin/") {
      if (req.method !== "GET" && req.method !== "HEAD") return deny(res, 405, "method not allowed");
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-frame-options", "DENY");
      res.setHeader(
        "content-security-policy",
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
      );
      if (!configured) return sendHtml(res, 503, configPage(missing));
      const session = sessionFrom(req);
      if (!session) return sendHtml(res, 200, loginPage(url.searchParams.get("error"), configured));
      return sendHtml(res, 200, adminPage(session.email));
    }

    // ---------- API admin ----------
    if (p.startsWith("/api/admin/")) {
      const session = sessionFrom(req);
      if (!session) return deny(res, 403, "forbidden");
      if (req.method !== "GET" && !sameOrigin(req)) return deny(res, 403, "csrf");
      res.setHeader("cache-control", "no-store");

      try {
        if (p === "/api/admin/summary" && req.method === "GET") {
          const [revenue, plans, activations, trials] = await Promise.all([
            pool.query("SELECT COALESCE(SUM(amount_cents),0)::int AS cents, COUNT(*)::int AS paid FROM orders WHERE status='paid'"),
            pool.query("SELECT tier, COUNT(*)::int AS sold FROM orders WHERE status='paid' GROUP BY tier"),
            pool.query("SELECT COUNT(*)::int AS macs FROM license_activations"),
            pool.query("SELECT COUNT(*)::int AS leads FROM trial_leads"),
          ]);
          return sendJson(res, 200, {
            revenueCents: revenue.rows[0].cents,
            paidOrders: revenue.rows[0].paid,
            byPlan: plans.rows,
            macs: activations.rows[0].macs,
            trialLeads: trials.rows[0].leads,
            version,
          });
        }

        if (p === "/api/admin/orders" && req.method === "GET") {
          const q = (url.searchParams.get("q") || "").trim();
          const like = q ? `%${q}%` : "%";
          const { rows } = await pool.query(
            `SELECT id, email, tier, max_devices, amount_cents, currency, status, license_id, license_token,
                    created_at, paid_at
               FROM orders
              WHERE license_id IS NOT NULL
                AND (email ILIKE $1 OR license_id ILIKE $1 OR tier ILIKE $1)
              ORDER BY COALESCE(paid_at, created_at) DESC
              LIMIT 200`,
            [like]
          );
          const ids = rows.map((r) => r.license_id).filter(Boolean);
          let acts = [];
          if (ids.length) {
            const a = await pool.query(
              `SELECT license_id, hardware_hash, device_name, app_version, activated_at, last_seen_at
                 FROM license_activations WHERE license_id = ANY($1::text[])
                 ORDER BY last_seen_at DESC`,
              [ids]
            );
            acts = a.rows;
          }
          const byLicense = new Map();
          for (const a of acts) {
            if (!byLicense.has(a.license_id)) byLicense.set(a.license_id, []);
            byLicense.get(a.license_id).push(a);
          }
          return sendJson(res, 200, {
            rows: rows.map((r) => ({ ...r, macs: byLicense.get(r.license_id) || [] })),
          });
        }

        if (p === "/api/admin/trials" && req.method === "GET") {
          const { rows } = await pool.query(
            `SELECT t.email, t.locale, t.country, t.version_downloaded, t.created_at,
                    EXISTS (SELECT 1 FROM orders o WHERE lower(o.email)=lower(t.email) AND o.status='paid') AS purchased
               FROM trial_leads t ORDER BY t.created_at DESC LIMIT 300`
          );
          return sendJson(res, 200, { rows });
        }

        const resend = p.match(/^\/api\/admin\/orders\/([A-Za-z0-9-]+)\/resend$/);
        if (resend && req.method === "POST") {
          const licenseId = resend[1];
          const { rows } = await pool.query(
            "SELECT email, license_token, tier, max_devices FROM orders WHERE license_id=$1 AND license_token IS NOT NULL ORDER BY paid_at DESC NULLS LAST LIMIT 1",
            [licenseId]
          );
          if (!rows.length) return deny(res, 404, "license not found");
          if (!n8nEmailUrl) return deny(res, 503, "N8N_EMAIL_URL not configured");
          const row = rows[0];
          const r = await fetch(n8nEmailUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              to: row.email,
              from: emailFrom,
              subject: "Tu licencia de VoxFlow Studio",
              html: licenseEmailHtml({
                email: row.email,
                token: row.license_token,
                tier: row.tier,
                maxDevices: row.max_devices,
                licenseId,
              }),
            }),
          });
          const sent = r.ok;
          if (!sent) return deny(res, 502, "email gateway error");
          return sendJson(res, 200, { ok: true, to: row.email });
        }

        const reset = p.match(/^\/api\/admin\/orders\/([A-Za-z0-9-]+)\/reset-seats$/);
        if (reset && req.method === "POST") {
          const licenseId = reset[1];
          const d = await pool.query("DELETE FROM license_activations WHERE license_id=$1", [licenseId]);
          return sendJson(res, 200, { ok: true, freed: d.rowCount });
        }

        if (p === "/api/admin/licenses" && req.method === "POST") {
          const body = JSON.parse((await readBody(req)) || "{}");
          const email = String(body.email || "").trim().toLowerCase();
          const planKey = String(body.plan || "").toLowerCase();
          const plan = PLAN_OPTIONS[planKey];
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return deny(res, 400, "invalid email");
          if (!plan) return deny(res, 400, "invalid plan");
          if (!process.env.VOXFLOW_ED25519_PRIVATE_KEY) return deny(res, 503, "signing key not configured");
          const { token, payload } = signLicense(email, plan.tier, plan.maxDevices);
          await pool.query(
            `INSERT INTO orders(email,tier,max_devices,amount_cents,currency,status,license_id,license_token,paid_at)
             VALUES($1,$2,$3,$4,'usd','paid',$5,$6,NOW())`,
            [email, plan.tier, plan.maxDevices, plan.price, payload.licenseId, token]
          );
          let mailed = false;
          if (body.sendEmail && n8nEmailUrl) {
            try {
              const r = await fetch(n8nEmailUrl, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  to: email,
                  from: emailFrom,
                  subject: "Tu licencia de VoxFlow Studio",
                  html: licenseEmailHtml({
                    email,
                    token,
                    tier: plan.tier,
                    maxDevices: plan.maxDevices,
                    licenseId: payload.licenseId,
                  }),
                }),
              });
              mailed = r.ok;
            } catch {}
          }
          return sendJson(res, 200, { ok: true, email, tier: plan.tier, maxDevices: plan.maxDevices, licenseId: payload.licenseId, licenseKey: token, mailed });
        }

        return deny(res, 404, "not found");
      } catch (e) {
        console.error("admin api error", e?.message);
        return deny(res, 500, "internal error");
      }
    }

    return false;
  }

  return { handle, isAdminPath, configured, missing };
}

function redirectTo(res, location) {
  res.writeHead(303, { location, "cache-control": "no-store" });
  res.end();
}

function sendHtml(res, code, html) {
  res.writeHead(code, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(html);
}

const BASE_CSS = `
:root{color-scheme:dark;--bg:#08090c;--card:#101218;--line:rgba(255,255,255,.10);--ink:#f4f5f7;--ink2:#a2a6b3;--cyan:#00f0ff;--emerald:#0fba82;--amber:#ffb800;--red:#ff453a}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(1200px 600px at 20% -10%,rgba(0,240,255,.08),transparent 60%),var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--cyan);text-decoration:none}
.wrap{max-width:1180px;margin:0 auto;padding:22px 18px 64px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.num{font-variant-numeric:tabular-nums}
header.top{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:14px 0 20px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:.08em;font-size:13px}
.brand i{width:9px;height:9px;border-radius:50%;background:var(--cyan);box-shadow:0 0 12px var(--cyan);display:inline-block}
.spacer{flex:1}
.who{font-size:12px;color:var(--ink2)}
.btn{appearance:none;border:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02));color:var(--ink);padding:9px 13px;border-radius:10px;font:600 12.5px/1 inherit;cursor:pointer;min-height:36px}
.btn:hover{border-color:rgba(255,255,255,.22)}
.btn.primary{background:var(--cyan);color:#001417;border-color:transparent}
.btn.danger{color:#ffb4ae;border-color:rgba(255,69,58,.35)}
.btn:disabled{opacity:.45;cursor:default}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:22px}
.kpi{background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.015));border:1px solid var(--line);border-radius:14px;padding:14px}
.kpi .k{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink2);font-weight:700}
.kpi .v{font-size:26px;font-weight:800;letter-spacing:-.02em;margin-top:6px}
.kpi .s{font-size:11.5px;color:var(--ink2);margin-top:3px}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;background:rgba(255,255,255,.04);padding:5px;border-radius:12px;border:1px solid var(--line)}
.tab{appearance:none;border:0;background:transparent;color:var(--ink2);padding:9px 13px;border-radius:8px;font:700 12.5px/1 inherit;cursor:pointer}
.tab[aria-selected="true"]{background:rgba(255,255,255,.10);color:var(--ink)}
.panel{display:none}.panel.on{display:block}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
.row-actions{display:flex;gap:8px;flex-wrap:wrap}
input,select{background:#0b0d12;border:1px solid var(--line);color:var(--ink);border-radius:10px;padding:10px 12px;font:inherit;width:100%}
input:focus,select:focus{outline:2px solid rgba(0,240,255,.35);outline-offset:1px}
label.f{display:grid;gap:6px;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink2);font-weight:700}
.search{display:grid;grid-template-columns:1fr auto;gap:10px;margin-bottom:14px}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink2);padding:8px 10px;border-bottom:1px solid var(--line)}
td{padding:11px 10px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:top}
tr:hover td{background:rgba(255,255,255,.02)}
.pill{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.05em;padding:3px 8px;border-radius:99px;border:1px solid var(--line);color:var(--ink2)}
.pill.paid{color:#9ff5d9;border-color:rgba(15,186,130,.4);background:rgba(15,186,130,.12)}
.pill.pending{color:#ffe0a3;border-color:rgba(255,184,0,.4);background:rgba(255,184,0,.10)}
.pill.plan{color:#bfe9ff;border-color:rgba(0,240,255,.35);background:rgba(0,240,255,.10)}
.key{font-size:11.5px;color:var(--ink2);word-break:break-all;max-width:240px;display:block}
details summary{cursor:pointer;font-size:12px;color:var(--cyan);list-style:none}
details summary::-webkit-details-marker{display:none}
.macs{display:grid;gap:6px;margin-top:8px;font-size:11.5px;color:var(--ink2)}
.mac{border-left:2px solid rgba(0,240,255,.35);padding-left:8px}
.note{font-size:12px;color:var(--ink2)}
.result{margin-top:16px;display:none}.result.on{display:block}
.keybox{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;margin-top:10px}
.keybox code{background:#05070a;border:1px solid var(--line);border-radius:10px;padding:12px;font-size:12px;word-break:break-all;display:block}
.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#04181c;border:1px solid rgba(0,240,255,.35);color:#d8fdff;padding:11px 16px;border-radius:11px;font-size:12.5px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:50}
.toast.on{opacity:1}
.empty{padding:22px;color:var(--ink2);font-size:13px;text-align:center}
@media(max-width:860px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:720px){
  .wrap{padding:16px 12px 48px}
  .kpi .v{font-size:22px}
  table,thead,tbody,th,td,tr{display:block}
  thead{display:none}
  tr{border:1px solid var(--line);border-radius:12px;margin-bottom:10px;padding:6px 2px;background:rgba(255,255,255,.02)}
  td{border:0;padding:6px 12px;display:grid;grid-template-columns:96px 1fr;gap:10px;align-items:start}
  td::before{content:attr(data-label);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink2);font-weight:700;padding-top:2px}
  td[data-label=""]::before{content:none}
  td[data-label=""]{grid-template-columns:1fr}
  .key{max-width:none}
  .search{grid-template-columns:1fr}
}
`;

function shell(title, body, { email = "", logout = false } = {}) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)}</title><style>${BASE_CSS}</style></head>
<body><div class="wrap">
<header class="top">
  <div class="brand"><i></i>VOXFLOW · ADMIN</div>
  <div class="spacer"></div>
  ${email ? `<span class="who mono">${escapeHtml(email)}</span><button class="btn" id="logout">Salir</button>` : ""}
</header>
${body}
<div class="toast" id="toast"></div>
${logout ? `<script>
(()=>{
const t=(m)=>{const n=document.getElementById('toast');n.textContent=m;n.classList.add('on');clearTimeout(n._h);n._h=setTimeout(()=>n.classList.remove('on'),2200)};
document.getElementById('logout').addEventListener('click',async()=>{await fetch('/api/auth/logout',{method:'POST'});location.href='/admin';});
})();
</script>` : ""}
</div></body></html>`;
}

function loginPage(error, configured) {
  const msg = {
    forbidden: "Ese correo de Google no está autorizado para /admin.",
    state: "La sesión de acceso caducó. Vuelve a intentarlo.",
    token: "Google rechazó el intercambio de código.",
    userinfo: "No se pudo leer tu perfil de Google.",
    unverified: "Tu correo de Google no está verificado.",
    google: "Fallo de comunicación con Google.",
  }[error || ""];
  return shell(
    "Acceso · VoxFlow Admin",
    `<div class="card" style="max-width:440px;margin:12vh auto 0;text-align:center">
      <div class="brand" style="justify-content:center;margin-bottom:6px"><i></i>VOXFLOW STUDIO</div>
      <h1 style="font-size:20px;margin:6px 0 4px">Panel privado</h1>
      <p class="note">Acceso restringido al CEO. Solo Google OAuth.</p>
      ${msg ? `<p class="note" style="color:#ffb4ae">${escapeHtml(msg)}</p>` : ""}
      <a class="btn primary" style="display:inline-block;margin-top:16px;text-decoration:none" href="/api/auth/google/login">Iniciar sesión con Google</a>
      <p class="note" style="margin-top:18px">voxflow.iareal.net · admin</p>
    </div>`
  );
}

function configPage(missing) {
  return shell(
    "Configuración pendiente · VoxFlow Admin",
    `<div class="card" style="max-width:620px;margin:10vh auto 0">
      <h1 style="font-size:19px;margin:0 0 8px">Panel sin configurar</h1>
      <p class="note">Faltan variables de entorno en Coolify (fail-closed: nadie entra hasta configurarlas):</p>
      <ul class="mono" style="font-size:12.5px;color:#ffb4ae">${missing.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>
      <p class="note">Redirect URI en Google Cloud Console:<br><span class="mono">https://voxflow.iareal.net/api/auth/callback/google</span></p>
    </div>`
  );
}

function adminPage(email) {
  return shell(
    "VoxFlow Admin",
    `<section class="kpis" id="kpis">
      <div class="kpi"><div class="k">Ingresos totales</div><div class="v num" id="k-rev">—</div><div class="s" id="k-rev-s">&nbsp;</div></div>
      <div class="kpi"><div class="k">Licencias vendidas</div><div class="v num" id="k-sold">—</div><div class="s" id="k-sold-s">&nbsp;</div></div>
      <div class="kpi"><div class="k">Macs activadas</div><div class="v num" id="k-macs">—</div><div class="s">asientos en uso ahora</div></div>
      <div class="kpi"><div class="k">Trials 14 días</div><div class="v num" id="k-trials">—</div><div class="s">descargas registradas</div></div>
    </section>

    <nav class="tabs" role="tablist">
      <button class="tab" role="tab" data-tab="clients" aria-selected="true">Clientes y compras</button>
      <button class="tab" role="tab" data-tab="issue" aria-selected="false">Emitir licencia</button>
      <button class="tab" role="tab" data-tab="leads" aria-selected="false">Leads de prueba</button>
    </nav>

    <section class="panel on" id="p-clients">
      <div class="search">
        <input id="q" type="search" placeholder="Buscar por email, tier o License ID (BE-...)" autocomplete="off">
        <button class="btn" id="search-btn">Buscar</button>
      </div>
      <div class="card" style="padding:6px 10px 10px">
        <table><thead><tr><th>Email</th><th>Plan</th><th>Monto</th><th>Fecha</th><th>License ID</th><th>Macs</th><th>Acciones</th></tr></thead>
        <tbody id="orders"><tr><td colspan="7" class="empty">Cargando…</td></tr></tbody></table>
      </div>
    </section>

    <section class="panel" id="p-issue">
      <div class="card" style="max-width:560px">
        <h2 style="font-size:16px;margin:0 0 12px">Emitir licencia manual</h2>
        <form id="issue-form" style="display:grid;gap:12px">
          <label class="f">Email del cliente<input id="i-email" type="email" required placeholder="cliente@dominio.com"></label>
          <label class="f">Plan<select id="i-plan">
            <option value="personal">Personal · 1 Mac — $29</option>
            <option value="pro" selected>Pro Studio · 3 Macs — $49</option>
            <option value="team">Team · 5 Macs — $69</option>
            <option value="founder">Founder · 5 Macs — $0</option>
          </select></label>
          <label class="note" style="display:flex;gap:8px;align-items:center"><input id="i-send" type="checkbox" style="width:auto"> Enviar por correo automáticamente</label>
          <button class="btn primary" type="submit" id="i-submit">Firmar y generar clave VFS1</button>
        </form>
        <div class="result" id="issue-result">
          <p class="note" id="issue-msg"></p>
          <div class="keybox"><code class="mono" id="issue-key"></code><button class="btn" id="issue-copy">Copiar</button></div>
        </div>
      </div>
    </section>

    <section class="panel" id="p-leads">
      <div class="card" style="padding:6px 10px 10px">
        <table><thead><tr><th>Email</th><th>Fecha</th><th>Idioma</th><th>País</th><th>Versión</th><th>Compró</th></tr></thead>
        <tbody id="leads"><tr><td colspan="6" class="empty">Cargando…</td></tr></tbody></table>
      </div>
    </section>

    <script>
    const $=(s)=>document.querySelector(s);
    const money=(c,cur)=>new Intl.NumberFormat('en-US',{style:'currency',currency:(cur||'usd').toUpperCase()}).format((c||0)/100);
    const d=(v)=>v?new Date(v).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'}):'—';
    const toast=(m)=>{const t=$('#toast');t.textContent=m;t.classList.add('on');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('on'),2200)};
    const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!=null)n.textContent=txt;return n};

    async function api(path,opts){
      const r=await fetch(path,Object.assign({headers:{'content-type':'application/json'}},opts||{}));
      if(r.status===403){location.href='/admin';throw new Error('forbidden');}
      if(!r.ok){let e='error';try{e=(await r.json()).error||e}catch{}throw new Error(e);}
      return r.json();
    }

    async function loadSummary(){
      const s=await api('/api/admin/summary');
      $('#k-rev').textContent=money(s.revenueCents,'usd');
      $('#k-rev-s').textContent=s.paidOrders+' pagos';
      $('#k-sold').textContent=String(s.byPlan.reduce((a,b)=>a+b.sold,0));
      $('#k-sold-s').textContent=s.byPlan.map(p=>p.tier+' '+p.sold).join(' · ')||'—';
      $('#k-macs').textContent=String(s.macs);
      $('#k-trials').textContent=String(s.trialLeads);
    }

    function macList(r){
      const wrap=el('div');
      if(!r.macs.length){wrap.appendChild(el('span','note','0 Macs vinculadas'));return wrap;}
      const det=el('details');
      det.appendChild(el('summary',null,r.macs.length+'/'+r.max_devices+' Macs'));
      const list=el('div','macs');
      r.macs.forEach((m)=>{
        const line=el('div','mac');
        line.appendChild(el('div',null,(m.device_name||'Mac')+(m.app_version?' · v'+m.app_version:'')));
        line.appendChild(el('div','num',(m.last_seen_at?d(m.last_seen_at):d(m.activated_at))+' · '+String(m.hardware_hash||'').slice(0,10)));
        list.appendChild(line);
      });
      det.appendChild(list);wrap.appendChild(det);return wrap;
    }

    async function loadOrders(){
      const q=encodeURIComponent($('#q').value.trim());
      const tbody=$('#orders');
      tbody.innerHTML='';
      const {rows}=await api('/api/admin/orders?q='+q);
      if(!rows.length){const tr=el('tr');const td=el('td','empty','Sin resultados');td.colSpan=7;tr.appendChild(td);tbody.appendChild(tr);return;}
      rows.forEach((r)=>{
        const tr=el('tr');
        const emailTd=el('td');emailTd.dataset.label='Email';emailTd.appendChild(el('div',null,r.email));emailTd.appendChild(el('span','note mono',String(r.license_token||'').slice(0,18)+'…'));tr.appendChild(emailTd);

        const plan=el('td');plan.dataset.label='Plan';plan.appendChild(el('span','pill plan',r.tier));tr.appendChild(plan);

        const amt=el('td','num');amt.dataset.label='Monto';amt.textContent=money(r.amount_cents,r.currency);tr.appendChild(amt);

        const f=el('td','num');f.dataset.label='Fecha';f.textContent=d(r.paid_at||r.created_at);tr.appendChild(f);

        const id=el('td','mono');id.dataset.label='License';id.textContent=r.license_id||'—';tr.appendChild(id);

        const mac=el('td');mac.dataset.label='Macs';mac.appendChild(macList(r));tr.appendChild(mac);

        const act=el('td');act.dataset.label='';
        const box=el('div','row-actions');
        const copy=el('button','btn','Copiar VFS1');copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(r.license_token||'');toast('Clave copiada');}catch{toast('No se pudo copiar');}});
        const send=el('button','btn','Reenviar');send.addEventListener('click',async()=>{send.disabled=true;try{const o=await api('/api/admin/orders/'+encodeURIComponent(r.license_id)+'/resend',{method:'POST'});toast('Licencia reenviada a '+o.to);}catch(e){toast('Error: '+e.message);}send.disabled=false;});
        const free=el('button','btn danger','Liberar Macs');free.addEventListener('click',async()=>{if(!confirm('¿Liberar todas las Macs de '+r.email+'? Podrá activar la licencia en otra Mac.'))return;free.disabled=true;try{const o=await api('/api/admin/orders/'+encodeURIComponent(r.license_id)+'/reset-seats',{method:'POST'});toast(o.freed+' Macs liberadas');loadOrders();loadSummary();}catch(e){toast('Error: '+e.message);}free.disabled=false;});
        box.append(copy,send,free);act.appendChild(box);tr.appendChild(act);
        tbody.appendChild(tr);
      });
    }

    async function loadLeads(){
      const tbody=$('#leads');tbody.innerHTML='';
      const {rows}=await api('/api/admin/trials');
      if(!rows.length){const tr=el('tr');const td=el('td','empty','Todavía no hay descargas trial');td.colSpan=6;tr.appendChild(td);tbody.appendChild(tr);return;}
      rows.forEach((r)=>{
        const tr=el('tr');
        const e=el('td');e.dataset.label='Email';e.textContent=r.email;tr.appendChild(e);
        const f=el('td','num');f.dataset.label='Fecha';f.textContent=d(r.created_at);tr.appendChild(f);
        const l=el('td');l.dataset.label='Idioma';l.textContent=(r.locale||'—').toUpperCase();tr.appendChild(l);
        const c=el('td');c.dataset.label='País';c.textContent=r.country||'—';tr.appendChild(c);
        const v=el('td','mono');v.dataset.label='Versión';v.textContent=r.version_downloaded||'—';tr.appendChild(v);
        const p=el('td');p.dataset.label='Compró';p.appendChild(el('span','pill '+(r.purchased?'paid':'pending'),r.purchased?'Sí':'No'));tr.appendChild(p);
        tbody.appendChild(tr);
      });
    }

    document.querySelectorAll('.tab').forEach((t)=>t.addEventListener('click',()=>{
      document.querySelectorAll('.tab').forEach((x)=>x.setAttribute('aria-selected',String(x===t)));
      document.querySelectorAll('.panel').forEach((p)=>p.classList.toggle('on',p.id==='p-'+t.dataset.tab));
      if(t.dataset.tab==='leads')loadLeads();
    }));

    $('#search-btn').addEventListener('click',loadOrders);
    $('#q').addEventListener('keydown',(e)=>{if(e.key==='Enter')loadOrders();});

    $('#issue-form').addEventListener('submit',async(e)=>{
      e.preventDefault();
      const btn=$('#i-submit');btn.disabled=true;
      try{
        const body={email:$('#i-email').value.trim(),plan:$('#i-plan').value,sendEmail:$('#i-send').checked};
        const r=await api('/api/admin/licenses',{method:'POST',body:JSON.stringify(body)});
        $('#issue-result').classList.add('on');
        $('#issue-msg').textContent=r.tier+' · '+r.maxDevices+' Macs · '+r.email+(r.mailed?' · enviada por correo':'');
        $('#issue-key').textContent=r.licenseKey;
        $('#issue-key').dataset.key=r.licenseKey;
        $('#i-email').value='';$('#i-send').checked=false;
        loadSummary();loadOrders();
      }catch(err){toast('Error: '+err.message);}
      btn.disabled=false;
    });

    $('#issue-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#issue-key').dataset.key||'');toast('Clave copiada');}catch{toast('No se pudo copiar');}});

    loadSummary().catch((e)=>toast('Error: '+e.message));
    loadOrders().catch((e)=>toast('Error: '+e.message));
    </script>`,
    { email, logout: true }
  );
}
