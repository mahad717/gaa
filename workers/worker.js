/**
 * ============================================================================
 * WASMO PLATFORM — Cloudflare Worker (Edge Layer)
 * ============================================================================
 * Responsibilities:
 *   1. Age Gate            — edge cookie check + interstitial for HTML routes
 *   2. Signed HLS tokens   — HMAC-SHA256 tokens, 10-min TTL, slug-bound
 *   3. Media gateway       — token + Referer/Origin validation on .m3u8/.ts,
 *                            playlist URL rewriting, hotlink protection
 *   4. SEO/AEO metadata    — dynamic OG/Twitter meta injection on video pages
 *   5. /sitemap.xml        — Google video sitemap generated from Supabase
 *   6. Edge caching        — Cache API + stale-while-revalidate → near-zero TTFB
 *
 * Configuration (wrangler):
 *   wrangler secret put SIGNING_SECRET      # HMAC key for tokens
 *   wrangler secret put SUPABASE_ANON_KEY   # or keep as plain var (public-safe)
 *   wrangler secret put STREAM_TOKEN        # only if using CF Stream signed URLs
 * ============================================================================
 */

const AGE_COOKIE = 'wv_age_ok';
// Bump on deploy-affecting changes (JSON-LD format, header set, meta rules) so
// per-colo Cache API entries from previous code versions stop being served.
const CACHE_BUILD = 'v3';

/* ────────────────── Affiliate offers (Adultforce) ──────────────────
 * 1. Sign up at Adultforce → Offers → copy the "Tracking Link"
 * 2. Paste it as `url` below (replace the placeholder)
 * 3. Redeploy — the public /go/<id> links NEVER change, so old posts/ads
 *    keep working when you swap the destination or rotate offers.
 * Set age_gate:true to render the offer as a native card on the age-gate.
 */
const OFFERS = {
  'cams-free': {
    url: 'https://www.adultforce.com/', // ← TODO: paste real Adultforce tracking URL
    title: 'Free Live Cams',
    subtitle: 'Thousands of models online right now — join free',
    cta: '🔥 Watch Free Cams',
    age_gate: true,
  },
  // 'offer-2': { url: '…', title: '…', subtitle: '…', cta: '…', age_gate: false },
};
// Sponsored-label toggle: '' = undisclosed (default), e.g. 'Sponsored' to disclose.
const AFF_LABEL = '';
const AGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

const DEFAULT_ENV = {
  SITE_URL: 'https://wasmo.site',
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  SIGNING_SECRET: 'dev-only-insecure-change-me',
  STREAM_BASE_URL: '', // e.g. https://customer-<code>.cloudflarestream.com
  ALLOWED_ORIGINS: 'https://wasmo.site,https://www.wasmo.site',
  TOKEN_TTL_SECONDS: '600', // 10 minutes
  ALLOW_EMPTY_REFERER: 'false',
  HTML_CACHE_TTL: '300',
  SITEMAP_CACHE_TTL: '3600',
};

/* ─────────────────────────── Utilities ─────────────────────────── */

