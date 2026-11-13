/**
 * Download modal: one email field → n8n webhook → .dmg download.
 * If funnel.ts still holds placeholder URLs, it runs in demo mode (no network, no download).
 */
import { funnel, isPlaceholder } from "../config/funnel";
import { getLocale, tr } from "./i18n";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function initModal() {
  const dlg = document.querySelector<HTMLDialogElement>("#download");
  if (!dlg) return;
  // SHA-256 dinámico desde el manifiesto firmado
  fetch("/api/updates/latest")
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const sha = j?.sha256 as string | undefined;
      if (!sha) return;
      const dd = dlg.querySelector(".verify .sha");
      if (dd) dd.textContent = sha;
    })
    .catch(() => undefined);
  const form = dlg.querySelector<HTMLFormElement>("form")!;
  const input = form.querySelector<HTMLInputElement>('input[name="email"]')!;
  const err = form.querySelector<HTMLElement>(".field-err")!;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const stepForm = form.querySelector<HTMLElement>('[data-step="form"]')!;
  const stepDone = form.querySelector<HTMLElement>('[data-step="done"]')!;
  const msg = form.querySelector<HTMLElement>(".modal-msg")!;
  let opener: HTMLElement | null = null;

  const open = (from: HTMLElement) => {
    opener = from;
    stepForm.hidden = false;
    stepDone.hidden = true;
    err.textContent = "";
    input.removeAttribute("aria-invalid");
    dlg.showModal();
    requestAnimationFrame(() => input.focus());
  };
  const close = () => {
    dlg.close();
    opener?.focus();
  };

  document.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-open-download]");
    if (t) open(t);
  });
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) close(); // backdrop
    if ((e.target as HTMLElement).closest("[data-close]")) close();
  });

  input.addEventListener("input", () => {
    if (err.textContent && EMAIL.test(input.value.trim())) {
      err.textContent = "";
      input.removeAttribute("aria-invalid");
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!EMAIL.test(email)) {
      err.textContent = tr("modal.invalid");
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = tr("modal.sending");

    const demo = isPlaceholder(funnel.n8n.trialWebhookUrl) || isPlaceholder(funnel.download.dmgUrl) || location.protocol === "file:";
    let note = tr("modal.okBody");

    if (demo) {
      await new Promise((r) => setTimeout(r, 450));
      note = tr("modal.demo");
    } else {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), funnel.n8n.timeoutMs);
      try {
        const r = await fetch(funnel.n8n.trialWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            locale: getLocale(),
            plan: "trial",
            trialDays: funnel.trialDays,
            source: "web-p1-cupertino-noir",
            page: location.pathname,
            referrer: document.referrer || null,
            ts: new Date().toISOString(),
          }),
          signal: ctrl.signal,
        });
        if (!r.ok) note = tr("modal.netError");
      } catch {
        note = tr("modal.netError");
      } finally {
        clearTimeout(to);
      }
      const a = document.createElement("a");
      a.href = funnel.download.dmgUrl;
      a.download = funnel.download.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    msg.textContent = note;
    submit.disabled = false;
    submit.textContent = tr("modal.submit");
    stepForm.hidden = true;
    stepDone.hidden = false;
    stepDone.querySelector<HTMLElement>("h2")?.focus?.();
  });
}
