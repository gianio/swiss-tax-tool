/*
 * First-visit privacy & terms popup. Must be accepted before the app can be
 * used. Acceptance is remembered locally (localStorage flag only).
 */
(function (root) {
  "use strict";
  const KEY = "est-consent-v1";

  function accepted() {
    try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; }
  }

  function show(force) {
    if (!force && accepted()) return;
    if (document.querySelector(".modal-backdrop.consent")) return;
    const t = document.createElement("template");
    t.innerHTML = `
      <div class="modal-backdrop consent" role="dialog" aria-modal="true" aria-labelledby="cTitle">
        <div class="modal">
          <span class="modal-ico mi mi-shield"></span>
          <h2 id="cTitle">Läuft lokal – Ihre Daten bleiben bei Ihnen</h2>
          <ul class="checklist">
            <li><strong>Kein Upload.</strong> Kontoauszüge, CSV- und PDF-Dateien werden ausschliesslich in Ihrem Browser verarbeitet.</li>
            <li><strong>Nichts wird geteilt.</strong> Keine Registrierung, keine Cookies, kein Tracking, keine Analyse-Dienste, keine Werbung.</li>
            <li><strong>Technisch abgesichert.</strong> Eine Sicherheitsrichtlinie (Content-Security-Policy) verbietet der Seite, Daten an fremde Server zu senden.</li>
            <li><strong>Keine Datenspeicherung.</strong> Weder wir noch Dritte speichern Ihre Dateien oder Angaben. Schliessen Sie den Tab, ist alles weg. Im Browser bleibt nur diese Zustimmung – und, nur wenn Sie es ausdrücklich wählen, ein Bank-Spaltenprofil (Spaltennamen, keine Beträge).</li>
            <li><strong>Transparent:</strong> Wie bei jeder Website sieht der Hosting-Anbieter beim Laden der Seite technisch Ihre IP-Adresse. Nach dem Laden funktioniert die App auch offline.</li>
          </ul>
          <label class="check"><input type="checkbox" id="cAgb"><span>Ich habe die <a href="agb.html" target="_blank" rel="noopener">AGB</a> und die <a href="datenschutz.html" target="_blank" rel="noopener">Datenschutzerklärung</a> gelesen und akzeptiere sie.</span></label>
          <label class="check"><input type="checkbox" id="cTax"><span>Mir ist bewusst, dass dies <strong>keine Steuerberatung</strong> ist, der Steuerauszug kein Dokument meiner Bank ist und ich ihn vor dem Einreichen selbst prüfe (<a href="haftungsausschluss.html" target="_blank" rel="noopener">Haftungsausschluss</a>).</span></label>
          <div class="actions" style="justify-content:flex-end">
            <button class="btn primary" id="cOk" type="button" disabled>Verstanden – loslegen</button>
          </div>
        </div>
      </div>`;
    const ov = t.content.firstElementChild;
    document.body.appendChild(ov);
    const a = ov.querySelector("#cAgb"), b = ov.querySelector("#cTax"), ok = ov.querySelector("#cOk");
    const upd = () => { ok.disabled = !(a.checked && b.checked); };
    a.addEventListener("change", upd); b.addEventListener("change", upd);
    ok.addEventListener("click", () => {
      try { localStorage.setItem(KEY, "1"); } catch (e) { /* private mode: ask again next time */ }
      ov.remove();
    });
    a.focus();
  }

  root.SQConsent = { show, accepted };
})(typeof self !== "undefined" ? self : this);
