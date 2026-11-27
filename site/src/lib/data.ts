// Build-time data. Everything here runs once per build (daily, after the scrape).
import pricesRaw from '../../../data/prices.json';
import providersRaw from '../../../scraper/providers.json';
import fs from 'node:fs';
import path from 'node:path';

export const STALE_HOURS = 48;
// BWM_NOW lets a preview build pretend it's another moment (for testing with old data).
export const NOW = new Date(process.env.BWM_NOW || Date.now());

export type DrugKey = 'mounjaro' | 'wegovy' | 'wegovy-pill';

export const DRUGS: Record<DrugKey, {
  key: DrugKey; name: string; generic: string; form: string; path: string;
  doses: string[]; startDose: string; schedule: [string, number][];
}> = {
  mounjaro: {
    key: 'mounjaro', name: 'Mounjaro', generic: 'tirzepatide', form: 'Weekly injection pen',
    path: '/uk/mounjaro/', doses: ['2.5mg', '5mg', '7.5mg', '10mg', '12.5mg', '15mg'], startDose: '2.5mg',
    schedule: [['2.5mg', 1], ['5mg', 1], ['7.5mg', 1], ['10mg', 1], ['12.5mg', 1], ['15mg', 7]],
  },
  wegovy: {
    key: 'wegovy', name: 'Wegovy', generic: 'semaglutide', form: 'Weekly injection pen',
    path: '/uk/wegovy/', doses: ['0.25mg', '0.5mg', '1mg', '1.7mg', '2.4mg', '7.2mg'], startDose: '0.25mg',
    schedule: [['0.25mg', 1], ['0.5mg', 1], ['1mg', 1], ['1.7mg', 1], ['2.4mg', 8]],
  },
  'wegovy-pill': {
    key: 'wegovy-pill', name: 'Wegovy pill', generic: 'oral semaglutide', form: 'Daily tablet',
    path: '/uk/wegovy-pill/', doses: ['1.5mg', '4mg', '9mg', '25mg'], startDose: '1.5mg',
    schedule: [['1.5mg', 1], ['4mg', 1], ['9mg', 1], ['25mg', 9]],
  },
};
export const DRUG_LIST = Object.values(DRUGS);

export interface Provider {
  slug: string; name: string; homepage: string; gphc: string; subscription: boolean;
}
export interface Listing {
  provider: Provider; drug: DrugKey; prices: Record<string, number>;
  wasPrices: Record<string, number>; offer: string | null; url: string;
  verifiedAt: string; ageHours: number; firstYear: number | null;
  /** How the price was read: 'data' = the shop's own product data (JSON-LD, Shopify/WooCommerce feed), 'page' = the price as printed on the page. */
  sourceType: 'data' | 'page';
}

// Extractor methods that read the shop's structured product data rather than the visible text.
const DATA_METHODS = new Set(['jsonld', 'jsonld_list', 'shopify', 'shopify_inline', 'woo', 'wcapi', 'embedded', 'fields', 'jsmap']);
export const SOURCE_LABEL: Record<Listing['sourceType'], string> = {
  data: "the provider's product data",
  page: "the price shown on the provider's page",
};

const providers: Provider[] = (providersRaw as any[]).map((p) => ({
  slug: p.slug, name: p.name, homepage: p.homepage || '', gphc: p.gphc || '', subscription: !!p.subscription,
}));
export const PROVIDERS = new Map(providers.map((p) => [p.slug, p]));

// Offers are rewritten into one neutral form that only ever describes the consultation
// service, never a medicine (POMs can't be advertised to the public in the UK).
// Anything that isn't a clear first-time money-off for new patients is dropped:
// newsletter sign-ups, subscription discounts, product promos, freebies.
const DRUG_WORDS = /mounjaro|wegovy|tirzepatide|semaglutide|ozempic|saxenda|zepbound|orlistat|alli|mysimba|inject|pen\b|pill|tablet|jab|glp/i;
export function cleanOffer(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.replace(/\s+/g, ' ');
  if (/newsletter|subscribe|subscription|recurring|every order|refer|app\b|trial/i.test(t)) return null;
  if (!/first|new (customer|patient)s?/i.test(t)) return null;
  const pounds = t.match(/£\s?(\d{1,3})(?![\d.])/);
  const pct = t.match(/(\d{1,2})\s?%/);
  let amount = pounds ? `£${pounds[1]}` : pct ? `${pct[1]}%` : null;
  if (!amount) return null;
  if (/\bup to\s*[£\d]/i.test(t)) amount = `Up to ${amount}`;
  const n = t.match(/first\s+(\d)\s+consultations/i);
  const scope = n ? `your first ${n[1]} consultations` : 'your first consultation';
  const code = t.match(/code:?\s+([A-Z0-9]{4,15})\b/);
  const codeOk = code && !DRUG_WORDS.test(code[1]);
  return `${amount} off ${scope}` + (codeOk ? ` (code ${code![1]})` : '');
}

