// All verified prices as JSON. Same data as the pages, same 48-hour freshness rule.
import { DRUG_LIST, listingsFor, GENERATED_AT } from '../../lib/data';
export function GET() {
  const body = {
    source: 'https://bestweightlossmeds.com/uk/',
    generatedAt: GENERATED_AT,
    note: "Published prices read from each provider's own website. Per pen (4 weekly doses) for injections, per 30 tablets for the pill. Confirm the final price with the provider.",
    medicines: Object.fromEntries(DRUG_LIST.map((d) => [d.key, {
      name: d.name, generic: d.generic, doses: d.doses,
      providers: listingsFor(d.key).map((l) => ({
        name: l.provider.name, slug: l.provider.slug, prices: l.prices, firstYearTotal: l.firstYear,
        subscription: l.provider.subscription, checkedAt: l.verifiedAt, url: l.url,
      })),
    }])),
  };
  return new Response(JSON.stringify(body, null, 1), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
