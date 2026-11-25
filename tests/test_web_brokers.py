"""Interactive Brokers and Revolut imports (web/ibkr.js, web/revolut.js).

Synthetic fixtures only (sample_data/sample_ibkr_activity.csv,
sample_data/sample_revolut_trading.csv and inline Revolut PDF text lines).
Skipped if Node isn't installed.
"""

import json
import shutil
import subprocess

import pytest

from backend.validation import validate_ech0196
from tests.conftest import ROOT

node = shutil.which("node")
pytestmark = pytest.mark.skipif(node is None, reason="Node.js not available")

CLI = ROOT / "web" / "cli.js"
IBKR_CSV = ROOT / "sample_data" / "sample_ibkr_activity.csv"
REVOLUT_CSV = ROOT / "sample_data" / "sample_revolut_trading.csv"


def _node(script: str) -> str:
    return subprocess.run([node, "-e", script], capture_output=True, check=True, cwd=ROOT, text=True).stdout


def _xml(path) -> str:
    out = subprocess.run([node, str(CLI), str(path), "2025", "ZH"], capture_output=True, check=True).stdout
    result = validate_ech0196(out)
    assert result.valid, result.errors[:10]
    return out.decode()


def test_ibkr_csv_parse():
    r = json.loads(_node(f"""
      const I=require('./web/ibkr.js'), fs=require('fs');
      const t=fs.readFileSync({json.dumps(str(IBKR_CSV))},'utf8');
      console.log(JSON.stringify({{detect:I.isIbkrCsv(t), r:I.parseCsv(t)}}));"""))
    assert r["detect"] is True
    res = r["r"]
    assert res["account"] == {"holderName": "Erika Muster", "customerNumber": "U1234567"}
    assert res["year"] == 2025 and res["warnings"] == []
    assert res["balances"] == [{"currency": "CHF", "amount": 1000}, {"currency": "USD", "amount": 500}]
    by = {(t["type"], t["symbol"]): t for t in res["transactions"]}
    assert by[("Bestand 01.01.", "AAPL")]["quantity"] == 10
    assert by[("Kauf", "NESN")]["net"] == -1615 and by[("Kauf", "NESN")]["costs"] == 5
    div = by[("Dividende", "NESN")]
    assert div["isin"] == "CH0038863350" and div["costs"] == 21.35 and div["net"] == 39.65
    assert by[("Zinsen auf Einlagen", "")]["net"] == 1.23
    assert not any(t["symbol"].startswith("USD.") for t in res["transactions"])  # forex ignored


def test_ibkr_csv_is_xsd_valid():
    xml = _xml(IBKR_CSV)
    assert 'securityCategory="FUND" securityName="VANGUARD TOT WORLD STK ETF" isin="US9220427424"' in xml
    assert 'quantity="15" balanceCurrency="USD" name="Bestand 31.12."' in xml  # AAPL 10 + 5
    assert 'grossRevenueA="61" withHoldingTaxClaim="21.35"' in xml  # Swiss dividend, 35 % VST


def test_ibkr_csv_warnings_for_partial_year_and_mismatch():
    r = json.loads(_node(f"""
      const I=require('./web/ibkr.js'), fs=require('fs');
      let t=fs.readFileSync({json.dumps(str(IBKR_CSV))},'utf8');
      t=t.replace('December 31, 2025','November 23, 2025').replace('Summary,Stocks,USD,VT,10','Summary,Stocks,USD,VT,12');
      console.log(JSON.stringify(I.parseCsv(t).warnings));"""))
    assert any("nicht am 31.12." in w for w in r)
    assert any(w.startswith("VT: berechneter Endbestand 10") for w in r)


def test_revolut_csv_multi_year_and_dividend_gross_up():
    r = json.loads(_node(f"""
      const R=require('./web/revolut.js'), fs=require('fs');
      const t=fs.readFileSync({json.dumps(str(REVOLUT_CSV))},'utf8');
      console.log(JSON.stringify({{detect:R.isRevolutCsv(t), r:R.parseCsv(t,{{today:new Date('2026-03-01')}})}}));"""))
    assert r["detect"] is True
    res = r["r"]
    assert res["year"] == 2025  # most recent completed year, not 2026
    by = {(t["type"], t["symbol"], t["date"]): t for t in res["transactions"]}
    assert by[("Bestand 01.01.", "MSFT", "2025-01-01")]["quantity"] == 1.5  # bought in 2024
    assert not any(t["date"].startswith("2026") for t in res["transactions"])
    ko = by[("Dividende", "KO", "2025-04-01")]
    assert ko["costs"] == 0.70 and ko["net"] == 3.98  # 4.68 gross, 15 % US tax
    assert res["balances"] == [{"currency": "USD", "amount": 656.1}]
    assert any("15 %" in w for w in res["warnings"])


def test_revolut_csv_is_xsd_valid():
    xml = _xml(REVOLUT_CSV)
    assert 'quantity="7.8125" balanceCurrency="USD" name="Bestand 31.12."' in xml


