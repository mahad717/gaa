/**
 * Shared domain types + demo fixtures.
 * Fixtures mirror schema.sql EXACTLY so the UI runs before schema.sql is
 * applied; once Supabase has the tables + seed, live data takes over
 * automatically (see lib/supabase.ts → getVideos fallback chain).
 */

export type VideoStatus = 'draft' | 'scheduled' | 'published' | 'removed';

export interface Faq {
  question: string;
  answer: string;
}

export interface Video {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  /** AEO: 50–100 word direct-answer block */
  summary: string | null;
  /** AEO: full transcript, time-coded */
  transcript: string | null;
  duration: number | null; // seconds
  thumbnail_url: string | null;
  status: VideoStatus;
  age_restricted: boolean;
  view_count: number;
  published_at: string | null;
  category?: { name: string; slug: string } | null;
  tags?: { name: string; slug: string }[];
  faqs?: Faq[];
  /** Demo-only: public test stream used until CF Stream is wired up */
  demo_manifest?: string;
}

export const FIXTURE_VIDEOS: Video[] = [
  {
    id: 'c0000000-0000-4000-8000-000000000001',
    slug: 'coral-reefs-silent-cities',
    title: 'Coral Reefs: The Silent Cities',
    description:
      'A short documentary exploring how coral reef ecosystems build vast underwater structures that shelter roughly a quarter of all marine species.',
    summary:
      'Coral reefs are massive living structures built by tiny animals called polyps. This documentary explains how reefs form over thousands of years, why they shelter about a quarter of all marine species, and how coral bleaching threatens them when ocean temperatures rise. You will learn the three main threats reefs face today, what restoration projects are doing with coral gardening, and the single most effective action individuals can take to support reef conservation worldwide.',
    transcript: `[00:00] Coral reefs are often called the rainforests of the sea, and for good reason.
[00:14] Each reef begins with a single polyp — an animal the size of a pencil eraser.
[00:31] Over thousands of years, colonies of polyps deposit calcium carbonate, building structures visible from space.
[01:05] Scientists estimate reefs support roughly a quarter of all marine species despite covering less than one percent of the ocean floor.
[01:42] When water temperatures rise, corals expel the algae living in their tissues — a process called bleaching.
[02:18] Restoration teams now grow coral fragments in underwater nurseries and replant them onto damaged reefs.
[03:02] The takeaway: reducing carbon emissions remains the single most effective way to protect reefs worldwide.`,
    duration: 754,
    thumbnail_url: 'https://picsum.photos/seed/coral-reef/640/360',
    status: 'published',
    age_restricted: true,
    view_count: 15230,
    published_at: new Date(Date.now() - 9 * 86400_000).toISOString(),
    category: { name: 'Documentary', slug: 'documentary' },
    tags: [{ name: 'Nature', slug: 'nature' }],
    faqs: [
      {
        question: 'Why are coral reefs important to ocean ecosystems?',
        answer:
          'Coral reefs shelter roughly a quarter of all marine species, protect coastlines from storm surge, and support fishing and tourism economies worth billions of dollars annually.',
      },
      {
        question: 'What causes coral bleaching?',
        answer:
          'When ocean water stays too warm, corals expel the symbiotic algae living in their tissues. The coral turns white and, if temperatures do not fall, can starve and die.',
      },
    ],
    demo_manifest: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  },
  {
    id: 'c0000000-0000-4000-8000-000000000002',
    slug: 'building-an-hls-video-pipeline',
    title: 'Building an HLS Video Pipeline That Resists Downloading',
    description:
      'An engineering walkthrough of adaptive bitrate streaming: HLS manifests, segmenting, signed playback tokens and edge caching with Cloudflare Workers.',
    summary:
      'This tutorial shows how a production video pipeline works end to end. First, a master file is transcoded into multiple bitrate renditions and packaged as an HLS manifest with short segments. Next, an edge worker signs playback tokens that expire in ten minutes, so playlist URLs cannot be reused or shared. Finally, strict referer and origin checks block third-party embeds. The result is smooth adaptive playback that keeps casual downloaders out without hurting viewer experience or startup time.',
    transcript: `[00:00] Every video platform you use daily relies on the same core idea: chop the file into small segments.
[00:22] HLS packaging produces a master manifest listing several bitrate renditions.
[00:47] The player measures available bandwidth and switches renditions on the fly — this is adaptive bitrate streaming.
[01:20] Serving raw MP4 files makes downloading trivial, so production platforms sign every manifest request.
[01:58] A signed token is an HMAC of the video slug plus an expiry timestamp; ten minutes is a practical window.
[02:35] Segment requests carry the same token, and the edge validates it before every response.
[03:11] Combine tokens with referer checks and strict CORS, and hotlinking scripts stop working.`,
    duration: 982,
    thumbnail_url: 'https://picsum.photos/seed/hls-pipeline/640/360',
    status: 'published',
    age_restricted: true,
    view_count: 8421,
    published_at: new Date(Date.now() - 3 * 86400_000).toISOString(),
    category: { name: 'Technology', slug: 'technology' },
    tags: [
      { name: 'Tutorial', slug: 'tutorial' },
      { name: 'Streaming', slug: 'streaming' },
      { name: 'Engineering', slug: 'engineering' },
    ],
    faqs: [
      {
        question: 'Why do video platforms use HLS instead of MP4 files?',
        answer:
          'HLS splits video into short segments served over plain HTTP, which enables adaptive bitrate switching, fast seeking, CDN caching, and short-lived signed playback tokens that make bulk downloading impractical.',
      },
      {
        question: 'How long should a signed playback token stay valid?',
        answer:
          'Ten to fifteen minutes is the sweet spot: long enough that a viewer never sees a mid-playback expiry, short enough that a leaked URL becomes useless to scrapers.',
      },
    ],
    demo_manifest: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  },
  {
    id: 'c0000000-0000-4000-8000-000000000003',
    slug: 'sunrise-photography-basics',
    title: 'Sunrise Photography Basics: Light, Timing and Composition',
    description:
      'A practical guide to photographing sunrise: planning the shoot around golden hour, exposing for highlights, and composing landscapes that read well.',
    summary:
      'Good sunrise photography starts the evening before. Check what time golden hour begins, scout an east-facing location, and arrive twenty minutes early to set up. Meter for the highlights so the sky keeps its color, and let the foreground fall into soft silhouette. Use a tripod with a two-second timer to avoid shake at slow shutter speeds. Compose with a clear subject in the lower third so the sun has somewhere to rise into. Bracket your exposures when the dynamic range is too wide for one frame.',
    transcript: `[00:00] Sunrise light is brief, directional, and warm — three qualities that make it worth waking up for.
[00:19] Golden hour starts roughly thirty minutes before the sun crests the horizon.
[00:41] Scout your location in daylight: you want an unobstructed east-facing view plus a strong foreground subject.
[01:12] Expose for the sky, not the land. Highlight detail is nearly impossible to recover; shadow detail is not.
[01:47] A sturdy tripod and a two-second timer eliminate the camera shake that ruins long exposures.
[02:20] Place your subject in the lower third so the composition has room for the sun to rise into.
[02:58] When the scene exceeds your sensor's dynamic range, bracket three frames and blend them later.`,
    duration: 613,
    thumbnail_url: 'https://picsum.photos/seed/sunrise-photography/640/360',
    status: 'published',
    age_restricted: true,
    view_count: 4217,
    published_at: new Date(Date.now() - 1 * 86400_000).toISOString(),
    category: { name: 'Education', slug: 'education' },
    tags: [
      { name: 'Tutorial', slug: 'tutorial' },
      { name: 'Photography', slug: 'photography' },
    ],
    faqs: [
      {
        question: 'What camera settings work best for sunrise photos?',
        answer:
          'Start at ISO 100, an aperture around f/8 for landscape depth of field, and let shutter speed fall where the highlight metering puts it — often 1/15 to 1 second on a tripod.',
      },
    ],
    demo_manifest: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  },
];

export const FIXTURE_CATEGORIES = [
  { name: 'Education', slug: 'education' },
  { name: 'Documentary', slug: 'documentary' },
  { name: 'Technology', slug: 'technology' },
  { name: 'Lifestyle', slug: 'lifestyle' },
];
