import sources from '../../../scraper/sources.json';
import { DRUG_LIST, GENERATED_AT } from '../lib/data';
export function GET() {
  const site = 'https://bestweightlossmeds.com';
  const providers = [...new Set((sources as any[]).map((s) => s.provider))];
  const urls = ['/uk/', '/uk/price-lists/', ...DRUG_LIST.map((d) => d.path), '/uk/providers/', '/uk/how-we-check-prices/',
    ...providers.map((p) => `/uk/providers/${p}/`)];
  const lastmod = (GENERATED_AT || new Date().toISOString()).slice(0, 10);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${site}${u}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}
