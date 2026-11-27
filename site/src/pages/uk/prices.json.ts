// All verified prices as JSON. Same data as the pages, same freshness rule.
// Every price carries where it was read (source.url), how (source.type) and when (checkedAt).
import { DRUG_LIST, listingsFor, GENERATED_AT, STALE_HOURS, SOURCE_LABEL } from '../../lib/data';
const site = 'https://bestweightlossmeds.com';
export function GET() {
  const body = {
    source: `${site}/uk/`,
    generatedAt: GENERATED_AT,
    note: "Published prices read from each provider's own website. Per pen (4 weekly doses) for injections, per 30 tablets for the pill. Confirm the final price with the provider.",
    freshnessRule: `A price is only published if it was read from the provider's own page in the last ${STALE_HOURS} hours. Older prices are removed, not shown.`,
    methodology: `${site}/uk/how-we-check-prices/`,
    corrections: `${site}/uk/corrections/`,
    medicines: Object.fromEntries(DRUG_LIST.map((d) => [d.key, {
      name: d.name, generic: d.generic, doses: d.doses,
      providers: listingsFor(d.key).map((l) => ({
        name: l.provider.name, slug: l.provider.slug, prices: l.prices, firstYearTotal: l.firstYear,
        subscription: l.provider.subscription, checkedAt: l.verifiedAt, url: l.url,
        source: { url: l.url, type: l.sourceType === 'data' ? 'product_data' : 'page_text', description: SOURCE_LABEL[l.sourceType] },
      })),
    }])),
  };
  return new Response(JSON.stringify(body, null, 1), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
