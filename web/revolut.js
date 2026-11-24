/*
 * Revolut (Revolut Securities) stock-trading import: "Account Statement" PDF
 * and the trading CSV export, browser + Node.
 *
 *   PDF: per-currency sections "XXX Account summary" (ending cash value),
 *        "XXX Portfolio breakdown" (year-end positions with ISIN) and
 *        "XXX Transactions" (trades with fees + commission, dividends).
 *   CSV: Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
 *        (no fees, no ISIN, no positions — the PDF is the better source).
 *
 * Revolut shows dividends after the foreign withholding tax. For USD
 * dividends the standard 15 % (form W-8BEN) is assumed and the gross amount
 * reconstructed, so the tax software can compute the DA-1 credit; this is
 * stated as a warning.
 *
 * Exposed as window.SQRevolut (browser) / module.exports (Node).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SQRevolut = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const SYMBOL_CCY = { "US$": "USD", $: "USD", "€": "EUR", "£": "GBP", CHF: "CHF" };
  const US_WHT = 0.15;
  const r2 = (x) => Math.round(x * 100) / 100;
  const r8 = (x) => Math.round(x * 1e8) / 1e8;

  function dmy(d, m, y) {
    const mo = MON[String(m).slice(0, 3).toLowerCase()];
    return mo ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
  }
  // "US$1,000.01" / "-US$1.11" / "€0" / "USD 500" → number
  function money(s) {
    if (s == null) return null;
    const t = String(s).trim();
    if (!t) return null;
    const neg = /^-|^\(|\s-/.test(t);
    const n = Number(t.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n)) return null;
    return neg ? -n : n;
  }

  // ---- shared: events → transactions ------------------------------------
  // event: {date, kind: buy|sell|div|divtax|cash|other, symbol, qty, price,
  //         value (signed cash effect), costs, currency, label}
  function build(ev, opts) {
    const warnings = [];
    const txns = [];
    const names = opts.names || {}, isins = opts.isins || {};
    const years = [...new Set(ev.map((e) => +e.date.slice(0, 4)))].sort();
    // Default: the most recent completed calendar year in the file.
    const done = years.filter((y) => y < (opts.today || new Date()).getFullYear());
    const year = opts.year || (done.length ? done[done.length - 1] : years[years.length - 1]) || null;
    if (!year) throw new Error("Im Revolut-Auszug wurden keine Transaktionen gefunden.");
    if (years.length > 1)
      warnings.push(`Die Datei enthält mehrere Jahre (${years.join(", ")}). Steuerjahr ${year}: frühere Käufe/Verkäufe ergeben den Anfangsbestand, spätere werden ignoriert.`);
    const meta = (sym, ccy) => ({ symbol: sym, isin: isins[sym] || "", name: names[sym] || sym, currency: ccy });

    const opening = {}, cash = {};
    let grossed = 0, grossedTax = 0;
    const corr = {};
    for (const e of ev) {
      const y = +e.date.slice(0, 4);
      if (y > year) continue;
      cash[e.currency] = r2((cash[e.currency] || 0) + (e.value || 0));
      if (y < year) {
        if (e.kind === "buy") opening[e.symbol] = r8((opening[e.symbol] || 0) + e.qty);
        if (e.kind === "sell") opening[e.symbol] = r8((opening[e.symbol] || 0) - e.qty);
        if (opening[e.symbol] != null && !opening[`${e.symbol}\u0000ccy`]) opening[`${e.symbol}\u0000ccy`] = e.currency;
        continue;
      }
      if (e.kind === "buy" || e.kind === "sell") {
        txns.push({ ...meta(e.symbol, e.currency), date: e.date, type: e.kind === "buy" ? "Kauf" : "Verkauf",
          quantity: e.qty, unitPrice: e.price, costs: r2(e.costs || 0), net: r2(e.value), });
      } else if (e.kind === "div") {
        let gross = e.value, tax = 0;
        if (e.currency === "USD" && e.value > 0) {
          gross = r2(e.value / (1 - US_WHT)); tax = r2(gross - e.value);
          grossed += gross; grossedTax += tax;
        }
        txns.push({ ...meta(e.symbol, e.currency), date: e.date, type: "Dividende", quantity: null, unitPrice: null,
          costs: tax, net: r2(gross - tax) });
      } else if (e.kind === "divtax") {
        const k = `${e.symbol} ${e.currency}`;
        corr[k] = r2((corr[k] || 0) + e.value);
      } else if (e.kind === "other") {
        warnings.push(`${e.date} ${e.symbol || ""} „${e.label}“ wird nicht automatisch verarbeitet – bitte prüfen.`);
      }
    }
    for (const [k, v] of Object.entries(corr)) {
      if (v) warnings.push(`Quellensteuer-Korrektur ${k}: ${v} – nicht automatisch verbucht, bitte prüfen.`);
    }
    if (grossed)
      warnings.push(`Revolut weist Dividenden nach Abzug der US-Quellensteuer aus. Angenommen wurden 15 % (Formular W‑8BEN): brutto USD ${r2(grossed)}, Quellensteuer USD ${r2(grossedTax)}. Bitte mit dem Revolut-Steuerbericht abgleichen.`);

    for (const [sym, q] of Object.entries(opening)) {
      if (sym.includes("\u0000")) continue;
      txns.push({ ...meta(sym, opening[`${sym}\u0000ccy`] || "USD"), date: `${year}-01-01`, type: "Bestand 01.01.",
        quantity: Math.max(0, q), unitPrice: null, costs: null, net: null });
    }

    // Year-end positions from the PDF fix the closing quantity; check them.
    const run = {};
    for (const t of txns) {
      if (t.type === "Bestand 01.01.") run[t.symbol] = r8((run[t.symbol] || 0) + t.quantity);
      if (t.type === "Kauf") run[t.symbol] = r8((run[t.symbol] || 0) + t.quantity);
      if (t.type === "Verkauf") run[t.symbol] = r8((run[t.symbol] || 0) - t.quantity);
    }
    if (opts.positions) {
      for (const p of opts.positions) {
        txns.push({ ...meta(p.symbol, p.currency), date: `${year}-12-31`, type: "Bestand 31.12.", quantity: p.qty,
          unitPrice: null, costs: null, net: null });
        if (Math.abs((run[p.symbol] || 0) - p.qty) > 1e-6)
          warnings.push(`${p.symbol}: berechneter Endbestand ${run[p.symbol] || 0} ≠ Revolut-Bestand ${p.qty}.`);
      }
      for (const [sym, q] of Object.entries(run)) {
        if (Math.abs(q) > 1e-6 && !opts.positions.some((p) => p.symbol === sym))
          warnings.push(`${sym}: berechneter Endbestand ${q}, im Auszug aber keine Position per Jahresende.`);
      }
    }

    const noIsin = [...new Set(txns.filter((t) => t.symbol && !t.isin).map((t) => t.symbol))];
    if (noIsin.length)
      warnings.push(`Ohne ISIN (Revolut nennt sie nur für Positionen per Jahresende): ${noIsin.join(", ")}. Die Steuersoftware ordnet diese Titel über den Namen zu – bitte dort prüfen.`);

    txns.sort((a, b) => a.date.localeCompare(b.date) || (a.type === "Bestand 01.01." ? -1 : 0) || (b.type === "Bestand 31.12." ? -1 : 0));
    const n = txns.length;
    txns.forEach((t, i) => { t.row = n - i; t.dateKey = +t.date.replace(/-/g, ""); });

    const balances = opts.balances || Object.entries(cash).map(([currency, amount]) => ({ currency, amount: r2(amount) }))
      .filter((b) => b.amount >= 0);
    return { transactions: txns, balances, account: opts.account || { holderName: "", customerNumber: "" },
      period: opts.period || null, year, warnings: warnings.concat(opts.warnings || []), format: opts.format,
      institution: "Revolut Securities Europe UAB" };
  }

  // ---- CSV --------------------------------------------------------------
  function splitCsv(line) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === "," && !q) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out.map((v) => v.trim());
  }
  function isRevolutCsv(text) {
    const first = String(text || "").replace(/^﻿/, "").split(/\r?\n/, 1)[0];
    return /\bTicker\b/i.test(first) && /Price per share/i.test(first) && /Total Amount/i.test(first);
  }
  function kindOf(type) {
    const t = String(type || "").toUpperCase();
    if (/^BUY\b/.test(t)) return "buy";
    if (/^SELL\b/.test(t)) return "sell";
    if (/^DIVIDEND TAX/.test(t)) return "divtax";
    if (/^DIVIDEND/.test(t)) return "div";
    if (/^CASH (TOP-UP|WITHDRAWAL)|^TRANSFER|^TOP-UP|^WITHDRAWAL/.test(t)) return "cash";
    return "other";
  }
  function parseCsv(text, opts) {
    const lines = String(text).replace(/^﻿/, "").split(/\r\n|\n|\r/).filter((l) => l.trim());
    const h = splitCsv(lines[0]).map((x) => x.toLowerCase());
    const col = (name) => h.indexOf(name);
    const iD = col("date"), iS = col("ticker"), iT = col("type"), iQ = col("quantity"), iP = col("price per share"),
      iA = col("total amount"), iC = col("currency");
    const ev = [];
    for (const line of lines.slice(1)) {
      const r = splitCsv(line);
      const date = (r[iD] || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const kind = kindOf(r[iT]);
      const amount = money(r[iA]) || 0;
      const qty = Math.abs(money(r[iQ]) || 0);
      // CSV amounts are unsigned for trades: buys cost cash, sells bring cash.
      let value = amount;
      if (kind === "buy") value = -Math.abs(amount);
      if (kind === "sell") value = amount; // may be negative (fee-only residual sale)
      ev.push({ date, kind, symbol: r[iS] || "", qty, price: money(r[iP]), value, costs: 0,
        currency: (r[iC] || "").toUpperCase() || "USD", label: r[iT] });
    }
    const res = build(ev, Object.assign({ format: "CSV" }, opts || {}));
    res.warnings.push("Der Revolut-CSV-Export enthält keine Gebühren, keine ISIN und keine Jahresendbestände. Genauer ist das PDF „Account Statement“ für das Steuerjahr.");
    return res;
  }

  // ---- PDF ----------------------------------------------------------------
  async function pdfLines(buf, pdfjsLib) {
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const t = pdfjsLib.Util.transform(vp.transform, it.transform);
        items.push({ x: t[4], y: t[5], s: it.str.trim() });
      }
      items.sort((a, b) => a.y - b.y || a.x - b.x);
      const lines = [];
      for (const it of items) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(last.y - it.y) <= 2.5) last.items.push(it);
        else lines.push({ y: it.y, items: [it] });
      }
      for (const l of lines) out.push(l.items.sort((a, b) => a.x - b.x).map((i) => i.s).join(" "));
    }
    return out;
  }

  const M = String.raw`-?(?:US\$|\$|€|£|CHF ?)-?[\d,]*\.?\d+`;
  function isRevolutText(text) {
    return /Revolut/i.test(text) && /Account Statement/i.test(text) && /Portfolio breakdown/i.test(text);
  }
  function fromLines(lines) {
    const text = lines.join("\n");
    const per = text.match(/Period\s+(\d{1,2}) (\w{3}) (\d{4})\s*-\s*(\d{1,2}) (\w{3}) (\d{4})/);
    const period = per ? { from: dmy(per[1], per[2], per[3]), to: dmy(per[4], per[5], per[6]), text: per[0].replace(/^Period\s+/, "") } : null;
    const account = {
      holderName: ((text.match(/Account name\s+(.+)/) || [])[1] || "").trim(),
      customerNumber: ((text.match(/Account number\s+(\S+)/) || [])[1] || "").trim(),
    };
    const ev = [], positions = [], names = {}, isins = {}, balances = [], warnings = [];
    let sec = "", ccy = "";
    const reTx = new RegExp(`^(\\d{1,2}) (\\w{3}) (\\d{4}) \\d{2}:\\d{2}(?::\\d{2})? \\w+\\s+(?:([A-Z][A-Z0-9.]*)\\s+)?(.+)$`);
    const reTrade = new RegExp(`^Trade - [A-Za-z ]+?\\s+([\\d.,]+)\\s+(${M})\\s+(Buy|Sell)\\s+(${M})\\s+(${M})\\s+(${M})$`);
    const reOther = new RegExp(`^(.+?)\\s+(${M})\\s+(${M})\\s+(${M})$`);
    const rePos = new RegExp(`^([A-Z][A-Z0-9.]*)\\s+(.+?)\\s+([A-Z]{2}[A-Z0-9]{9}\\d)\\s+([\\d.,]+)\\s+(${M})\\s+(${M})\\s+[\\d.]+%$`);
    for (const l of lines) {
      let mm = l.match(/^([A-Z]{3}) (Account summary|Portfolio breakdown|Transactions)$/);
      if (mm) { ccy = mm[1]; sec = mm[2]; continue; }
      if (sec === "Account summary") {
        mm = l.match(new RegExp(`^Cash value\\*?\\s+(${M})\\s+(${M})$`));
        if (mm) balances.push({ currency: ccy, amount: money(mm[2]) });
      } else if (sec === "Portfolio breakdown") {
        mm = l.match(rePos);
        if (mm && ISIN.test(mm[3])) {
          positions.push({ symbol: mm[1], qty: money(mm[4]), currency: ccy });
          names[mm[1]] = mm[2]; isins[mm[1]] = mm[3];
        }
      } else if (sec === "Transactions") {
        mm = l.match(reTx);
        if (!mm) continue;
        const date = dmy(mm[1], mm[2], mm[3]);
        const symbol = mm[4] || "", rest = mm[5];
        let t = rest.match(reTrade);
        if (t) {
          const side = t[3] === "Buy" ? "buy" : "sell", value = money(t[4]), costs = (money(t[5]) || 0) + (money(t[6]) || 0);
          ev.push({ date, kind: side, symbol, qty: money(t[1]), price: money(t[2]),
            value: side === "buy" ? -Math.abs(value) : value, costs, currency: ccy, label: "Trade" });
          continue;
        }
        t = rest.match(reOther);
        if (t) {
          const label = t[1].trim(), kind = kindOf(label);
          ev.push({ date, kind, symbol, qty: null, price: null, value: money(t[2]), costs: (money(t[3]) || 0) + (money(t[4]) || 0),
            currency: ccy, label });
        } else warnings.push(`Zeile nicht erkannt: ${l}`);
      }
    }
    // A statement that starts on the account opening date has no prior holdings.
    if (period && period.from && !/-01-01$/.test(period.from))
      warnings.push(`Der Auszug beginnt am ${period.from}. Falls das Depot schon vorher Positionen hatte, bitte einen Auszug ab 1. Januar verwenden.`);
    if (period && period.to && !/-12-31$/.test(period.to))
      warnings.push(`Der Auszug endet am ${period.to}, nicht am 31.12. – Bestände und Kontostände sind nicht die Jahresendwerte.`);
    const year = period && period.to ? +period.to.slice(0, 4) : null;
    const used = new Set(ev.map((e) => e.currency).concat(positions.map((p) => p.currency)));
    const bal = balances.filter((b) => b.amount || used.has(b.currency));
    return build(ev, { format: "PDF", period, account, names, isins, balances: bal,
      positions: period && /-12-31$/.test(period.to || "") ? positions : null, year, warnings });
  }

  async function parsePdf(buf, pdfjsLib) {
    const lines = await pdfLines(buf, pdfjsLib);
    if (!isRevolutText(lines.join("\n"))) return null;
    return fromLines(lines);
  }

  return { isRevolutCsv, parseCsv, parsePdf, _fromLines: fromLines };
});