function hoursSince(iso: string | undefined | null) {
  if (!iso) return Infinity;
  return (NOW.getTime() - new Date(iso).getTime()) / 36e5;
}

function firstYearCost(drug: DrugKey, prices: Record<string, number>) {
  let total = 0;
  for (const [dose, months] of DRUGS[drug].schedule) {
    if (prices[dose] == null) return null;
    total += prices[dose] * months;
  }
  return Math.round(total);
}

// Only fresh, verified listings are ever published.
const allListings: Listing[] = [];
for (const [slug, byDrug] of Object.entries((pricesRaw as any).providers || {})) {
  const provider = PROVIDERS.get(slug);
  if (!provider) continue;
  for (const [drug, rec] of Object.entries(byDrug as Record<string, any>)) {
    if (!(drug in DRUGS) || !rec?.prices) continue;
    const age = hoursSince(rec.verifiedAt);
    if (age > STALE_HOURS) continue;
    const offerAge = hoursSince(rec.offer?.verifiedAt);
    allListings.push({
      provider, drug: drug as DrugKey, prices: rec.prices, wasPrices: {},
      offer: offerAge <= STALE_HOURS ? cleanOffer(rec.offer.text) : null, url: rec.url || provider.homepage,
      verifiedAt: rec.verifiedAt, ageHours: age, firstYear: firstYearCost(drug as DrugKey, rec.prices),
      sourceType: DATA_METHODS.has(rec.method) ? 'data' : 'page',
    });
  }
}

// Outlier guard: a starting-dose price far above everyone else's is almost always a
// multi-pack or bundle read by mistake. Hold it back rather than publish it.
for (const drug of Object.keys(DRUGS) as DrugKey[]) {
  const start = DRUGS[drug].startDose;
  const vals = allListings.filter((l) => l.drug === drug && l.prices[start] != null).map((l) => l.prices[start]).sort((a, b) => a - b);
  if (vals.length < 5) continue;
  const median = vals[Math.floor(vals.length / 2)];
  for (let i = allListings.length - 1; i >= 0; i--) {
    const l = allListings[i];
    if (l.drug === drug && l.prices[start] != null && l.prices[start] > median * 1.8) {
      console.warn(`[outlier] held back ${l.provider.slug} ${drug}: ${l.prices[start]} vs median ${median}`);
      allListings.splice(i, 1);
    }
  }
}

export function listingsFor(drug: DrugKey) {
  return allListings.filter((l) => l.drug === drug);
}
export function listingsForProvider(slug: string) {
  return allListings.filter((l) => l.provider.slug === slug);
}
/** Ranked cheapest-first for one dose; providers without that dose go last. */
export function ranked(drug: DrugKey, dose: string) {
  return listingsFor(drug)
    .filter((l) => l.prices[dose] != null)
    .sort((a, b) => a.prices[dose] - b.prices[dose] || a.provider.name.localeCompare(b.provider.name));
}
export function cheapest(drug: DrugKey, dose: string) {
  return ranked(drug, dose)[0] || null;
}
/** Providers listed on the site: every provider with at least one fresh listing. */
export function liveProviders() {
  const slugs = new Set(allListings.map((l) => l.provider.slug));
  return providers.filter((p) => slugs.has(p.slug)).sort((a, b) => a.name.localeCompare(b.name));
}
export const ALL_PROVIDERS = providers;
export const GENERATED_AT: string | null = (pricesRaw as any).generatedAt || null;

/** Compact payload for the client-side dose picker. */
export function pickerPayload(drug: DrugKey) {
  return listingsFor(drug).map((l) => ({
    s: l.provider.slug, n: l.provider.name, p: l.prices, w: l.wasPrices, o: l.offer,
    u: l.url, t: l.verifiedAt, sub: l.provider.subscription ? 1 : 0, y: l.firstYear,
  }));
}

export const gbp = (v: number, dp = 2) =>
  '£' + v.toLocaleString('en-GB', { minimumFractionDigits: v % 1 && dp ? 2 : 0, maximumFractionDigits: dp });
export const doseLabel = (d: string) => d.replace('mg', ' mg');

