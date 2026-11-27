#!/usr/bin/env python3
"""Daily GLP-1 price refresh. Standard library only, no AI.

Reads scraper/sources.json (one row per provider + drug page), fetches each page,
extracts a per-dose price ladder, validates it and writes data/prices.json.

Extraction order, most reliable first:
  1. Platform data: Shopify product JSON, WooCommerce Store API, Woo variation data.
  2. Structured data in the page: JSON-LD offers, Shopify inline variants,
     embedded app state (__NEXT_DATA__ / __NUXT__ / any JSON blob with mg + price).
  3. Visible text (last resort, marked low confidence).
Rows with method "auto" run the whole ladder; a fixed method runs only that extractor.

Publishing rules:
  * A price is only ever shown with the time it was last verified (verifiedAt).
  * A price that moves more than GUARD_PCT against the last verified value is held
    until the same value is seen on a second run.
  * Low-confidence (text) results must match the previous verified ladder or be seen
    twice before they replace it.
  * Failed fetches keep the old value and old verifiedAt; the site hides anything
    older than STALE_HOURS.

Env:
  SCRAPERAPI_KEY   only for sources with "proxy": true (sites that block datacentre IPs)
  BWM_ONLY         optional provider slug(s), comma separated, for a quick test run
Writes: data/prices.json, data/history/YYYY-MM.jsonl, data/run-report.json
"""
import html as htmlmod
import json
import os
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "scraper" / "sources.json"
PRICES = ROOT / "data" / "prices.json"
HISTORY = ROOT / "data" / "history"
REPORT = ROOT / "data" / "run-report.json"

DOSES = {
    "mounjaro": ["2.5mg", "5mg", "7.5mg", "10mg", "12.5mg", "15mg"],
    "wegovy": ["0.25mg", "0.5mg", "1mg", "1.7mg", "2.4mg", "7.2mg"],
    "wegovy-pill": ["1.5mg", "4mg", "9mg", "25mg"],
}
FLOOR, CEILING = 40.0, 600.0       # plausible monthly price range in GBP
GUARD_PCT = 0.35                   # hold moves bigger than this for a second sighting
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
PRICE_RE = re.compile(r"£\s?([0-9][0-9,]*(?:\.[0-9]{2})?)")
SSL_CTX = ssl.create_default_context()
TRANSIENT = re.compile(r"429|RemoteDisconnected|URLError|timed out|timeout|Connection reset|50[234]", re.I)


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------- fetching
def _get(url, timeout=25):
    last = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Accept-Language": "en-GB,en;q=0.9",
                "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
            })
            with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
                body = r.read().decode("utf-8", "replace")
                if r.status == 200 and len(body) > 150:
                    return body, None
                last = f"http {r.status}"
        except urllib.error.HTTPError as e:
            last = f"http {e.code}"
        except Exception as e:  # network, TLS, timeout
            last = type(e).__name__
        time.sleep(1.0 + attempt)
    return None, last


def via_proxy(url):
    key = os.environ.get("SCRAPERAPI_KEY", "")
    if not key:
        return None, "no proxy key"
    purl = ("https://api.scraperapi.com/?api_key=" + urllib.parse.quote(key)
            + "&country_code=uk&url=" + urllib.parse.quote(url, safe=""))
    return _get(purl, timeout=70)


def fetch(url, proxy=False):
    """Direct first (free). Sources marked proxy, or any direct failure such as a
    rate limit or bot block, go through ScraperAPI's UK residential pool."""
    if proxy:
        body, err = via_proxy(url)
        if body:
            return body, None, "proxy"
    body, err = _get(url)
    if body:
        return body, None, "direct"
    if not proxy:
        pbody, perr = via_proxy(url)
        if pbody:
            return pbody, None, "proxy-fallback"
        err = f"{err}; proxy: {perr}"
    return None, err, "direct"


# ---------------------------------------------------------------- helpers
def dose_re(d):
    n = d.replace("mg", "").strip()
    tail = r"(?:\.0)?" if "." not in n else ""     # "1.0mg" is the same dose as "1mg"
    return re.compile(r"(?<![\d.])" + re.escape(n) + tail + r"\s*mg", re.I)


def to_price(v, pence=False):
    try:
        f = float(str(v).replace(",", "").replace("£", "").strip())
    except (TypeError, ValueError):
        return None
    if pence:
        f /= 100.0
    return round(f, 2)


