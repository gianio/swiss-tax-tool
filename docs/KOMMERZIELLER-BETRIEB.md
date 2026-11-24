# Checkliste: kommerzieller Betrieb & Vertrieb

> Orientierungshilfe, keine Rechtsberatung. Die rechtlichen Punkte von einer
> Anwältin / einem Anwalt (IT‑ und Vertragsrecht) bestätigen lassen.

## 1. Wen kontaktieren

| Stelle | Wozu |
|---|---|
| **Anwalt/Anwältin (IT, Vertragsrecht, Datenschutz)** | AGB, Haftungsausschluss, Datenschutzerklärung und Impressum prüfen (Entwürfe liegen in `web/`); Marken‑ und Haftungsfragen; Einschätzung Urkunden‑/Missbrauchsrisiko |
| **Treuhand / Steuerberatung** | Rechtsform (Einzelfirma vs. GmbH), Buchhaltung, MWST, AHV als Selbständige/r |
| **AHV‑Ausgleichskasse (SVA des Kantons)** | Anerkennung als selbständig erwerbend |
| **Handelsregisteramt des Kantons** | Eintrag Pflicht für Einzelfirmen ab CHF 100'000 Umsatz/Jahr (freiwillig früher möglich) |
| **ESTV (MWST)** | MWST‑Pflicht ab CHF 100'000 Umsatz/Jahr (weltweit) |
| **Kantonale Steuerverwaltung(en) / Schweizerische Steuerkonferenz (SSK)** | Ob selbst erstellte, **nicht bank‑signierte** eCH‑0196‑Auszüge zum Import akzeptiert werden; der E‑Steuerauszug wird von SSK und eCH getragen |
| **Hersteller der Steuersoftware (z. B. SofTax)** | Kompatibilitätstest des Imports (XML und Barcode‑PDF) |
| **eCH (ech.ch)** | Nutzungsbedingungen des Standards eCH‑0196; ob es eine Konformitätsprüfung gibt |
| **Zahlungsanbieter** (Payrexx, Datatrans, Stripe …) | Vertrag, KYC, Gebühren; TWINT und Karten; Webhook für die Freischaltung (`web/config.js`) |
| **Hosting‑Anbieter** | Sitz (CH/EU bevorzugt), Dauer der Server‑Logs, Vertrag über die Datenbearbeitung |
| **Versicherung** | Betriebs‑/Berufshaftpflicht mit Deckung für Vermögensschäden |

## 2. Was prüfen

### Marken & Name
- „Swissquote“, „SofTax“, „TWINT“ sind fremde Marken: nur **beschreibend** verwenden („liest Swissquote‑Exporte“), **nicht** im Produktnamen, in der Domain oder im Logo.
- Das Repository und die Domain sollten **nicht** „swissquote“ enthalten → vor dem Launch umbenennen.
- Eigenen Produktnamen auf Swissreg (IGE) recherchieren und ggf. als Marke anmelden.
- TWINT‑ und Kartenlogos nur gemäss den Brand‑Guidelines (bekommt man über den Zahlungsanbieter).

### Open‑Source‑Lizenzen (erledigt, bitte bestätigen lassen)
Alle eingebundenen Komponenten erlauben eine kommerzielle Nutzung:
pdf.js (Apache‑2.0), pdf‑lib (MIT), Pyodide (MPL‑2.0, unverändert ausgeliefert), CPython‑Standardbibliothek (PSF), pdf417gen (MIT), OpenSteuerauszug (MIT, als Vorlage).
Die Pflicht – Lizenztexte mitliefern – ist umgesetzt: `web/vendor/licenses/` und die Seite `web/lizenzen.html`.
Die Code128‑Mustertabelle ist die Normtabelle (ISO/IEC 15417) und wurde gegen reportlab abgeglichen. Dessen Lizenz enthält eine Werbeklausel; da es sich um Normwerte handelt, ist das Risiko gering – kurz anwaltlich bestätigen lassen.

### Datenschutz (DSG / ggf. DSGVO)
- Datenschutzerklärung (Art. 19 DSG) – Entwurf `web/datenschutz.html`.
- Die App speichert keine Finanz‑ oder Personendaten (CSP technisch durchgesetzt). Im Browser bleiben nur die Zustimmung und – nur auf Wunsch – ein Bankprofil mit Spaltennamen.
- Server‑Logs des Hostings angeben (Dauer, Land).
- Werden gezielt Nutzende in der EU angesprochen, zusätzlich die DSGVO beachten.

### Konsumentenrecht, Preise
- Impressum mit vollständiger Identität und E‑Mail (Art. 3 Abs. 1 lit. s UWG) – `web/impressum.html`.
- Preise in CHF, gegebenenfalls inkl. MWST (Preisbekanntgabeverordnung); vor der Zahlung klar angezeigt (umgesetzt im Zahlungsdialog).
- Kein gesetzliches Widerrufsrecht in der CH; Kulanz‑Rückerstattung in den AGB (Ziff. 7).

### Haftung & Missbrauch
- Haftungsbeschränkung (AGB Ziff. 8, Art. 100 OR); keine Haftung für Steuerfolgen.
- Verbot, erzeugte Dokumente als Bankbelege auszugeben (AGB Ziff. 4.3). Jede Seite des Barcode‑PDFs trägt den Hinweis „Selbst erstellt – kein Dokument der Bank“.

### Qualität vor dem Launch
- Mit mehreren echten Auszügen (verschiedene Banken) und in mehreren Kantonen testen, inkl. des Imports in die jeweilige Steuersoftware.
- Bekannte Grenzen dokumentieren: Kapitalmassnahmen, rekonstruierte Anfangsbestände, Fremdwährungen, PDF‑Auszüge anderer Banken (nur CSV oder manuelle Erfassung).
- Support‑Kanal und Versionsangabe.

## 3. Platzhalter in den Rechtstexten
`[Name / Firma]`, `[Rechtsform]`, `[Adresse]`, `[UID]`, `[E‑Mail]`, `[Domain]`, `[Datum]`, `[Hosting‑Anbieter]`, `[Zahlungsdienstleister]`, `[Sitz/Gerichtsstand]`, MWST‑Status – in `agb.html`, `datenschutz.html`, `haftungsausschluss.html`, `impressum.html` und `config.js` ersetzen. Danach die „Entwurf“-Hinweise entfernen.