REVOLUT_PDF_LINES = [
    "Account Statement", "Generated on the 05 Jan 2026", "Erika Muster",
    "Musterweg 1 Period 01 Jan 2025 - 31 Dec 2025", "Account name Erika Muster",
    "Bern Account number ABCD1234", "USD Account summary", "Starting Ending",
    "Positions Value US$0 US$700", "Cash value* US$0 US$1,234.50", "Total US$0 US$1,934.50",
    "USD Portfolio breakdown", "Symbol Company ISIN Quantity Price Value % of Portfolio",
    "KO Coca-Cola US1912161007 10 US$70 US$700 100%", "Positions Value US$700 100%",
    "Cash value US$1,234.50 0%", "USD Transactions",
    "Date Symbol Type Quantity Price Side Value Fees Commission",
    "02 Jan 2025 10:00:00 GMT Cash top-up US$2,500 US$0 US$0",
    "21 Jan 2025 14:30:19 GMT KO Trade - Market 10 US$60 Buy US$601 US$0 US$1",
    "05 Feb 2025 14:30:19 GMT NVDA Trade - Limit 2 US$120 Buy US$241 US$0 US$1",
    "01 Apr 2025 16:00:00 GMT KO Dividend US$4.17 US$0 US$0",
    "Date Symbol Type Quantity Price Side Value Fees Commission",
    "10 Sep 2025 14:30:19 GMT NVDA Trade - Market 2 US$200 Sell US$398.33 US$0.02 US$1.65",
    "12 Sep 2025 10:00:00 GMT Cash withdrawal -US$1,000 US$0 US$0",
    "EUR Account summary", "Cash value* €0 €0", "EUR Portfolio breakdown", "EUR Transactions",
]


def test_revolut_pdf_lines():
    res = json.loads(_node(f"""
      const R=require('./web/revolut.js');
      console.log(JSON.stringify(R._fromLines({json.dumps(REVOLUT_PDF_LINES)})));"""))
    assert res["account"] == {"holderName": "Erika Muster", "customerNumber": "ABCD1234"}
    assert res["period"]["from"] == "2025-01-01" and res["year"] == 2025
    assert res["balances"] == [{"currency": "USD", "amount": 1234.5}]  # empty EUR dropped
    by = {(t["type"], t["symbol"]): t for t in res["transactions"]}
    assert by[("Kauf", "KO")]["isin"] == "US1912161007" and by[("Kauf", "KO")]["name"] == "Coca-Cola"
    assert by[("Kauf", "KO")]["net"] == -601 and by[("Kauf", "KO")]["costs"] == 1
    sell = by[("Verkauf", "NVDA")]
    assert sell["quantity"] == 2 and sell["net"] == 398.33 and sell["costs"] == 1.67
    assert by[("Bestand 31.12.", "KO")]["quantity"] == 10
    assert by[("Dividende", "KO")]["costs"] == 0.74 and by[("Dividende", "KO")]["net"] == 4.17
    assert not any("Endbestand" in w or "nicht erkannt" in w for w in res["warnings"])


def test_fx_rates_bundle_and_monthly_rates():
    out = json.loads(_node("""
      const F=require('./web/fx-rates.js'), C=require('./web/core.js');
      const t=[{row:1,dateKey:20250315,date:'2025-03-15',type:'Dividende',symbol:'X',name:'X Corp',isin:'US0378331005',
        quantity:null,unitPrice:null,costs:15,net:85,currency:'USD'}];
      const res=C.classify(t,'CH');
      const xml=C.buildXml(res,{taxYear:2025,canton:'ZH',clientNumber:'1',fxRates:{USD:0.8},fxMonthly:{USD:{'2025-03':0.9}}}).xml;
      console.log(JSON.stringify({ye:F.yearEnd['2025'], src:F.source, xml}));"""))
    assert out["src"].startswith("Schweizerische Nationalbank")
    assert 0.5 < out["ye"]["USD"] < 1.5 and 0.5 < out["ye"]["EUR"] < 1.5
    # The dividend uses the March rate (0.9), not the year-end rate (0.8).
    assert 'exchangeRate="0.9"' in out["xml"] and 'grossRevenueB="90"' in out["xml"]


def test_performance_average_cost():
    out = json.loads(_node("""
      const C=require('./web/core.js');
      const mk=(row,date,type,q,p,net,costs)=>({row,dateKey:+date.replace(/-/g,''),date,type,symbol:'ABC',name:'ABC',
        isin:'US0378331005',quantity:q,unitPrice:p,costs,net,currency:'CHF'});
      const t=[mk(3,'2025-01-10','Kauf',10,100,-1001,1), mk(2,'2025-02-10','Kauf',10,120,-1201,1),
               mk(1,'2025-06-10','Verkauf',5,150,749,1)];
      const res=C.classify(t,'CH');
      console.log(JSON.stringify(C.summarize(res,{taxYear:2025,fxRates:{CHF:1}},[]).performance));"""))
    # avg cost 110 -> 5 * (150 - 110) = 200, minus 3 fees; 15 left at last price 150: 15*150 - 1650 = 600
    assert round(out["realizedChf"], 6) == 197 and round(out["unrealizedChf"], 6) == 600
    assert out["feesChf"] == 3 and out["incomplete"] is False
