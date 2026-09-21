/**
 * ============================================================================
 * WASMO — VideoDetail.jsx (standalone, framework-portable)
 * ============================================================================
 * Framework: React 18+ with react-helmet-async (Vite / CRA / Remix).
 *   • Next.js App Router alternative: use `generateMetadata()` + a server
 *     component instead of Helmet (see this project's app router demo).
 *
 * SEO features
 *   – Canonical URL, robots directive, hreflang alternates (en / so / x-default)
 *   – Open Graph + Twitter Card (player card with signed-stream embed page)
 *   – Adult compliance meta: rating=adult + RTA label
 *
 * AEO features (answer engines: Perplexity, ChatGPT, Gemini, Google AI)
 *   – "Quick answer" block: the 50–100 word summary in a <section> that LLMs
 *     can quote verbatim, with clear entity naming.
 *   – Full time-coded transcript in crawlable HTML.
 *   – FAQPage JSON-LD that mirrors on-page visible Q&A (Google requirement).
 *   – JSON-LD graph: VideoObject + BreadcrumbList (+ FAQPage when present).
 *
 * Semantic structure for crawlers/LLMs: <main> → <article> → <header>/<section>.
 * ============================================================================
 */

import { Helmet } from 'react-helmet-async';
import VideoPlayer from './VideoPlayer'; // the hls.js player from this project

const SITE_URL = 'https://wasmo.site';
const SITE_NAME = 'Wasmo';

const esc = (s = '') => String(s);

