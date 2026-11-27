// Today's verified prices for one medicine as CSV, for anyone who wants to cite or reuse them.
import { DRUGS, DRUG_LIST, listingsFor, type DrugKey } from '../../../lib/data';
export function getStaticPaths() {
  return DRUG_LIST.map((d) => ({ params: { drug: d.key } }));
}
const q = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
export function GET({ params }: { params: { drug: DrugKey } }) {
  const d = DRUGS[params.drug];
  const head = ['provider', ...d.doses.map((x) => `price_${x}`), 'first_year_total', 'subscription', 'checked_at_utc', 'source_url'];
  const rows = listingsFor(d.key).sort((a, b) => a.provider.name.localeCompare(b.provider.name)).map((l) => [
    l.provider.name, ...d.doses.map((x) => l.prices[x] != null ? l.prices[x].toFixed(2) : ''),
    l.firstYear ?? '', l.provider.subscription ? 'yes' : 'no', l.verifiedAt, l.url,
  ].map((v) => q(String(v))).join(','));
  return new Response([head.join(','), ...rows].join('\n') + '\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
}