export function ago(iso: string) {
  const h = hoursSince(iso);
  if (h < 1) return 'under an hour ago';
  if (h < 24) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago`;
  return `${Math.round(h / 24)} day${Math.round(h / 24) === 1 ? '' : 's'} ago`;
}

// ---------------------------------------------------------------- history
// data/history/YYYY-MM.jsonl: one line per successful price change {t: date, p: slug, d: drug, v: prices}.
type HistPoint = { t: string; v: Record<string, number> };
const HIST = new Map<string, HistPoint[]>();
try {
  const dir = path.resolve(process.cwd(), '../data/history');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl')).sort()) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        const k = `${r.p}|${r.d}`;
        if (!HIST.has(k)) HIST.set(k, []);
        HIST.get(k)!.push({ t: r.t, v: r.v });
      } catch { /* skip bad line */ }
    }
  }
  for (const arr of HIST.values()) arr.sort((a, b) => a.t.localeCompare(b.t));
} catch { /* no history yet */ }

const fmtDay = (t: string) => new Date(t + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** The most recent price change for this listing and dose in the last `days` days, if any. */
export function recentChange(l: Listing, dose: string, days = 14) {
  const arr = HIST.get(`${l.provider.slug}|${l.drug}`) || [];
  const cur = l.prices[dose];
  if (cur == null) return null;
  const cutoff = new Date(NOW.getTime() - days * 864e5).toISOString().slice(0, 10);
  // Walk back to the last point with a different value for this dose.
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i].v[dose];
    if (v == null || Math.abs(v - cur) < 0.005) continue;
    const changedOn = arr[i + 1]?.t;
    if (!changedOn || changedOn < cutoff) return null;
    return { from: v, to: cur, diff: cur - v, on: changedOn, onLabel: fmtDay(changedOn) };
  }
  return null;
}

/** Lowest price for a dose across providers on each day we have history for (carry-forward). */
export function lowestSeries(drug: DrugKey, dose: string, days = 90) {
  const cutoff = new Date(NOW.getTime() - days * 864e5).toISOString().slice(0, 10);
  const series = [...HIST.entries()].filter(([k]) => k.endsWith(`|${drug}`)).map(([, v]) => v);
  const dates = [...new Set(series.flatMap((a) => a.map((p) => p.t)))].sort();
  const out: { t: string; v: number }[] = [];
  for (const t of dates) {
    let min = Infinity;
    for (const a of series) {
      let last: number | undefined;
      for (const p of a) { if (p.t > t) break; if (p.v[dose] != null) last = p.v[dose]; }
      if (last != null && last < min) min = last;
    }
    if (t >= cutoff && min < Infinity) out.push({ t, v: min });
  }
  return out;
}

/** Lowest, typical (median) and highest price for every dose of a drug today. */
export function doseStats(drug: DrugKey) {
  return DRUGS[drug].doses.map((dose) => {
    const r = ranked(drug, dose);
    const vals = r.map((l) => l.prices[dose]);
    const mid = vals.length ? (vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2) : null;
    return {
      dose, n: vals.length, low: vals[0] ?? null, lowBy: r.filter((l) => l.prices[dose] === vals[0]).map((l) => l.provider),
      median: mid, high: vals.at(-1) ?? null, highBy: r.at(-1)?.provider ?? null,
    };
  });
}

export const gmt = (iso: string) => new Date(iso).toLocaleString('en-GB', {
  timeZone: 'Europe/London', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
});
/** Short absolute check time in UK time, e.g. "27 Nov, 06:12". Absolute so a page built in the
 * morning never says "under an hour ago" in the evening. */
export const checkedAt = (iso: string) => new Date(iso).toLocaleString('en-GB', {
  timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});
export const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
/** Newest check time among the given listings (for sitemap lastmod and page dateModified). */
export const latestCheck = (ls: Listing[]) => ls.map((l) => l.verifiedAt).sort().at(-1) || null;
/** Tracked provider pages vs. pages with a price confirmed inside the freshness window. */
export function coverage() {
  const tracked = Object.values((pricesRaw as any).providers || {}).reduce((n: number, byDrug: any) => n + Object.keys(byDrug).length, 0);
  return { tracked, fresh: allListings.length };
}
export const priceCount = () => allListings.reduce((n, l) => n + Object.keys(l.prices).length, 0);

/** URL slug for a dose: "2.5mg" -> "2-5mg". */
export const doseSlug = (d: string) => d.replace('.', '-');
export const dosePath = (drug: DrugKey, d: string) => `${DRUGS[drug].path}${doseSlug(d)}/`;
