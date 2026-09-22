'use client';

/**
 * Wasmo demo application shell (single-route showcase).
 * In production, `detail` view = its own SSR route /watch/[slug] rendered by
 * the Next server + edge worker (see VideoDetail.jsx / README). Here the same
 * UI patterns run client-side so everything is demonstrable on one route.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import AgeGate from '@/components/video/AgeGate';
import VideoPlayer from '@/components/video/VideoPlayer';
import type { Video } from '@/lib/fixtures';
import { FIXTURE_CATEGORIES } from '@/lib/fixtures';
import {
  buildBreadcrumbJsonLd,
  buildFaqJsonLd,
  buildVideoObjectJsonLd,
  formatDuration,
  formatViews,
  jsonLdScript,
  metaDescription,
} from '@/lib/seo';

/* ────────────────────────────── JSON-LD helper ────────────────────────────── */

function JsonLd({ data }: { data: object | null }) {
  if (!data) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

/* ──────────────────────────────── Video card ──────────────────────────────── */

function VideoCard({ video, onOpen }: { video: Video; onOpen: () => void }) {
  return (
    <li>
      <button
        onClick={onOpen}
        className="group w-full overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 text-left transition hover:border-zinc-600 focus-visible:outline-2 focus-visible:outline-rose-500"
        aria-label={`Watch ${video.title}`}
      >
        <span className="relative block aspect-video overflow-hidden bg-gradient-to-br from-zinc-800 to-zinc-900">
          {video.thumbnail_url && (
            <img
              src={video.thumbnail_url}
              alt=""
              className="h-full w-full object-cover opacity-90 transition group-hover:scale-105 group-hover:opacity-100"
              loading="lazy"
            />
          )}
          {video.duration ? (
            <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-zinc-100">
              {formatDuration(video.duration)}
            </span>
          ) : null}
        </span>
        <span className="block p-3">
          <span className="line-clamp-2 block text-sm font-semibold leading-snug text-zinc-100 group-hover:text-white">
            {video.title}
          </span>
          <span className="mt-1.5 block text-xs text-zinc-500">
            {video.category?.name} · {formatViews(video.view_count)} views
          </span>
        </span>
      </button>
    </li>
  );
}

function SponsoredTile() {
  return (
    <li>
      <a
        href="/go/smartlink?src=grid"
        rel="nofollow sponsored"
        aria-label="Sponsored: watch free content"
        className="group flex h-full w-full flex-col overflow-hidden rounded-xl border border-zinc-800 bg-gradient-to-br from-rose-950/70 via-zinc-900 to-zinc-950 text-left transition hover:border-rose-700"
      >
        <span className="relative flex aspect-video items-center justify-center overflow-hidden">
          <span className="absolute inset-0 bg-[radial-gradient(closest-side,rgba(225,29,72,0.35),transparent)]" />
          <span className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-rose-800/60 bg-black">
            <img src="/wasmo-logo.png" alt="" className="h-full w-full object-cover" loading="lazy" />
          </span>
          <span className="absolute left-2 top-2 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-400">
            Hot
          </span>
          <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium text-zinc-100">
            Live now
          </span>
        </span>
        <span className="block p-3">
          <span className="line-clamp-2 block text-sm font-semibold leading-snug text-zinc-100">
            🔥 Daawo bilaash ah — exclusive 18+ content near you
          </span>
          <span className="mt-1.5 block text-xs font-medium text-rose-400 group-hover:text-rose-300">
            Bilaash · No signup · Watch now →
          </span>
        </span>
      </a>
    </li>
  );
}

/* ─────────────────────────────── Detail view ──────────────────────────────── */

function DetailView({
  video,
  related,
  onBack,
  onSelect,
}: {
  video: Video;
  related: Video[];
  onBack: () => void;
  onSelect: (slug: string) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    document.title = `${video.title} · Wasmo`;
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
  }, [video.title]);

  const transcriptLines = useMemo(
    () =>
      (video.transcript ?? '')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const m = line.match(/^(\[\d{1,2}:\d{2}(?::\d{2})?\])\s*(.*)$/);
          return m ? { stamp: m[1], text: m[2] } : { stamp: null, text: line };
        }),
    [video.transcript]
  );

  return (
    <article className="mx-auto max-w-4xl">
      {/* Structured data for the detail entity */}
      <JsonLd data={buildVideoObjectJsonLd(video)} />
      <JsonLd data={buildBreadcrumbJsonLd(video)} />
      <JsonLd data={buildFaqJsonLd(video)} />

      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-zinc-400">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <button onClick={onBack} className="hover:text-zinc-200 hover:underline">
              Home
            </button>
          </li>
          {video.category && (
            <>
              <li aria-hidden="true">/</li>
              <li className="text-zinc-500">{video.category.name}</li>
            </>
          )}
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-zinc-200">
            {video.title}
          </li>
        </ol>
      </nav>

      <header className="mb-6">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-bold text-white outline-none md:text-3xl"
        >
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
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
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

      <section aria-label="Video player" className="mb-6">
        <VideoPlayer
          slug={video.slug}
          demoManifest={video.demo_manifest}
          poster={video.thumbnail_url}
          title={video.title}
        />
      </section>

      {/* Below-player smartlink banner — prime conversion slot */}
      <a
        href="/go/smartlink?src=player"
        rel="nofollow sponsored"
        className="group mb-8 flex items-center justify-between gap-3 rounded-xl border border-rose-900/60 bg-gradient-to-r from-rose-950/80 via-zinc-900 to-zinc-950 p-4 transition hover:border-rose-700"
      >
        <span className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black">
            <img src="/wasmo-logo.png" alt="" className="h-full w-full object-cover" loading="lazy" />
          </span>
          <span>
            <span className="block text-sm font-bold text-white">
              🔥 Daawo bilaash ah — hot 18+ content in your area
            </span>
            <span className="block text-xs text-zinc-400">
              Bilaash · No signup · Works on all Somali networks
            </span>
          </span>
        </span>
        <span className="hidden shrink-0 rounded-lg bg-gradient-to-r from-rose-600 to-orange-500 px-4 py-2 text-sm font-bold text-white transition group-hover:brightness-110 sm:block">
          Watch free →
        </span>
      </a>

      {video.summary && (
        <section
          id="quick-answer"
          aria-label="Quick answer"
          className="mb-8 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5"
        >
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-rose-400">
            Quick answer
          </h2>
          <p className="leading-relaxed text-zinc-200">{video.summary}</p>
        </section>
      )}

      <section aria-label="About this video" className="mb-8">
        <h2 className="mb-2 text-lg font-semibold text-white">About this video</h2>
        <p className="leading-relaxed text-zinc-300">{video.description}</p>
        {video.tags && video.tags.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Tags">
            {video.tags.map((tag) => (
              <li
                key={tag.slug}
                className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300"
              >
                #{tag.name}
              </li>
            ))}
          </ul>
        )}
      </section>

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

      {video.faqs && video.faqs.length > 0 && (
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
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((r) => (
              <VideoCard key={r.slug} video={r} onOpen={() => onSelect(r.slug)} />
            ))}
          </ul>
        </section>
      )}

      <button
        onClick={onBack}
        className="mb-8 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800"
      >
        ← Back to all videos
      </button>
    </article>
  );
}

