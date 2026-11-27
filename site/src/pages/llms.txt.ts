// A short map of the site for AI assistants: what it is, where the data is, how fresh it is.
import { DRUG_LIST, listingsFor, GENERATED_AT, STALE_HOURS } from '../lib/data';
export function GET() {
  const site = 'https://bestweightlossmeds.com';
  const lines = [
    '# Best Weight Loss Meds',
    '',
    `> Independent UK price comparison for prescription weight-loss medicines (Mounjaro, Wegovy, Wegovy pill) at every dose. Prices are read from each provider's own website every morning and only published if confirmed in the last ${STALE_HOURS} hours. No affiliate links, no payment from providers, no medical advice.`,
    '',
    `Last data update: ${GENERATED_AT || 'unknown'}`,
    '',
    '## Prices',
    ...DRUG_LIST.map((d) => `- [${d.name} prices UK](${site}${d.path}): ${listingsFor(d.key).length} providers, every dose.`),
    '',
    '## Trust',
    `- [How we check prices](${site}/uk/how-we-check-prices/): method, freshness rule, what we don't do`,
    `- [Corrections](${site}/uk/corrections/): every published error and the fix`,
    `- [All providers](${site}/uk/providers/)`,
    '',
    'Prices are per pen (four weekly doses) for injections and per 30 tablets for the pill. Consultation and delivery fees vary; the provider confirms the final price. Whether a medicine is suitable is a prescriber\'s decision.',
    '',
  ];
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