const b64urlEncode = (input) => {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const b64urlDecode = (str) => {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

async function hmacSign(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return b64urlEncode(new Uint8Array(sig));
}

/** Constant-time string comparison to prevent token-forgery timing oracles. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

const xmlResponse = (xml, status = 200, headers = {}) =>
  new Response(xml, {
    status,
    headers: { 'content-type': 'application/xml; charset=utf-8', ...headers },
  });

/** Hash IP+UA into a non-reversible fingerprint for view analytics. */
async function fingerprint(request) {
  const raw = `${request.headers.get('cf-connecting-ip') ?? ''}|${request.headers.get('user-agent') ?? ''}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return b64urlEncode(new Uint8Array(digest)).slice(0, 32);
}

/* ─────────────────────── Signed token issue/verify ─────────────────────── */

/**
 * Issue a signed playback token bound to one video slug.
 * Format: base64url(JSON{slug,exp,fp}).base64url(HMAC-SHA256(payload))
 * @param {string} slug
 * @param {string} secret
 * @param {number} ttlSeconds 5–15 min recommended
 * @param {string|null} fp viewer fingerprint (binds token to IP+UA)
 */
async function issueToken(slug, secret, ttlSeconds, fp = null) {
  const payload = b64urlEncode(
    JSON.stringify({ slug, exp: Math.floor(Date.now() / 1000) + ttlSeconds, fp })
  );
  return `${payload}.${await hmacSign(payload, secret)}`;
}

/**
 * Verify a signed token for a given slug. Returns payload or null.
 * @param {string} token
 * @param {string} slug
 * @param {string} secret
 * @param {string|null} fp current viewer fingerprint
 */
async function verifyToken(token, slug, secret, fp = null) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = await hmacSign(payload, secret);
  if (!timingSafeEqual(sig, expected)) return null;
  let data;
  try {
    data = JSON.parse(b64urlDecode(payload));
  } catch {
    return null;
  }
  if (data.exp < Math.floor(Date.now() / 1000)) return null; // expired
  if (data.slug !== slug) return null;                       // slug-bound
  if (data.fp && fp && data.fp !== fp) return null;          // viewer-bound
  return data;
}

/* ─────────────────── Hotlink / CSRF protection ─────────────────── */

/**
 * Validate Referer/Origin on every media request so segments can only be
 * fetched from our own pages — blocks downloader scripts and third-party embeds.
 */
function mediaReferrerAllowed(request, env) {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim().toLowerCase());
  const origin = request.headers.get('Origin');
  const referer = request.headers.get('Referer');
  if (origin) return allowed.includes(origin.toLowerCase());
  if (referer) return allowed.some((a) => referer.toLowerCase().startsWith(a));
  return env.ALLOW_EMPTY_REFERER === 'true'; // strict default: deny empty Referer
}

/** Strict CORS: reflect origin only when it is on the allowlist. */
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  const headers = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'false';
  }
  return headers;
}

/* ─────────────────────── Security headers ─────────────────────── */

function securityHeaders(env) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      // hls.js needs blob: for MSE; stream domain for media
      `media-src 'self' blob: ${env.STREAM_BASE_URL || ''}`.trim(),
      "img-src 'self' data: https:",
      "script-src 'self' 'unsafe-inline'", // JSON-LD blocks are inline
      "style-src 'self' 'unsafe-inline'",
      "frame-ancestors 'self'",
      'object-src \'none\'',
      'base-uri \'self\'',
    ].join('; '),
  };
}

/* ───────────────────────── Supabase REST helpers ───────────────────────── */

async function sbFetch(env, path, init = {}, cacheTtl = 60) {
  const cache = caches.default;
  const cacheKey = new Request(`https://sb-cache.internal/v2${path}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit.json();

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status} on ${path}`);
  const data = await res.json();
  // Micro-cache DB reads at the edge to keep sitemap/OG paths off the DB
  const res2 = new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${cacheTtl}` },
  });
  if (cacheTtl > 0) {
    // NOTE: cannot block on put inside sbFetch; fire and forget by caller ctx
    try { await cache.put(cacheKey, res2.clone()); } catch { /* best effort */ }
  }
  return data;
}

/** Public projection — NEVER includes stream_id / hls_path. */
const VIDEO_PUBLIC_FIELDS =
  'id,slug,title,description,summary,duration,thumbnail_url,view_count,' +
  'published_at,updated_at,age_restricted,stream_id,hls_path';

async function getVideoBySlug(env, slug) {
  const rows = await sbFetch(
    env,
    `videos?select=${VIDEO_PUBLIC_FIELDS}&slug=eq.${encodeURIComponent(slug)}&status=eq.published&limit=1`
  );
  return rows[0] ?? null;
}

/* ─────────────────────────── Age Gate (edge) ─────────────────────────── */

function hasAgeCookie(request) {
  const cookie = request.headers.get('Cookie') ?? '';
  return cookie.split(/;\s*/).some((c) => c.trim().startsWith(`${AGE_COOKIE}=1`));
}