def assign(pairs, doses):
    """pairs: (label, price, was_price). Cheapest price per dose wins."""
    out, was = {}, {}
    for label, pr, wp in pairs:
        if pr is None or not (FLOOR <= pr <= CEILING):
            continue
        hits = [d for d in doses if dose_re(d).search(label or "")]
        if len(hits) != 1:
            continue
        d = hits[0]
        if d not in out or pr < out[d]:
            out[d] = pr
            if wp and wp > pr + 0.5:
                was[d] = wp
            else:
                was.pop(d, None)
    return out, was


def strip_html(h):
    h = re.sub(r"<(script|style|noscript)[\s\S]*?</\1>", " ", h, flags=re.I)
    h = re.sub(r"<[^>]+>", " ", h)
    return re.sub(r"\s+", " ", htmlmod.unescape(h))


def walk(node):
    stack = [node]
    while stack:
        n = stack.pop()
        if isinstance(n, dict):
            yield n
            stack.extend(n.values())
        elif isinstance(n, list):
            stack.extend(n)


# ---------------------------------------------------------------- extractors
def ex_shopify(body, doses):
    v = (json.loads(body).get("product") or {}).get("variants") or []
    return assign([(x.get("title", ""), to_price(x.get("price")),
                    to_price(x.get("compare_at_price"))) for x in v], doses)


def ex_wcapi(body, doses):
    pairs = []
    for x in json.loads(body) or []:
        p = x.get("prices") or {}
        unit = 10 ** int(p.get("currency_minor_unit", 2))
        label = " ".join(str(a.get("value", "")) for a in x.get("variation", [])) \
            if isinstance(x.get("variation"), list) else str(x.get("variation", "") or x.get("name", ""))
        pr = to_price(p.get("price")); rp = to_price(p.get("regular_price"))
        pairs.append((label, pr / unit if pr is not None else None, rp / unit if rp else None))
    return assign(pairs, doses)


def ex_woo(body, doses):
    m = re.search(r'data-product_variations=(["\'])(.*?)\1', body, re.S)
    raw = htmlmod.unescape(m.group(2)) if m else None
    if not raw:
        m = re.search(r"product_variations\s*[:=]\s*(\[[\s\S]*?\])\s*[,;<]", body)
        raw = m.group(1) if m else None
    if not raw:
        return {}, {}
    pairs = []
    for x in json.loads(raw):
        label = " ".join(str(v) for v in (x.get("attributes") or {}).values())
        pr = to_price(x.get("display_price")) or to_price(x.get("display_regular_price"))
        pairs.append((label, pr, to_price(x.get("display_regular_price"))))
    return assign(pairs, doses)


