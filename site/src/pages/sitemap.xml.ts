import sources from '../../../scraper/sources.json';
import { DRUG_LIST, listingsFor, listingsForProvider, latestCheck, GENERATED_AT } from '../lib/data';
// lastmod = when that page's prices were last confirmed, not the build time, so it only moves
// when the data behind the page does. Pages with no dated data carry no lastmod.
export function GET() {
  const site = 'https://bestweightlossmeds.com';
  const providers = [...new Set((sources as any[]).map((s) => s.provider))];
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
  const urls: [string, string | null][] = [
    ['/uk/', day(GENERATED_AT)],
    ...DRUG_LIST.map((d) => [d.path, day(latestCheck(listingsFor(d.key)))] as [string, string | null]),
    ['/uk/price-lists/', day(GENERATED_AT)],
    ['/uk/providers/', day(GENERATED_AT)],
    ['/uk/how-we-check-prices/', null],
    ['/uk/corrections/', null],
    ...providers.map((p) => [`/uk/providers/${p}/`, day(latestCheck(listingsForProvider(p)))] as [string, string | null]),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, m]) => `<url><loc>${site}${u}</loc>${m ? `<lastmod>${m}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}