function formatDuration(seconds) {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function formatViews(n = 0) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/* ───────────────────────────── JSON-LD builders ───────────────────────────── */

function buildVideoObject(video) {
  const duration = (() => {
    if (!video.duration) return undefined;
    const h = Math.floor(video.duration / 3600);
    const m = Math.floor((video.duration % 3600) / 60);
    const s = video.duration % 60;
    return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s ? `${s}S` : ''}`;
  })();

  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: video.title,
    description: video.summary ?? video.description ?? undefined,
    thumbnailUrl: video.thumbnail_url ? [video.thumbnail_url] : undefined,
    uploadDate: video.published_at ?? undefined,
    duration,
    // contentUrl deliberately omitted: media is only reachable through
    // short-lived signed HLS tokens issued by the edge worker.
    embedUrl: `${SITE_URL}/watch/${video.slug}`,
    interactionStatistic: {
      '@type': 'InteractionCounter',
      interactionType: { '@type': 'WatchAction' },
      userInteractionCount: video.view_count ?? 0,
    },
    isFamilyFriendly: false,
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  };
}

function buildBreadcrumbList(video) {
  const items = [{ name: 'Home', item: `${SITE_URL}/` }];
  if (video.category) {
    items.push({ name: video.category.name, item: `${SITE_URL}/category/${video.category.slug}` });
  }
  items.push({ name: video.title, item: `${SITE_URL}/watch/${video.slug}` });
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.item,
    })),
  };
}

function buildFaqPage(video) {
  const faqs = video.faqs ?? [];
  if (!faqs.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
}

function JsonLd({ data }) {
  if (!data) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

/* ─────────────────────────────── Component ─────────────────────────────── */

export default function VideoDetail({ video, related = [] }) {
  const canonical = `${SITE_URL}/watch/${video.slug}`;
  const title = `${video.title} · ${SITE_NAME}`;
  const description = (video.summary ?? video.description ?? video.title).slice(0, 160);

  const transcriptLines = (video.transcript ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\[\d{1,2}:\d{2}(?::\d{2})?\])\s*(.*)$/);
      if (!match) return { stamp: null, text: line };
      return { stamp: match[1], text: match[2] };
    });

  return (
    <>
      {/* ────────────────────────────── HEAD ────────────────────────────── */}
      <Helmet prioritizeSeoTags>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonical} />
        <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />

        {/* Adult-content compliance signals (industry standard) */}
        <meta name="rating" content="adult" />
        <meta name="rating" content="RTA-5042-1996-1400-1577-RTA" />

        {/* hreflang alternates — extend as locales ship */}
        <link rel="alternate" hrefLang="en" href={canonical} />
        <link rel="alternate" hrefLang="so" href={canonical} />
        <link rel="alternate" hrefLang="x-default" href={canonical} />

        {/* Open Graph */}
        <meta property="og:type" content="video.other" />
        <meta property="og:site_name" content={SITE_NAME} />
        <meta property="og:title" content={video.title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonical} />
        {video.thumbnail_url && <meta property="og:image" content={video.thumbnail_url} />}
        {video.duration ? <meta property="video:duration" content={String(video.duration)} /> : null}

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={video.title} />
        <meta name="twitter:description" content={description} />
        {video.thumbnail_url && <meta name="twitter:image" content={video.thumbnail_url} />}
      </Helmet>

      {/* JSON-LD graph: VideoObject + BreadcrumbList + (FAQPage) */}
      <JsonLd data={buildVideoObject(video)} />
      <JsonLd data={buildBreadcrumbList(video)} />
      <JsonLd data={buildFaqPage(video)} />

      {/* ────────────────────────────── BODY ────────────────────────────── */}
      <main>
        <article itemScope itemType="https://schema.org/VideoObject">
          <nav aria-label="Breadcrumb" className="mb-4 text-sm text-zinc-400">
            <ol className="flex flex-wrap items-center gap-2">
              <li><a href="/" className="hover:text-zinc-200">Home</a></li>
              {video.category && (
                <>
                  <li aria-hidden="true">/</li>
                  <li>
                    <a href={`/category/${video.category.slug}`} className="hover:text-zinc-200">
                      {video.category.name}
                    </a>
                  </li>
                </>
              )}
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="text-zinc-200">{video.title}</li>
            </ol>
          </nav>

          <header className="mb-6">
            <h1 itemProp="name" className="text-2xl font-bold text-white md:text-3xl">
              {video.title}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-400">
              <span>{formatViews(video.view_count)} views</span>
              {video.duration ? <span>· {formatDuration(video.duration)}</span> : null}
              {video.published_at ? (
                <span>
                  ·{' '}
                  <time dateTime={video.published_at}>
                    {new Date(video.published_at).toLocaleDateString('en-US', {
                      year: 'numeric', month: 'short', day: 'numeric',
                    })}
                  </time>
                </span>
              ) : null}
              {video.age_restricted ? (
                <span className="rounded border border-rose-800 bg-rose-950/60 px-1.5 py-0.5 text-xs font-semibold text-rose-400">
                  18+
                </span>
              ) : null}
            </p>
          </header>

          <section aria-label="Video player" className="mb-8">
            <VideoPlayer
              slug={video.slug}
              demoManifest={video.demo_manifest}
              poster={video.thumbnail_url}
              title={video.title}
            />
          </section>

          {/* AEO CORE #1 — Quick answer block (50–100 words).
              Written as declarative prose so answer engines can quote it. */}
          {video.summary && (
            <section
              id="quick-answer"
              aria-label="Quick answer"
              className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5"
            >
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-rose-400">
                Quick answer
              </h2>
              <p itemProp="description" className="leading-relaxed text-zinc-200">
                {video.summary}
              </p>
            </section>
          )}

          <section aria-label="About this video" className="mb-8">
            <h2 className="mb-2 text-lg font-semibold text-white">About this video</h2>
            <p className="leading-relaxed text-zinc-300">{video.description}</p>
            {video.tags?.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Tags">
                {video.tags.map((tag) => (
                  <li key={tag.slug}>
                    <a
                      href={`/tag/${tag.slug}`}
                      className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-rose-700 hover:text-rose-400"
                    >
                      #{tag.name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* AEO CORE #2 — crawlable transcript.
              Rendered as real text (not media captions) so search engines and
              LLMs can index every spoken sentence. */}
          {video.transcript && (
            <section id="transcript" aria-label="Full transcript" className="mb-8">
              <h2 className="mb-3 text-lg font-semibold text-white">Full transcript</h2>
              <div className="max-h-96 space-y-2 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/70 p-5 text-sm leading-relaxed text-zinc-300">
                {transcriptLines.map((line, i) => (
                  <p key={i}>
                    {line.stamp && (
                      <span className="mr-2 font-mono text-xs text-rose-400/90">{line.stamp}</span>
                    )}
                    {line.text}
                  </p>
                ))}
              </div>
            </section>
          )}

          {/* AEO CORE #3 — visible FAQ that mirrors the FAQPage JSON-LD */}
          {video.faqs?.length > 0 && (
            <section id="faq" aria-label="Frequently asked questions" className="mb-8">
              <h2 className="mb-3 text-lg font-semibold text-white">Frequently asked questions</h2>
              <dl className="space-y-4">
                {video.faqs.map((faq) => (
                  <div key={faq.question} className="rounded-xl border border-zinc-800 p-4">
                    <dt className="font-medium text-zinc-100">{faq.question}</dt>
                    <dd className="mt-1.5 leading-relaxed text-zinc-300">{faq.answer}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {related.length > 0 && (
            <section aria-label="Related videos" className="mb-8">
              <h2 className="mb-3 text-lg font-semibold text-white">More like this</h2>
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {related.map((r) => (
                  <li key={r.slug}>
                    <a href={`/watch/${r.slug}`} className="group block overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                      {r.thumbnail_url && (
                        <img
                          src={r.thumbnail_url}
                          alt={`Thumbnail for ${r.title}`}
                          className="aspect-video w-full object-cover transition group-hover:opacity-80"
                          loading="lazy"
                        />
                      )}
                      <div className="p-3">
                        <h3 className="line-clamp-2 text-sm font-medium text-zinc-100">{r.title}</h3>
                        <p className="mt-1 text-xs text-zinc-500">{formatViews(r.view_count)} views</p>
                      </div>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>
      </main>
    </>
  );
}