/** Cloaked affiliate redirect: /go/:offerId → configured tracking URL. */
function handleGoRedirect(env, offerId, ctx) {
  const offer = OFFERS[offerId];
  if (!offer?.url) {
    return new Response(JSON.stringify({ error: 'unknown_offer' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }
  // Server-side click log → visible in Workers observability (Logs) dashboard.
  ctx?.waitUntil(
    Promise.resolve().then(() => console.log(JSON.stringify({ evt: 'aff_click', offer: offerId })))
  );
  return new Response(null, {
    status: 302,
    headers: {
      location: offer.url,
      // Keep the redirect out of every index/crawl and out of any edge cache.
      'x-robots-tag': 'noindex, nofollow',
      'cache-control': 'no-store, private',
      'referrer-policy': 'no-referrer',
    },
  });
}

/** Native offer card for the age-gate (matches the dark interstitial theme). */
function offerGateCardHtml(offer, offerId) {
  const label = AFF_LABEL
    ? `<div class="aff-label">${esc(AFF_LABEL)}</div>`
    : '';
  return `
  <div class="aff-wrap">
    <div class="aff-divider"><span>Advertisement</span></div>
    <a class="aff-card" href="/go/${esc(offerId)}" rel="nofollow sponsored">
      <div class="aff-glow"></div>
      <div class="aff-title">${esc(offer.title)}</div>
      <div class="aff-sub">${esc(offer.subtitle)}</div>
      <div class="aff-cta">${esc(offer.cta)}</div>
      ${label}
    </a>
  </div>`;
}

function ageInterstitial(redirectUrl, env) {
  const gateOffersHtml = Object.entries(OFFERS)
    .filter(([, o]) => o.age_gate && o.url)
    .map(([id, o]) => offerGateCardHtml(o, id))
    .join('\n');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="rating" content="adult">
<meta name="rating" content="RTA-5042-1996-1400-1577-RTA">
<title>Age Verification Required · ${new URL(env.SITE_URL).hostname}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#09090b;color:#fafafa;font:16px/1.6 system-ui,sans-serif;padding:24px}
  .card{max-width:460px;background:#18181b;border:1px solid #27272a;border-radius:16px;padding:32px;text-align:center}
  h1{font-size:1.35rem;margin-bottom:12px}
  p{color:#a1a1aa;margin-bottom:24px}
  .btn{display:inline-block;width:100%;padding:13px 20px;border-radius:10px;font-weight:600;
       text-decoration:none;border:0;cursor:pointer;font-size:1rem}
  .btn-yes{background:#e11d48;color:#fff;margin-bottom:10px}
  .btn-no{background:transparent;color:#a1a1aa;border:1px solid #3f3f46}
  .aff-wrap{margin-top:18px}
  .aff-divider{display:flex;align-items:center;gap:10px;margin:4px 0 12px;color:#52525b;font-size:.68rem;letter-spacing:.12em;text-transform:uppercase}
  .aff-divider::before,.aff-divider::after{content:'';flex:1;height:1px;background:#27272a}
  .aff-card{display:block;position:relative;overflow:hidden;border:1px solid #3f3f46;border-radius:12px;
            padding:14px 16px;text-decoration:none;background:#101013;text-align:left}
  .aff-glow{position:absolute;inset:-40% -20% auto;height:120px;
            background:radial-gradient(closest-side,rgba(225,29,72,.25),transparent);pointer-events:none}
  .aff-title{position:relative;font-weight:700;font-size:.98rem;color:#fafafa}
  .aff-sub{position:relative;font-size:.8rem;color:#a1a1aa;margin:2px 0 10px}
  .aff-cta{position:relative;display:block;text-align:center;padding:10px 14px;border-radius:9px;
           font-weight:700;font-size:.92rem;color:#fff;
           background:linear-gradient(90deg,#e11d48,#f97316)}
  .aff-card:hover .aff-cta{filter:brightness(1.12)}
  .aff-label{position:relative;text-align:center;margin-top:8px;font-size:.65rem;color:#52525b}
</style>
</head>
<body>
<main class="card">
  <h1>This website contains age-restricted material</h1>
  <p>You must be 18 years or older (or the age of majority in your jurisdiction) to enter.
     By continuing you confirm that you are of legal age and that viewing such content is
     legal where you are.</p>
  <form method="POST" action="/api/age-verify">
    <input type="hidden" name="redirect" value="${redirectUrl}">
    <button class="btn btn-yes" type="submit">I am 18 or older — Enter</button>
  </form>
  ${gateOffersHtml}
  <a class="btn btn-no" href="https://www.google.com" rel="nofollow">Leave this site</a>
</main>
</body>
</html>`;
  return new Response(html, {
    status: 200, // soft-gate: keep 200 so crawlers still index canonical pages
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'X-Robots-Tag': 'noindex',
      'cache-control': 'private, no-store',
    },
  });
}

/* ──────────────────────── Sitemap generation ──────────────────────── */

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Google video sitemap fetched live from Supabase (public/RLS-filtered). */
async function handleSitemap(request, env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(`${env.SITE_URL}/sitemap.xml?v=2`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let entries = [];
  try {
    let page = 1;
    for (;;) {
      const rows = await sbFetch(
        env,
        // PostgREST has no `page` param — sending one makes it treat `page`
        // as a COLUMN FILTER (400 → empty sitemap). Paginate with offset.
        'videos?select=slug,title,description,thumbnail_url,duration,updated_at,published_at,age_restricted' +
          `&status=eq.published&order=published_at.desc&offset=${(page - 1) * 1000}&limit=1000`
      );
      entries.push(...rows);
      if (rows.length < 1000 || page >= 50) break; // 50k cap → switch to sitemap index beyond this
      page++;
    }
  } catch {
    entries = [];
  }

  const staticUrls = ['', '/categories', '/search'].map(
    (p) => `  <url><loc>${env.SITE_URL}${p}</loc><changefreq>daily</changefreq><priority>0.6</priority></url>`
  );

  const videoUrls = entries.map((v) => {
    const lastmod = (v.updated_at ?? v.published_at ?? new Date().toISOString()).slice(0, 19) + 'Z';
    return `  <url>
    <loc>${env.SITE_URL}/watch/${esc(v.slug)}</loc>
    <lastmod>${lastmod}</lastmod>
    <video:video>
      <video:thumbnail_loc>${esc(v.thumbnail_url)}</video:thumbnail_loc>
      <video:title>${esc(v.title)}</video:title>
      <video:description>${esc((v.description ?? v.summary ?? '').slice(0, 2048))}</video:description>
      ${v.duration ? `<video:duration>${Math.min(v.duration, 28800)}</video:duration>` : ''}
      ${v.published_at ? `<video:publication_date>${v.published_at.slice(0, 19)}Z</video:publication_date>` : ''}
      <video:family_friendly>${v.age_restricted ? 'no' : 'yes'}</video:family_friendly>
      <video:live>no</video:live>
    </video:video>
  </url>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
${[...staticUrls, ...videoUrls].join('\n')}
</urlset>`;

  const res = xmlResponse(xml, 200, {
    'cache-control': `public, max-age=${env.SITEMAP_CACHE_TTL}, stale-while-revalidate=86400`,
  });
  // Never poison the edge cache with an empty sitemap (e.g. transient
  // Supabase hiccup) — skip caching when no video rows came back.
  if (entries.length > 0) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

function handleRobots(env) {
  const body = `# wasmo.site — robots.txt
# Standard crawlers: allowed (canonical HTML only)
User-agent: *
Disallow: /media/
Disallow: /api/
Disallow: /go/
Allow: /

# AI / answer engines: explicitly welcome for AEO (Perplexity, ChatGPT, Gemini, Claude…)
User-agent: GPTBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: ClaudeBot
Allow: /

Sitemap: ${env.SITE_URL}/sitemap.xml
`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

/* ─────────────────── Media gateway (HLS + anti-hotlink) ─────────────────── */

/**
 * Rewrite a playlist so every child URL (variant playlists + segments) carries
 * the viewer's own signed token, and is routed through this worker.
 */
function rewritePlaylist(manifestText, slug, token, basePath) {
  return manifestText
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) {
        // Rewrite URI="..." attributes (e.g. EXT-X-KEY / EXT-X-MAP)
        return line.replace(/URI="([^"]+)"/g, (_m, uri) => {
          if (/^https?:\/\//i.test(uri)) return `URI="${uri}"`;
          const abs = uri.startsWith('/') ? uri : `${basePath}/${uri}`;
          return `URI="/media/${slug}${abs}?token=${encodeURIComponent(token)}"`;
        });
      }
      if (/^https?:\/\//i.test(t)) return line; // absolute URLs left untouched
      const abs = t.startsWith('/') ? t : `${basePath}/${t}`;
      return `/media/${slug}${abs}?token=${encodeURIComponent(token)}`;
    })
    .join('\n');
}

async function resolveStreamSource(env, video, token) {
  // Preferred: Cloudflare Stream manifest proxied under our own /media path
  if (env.STREAM_BASE_URL && video.stream_id) {
    return `${env.STREAM_BASE_URL}/${video.stream_id}/manifest/video.m3u8`;
  }
  if (video.hls_path) {
    // Custom origin storage: {ORIGIN}/media/{slug}/manifest.m3u8
    return `${env.SITE_URL}${video.hls_path}?token=${encodeURIComponent(token)}`;
  }
  return null;
}

/**
 * GET /media/:slug/(manifest.m3u8|*.m3u8|*.ts|*.m4s|...)
 * Security checks (all required):
 *   1. age cookie      2. signed token (slug-bound, exp-bound, viewer-bound)
 *   3. Referer/Origin allowlist        4. token validated BEFORE cache read
 */
async function handleMedia(request, env, ctx, slug, mediaPath) {
  const url = new URL(request.url);

  if (!hasAgeCookie(request)) {
    return json({ error: 'age_verification_required' }, 403, corsHeaders(request, env));
  }
  if (!mediaReferrerAllowed(request, env)) {
    return json({ error: 'hotlink_prohibited' }, 403, corsHeaders(request, env));
  }

  const fp = await fingerprint(request);
  const payload = await verifyToken(url.searchParams.get('token'), slug, env.SIGNING_SECRET, fp);
  if (!payload) {
    return json({ error: 'invalid_or_expired_token' }, 403, corsHeaders(request, env));
  }

  const video = await getVideoBySlug(env, slug);
  if (!video) return json({ error: 'not_found' }, 404, corsHeaders(request, env));

  const isManifest = mediaPath.endsWith('.m3u8');
  const cache = caches.default;

  // Segments are immutable → cache aggressively by path (token already validated)
  if (!isManifest) {
    const segKey = new Request(`${env.SITE_URL}/media/${slug}/${mediaPath}`);
    const segHit = await cache.match(segKey);
    if (segHit) return segHit;
  }

  const source = await resolveStreamSource(env, video, url.searchParams.get('token'));
  if (!source) return json({ error: 'stream_unconfigured' }, 404, corsHeaders(request, env));

  // Upstream path: manifest root vs segment child
  const upstreamUrl = isManifest
    ? source
    : source.replace(/manifest\.m3u8.*$/, '') + mediaPath;

  const upstream = await fetch(upstreamUrl, {
    headers: { Referer: env.SITE_URL, 'User-Agent': request.headers.get('User-Agent') ?? '' },
    cf: { cacheTtl: isManifest ? 0 : 86400, cacheEverything: !isManifest },
  });

  if (!upstream.ok) {
    return json({ error: 'upstream_error', status: upstream.status }, 502, corsHeaders(request, env));
  }

  if (isManifest) {
    const text = await upstream.text();
    // Sub-path of this playlist relative to /media/{slug}/
    const basePath = mediaPath.includes('/')
      ? mediaPath.slice(0, mediaPath.lastIndexOf('/'))
      : '';
    const rewritten = rewritePlaylist(text, slug, url.searchParams.get('token'), basePath);
    return new Response(rewritten, {
      headers: {
        'content-type': 'application/vnd.apple.mpegurl',
        'cache-control': 'private, no-store', // playlists carry per-viewer tokens
        ...corsHeaders(request, env),
      },
    });
  }

  const segRes = new Response(upstream.body, {
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'video/mp2t',
      'cache-control': 'public, max-age=31536000, immutable',
      ...corsHeaders(request, env),
    },
  });
  ctx.waitUntil(cache.put(new Request(`${env.SITE_URL}/media/${slug}/${mediaPath}`), segRes.clone()));
  return segRes;
}

/* ─────────────────── Signed URL issuance endpoint ─────────────────── */

/**
 * POST/GET /api/videos/:slug/sign
 * Exchanges a slug for a short-lived signed manifest URL.
 * Client never learns the raw upstream URL — only our own /media path + token.
 */
async function handleSign(request, env, ctx, slug) {
  if (!hasAgeCookie(request)) {
    return json({ error: 'age_verification_required' }, 403, corsHeaders(request, env));
  }
  if (!mediaReferrerAllowed(request, env)) {
    return json({ error: 'hotlink_prohibited' }, 403, corsHeaders(request, env));
  }

  const video = await getVideoBySlug(env, slug);
  if (!video) return json({ error: 'not_found' }, 404, corsHeaders(request, env));

  const fp = await fingerprint(request);
  const ttl = Math.min(Math.max(parseInt(env.TOKEN_TTL_SECONDS, 10) || 600, 300), 900); // clamp 5–15 min
  const token = await issueToken(slug, env.SIGNING_SECRET, ttl, fp);

  return json(
    {
      manifestUrl: `/media/${slug}/manifest.m3u8?token=${encodeURIComponent(token)}`,
      expiresAt: new Date((Math.floor(Date.now() / 1000) + ttl) * 1000).toISOString(),
      ttlSeconds: ttl,
    },
    200,
    { 'cache-control': 'private, no-store', ...corsHeaders(request, env) }
  );
}

/* ───────────────── Age verification cookie endpoint ───────────────── */

async function handleAgeVerify(request, env) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const form = await request.formData().catch(() => null);
  const redirectTo = form?.get('redirect');
  let target = env.SITE_URL;
  if (redirectTo && typeof redirectTo === 'string' && redirectTo.startsWith('/')) {
    target = `${env.SITE_URL}${redirectTo}`; // open-redirect guard: same-origin paths only
  }
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    location: target,
    'set-cookie':
      `${AGE_COOKIE}=1; Path=/; Max-Age=${AGE_COOKIE_MAX_AGE}; Secure; SameSite=Lax`,
    'cache-control': 'private, no-store',
    ...securityHeaders(env),
  };
  return new Response('<!doctype html><title>Redirecting…</title><a href="/">Continue</a>', {
    status: 303,
    headers,
  });
}

/* ──────────────── Dynamic OG / Twitter meta injection ──────────────── */

/**
 * For /watch/:slug HTML, replace/enrich OG + Twitter meta at the edge so
 * crawlers always see fresh, correct metadata — even for statically rendered
 * shells. Idempotent: strips any existing og:, twitter: or video: meta tags,
 * then injects a fresh set.
 */
/** Seconds → ISO-8601 duration (schema.org requires e.g. "PT4M35S"). */
function secondsToIso8601(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  let out = 'PT';
  if (h) out += `${h}H`;
  if (m) out += `${m}M`;
  if (r || (!h && !m)) out += `${r}S`;
  return out;
}

/**
 * Server-side AEO injection for /watch/:slug — video-specific OG/Twitter meta
 * PLUS VideoObject + BreadcrumbList JSON-LD so answer engines/crawlers receive
 * complete structured data in the first HTML response (no JS execution needed).
 */
async function injectVideoMeta(html, env, video) {
  const title = esc(video.title);
  const desc = esc((video.summary ?? video.description ?? '').slice(0, 300));
  const thumb = esc(video.thumbnail_url ?? '');
  const pageUrl = `${env.SITE_URL}/watch/${esc(video.slug)}`;
  const uploadDate = video.published_at ?? video.updated_at ?? new Date().toISOString();

  const metaTags = [
    `<meta name="rating" content="adult">`,
    `<meta name="rating" content="RTA-5042-1996-1400-1577-RTA">`,
    `<meta property="og:type" content="video.other">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:url" content="${pageUrl}">`,
    `<meta property="og:image" content="${thumb}">`,
    video.duration
      ? `<meta property="video:duration" content="${video.duration}">`
      : '',
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${desc}">`,
    `<meta name="twitter:image" content="${thumb}">`,
  ]
    .filter(Boolean)
    .join('\n    ');

  // ── Server-side JSON-LD: VideoObject + BreadcrumbList ──────────────────
  // < is escaped as \u003c so user content can never close the script tag.
  const videoObject = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: video.title,
    description: (video.summary ?? video.description ?? '').slice(0, 500),
    thumbnailUrl: video.thumbnail_url ? [video.thumbnail_url] : undefined,
    uploadDate,
    ...(video.duration ? { duration: secondsToIso8601(video.duration) } : {}),
    contentUrl: pageUrl,
    embedUrl: pageUrl,
    isFamilyFriendly: false,
    ...(video.view_count != null
      ? {
          interactionStatistic: {
            '@type': 'InteractionCounter',
            interactionType: { '@type': 'WatchAction' },
            userInteractionCount: video.view_count,
          },
        }
      : {}),
    publisher: { '@type': 'Organization', name: 'Wasmo', url: env.SITE_URL },
  };
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: env.SITE_URL },
      { '@type': 'ListItem', position: 2, name: video.title, item: pageUrl },
    ],
  };
  const jsonLd = JSON.stringify([videoObject, breadcrumb])
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  let out = html.replace(/<meta\s+(?:property|name)="(og|twitter|video):[^"]*"[^>]*>\s*/gi, '');
  if (out.includes('</head>')) {
    out = out.replace(
      '</head>',
      `    ${metaTags}\n    <script type="application/ld+json">${jsonLd}</script>\n</head>`
    );
  }
  return out;
}

/* ───────────────────────────── Router ───────────────────────────── */

const worker = {
  async fetch(request, rawEnv, ctx) {
    const env = { ...DEFAULT_ENV, ...rawEnv };
    const url = new URL(request.url);
    const path = url.pathname;
    const isHtmlGet =
      request.method === 'GET' &&
      (request.headers.get('Accept') ?? '').includes('text/html');

    // Global preflight for media/sign CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      /* ---------- Sitemap & robots ---------- */
      if (path === '/sitemap.xml') return await handleSitemap(request, env, ctx);
      if (path === '/robots.txt') return handleRobots(env);

      /* ---------- Age verification endpoint ---------- */
      if (path === '/api/age-verify') return await handleAgeVerify(request, env);

      /* ---------- Affiliate offer redirects (cloaked) ---------- */
      const goMatch = path.match(/^\/go\/([A-Za-z0-9_-]+)\/?$/);
      if (goMatch) return handleGoRedirect(env, decodeURIComponent(goMatch[1]), ctx);

      /* ---------- Signed URL issuance ---------- */
      const signMatch = path.match(/^\/api\/videos\/([^/]+)\/sign$/);
      if (signMatch) return await handleSign(request, env, ctx, decodeURIComponent(signMatch[1]));

      /* ---------- Media gateway (HLS manifests + segments) ---------- */
      const mediaMatch = path.match(/^\/media\/([^/]+)\/(.+)$/);
      if (mediaMatch) {
        return await handleMedia(request, env, ctx, decodeURIComponent(mediaMatch[1]), mediaMatch[2]);
      }

      /* ---------- HTML routes ---------- */
      if (isHtmlGet) {
        // Age gate: every HTML route requires an explicit age attestation.
        if (!hasAgeCookie(request) && path !== '/') {
          return ageInterstitial(path, env);
        }

        const cache = caches.default;
        const cacheKey = new Request(`${env.SITE_URL}${CACHE_BUILD}${path}${url.search}`);
        const hit = await cache.match(cacheKey);
        if (hit) return hit;

        // Origin: the Next.js static export bundled into this worker via the
        // [assets] binding (single-deploy architecture). Falls back to network
        // proxying when ASSETS is not bound (external backend mode).
        const origin = env.ASSETS
          ? await env.ASSETS.fetch(new Request(request.url, { headers: request.headers }))
          : await fetch(request, { cf: { cacheTtl: 0, cacheEverything: false } });
        let res = new Response(origin.body, origin);

        // Dynamic OG injection for video detail pages
        const watchMatch = path.match(/^\/watch\/([^/?#]+)/);
        if (watchMatch) {
          try {
            const video = await getVideoBySlug(env, decodeURIComponent(watchMatch[1]));
            if (video) {
              const html = await origin.text();
              res = new Response(await injectVideoMeta(html, env, video), {
                status: origin.status,
                headers: origin.headers,
              });
            }
          } catch { /* fall through with unmodified HTML */ }
        }

        // Cache HTML at the edge → near-zero TTFB for subsequent visitors
        res = new Response(res.body, res);
        res.headers.set(
          'cache-control',
          `public, max-age=${env.HTML_CACHE_TTL}, stale-while-revalidate=86400`
        );
        for (const [k, v] of Object.entries(securityHeaders(env))) res.headers.set(k, v);
        if (path !== '/') ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return res;
      }

      /* ---------- Fallback: proxy as-is ---------- */
      return fetch(request);
    } catch (err) {
      return json({ error: 'edge_error', message: String(err?.message ?? err) }, 500);
    }
  },
};


export default worker;
