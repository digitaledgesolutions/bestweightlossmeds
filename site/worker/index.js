// Edge gate for bestweightlossmeds.com. Serves the static build from ./dist.
//
// While PUBLIC !== "true" the site is private: visitors need the preview cookie,
// which they get once by opening any URL with ?preview=<PREVIEW_KEY>.
// While INDEXABLE !== "true" every response tells search engines not to index.
// With PREVIEW_KEY unset and PUBLIC unset the site stays closed (fails safe).

const REDIRECTS = new Map([
  ['/', '/uk/'],
  ['/mounjaro-injections-compared/', '/uk/mounjaro/'],
  ['/wegovy-discount-codes/', '/uk/wegovy/'],
  ['/mounjaro-discount-codes/', '/uk/mounjaro/'],
  ['/saxenda-discount-codes/', '/uk/'],
  ['/fr/', '/uk/'],
  ['/fr', '/uk/'],
  ['/uk', '/uk/'],
  ['/wp-admin', '/uk/'],
  ['/wp-login.php', '/uk/'],
  ['/admin', '/uk/'],
  ['/admin/', '/uk/'],
  ['/weight-loss-injections-uk-compared/', '/uk/'],
  ['/yoyo-weight-gain-risk-calculator/', '/uk/'],
  ['/privacy-policy/', '/uk/privacy/'],
  ['/uk/wegovy-pill', '/uk/wegovy-pill/'],
]);
const COOKIE = 'bwm_preview';
// [name, pattern, kind]: 'user' = fetched live to answer someone's question; 'search' = indexing for citations.
const AI_AGENTS = [
  ['ChatGPT-User', /ChatGPT-User/i, 'user'], ['Claude-User', /Claude-User/i, 'user'],
  ['Perplexity-User', /Perplexity-User/i, 'user'], ['MistralAI-User', /MistralAI-User/i, 'user'],
  ['OAI-SearchBot', /OAI-SearchBot/i, 'search'], ['Claude-SearchBot', /Claude-SearchBot/i, 'search'],
  ['PerplexityBot', /PerplexityBot/i, 'search'], ['Bingbot', /bingbot/i, 'search'], ['Googlebot', /Googlebot/i, 'search'],
];
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function withHeaders(res, env, extra = {}) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY)) h.set(k, v);
  if (env.INDEXABLE !== 'true') h.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

function closed(env) {
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Best Weight Loss Meds</title><style>body{font:17px/1.5 system-ui,sans-serif;color:#14211e;display:grid;place-items:center;min-height:100vh;margin:0;padding:1.5rem}h1{font-size:1.6rem;margin:0 0 .4rem;letter-spacing:-.02em}p{color:#5b6b67;margin:0}</style></head><body><main><h1>Best Weight Loss Meds</h1><p>This site isn't open yet.</p></main></body></html>`;
  return withHeaders(new Response(html, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }), env);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.href, 301);
    }

    if (url.pathname === '/robots.txt' && env.INDEXABLE !== 'true') {
      return withHeaders(new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } }), env);
    }

    if (env.PUBLIC !== 'true') {
      const key = env.PREVIEW_KEY;
      if (!key) return closed(env);
      const token = await sha256('bwm:' + key);
      const given = url.searchParams.get('preview');
      if (given !== null) {
        if (given !== key) return closed(env);
        url.searchParams.delete('preview');
        return withHeaders(new Response(null, { status: 302, headers: { Location: url.pathname + url.search } }), env, {
          'Set-Cookie': `${COOKIE}=${token}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`,
          'Cache-Control': 'no-store',
        });
      }
      const cookie = req.headers.get('Cookie') || '';
      if (!cookie.split(/;\s*/).includes(`${COOKIE}=${token}`)) return closed(env);
    }

    const to = REDIRECTS.get(url.pathname);
    if (to) return withHeaders(Response.redirect(new URL(to, url).href, 301), env);

    // Log AI assistants fetching pages live for a user (and AI search crawlers) to Workers Logs,
    // so we can see who checks which prices. No IPs or cookies are logged.
    const ua = req.headers.get('User-Agent') || '';
    const ai = AI_AGENTS.find(([, re]) => re.test(ua));
    if (ai) console.log(JSON.stringify({ event: 'ai_fetch', agent: ai[0], kind: ai[2], path: url.pathname }));

    const res = await env.ASSETS.fetch(req);
    const isAsset = /\.(woff2|svg|png|ico)$/.test(url.pathname);
    return withHeaders(res, env, {
      // Gated pages stay out of shared caches; public pages cache briefly (prices change daily).
      'Cache-Control': isAsset ? 'public, max-age=31536000, immutable'
        : env.PUBLIC === 'true' ? 'public, max-age=300, must-revalidate' : 'private, max-age=0, must-revalidate',
    });
  },
};
