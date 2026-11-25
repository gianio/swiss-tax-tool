/*
 * Download paywall (TWINT / credit card) — switched off by default.
 *
 * Configured in config.js (APP_CONFIG.paywall):
 *   enabled: true  -> hard gate: XML and PDF need a payment, preview masked.
 *   soft: true     -> soft gate (test phase): the payment dialog appears only
 *                     for the barcode PDF and can be skipped with
 *                     "Kostenlos weiter". Nothing is masked.
 *   both false     -> no dialog at all.
 * `index.html?paywall=demo` shows the hard dialog with a simulated payment,
 * `index.html?paywall=soft` forces the soft gate.
 *
 * Real flow (when enabled): the provider checkout opens in a NEW window so the
 * statement — which only exists in this tab's memory — is not lost. The
 * provider redirects that window to paid.html, which posts the reference back
 * here via postMessage; the reference is then verified server-side
 * (verifyUrl). Only price + a random reference ever go to the provider.
 *
 * Note: everything is generated in the browser, so a technically skilled user
 * could bypass any client-side gate. That is inherent to the privacy-first,
 * no-upload design and accepted on purpose.
 */
(function (root) {
  "use strict";
  const cfg = (root.APP_CONFIG && root.APP_CONFIG.paywall) || { enabled: false };
  const demo = /[?&]paywall=demo\b/.test(location.search);
  const soft = !cfg.enabled && !demo && (cfg.soft || /[?&]paywall=soft\b/.test(location.search));
  let unlocked = false, skipped = false;

  // Hard gate (masks preview, blocks XML + PDF).
  function active() { return !unlocked && (cfg.enabled || demo); }
  // Does this download need the dialog? kind: "xml" | "pdf"
  function gated(kind) {
    if (active()) return true;
    return soft && !unlocked && !skipped && kind === "pdf";
  }

  function randomRef() {
    const b = new Uint8Array(12);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function requireUnlock(kind) {
    if (!gated(kind || "pdf")) return Promise.resolve(true);
    return new Promise((resolve) => {
      const live = !!(cfg.checkoutUrl && (cfg.checkoutUrl.twint || cfg.checkoutUrl.card) && cfg.verifyUrl);
      const configured = demo || live || soft;
      const price = cfg.priceChf || "9.90";
      const ov = el(`
        <div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="payTitle">
          <div class="modal">
            <h2 id="payTitle">Steuerauszug herunterladen</h2>
            <p class="hint" style="margin-top:4px">Einmalig <strong>CHF ${price}</strong> für dieses Steuerjahr – XML und PDF mit Barcode.</p>
            ${demo ? '<div class="banner warn" style="margin:10px 0"><span class="ico mi mi-info"></span><div><strong>Demo-Modus:</strong> es wird keine echte Zahlung ausgelöst.</div></div>' : ""}
            ${soft ? '<div class="banner info" style="margin:10px 0"><span class="ico mi mi-info"></span><div><strong>Testphase:</strong> Der Download ist im Moment noch kostenlos. Sie können ohne Zahlung weiterfahren.</div></div>' : ""}
            <ul class="checklist">
              <li>eCH‑0196‑Steuerauszug (XML) für den Import in Ihre kantonale Steuersoftware</li>
              <li>PDF mit Barcode (macro PDF417) zum Scannen</li>
              <li>Ihre Steuerdaten bleiben auf Ihrem Gerät – an den Zahlungsanbieter gehen nur Betrag und eine Zufallsreferenz</li>
            </ul>
            <div class="pay-methods">
              <button class="pay-btn twint" type="button" data-m="twint" ${configured ? "" : "disabled"}>
                <span class="pm-logo">TWINT</span><span>Mit TWINT bezahlen</span></button>
              <button class="pay-btn card" type="button" data-m="card" ${configured ? "" : "disabled"}>
                <span class="pm-logo">VISA · MC</span><span>Mit Kreditkarte bezahlen</span></button>
            </div>
            <div class="pay-status muted-note" aria-live="polite">${configured ? "" : "Die Zahlung ist noch nicht verfügbar."}</div>
            <div class="actions" style="justify-content:flex-end"><button class="btn ghost" type="button" data-x>Abbrechen</button>${soft ? '<button class="btn primary" type="button" data-skip>Kostenlos weiter<span class="mi mi-arrow"></span></button>' : ""}</div>
          </div>
        </div>`);
      document.body.appendChild(ov);
      const status = ov.querySelector(".pay-status");
      let onMsg = null;
      const close = (ok) => {
        if (onMsg) window.removeEventListener("message", onMsg);
        ov.remove();
        resolve(ok);
      };
      ov.querySelector("[data-x]").addEventListener("click", () => close(false));
      const skipBtn = ov.querySelector("[data-skip]");
      if (skipBtn) skipBtn.addEventListener("click", () => { skipped = true; close(true); });
      ov.addEventListener("keydown", (e) => { if (e.key === "Escape") close(false); });

      ov.querySelectorAll(".pay-btn").forEach((btn) => btn.addEventListener("click", () => {
        const method = btn.dataset.m;
        ov.querySelectorAll(".pay-btn").forEach((b) => (b.disabled = true));
        if (soft && !live) {
          status.textContent = "Die Zahlung ist in der Testphase noch nicht aktiv – der Download ist kostenlos.";
          setTimeout(() => { skipped = true; close(true); }, 1400);
          return;
        }
        if (demo) {
          status.textContent = `Simuliere ${method === "twint" ? "TWINT" : "Kreditkarten"}-Zahlung …`;
          setTimeout(() => { unlocked = true; status.textContent = "✓ Bezahlt (Demo)"; setTimeout(() => close(true), 500); }, 900);
          return;
        }
        const url = cfg.checkoutUrl[method];
        if (!url) { status.textContent = "Diese Zahlungsart ist nicht eingerichtet."; return; }
        const ref = randomRef();
        const sep = url.includes("?") ? "&" : "?";
        const win = window.open(`${url}${sep}ref=${ref}&amount=${encodeURIComponent(price)}`, "estpay", "width=520,height=760");
        if (!win) { status.textContent = "Popup wurde blockiert – bitte Popups für diese Seite erlauben."; ov.querySelectorAll(".pay-btn").forEach((b) => (b.disabled = false)); return; }
        status.textContent = "Zahlung im neuen Fenster abschliessen …";
        onMsg = async (e) => {
          if (e.origin !== location.origin || !e.data || e.data.type !== "est-payment" || e.data.ref !== ref) return;
          if (e.data.status !== "success") { status.textContent = "Zahlung abgebrochen."; ov.querySelectorAll(".pay-btn").forEach((b) => (b.disabled = false)); return; }
          status.textContent = "Prüfe Zahlung …";
          try {
            const r = await fetch(`${cfg.verifyUrl}?ref=${encodeURIComponent(ref)}`, { credentials: "omit" });
            const j = await r.json();
            if (j && j.paid) { unlocked = true; status.textContent = "✓ Bezahlt"; setTimeout(() => close(true), 500); }
            else status.textContent = "Zahlung noch nicht bestätigt – bitte kurz warten und erneut versuchen.";
          } catch (err) { status.textContent = "Zahlung konnte nicht geprüft werden."; }
        };
        window.addEventListener("message", onMsg);
      }));
      (ov.querySelector("[data-skip]") || ov.querySelector(".pay-btn:not([disabled])"))?.focus();
    });
  }

  root.SQPay = { requireUnlock, isLocked: active, isSoft: () => soft && !unlocked, priceChf: cfg.priceChf || "9.90" };
})(typeof self !== "undefined" ? self : this);
