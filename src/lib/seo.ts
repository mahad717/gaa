/**
 * SEO / AEO helpers: JSON-LD builders (Schema.org), canonical URLs,
 * ISO-8601 durations and meta descriptions.
 * Used by both the demo app (server components) and edge metadata layer.
 */

import type { Video } from './fixtures';

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wasmo.site';

export const SITE_NAME = 'Wasmo';

export const absoluteUrl = (path: string) =>
  `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;

/** seconds → ISO-8601 (e.g. 754 → "PT12M34S") for VideoObject.duration */
export function isoDuration(seconds: number | null | undefined): string | undefined {
  if (!seconds || seconds <= 0) return undefined;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s ? `${s}S` : ''}`;
}

/** Compact human duration (e.g. "12:34") */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/* ───────────────────────────── JSON-LD builders ───────────────────────────── */

/** WebSite + SearchAction (sitelinks searchbox) — home page */
export function buildWebsiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
    isFamilyFriendly: false,
  };
}

/** VideoObject — video detail pages (SEO core entity) */
export function buildVideoObjectJsonLd(video: Video) {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: video.title,
    description: video.summary ?? video.description ?? undefined,
    thumbnailUrl: video.thumbnail_url ? [video.thumbnail_url] : undefined,
    uploadDate: video.published_at ?? undefined,
    duration: isoDuration(video.duration),
    // NOTE: contentUrl intentionally omitted — media is served via short-lived
    // signed HLS URLs only. embedUrl points to the canonical page.
    embedUrl: absoluteUrl(`/watch/${video.slug}`),
    interactionStatistic: {
      '@type': 'InteractionCounter',
      interactionType: { '@type': 'WatchAction' },
      userInteractionCount: video.view_count,
    },
    isFamilyFriendly: false,
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
    },
  };
}

/** BreadcrumbList — video detail pages */
export function buildBreadcrumbJsonLd(video: Video) {
  const items = [
    { position: 1, name: 'Home', item: SITE_URL },
    ...(video.category
      ? [
          {
            position: 2,
            name: video.category.name,
            item: absoluteUrl(`/category/${video.category.slug}`),
          },
        ]
      : []),
    {
      position: video.category ? 3 : 2,
      name: video.title,
      item: absoluteUrl(`/watch/${video.slug}`),
    },
  ];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(({ position, name, item }) => ({
      '@type': 'ListItem',
      position,
      name,
      item,
    })),
  };
}

/**
 * FAQPage — ONLY render when the FAQ content is visible on the page
 * (Google requires Q&A markup to match on-page content).
 */
export function buildFaqJsonLd(video: Video) {
  const faqs = video.faqs ?? [];
  if (faqs.length === 0) return null;
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

/** Serialize any JSON-LD graph for a <script type="application/ld+json"> */
export function jsonLdScript(graphs: (object | null)[]) {
  const valid = graphs.filter(Boolean);
  if (valid.length === 0) return null;
  return JSON.stringify(
    valid.length === 1 ? valid[0] : { '@context': 'https://schema.org', '@graph': valid }
  );
}

/* ────────────────────────────── AEO helpers ────────────────────────────── */

export const AEO_MIN_WORDS = 50;
export const AEO_MAX_WORDS = 100;

export function wordCount(text: string | null | undefined): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).length;
}

export function isAeoCompliantSummary(text: string | null | undefined): boolean {
  const n = wordCount(text);
  return n >= AEO_MIN_WORDS && n <= AEO_MAX_WORDS;
}

export function metaDescription(video: Video): string {
  const base = video.summary ?? video.description ?? video.title;
  return base.length <= 160 ? base : `${base.slice(0, 157).trimEnd()}…`;
}
