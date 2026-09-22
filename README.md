# Wasmo Platform — SEO/AEO Video Architecture

Production-ready reference implementation: **React (Next.js 16) + Supabase (PostgreSQL, RLS, Auth) + Cloudflare Workers (edge cache, signed HLS, sitemap)**, optimized for standard SEO and Answer Engine Optimization (AEO).

> ⚠ **CRITICAL — rotate your keys.** The Supabase `service_role` key and the GitHub token you shared in chat must be treated as compromised. Rotate both in the Supabase and GitHub dashboards **before** deploying. This codebase deliberately contains **only** the public anon key — never embed `service_role` in any frontend or repo file.

---

## File map

| File | Role |
|---|---|
| `supabase/schema.sql` | Full DB schema: tables, indexes (slug/tag/full-text/trigram), RLS policies, RPCs (`increment_view_count`, `search_videos`), seed demo data |
| `workers/worker.js` + `wrangler.toml` | Edge layer: age-gate cookie enforcement, HMAC-signed HLS tokens (5–15 min), `.m3u8`/segment gateway with Referer/Origin allowlist, dynamic OG/Twitter meta injection, `/sitemap.xml` (Google video sitemap), `/robots.txt`, Cache API with stale-while-revalidate |
| `src/components/video/VideoPlayer.tsx` | hls.js + MSE player: `controlsList="nodownload"`, context-menu disabled, manifest URL kept in refs only (never DOM/state), automatic token re-mint on expiry |
| `src/components/video/VideoDetail.jsx` | Standalone page component (react-helmet-async, portable to Vite/Remix/CRA): canonical + robots + hreflang, JSON-LD `VideoObject` + `BreadcrumbList` + `FAQPage`, Quick-Answer block (50–100 words), crawlable transcript, visible FAQ |
| `src/components/video/AgeGate.tsx` | Client modal layer of age verification (edge worker is layer 2); persists attestation to `profiles.age_verified` for signed-in users |
| `src/lib/seo.ts` | JSON-LD builders, ISO-8601 durations, AEO summary word-count validation |
| `src/lib/supabase.ts` | Typed data access — **public projections never select `stream_id`/`hls_path`**; falls back to fixtures until schema is applied |

The Next.js 16 demo app lives in `src/` (App Router): `src/app/page.tsx` (ISR 60, server-rendered `WebSite`+`ItemList` JSON-LD) → `src/components/WasmoApp.tsx` (client shell: age gate → grid → detail with player, Quick Answer, transcript, FAQ). The standalone deliverables above port 1:1 into Vite/Remix.

## Deployment

### 1. Supabase
1. Dashboard → SQL Editor → paste `supabase/schema.sql` → Run. (Seed rows are neutral demo content; delete section 10 before going live.)
2. Promote an admin: `insert into public.profiles (id, role) values ('<auth-user-uuid>', 'admin') on conflict (id) do update set role = 'admin';`
3. Content goes in `videos` with `status='published'`, a unique `slug`, a 50–100 word `summary` (AEO), `transcript`, and `video_faqs` rows. `stream_id`/`hls_path` are internal-only.

### 2. Cloudflare Worker
```bash
cd workers
wrangler login
wrangler secret put SIGNING_SECRET        # openssl rand -hex 32
wrangler deploy
```
Routes attach to `wasmo.site/*` automatically (see `wrangler.toml`). Set `STREAM_BASE_URL` to your Cloudflare Stream customer domain (e.g. `https://customer-xxxx.cloudflarestream.com`) — manifests are then proxied under your own `/media/...` path so upstream URLs never leak.

### 3. Frontend (Next.js demo in this repo, or Vite/Remix with the same components)
- Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL` (all public-safe).
- The demo `/` route shows the full UX: age gate → grid → detail (player, Quick Answer, transcript, FAQ). Production should serve detail pages from SSR route `/watch/[slug]` — the standalone `VideoDetail.jsx` or a Next server component both work; the edge worker injects/refreshes OG meta for crawlers regardless.

## Security model (anti-download, anti-hotlink)

1. **No direct MP4** — delivery is HLS only (`.m3u8` + segments), MSE via hls.js.
2. **Signed tokens** — `/api/videos/:slug/sign` issues an HMAC-SHA256 token bound to slug + expiry (10 min default, clamped 5–15) + viewer fingerprint (IP+UA hash). Every manifest and segment request re-validates it; playlists are rewritten so children carry the viewer's token.
3. **Origin lockdown** — Referer/Origin allowlist on all media routes; strict CORS reflects only allowlisted origins; empty Referer denied by default.
4. **Player hardening** — `controlsList="nodownload noplaybackrate noremoteplayback"`, `disablePictureInPicture`, right-click disabled, no media URL ever serialized into HTML or React state.
5. **Defense-in-depth** — a forged age cookie unlocks nothing by itself: media requires a valid token; RLS makes writes impossible via the anon key; `service_role` never leaves server secrets.

Note: browser-based streaming can never be 100% download-proof (a determined user can capture frames); these layers raise the cost of scraping from trivial to impractical. For the strongest protection add Cloudflare Stream signed URLs + watermarking.

## SEO / AEO checklist implemented

- Canonical URLs, robots directives, hreflang (en/so/x-default), RTA + `rating: adult` meta.
- `WebSite` (+SearchAction), `VideoObject`, `BreadcrumbList`, `FAQPage` JSON-LD — FAQ markup mirrors visible on-page Q&A per Google policy.
- Per-video 50–100 word **Quick Answer** block (enforced by DB check constraint `is_aeo_summary`), full time-coded transcript in HTML, full-text + trigram search (`search_videos` RPC).
- Google **video sitemap** at `/sitemap.xml` with `<video:family_friendly>no</video:family_friendly>` for age-restricted content.
- `robots.txt` explicitly allows GPTBot / PerplexityBot / ClaudeBot / Google-Extended for AEO citation.
- Edge HTML cache (300 s + stale-while-revalidate) → near-zero TTFB for crawlers.

## Compliance reminder

Age-restricted platforms carry legal obligations that vary by jurisdiction (age-verification laws, record-keeping, advertising rules). The age gate here is a technical gate — have the operational/legal side reviewed before launch, and keep content-lawful with rights cleared for every asset you publish.