def ex_jsonld(body, doses, prefer_list=False):
    """prefer_list: when an offer carries a StrikethroughPrice (e.g. the price before a
    promo code), publish that list price instead of the discounted one."""
    pairs = []
    for m in re.finditer(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', body, re.S | re.I):
        try:
            data = json.loads(m.group(1).strip())
        except Exception:
            continue
        for n in walk(data):
            offers = n.get("offers")
            if offers is None:
                continue
            for off in offers if isinstance(offers, list) else [offers]:
                if not isinstance(off, dict):
                    continue
                for o in [off] + list(off.get("offers") or []) if isinstance(off.get("offers"), list) else [off]:
                    pr = o.get("price") or o.get("lowPrice")
                    if pr is None and isinstance(o.get("priceSpecification"), dict):
                        pr = o["priceSpecification"].get("price")
                    if prefer_list and isinstance(o.get("priceSpecification"), dict):
                        for c in o["priceSpecification"].get("priceComponent") or []:
                            if isinstance(c, dict) and str(c.get("priceType", "")).endswith("StrikethroughPrice"):
                                pr = c.get("price")
                    label = str(o.get("name") or o.get("sku") or n.get("name") or "")
                    pairs.append((label, to_price(pr), None))
    return assign(pairs, doses)


def ex_shopify_inline(body, doses):
    pairs = []
    for m in re.finditer(r'\{[^{}]*?"(?:public_title|title)":"([^"]*?mg[^"]*?)"[^{}]*?\}', body, re.I):
        obj = m.group(0)
        pm = re.search(r'"price":(\d+)', obj)
        cm = re.search(r'"compare_at_price":(\d+)', obj)
        if pm:
            pairs.append((m.group(1), to_price(pm.group(1), pence=True),
                          to_price(cm.group(1), pence=True) if cm else None))
    return assign(pairs, doses)


def ex_embedded(body, doses):
    """Any JSON blob in the page (Next.js, Nuxt, inline state) with mg labels and prices."""
    blobs = []
    m = re.search(r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', body, re.S)
    if m:
        blobs.append(m.group(1))
    for m in re.finditer(r'<script[^>]*type="application/json"[^>]*>(.*?)</script>', body, re.S):
        blobs.append(m.group(1))
    pairs = []
    for b in blobs:
        try:
            data = json.loads(b)
        except Exception:
            continue
        for n in walk(data):
            label = " ".join(str(n.get(k, "")) for k in ("name", "title", "dose", "strength", "label", "variant"))
            if "mg" not in label.lower():
                continue
            for k in ("price", "amount", "salePrice", "monthlyPrice", "unitPrice"):
                if k in n and not isinstance(n[k], (dict, list)):
                    v = to_price(n[k])
                    if v and v > 1000:     # pence
                        v = round(v / 100, 2)
                    pairs.append((label, v, to_price(n.get("compareAtPrice") or n.get("wasPrice"))))
                    break
    return assign(pairs, doses)


def ex_fields(body, doses, label_keys, price_key):
    """Embedded JSON (Next.js etc.) with site-specific keys. label_keys are joined to
    make the dose label (e.g. variant_name + variant_qualifier = "2.5 mg"); price_key
    may hold a number or a sentence such as "then £199 every 4 weeks on this dose"."""
    blobs = [m.group(1) for m in re.finditer(
        r'<script[^>]*(?:id="__NEXT_DATA__"|type="application/json")[^>]*>(.*?)</script>', body, re.S)]
    pairs, seen = [], set()
    for b in blobs:
        try:
            data = json.loads(b)
        except Exception:
            continue
        for n in walk(data):
            if price_key not in n or not all(k in n for k in label_keys):
                continue
            label = " ".join(str(n[k]) for k in label_keys)
            raw = str(n[price_key])
            pm = PRICE_RE.search(raw)
            pr = to_price(pm.group(1)) if pm else to_price(raw)
            if (label, pr) not in seen:
                seen.add((label, pr))
                pairs.append((label, pr, None))
    return assign(pairs, doses)


def ex_text(body, doses, marker="", price_index=0, before=False):
    """price_index: which £ figure after each dose label to take (0 = first). Use 1 on
    tables laid out "dose | weekly | monthly" where the monthly price is second.
    before: the price sits in front of its label ("£154 for 1.5mg"), so take the last £
    figure between the previous dose label and this one."""
    t = strip_html(body)
    if marker:
        ix = t.lower().find(marker.lower())
        if ix >= 0:
            t = t[ix:]
    out = {}
    for d in doses:
        for m in dose_re(d).finditer(t):
            if before:
                start = max(0, m.start() - 200)
                for o in doses:
                    for om in dose_re(o).finditer(t, start, m.start()):
                        start = max(start, om.end())
                found = list(PRICE_RE.finditer(t, start, m.start()))
                pm = found[-1] if found else None
            else:
                end = m.end() + 200
                for o in doses:
                    om = dose_re(o).search(t, m.end())
                    if om:
                        end = min(end, om.start())
                found = list(PRICE_RE.finditer(t, m.end(), end))
                pm = found[price_index] if len(found) > price_index else None
            if pm:
                v = to_price(pm.group(1))
                if v and FLOOR <= v <= CEILING:
                    out[d] = v
                    break
    return out, {}


def ex_pattern(body, doses, pattern, marker="", end=""):
    """Site-specific regex over the visible text, with named groups `dose` and `price`.
    Optional marker/end limit the text to one table. Use when the page has a clear
    per-dose price table but no structured data."""
    t = strip_html(body)
    if marker:
        ix = t.find(marker)
        if ix < 0:
            return {}, {}
        t = t[ix:]
    if end:
        ix = t.find(end, len(marker))
        if ix >= 0:
            t = t[:ix]
    pairs = [(m.group("dose"), to_price(m.group("price")), None) for m in re.finditer(pattern, t)]
    return assign(pairs, doses)


def ex_jsmap(body, doses):
    """Inline script that fills placeholders, e.g. { id: "base-price-m-d-1", price: "£199" },
    with the dose label taken from the element carrying that id: <span id="...">..</span> (2.5mg)."""
    pairs = []
    for m in re.finditer(r'\{\s*id:\s*["\']([^"\']+)["\']\s*,\s*price:\s*["\']£?\s*([0-9][0-9,.]*)["\']\s*\}', body):
        el = re.search(r'id="' + re.escape(m.group(1)) + r'"[^>]*>([\s\S]{0,300})', body)
        if not el:
            continue
        label = strip_html(el.group(1))[:40]
        hit = re.search(r"\d+(?:\.\d+)?\s*mg", label, re.I)   # first dose label after the element
        if hit:
            pairs.append((hit.group(0), to_price(m.group(2)), None))
    return assign(pairs, doses)


def ex_positional(body, doses, price_marker=""):
    t = strip_html(body)
    order = sorted((m.start(), d) for d in doses for m in [dose_re(d).search(t)] if m)
    sec = t[t.lower().find(price_marker.lower()):] if price_marker and price_marker.lower() in t.lower() else t
    prices = [to_price(x) for x in PRICE_RE.findall(sec)][:len(doses)]
    out = {d: prices[i] for i, (_, d) in enumerate(order) if i < len(prices) and prices[i]}
    return {d: v for d, v in out.items() if FLOOR <= v <= CEILING}, {}


STRUCTURED = [("jsonld", ex_jsonld), ("shopify_inline", ex_shopify_inline),
              ("woo", ex_woo), ("embedded", ex_embedded)]
FIXED = {"jsmap": ex_jsmap, "shopify": ex_shopify, "wcapi": ex_wcapi, "woo": ex_woo, "jsonld": ex_jsonld,
         "shopify_inline": ex_shopify_inline, "embedded": ex_embedded,
         "jsonld_list": lambda b, d: ex_jsonld(b, d, prefer_list=True)}
LOW_CONFIDENCE = {"text", "positional"}


def extract(src, body, doses):
    """Returns (prices, was_prices, method_used)."""
    method = src.get("method", "auto")
    if method in FIXED:
        try:
            p, w = FIXED[method](body, doses)
            if len(p) >= 2:
                return p, w, method
        except Exception as e:
            log(f"    {method} parse error: {e}")
        if method in ("shopify", "wcapi"):
            return {}, {}, method
    if method == "fields":
        p, w = ex_fields(body, doses, src.get("labelKeys", []), src.get("priceKey", ""))
        return p, w, "fields"
    if method == "pattern":
        p, w = ex_pattern(body, doses, src["pattern"], src.get("marker", ""), src.get("end", ""))
        return p, w, "pattern"
    if method == "positional":
        p, w = ex_positional(body, doses, src.get("priceMarker", ""))
        return p, w, "positional"
    for name, fn in STRUCTURED:          # auto / html / failed fixed method
        try:
            p, w = fn(body, doses)
        except Exception:
            continue
        if len(p) >= 2:
            return p, w, name
    p, w = ex_text(body, doses, src.get("marker", ""), int(src.get("priceIndex", 0)),
                   bool(src.get("priceBefore")))
    return p, w, "text"


OFFER_RE = re.compile(
    r"((?:save|get|up to)?\s*£\s?\d{1,3}(?:\.\d{2})?\s*off[^.!|<]{0,60}"
    r"|\d{1,2}%\s*off[^.!|<]{0,60})", re.I)


def find_offer(body):
    """Short promo line from the page, e.g. '£20 off your first order'."""
    t = strip_html(body)
    for m in OFFER_RE.finditer(t):
        s = m.group(1).strip(" -–:,")
        if 8 <= len(s) <= 80 and re.search(r"first|order|month|new|code|today|sign", s, re.I):
            return s[0].upper() + s[1:]
    return None


# ---------------------------------------------------------------- validation
def ladder_ok(prices, doses):
    """Higher doses never cheaper than lower ones (allow 50p rounding)."""
    seq = [prices[d] for d in doses if d in prices]
    return all(b >= a - 0.5 for a, b in zip(seq, seq[1:]))


def repair_ladder(prices, doses):
    """If removing exactly one dose makes the ladder valid, drop it (a stray number
    picked up from elsewhere on the page). Otherwise return None: don't guess."""
    if ladder_ok(prices, doses):
        return prices, None
    for d in [x for x in reversed(doses) if x in prices]:
        trial = {k: v for k, v in prices.items() if k != d}
        if len(trial) >= 2 and ladder_ok(trial, doses):
            return trial, d
    return None, None


def merge(prev, new, method, was, offer, url, ts):
    """Decide what to publish. prev is the previous published record (may be None)."""
    rec = dict(prev or {})
    rec["url"] = url
    rec["checkedAt"] = ts
    old = (prev or {}).get("prices") or {}
    pending = (prev or {}).get("pending")

    big_move = any(d in old and old[d] and abs(v - old[d]) / old[d] > GUARD_PCT for d, v in new.items())
    low_conf = method in LOW_CONFIDENCE and old and new != {d: old.get(d) for d in new}
    seen_twice = pending and pending.get("prices") == new

    if (big_move or low_conf) and not seen_twice:
        rec["pending"] = {"prices": new, "method": method, "firstSeen": ts,
                          "reason": "big move" if big_move else "low-confidence change"}
        return rec, "held"
    rec.pop("pending", None)
    rec.update({"prices": new, "method": method, "verifiedAt": ts})
    if was:
        rec["wasPrices"] = was
    else:
        rec.pop("wasPrices", None)
    if offer:
        rec["offer"] = {"text": offer, "verifiedAt": ts}
    elif "offer" in rec:
        rec.pop("offer")       # offer no longer on the page
    return rec, "updated"


# ---------------------------------------------------------------- main
def main():
    sources = json.loads(SOURCES.read_text())
    only = {s for s in os.environ.get("BWM_ONLY", "").split(",") if s}
    store = json.loads(PRICES.read_text()) if PRICES.exists() else {"providers": {}}
    provs = store.setdefault("providers", {})
    ts = now_iso()
    report = {"startedAt": ts, "results": []}
    hist_lines = []

    todo = [src for src in sources if not only or src["provider"] in only]
    # Pass 1 checks everything; pass 2 retries transient failures (rate limits, dropped
    # connections) after a pause, slower, so one busy minute doesn't cost a day's price.
    for attempt, pause in ((1, 1.0), (2, 6.0)):
      if attempt == 2:
        todo = [src for src, r in zip(todo_prev, report["results"][-len(todo_prev):])
                if r["status"] == "fetch-failed" and TRANSIENT.search(r.get("error") or "")]
        if not todo:
            break
        report["results"] = [r for r in report["results"] if not (
            r["status"] == "fetch-failed" and TRANSIENT.search(r.get("error") or ""))]
        log(f"\nRetrying {len(todo)} transient failures after a pause")
        time.sleep(45)
      todo_prev = todo
      for src in todo:
          slug, drug, url = src["provider"], src["drug"], src["url"]
          doses = DOSES[drug]
          body, err, via = fetch(url, src.get("proxy", False))
          res = {"provider": slug, "drug": drug, "url": url, "via": via}
          if not body:
              res.update(status="fetch-failed", error=err)
          else:
              prices, was, method = extract(src, body, doses)
              res["method"] = method
              if len(prices) < 2:
                  res["status"] = "no-prices"
              elif repair_ladder(prices, doses)[0] is None:
                  res.update(status="bad-ladder", prices=prices)
              else:
                  prices, dropped = repair_ladder(prices, doses)
                  if dropped:
                      res["dropped"] = dropped
                  offer = (find_offer(body) if src.get("offer", True) and not body.lstrip().startswith(("{", "[")) else None)
                  prev = provs.get(slug, {}).get(drug)
                  rec, status = merge(prev, prices, method, was, offer, url, ts)
                  provs.setdefault(slug, {})[drug] = rec
                  res.update(status=status, prices=prices)
                  if status == "updated":
                      hist_lines.append(json.dumps({"t": ts[:10], "p": slug, "d": drug, "v": prices},
                                                   separators=(",", ":")))
          if res["status"] not in ("updated",):
              prev = provs.get(slug, {}).get(drug)
              if prev is not None:
                  prev["checkedAt"] = ts
          report["results"].append(res)
          log(f"  {res['status']:13} {slug:28} {drug:11} {res.get('method',''):14} "
              f"{res.get('prices') or res.get('error') or ''}")
          time.sleep(pause)

    store["generatedAt"] = ts
    PRICES.write_text(json.dumps(store, indent=1, ensure_ascii=False, sort_keys=True))
    if hist_lines:
        HISTORY.mkdir(parents=True, exist_ok=True)
        with open(HISTORY / f"{ts[:7]}.jsonl", "a") as f:
            f.write("\n".join(hist_lines) + "\n")

    total = len(report["results"])
    ok = sum(1 for r in report["results"] if r["status"] in ("updated", "held"))
    report.update(finishedAt=now_iso(), total=total, ok=ok,
                  hitRate=round(ok / total, 3) if total else 0,
                  failures=[r for r in report["results"] if r["status"] not in ("updated", "held")],
                  held=[r for r in report["results"] if r["status"] == "held"])
    REPORT.write_text(json.dumps(report, indent=1))
    log(f"\n{ok}/{total} sources OK ({report['hitRate']:.0%}); "
        f"{len(report['held'])} held for review; {len(report['failures'])} failed")


if __name__ == "__main__":
    sys.exit(main())
