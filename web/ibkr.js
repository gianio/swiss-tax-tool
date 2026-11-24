/*
 * Interactive Brokers "Activity Statement" import (CSV and PDF), browser + Node.
 *
 * Both formats are first turned into the same intermediate model, which is
 * then converted into the normalised transaction list that core.js classifies:
 *
 *   - Account Information        → holder name, account number
 *   - Statement period            → Bestand 01.01. from "Prior Quantity"
 *   - Trades (Stocks/ETFs)        → Kauf / Verkauf
 *   - Dividends + Withholding Tax → Dividende (gross, tax withheld)
 *   - Interest (credit)           → Zinsen auf Einlagen
 *   - Cash Report "Ending Cash"   → cash balance per currency
 *   - Financial Instrument Info   → ISIN, name, type per symbol
 *   - Open Positions              → cross-check of the closing quantities
 *
 * The CSV is exact. The PDF is landscape (rotated pages) and puts "Withholding
 * Tax" and "Dividends" side by side, so it is rebuilt line by line from the
 * pdf.js text coordinates (after applying the page rotation) and split into
 * columns where two sections share a row.
 *
 * Exposed as window.SQIbkr (browser) / module.exports (Node).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SQIbkr = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const ISIN = /[A-Z]{2}[A-Z0-9]{9}\d/;
  const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
    september: 9, october: 10, november: 11, december: 12 };
  const STOCKLIKE = /^(stocks?|etfs?|equities|aktien)$/i;
  const SECTIONS = ["Account Information", "Net Asset Value", "Change in NAV", "Mark-to-Market Performance Summary",
    "Realized & Unrealized Performance Summary", "Cash Report", "Open Positions", "Forex Balances", "Trades",
    "Deposits & Withdrawals", "Dividends", "Withholding Tax", "Change in Dividend Accruals", "Interest",
    "Interest Accruals", "Fees", "Corporate Actions", "Transfers", "Financial Instrument Information", "Codes",
    "Notes/Legal Notes", "Other Fees", "Commission Adjustments", "Payment in Lieu of Dividends"];

  function num(s) {
    if (s == null) return null;
    const t = String(s).trim().replace(/,/g, "");
    if (t === "" || t === "--" || t === "-") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  function isoDate(s) {
    const m = String(s || "").match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }
  function parsePeriod(text) {
    const re = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/g;
    const out = [];
    let m;
    while ((m = re.exec(text || "")) && out.length < 2) {
      const mo = MONTHS[m[1].toLowerCase()];
      if (mo) out.push(`${m[3]}-${String(mo).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`);
    }
    if (out.length === 1) out.push(out[0]);
    return out.length ? { from: out[0], to: out[1], text } : null;
  }
  function emptyModel() {
    return { account: {}, period: null, instruments: {}, prior: {}, openPos: {}, trades: [], dividends: [],
      wht: [], interest: [], cash: [], unsupported: new Set() };
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

  function isIbkrCsv(text) {
    const head = String(text || "").slice(0, 4000);
    return /^﻿?Statement,(Header|Data),/m.test(head) && /Interactive Brokers|Activity Statement/i.test(head);
  }

  function modelFromCsv(text) {
    const m = emptyModel();
    const headers = {};
    for (const line of String(text).split(/\r\n|\n|\r/)) {
      if (!line.trim()) continue;
      const r = splitCsv(line.replace(/^﻿/, ""));
      const [section, kind] = r;
      if (kind === "Header") { headers[section] = r.slice(2); continue; }
      if (kind !== "Data") continue;
      const h = headers[section] || [];
      const row = {}; h.forEach((name, i) => { row[name] = r[i + 2] == null ? "" : r[i + 2]; });
      switch (section) {
        case "Statement":
          if (row["Field Name"] === "Period") m.period = parsePeriod(row["Field Value"]);
          break;
        case "Account Information":
          if (row["Field Name"] === "Name") m.account.name = row["Field Value"];
          if (row["Field Name"] === "Account") m.account.number = row["Field Value"];
          if (row["Field Name"] === "Base Currency") m.account.base = row["Field Value"];
          break;
        case "Mark-to-Market Performance Summary":
          if (STOCKLIKE.test(row["Asset Category"] || "") && row.Symbol) m.prior[row.Symbol] = num(row["Prior Quantity"]) || 0;
          else if (row["Asset Category"] && !/forex|total/i.test(row["Asset Category"])) m.unsupported.add(row["Asset Category"]);
          break;
        case "Open Positions":
          if (row.DataDiscriminator === "Summary" && STOCKLIKE.test(row["Asset Category"] || "")) m.openPos[row.Symbol] = num(row.Quantity) || 0;
          break;
        case "Trades":
          if (row.DataDiscriminator !== "Order") break;
          if (!STOCKLIKE.test(row["Asset Category"] || "")) {
            if (!/forex/i.test(row["Asset Category"] || "")) m.unsupported.add(row["Asset Category"]);
            break;
          }
          m.trades.push({ currency: row.Currency, symbol: row.Symbol, date: isoDate(row["Date/Time"]),
            qty: num(row.Quantity), price: num(row["T. Price"]), proceeds: num(row.Proceeds), comm: num(row["Comm/Fee"]) });
          break;
        case "Dividends":
        case "Payment in Lieu of Dividends":
          if (/^total/i.test(row.Currency || "") || !row.Date) break;
          m.dividends.push({ currency: row.Currency, date: isoDate(row.Date), desc: row.Description, amount: num(row.Amount) });
          break;
        case "Withholding Tax":
          if (/^total/i.test(row.Currency || "") || !row.Date) break;
          m.wht.push({ currency: row.Currency, date: isoDate(row.Date), desc: row.Description, amount: num(row.Amount) });
          break;
        case "Interest":
          if (/^total/i.test(row.Currency || "") || !row.Date) break;
          m.interest.push({ currency: row.Currency, date: isoDate(row.Date), desc: row.Description, amount: num(row.Amount) });
          break;
        case "Cash Report":
          if (row["Currency Summary"] === "Ending Cash" && row.Currency && row.Currency !== "Base Currency Summary")
            m.cash.push({ currency: row.Currency, amount: num(row.Total) || 0 });
          break;
        case "Financial Instrument Information":
          if (row.Symbol) m.instruments[row.Symbol] = { isin: (row["Security ID"] || "").match(ISIN) ? row["Security ID"] : "",
            name: row.Description || row.Symbol, type: row.Type || "" };
          break;
        default: break;
      }
    }
    return m;
  }

  // ---- PDF ----------------------------------------------------------------
  // Rebuild visual lines (after page rotation) from pdf.js text items.
  async function pdfLines(buf, pdfjsLib) {
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const pages = [];
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
      lines.forEach((l) => l.items.sort((a, b) => a.x - b.x));
      pages.push(lines);
    }
    return pages;
  }

  // Turn page lines into a flat stream of {section, text, items}, splitting
  // rows where two sections are printed side by side.
  function sectionStream(pages) {
    const out = [];
    let section = "";
    for (const lines of pages) {
      let split = null; // {x, left, right, leftLines, rightLines}
      const flush = () => {
        if (!split) return;
        for (const l of split.leftLines) out.push({ section: split.left, ...l });
        for (const l of split.rightLines) out.push({ section: split.right, ...l });
        section = split.right; split = null;
      };
      for (const line of lines) {
        const text = line.items.map((i) => i.s).join(" ");
        const titles = line.items.filter((i) => SECTIONS.includes(i.s));
        if (titles.length >= 2) {
          flush();
          split = { x: titles[1].x - 4, left: titles[0].s, right: titles[1].s, leftLines: [], rightLines: [] };
          continue;
        }
        if (split) {
          if (SECTIONS.includes(line.items[0].s) && line.items.length === 1) { flush(); section = line.items[0].s; continue; }
          const L = line.items.filter((i) => i.x < split.x), R = line.items.filter((i) => i.x >= split.x);
          if (L.length) split.leftLines.push({ text: L.map((i) => i.s).join(" "), items: L });
          if (R.length) split.rightLines.push({ text: R.map((i) => i.s).join(" "), items: R });
          continue;
        }
        if (SECTIONS.includes(text)) { section = text; continue; }
        out.push({ section, text, items: line.items });
      }
      flush();
    }
    return out;
  }

  function isIbkrText(text) {
    return /Interactive Brokers/i.test(text) && /Activity Statement/i.test(text);
  }

  function modelFromPdfStream(stream, headText) {
    const m = emptyModel();
    m.period = parsePeriod((headText.match(/[A-Za-z]+ \d{1,2}, \d{4} - [A-Za-z]+ \d{1,2}, \d{4}/) || [])[0]);
    const N = String.raw`-?[\d,]*\.?\d+`;
    let sub = "", ccy = "", pendingDate = null;
    // Group stream by section to allow look-around for wrapped cells.
    const bySection = {};
    stream.forEach((l) => (bySection[l.section] = bySection[l.section] || []).push(l));

    for (const l of bySection["Account Information"] || []) {
      let mm;
      if ((mm = l.text.match(/^Name\s+(.+)$/))) m.account.name = mm[1];
      else if ((mm = l.text.match(/^Account\s+(U\w+)$/))) m.account.number = mm[1];
      else if ((mm = l.text.match(/^Base Currency\s+([A-Z]{3})$/))) m.account.base = mm[1];
    }

    sub = "";
    for (const l of bySection["Mark-to-Market Performance Summary"] || []) {
      if (/^(Stocks|Forex|ETFs|Equity and Index Options|Options|Futures|Bonds|Crypto.*)$/.test(l.text)) { sub = l.text; if (!/Stocks|Forex|ETFs/.test(sub)) m.unsupported.add(sub); continue; }
      const mm = l.text.match(new RegExp(`^([A-Z0-9.]+)\\s+(${N})\\s+(${N})\\s`));
      if (mm && STOCKLIKE.test(sub)) m.prior[mm[1]] = num(mm[2]) || 0;
    }

    sub = ""; ccy = "";
    for (const l of bySection["Open Positions"] || []) {
      if (/^(Stocks|ETFs|Forex|Equity and Index Options|Options|Futures|Bonds)$/.test(l.text)) { sub = l.text; continue; }
      if (/^[A-Z]{3}$/.test(l.text)) { ccy = l.text; continue; }
      const mm = l.text.match(new RegExp(`^([A-Z0-9.]+)\\s+(${N})\\s+\\d+\\s`));
      if (mm && STOCKLIKE.test(sub) && !/^Total/.test(l.text)) m.openPos[mm[1]] = num(mm[2]) || 0;
    }

    sub = ""; ccy = ""; pendingDate = null;
    for (const l of bySection["Trades"] || []) {
      const t = l.text;
      if (/^(Stocks|ETFs|Forex|Equity and Index Options|Options|Futures|Bonds|Crypto.*)$/.test(t)) {
        sub = t; if (!/Stocks|ETFs|Forex/.test(sub)) m.unsupported.add(sub); continue;
      }
      if (/^[A-Z]{3}$/.test(t)) { ccy = t; continue; }
      let mm = t.match(/^(\d{4}-\d{2}-\d{2}),?$/);
      if (mm) { pendingDate = mm[1]; continue; }
      if (/^\d{2}:\d{2}:\d{2}$/.test(t) || /^Total/.test(t)) continue;
      mm = t.match(new RegExp(`^([A-Z][A-Z0-9.]*)\\s+(?:(\\d{4}-\\d{2}-\\d{2}),?\\s+(?:\\d{2}:\\d{2}:\\d{2}\\s+)?)?(${N})\\s+(${N})\\s+(${N})\\s+(${N})\\s+(${N})\\s`));
      if (mm && STOCKLIKE.test(sub)) {
        m.trades.push({ currency: ccy, symbol: mm[1], date: mm[2] || pendingDate, qty: num(mm[3]), price: num(mm[4]),
          proceeds: num(mm[6]), comm: num(mm[7]) });
        pendingDate = null;
      }
    }

    // Dividends / Withholding Tax / Interest: one record per line carrying a
    // date and an amount; the description (symbol + ISIN) may wrap onto the
    // neighbouring line.
    const records = (lines, target) => {
      let c = "";
      lines.forEach((l, i) => {
        const t = l.text;
        if (/^[A-Z]{3}$/.test(t)) { c = t; return; }
        if (/^Total/.test(t) || /^Date\b/.test(t)) return;
        const d = t.match(/(\d{4}-\d{2}-\d{2})/);
        const a = t.match(new RegExp(`(${N})\\s*(?:[A-Z]{1,3})?$`));
        if (!d || !a) return;
        let desc = t.replace(d[1], "").replace(new RegExp(`${a[1].replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}\\s*(?:[A-Z]{1,3})?$`), "").trim();
        const near = [lines[i - 1], lines[i + 1]].filter(Boolean).map((x) => x.text);
        if (!/\([A-Z]{2}[A-Z0-9]{9}\d\)/.test(desc)) {
          const hit = near.find((x) => /\([A-Z]{2}[A-Z0-9]{9}\d\)/.test(x) && !/\d{4}-\d{2}-\d{2}/.test(x));
          if (hit) desc = hit + " " + desc;
        }
        target.push({ currency: c, date: d[1], desc: desc.trim(), amount: num(a[1]) });
      });
    };
    records(bySection["Dividends"] || [], m.dividends);
    records(bySection["Payment in Lieu of Dividends"] || [], m.dividends);
    records(bySection["Withholding Tax"] || [], m.wht);
    records(bySection["Interest"] || [], m.interest);

    ccy = "";
    for (const l of bySection["Cash Report"] || []) {
      if (/^Base Currency Summary$/.test(l.text)) { ccy = ""; continue; }
      if (/^[A-Z]{3}$/.test(l.text)) { ccy = l.text; continue; }
      const mm = l.text.match(new RegExp(`^Ending Cash\\s+(${N})`));
      if (mm && ccy) m.cash.push({ currency: ccy, amount: num(mm[1]) || 0 });
    }

    const fii = bySection["Financial Instrument Information"] || [];
    fii.forEach((l, i) => {
      const mm = l.text.match(/^([A-Z][A-Z0-9.]*)\s+(.*?)\s*\d+\s+([A-Z]{2}[A-Z0-9]{9}\d)\s+\S+\s+\S+\s+[\d.]+\s+(\S+)$/);
      if (!mm) return;
      let name = mm[2];
      if (!name) {
        const prev = fii[i - 1] && !ISIN.test(fii[i - 1].text) ? fii[i - 1].text : "";
        const next = fii[i + 1] && !ISIN.test(fii[i + 1].text) && !/^[A-Z][A-Z0-9.]*\s/.test(fii[i + 1].text) ? fii[i + 1].text : "";
        name = (prev + " " + next).trim() || mm[1];
      }
      m.instruments[mm[1]] = { isin: mm[3], name, type: mm[4] };
    });
    return m;
  }

  async function parsePdf(buf, pdfjsLib) {
    const pages = await pdfLines(buf, pdfjsLib);
    const head = pages.slice(0, 1).flat().map((l) => l.items.map((i) => i.s).join(" ")).join("\n");
    if (!isIbkrText(head)) return null;
    return buildResult(modelFromPdfStream(sectionStream(pages), head), "PDF");
  }

  function parseCsv(text) {
    return buildResult(modelFromCsv(text), "CSV");
  }

  // ---- model → transactions ---------------------------------------------
  function buildResult(m, kind) {
    const warnings = [];
    const txns = [];
    const meta = (sym) => {
      const inst = m.instruments[sym] || {};
      let name = inst.name || sym;
      if (/ETF/i.test(inst.type || "") && !/ETF/i.test(name)) name += " ETF";
      return { symbol: sym, isin: inst.isin || "", name };
    };
    const from = m.period && m.period.from, to = m.period && m.period.to;
    const year = from ? +from.slice(0, 4) : null;
    if (!m.trades.length && !m.dividends.length && !Object.keys(m.prior).length)
      throw new Error("Im Interactive-Brokers-Auszug wurden keine Wertschriften gefunden.");

    if (from && /-01-01$/.test(from)) {
      for (const [sym, q] of Object.entries(m.prior)) {
        txns.push({ ...meta(sym), date: from, type: "Bestand 01.01.", quantity: q, unitPrice: null, costs: null, net: null, currency: (m.trades.find((t) => t.symbol === sym) || {}).currency || "USD" });
      }
    } else if (from) {
      warnings.push(`Der Auszug beginnt am ${from}, nicht am 01.01. – Anfangsbestände werden geschätzt. Bitte einen Auszug ab 1. Januar verwenden.`);
    }
    if (to && !/-12-31$/.test(to))
      warnings.push(`Der Auszug endet am ${to}, nicht am 31.12. – Bestände und Kontostände sind nicht die Jahresendwerte. Für den Steuerauszug einen Auszug bis 31. Dezember verwenden.`);

    for (const t of m.trades) {
      if (!t.date || t.qty == null || t.qty === 0) continue;
      const net = r2((t.proceeds || 0) + (t.comm || 0));
      txns.push({ ...meta(t.symbol), date: t.date, type: t.qty > 0 ? "Kauf" : "Verkauf", quantity: Math.abs(t.qty),
        unitPrice: t.price, costs: r2(Math.abs(t.comm || 0)), net, currency: t.currency });
    }

    // Dividends with matching withholding tax (same date + ISIN/symbol).
    const key = (d) => {
      const mm = String(d.desc || "").match(/^([^\s(]+)\s*\(([A-Z]{2}[A-Z0-9]{9}\d)\)/);
      return { sym: mm ? mm[1] : "", isin: mm ? mm[2] : "" };
    };
    const used = new Set();
    for (const d of m.dividends) {
      if (d.amount == null || !d.date) continue;
      const k = key(d);
      let tax = 0;
      m.wht.forEach((w, i) => {
        const wk = key(w);
        if (w.date === d.date && (wk.isin ? wk.isin === k.isin : wk.sym === k.sym) && w.currency === d.currency) { tax += -(w.amount || 0); used.add(i); }
      });
      const sym = k.sym || "?";
      const base = m.instruments[sym] ? meta(sym) : { symbol: sym, isin: k.isin, name: sym };
      if (!base.isin) base.isin = k.isin;
      txns.push({ ...base, date: d.date, type: "Dividende", quantity: null, unitPrice: null,
        costs: Math.round(tax * 100) / 100, net: Math.round((d.amount - tax) * 100) / 100, currency: d.currency });
    }
    m.wht.forEach((w, i) => { if (!used.has(i) && w.amount) warnings.push(`Quellensteuer ohne passende Dividende: ${w.date} ${w.desc} ${w.amount}`); });

    for (const it of m.interest) {
      if (it.amount == null || !it.date) continue;
      if (it.amount <= 0) { warnings.push(`Zinsbelastung ${it.date} (${it.amount} ${it.currency}) ignoriert.`); continue; }
      txns.push({ symbol: "", isin: "", name: "", date: it.date, type: "Zinsen auf Einlagen", quantity: null, unitPrice: null, costs: null, net: it.amount, currency: it.currency });
    }

    for (const c of m.unsupported) warnings.push(`Anlageklasse „${c}“ wird noch nicht unterstützt und ist nicht im Steuerauszug enthalten.`);

    // Cross-check computed closing quantity against "Open Positions".
    const closing = {};
    for (const t of txns) {
      if (!t.symbol) continue;
      if (t.type === "Bestand 01.01.") closing[t.symbol] = (closing[t.symbol] || 0) + t.quantity;
      if (t.type === "Kauf") closing[t.symbol] = (closing[t.symbol] || 0) + t.quantity;
      if (t.type === "Verkauf") closing[t.symbol] = (closing[t.symbol] || 0) - t.quantity;
    }
    for (const [sym, q] of Object.entries(m.openPos)) {
      if (Math.abs((closing[sym] || 0) - q) > 1e-6) warnings.push(`${sym}: berechneter Endbestand ${closing[sym] || 0} ≠ IBKR-Bestand ${q}.`);
    }

    // Chronological, then core.js's newest-first row convention.
    txns.sort((a, b) => a.date.localeCompare(b.date) || (a.type === "Bestand 01.01." ? -1 : 0));
    const n = txns.length;
    txns.forEach((t, i) => { t.row = n - i; t.dateKey = +t.date.replace(/-/g, ""); });

    return {
      transactions: txns,
      balances: m.cash.map((c) => ({ currency: c.currency, amount: r2(c.amount) })),
      account: { holderName: m.account.name || "", customerNumber: m.account.number || "" },
      period: m.period, year, warnings, format: kind, institution: "Interactive Brokers",
    };
  }

  return { isIbkrCsv, parseCsv, parsePdf, _modelFromCsv: modelFromCsv };
});
