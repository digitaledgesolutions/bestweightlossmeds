# bestweightlossmeds.com

UK price comparison for Mounjaro, Wegovy and the Wegovy pill. Our own code, hosted on Cloudflare Workers. No AI in the pipeline.

```
scraper/   Python (stdlib only). Reads each provider's page daily, validates, writes data/prices.json
data/      prices.json (what the site shows), history/*.jsonl (daily price history), run-report.json
site/      Astro static site + a small Worker (site/worker/index.js) for the private gate and headers
```

## Daily run (free, hands-off)
1. `.github/workflows/daily.yml` runs at 06:07 UTC. The repo is public, so GitHub Actions minutes cost nothing.
2. It tests the extractors, runs `scraper/refresh.py` (pass 2 retries rate-limited sources after a pause), builds the site to catch errors, and commits `data/`.
3. That push triggers **Cloudflare Workers Builds** (connected in the dashboard: root `/site`, build `npm ci && npx astro build`, deploy `npx wrangler deploy`). No API token lives in GitHub.
4. `scraper/alert.py` opens a GitHub issue if under 90% of sources succeed, and closes it when they recover.

Routes `bestweightlossmeds.com/*` and `www.` point at Worker `bestweightlossmeds` (www 301s to the apex).

## Publishing rules
- A price only appears if it was confirmed in the last 48 hours. Every price shows when it was checked.
- Moves over 35%, and changes read from visible text rather than structured data, need a second sighting.
- Higher doses can't be cheaper than lower ones; prices must be £40–£600.
- Offers are shown only while they're on the provider's page.

## Adding a provider
Add it to `scraper/providers.json` (slug, name) and one row per medicine to `scraper/sources.json`.
Use `"method": "auto"` unless you know the platform: `shopify` (`/products/x.json`), `wcapi` (WooCommerce Store API), `woo`, `jsonld`, `shopify_inline`, `embedded`, `positional`. Set `"proxy": true` for sites that block datacentre IPs (uses `SCRAPERAPI_KEY`).

## Public / private switch
`site/wrangler.jsonc`: `PUBLIC=false` keeps the site closed; open it once with `?preview=<PREVIEW_KEY>` (a Worker secret) to get a 30-day cookie. `INDEXABLE=false` sends `noindex` on every response and a blocking robots.txt. Flip each to `"true"` when ready.

## Local
```
cd site && npm ci
BWM_NOW=2026-09-25T13:00:00Z npx astro build   # pretend it's a given time, for testing with old data
echo PREVIEW_KEY=localtest > .dev.vars && npx wrangler dev
```

## Secrets (repo → Settings → Secrets → Actions)
`CF_API_TOKEN` (needs Workers Scripts: Edit), `CF_ACCOUNT_ID`, `SCRAPERAPI_KEY`.