/* ──────────────────────────────── App shell ───────────────────────────────── */

export default function WasmoApp({ initialVideos }: { initialVideos: Video[] }) {
  const [videos] = useState<Video[]>(initialVideos);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return videos.filter((v) => {
      const inCategory = !category || v.category?.slug === category;
      const inQuery =
        !q ||
        v.title.toLowerCase().includes(q) ||
        (v.summary ?? '').toLowerCase().includes(q) ||
        (v.tags ?? []).some((t) => t.name.toLowerCase().includes(q));
      return inCategory && inQuery;
    });
  }, [videos, query, category]);

  const active = activeSlug ? videos.find((v) => v.slug === activeSlug) ?? null : null;
  const related = useMemo(() => {
    if (!active) return [];
    return videos
      .filter((v) => v.slug !== active.slug && (!active.category || v.category?.slug === active.category.slug))
      .slice(0, 3);
  }, [videos, active]);

  return (
    <AgeGate>
      <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
        {/* ── Header ── */}
        <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
            <button
              onClick={() => setActiveSlug(null)}
              className="flex shrink-0 items-center gap-2 text-lg font-black tracking-tight text-white"
              aria-label="Wasmo home"
            >
              <img
                src="/wasmo-logo.png"
                alt="Wasmo"
                width={32}
                height={32}
                className="h-8 w-8 rounded-lg object-cover"
              />
              <span>
                Wasmo<span className="text-rose-500">.</span>
              </span>
            </button>
            <div className="relative flex-1">
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveSlug(null);
                }}
                placeholder="Search videos, topics, transcripts…"
                aria-label="Search videos"
                className="w-full rounded-full border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition focus:border-rose-600"
              />
            </div>
          </div>
        </header>

        {/* ── Main ── */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
          {active ? (
            <DetailView
              video={active}
              related={related}
              onBack={() => setActiveSlug(null)}
              onSelect={(slug) => setActiveSlug(slug)}
            />
          ) : (
            <>
              <nav aria-label="Categories" className="mb-6 flex flex-wrap gap-2">
                <button
                  onClick={() => setCategory(null)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                    category === null
                      ? 'bg-rose-600 text-white'
                      : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600'
                  }`}
                >
                  All
                </button>
                {FIXTURE_CATEGORIES.map((c) => (
                  <button
                    key={c.slug}
                    onClick={() => setCategory(c.slug === category ? null : c.slug)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                      category === c.slug
                        ? 'bg-rose-600 text-white'
                        : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </nav>

              <section aria-label="Videos">
                <h1 className="sr-only">Wasmo — video platform</h1>
                {filtered.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-zinc-800 p-12 text-center text-zinc-500">
                    No videos match “{query}”. Try a different search term.
                  </div>
                ) : (
                  <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {filtered.map((v, i) => (
                      <Fragment key={v.slug}>
                        <VideoCard video={v} onOpen={() => setActiveSlug(v.slug)} />
                        {/* In-grid sponsored tile — smartlink monetization slot */}
                        {i === 6 && <SponsoredTile />}
                      </Fragment>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </main>

        {/* ── Footer (sticky bottom) ── */}
        <footer className="mt-auto border-t border-zinc-800 bg-zinc-950">
          <div className="mx-auto max-w-6xl px-4 py-6 text-xs leading-relaxed text-zinc-500 sm:px-6">
            <p>
              <strong className="text-zinc-400">Wasmo</strong> — reference architecture: Next.js SSR
              + Supabase (Postgres, RLS) + Cloudflare Workers (edge cache, signed HLS). Demo content
              is neutral placeholder media.
            </p>
            <p className="mt-1.5">
              18+ only · RTA labelled ·{' '}
              <a href="/sitemap.xml" className="underline hover:text-zinc-300">
                Sitemap
              </a>
            </p>
          </div>
        </footer>

        {/* Mobile sticky smartlink CTA — highest-visibility slot on phones */}
        <a
          href="/go/smartlink?src=sticky"
          rel="nofollow sponsored"
          className="sticky bottom-0 z-40 flex items-center justify-center gap-2 bg-gradient-to-r from-rose-600 to-orange-500 px-4 py-3 text-center text-sm font-bold text-white sm:hidden"
        >
          🔥 Daawo bilaash ah — Watch free now
        </a>
      </div>
    </AgeGate>
  );
}
