/**
 * Supabase data layer.
 * Strategy: try live Supabase (RLS-protected, published-only via anon key).
 * If the schema has not been applied yet (or network fails), fall back to
 * local fixtures so the demo always renders. Public projections NEVER select
 * stream_id / hls_path — those stay server-side for the edge worker.
 */

import { createClient } from '@supabase/supabase-js';
import { FIXTURE_VIDEOS, type Video } from './fixtures';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Browser-safe client (anon key only; RLS in schema.sql is the boundary). */
export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { 'x-application-name': 'wasmo-web' } },
    })
  : null;

/** Public fields only — mirrors schema.sql RLS expectations. */
const VIDEO_SELECT = `
  id, slug, title, description, summary, transcript, duration, thumbnail_url,
  status, age_restricted, view_count, published_at,
  categories ( name, slug ),
  video_tags ( tags ( name, slug ) ),
  video_faqs ( question, answer, position )
`;

/** Flatten Supabase's nested joins into the Video shape. */
function flatten(row: Record<string, unknown>): Video {
  const vt = (row.video_tags ?? []) as Array<{ tags: { name: string; slug: string } | null }>;
  const faqs = (row.video_faqs ?? []) as Array<{ question: string; answer: string; position: number }>;
  return {
    ...(row as unknown as Video),
    category: (row.categories as { name: string; slug: string } | null) ?? null,
    tags: vt.map((x) => x.tags).filter(Boolean) as Video['tags'],
    faqs: [...faqs].sort((a, b) => a.position - b.position).map(({ question, answer }) => ({ question, answer })),
  } as Video;
}

export async function getVideos(limit = 24): Promise<{ videos: Video[]; source: 'supabase' | 'fixtures' }> {
  if (!supabase) return { videos: FIXTURE_VIDEOS.slice(0, limit), source: 'fixtures' };
  try {
    const { data, error } = await supabase
      .from('videos')
      .select(VIDEO_SELECT)
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(limit);
    if (error || !data || data.length === 0) throw error ?? new Error('empty');
    return { videos: data.map(flatten), source: 'supabase' };
  } catch {
    // Schema not applied yet / network error → demo fixtures
    return { videos: FIXTURE_VIDEOS.slice(0, limit), source: 'fixtures' };
  }
}

export async function getVideoBySlug(
  slug: string
): Promise<{ video: Video | null; source: 'supabase' | 'fixtures' }> {
  if (!supabase) {
    return { video: FIXTURE_VIDEOS.find((v) => v.slug === slug) ?? null, source: 'fixtures' };
  }
  try {
    const { data, error } = await supabase
      .from('videos')
      .select(VIDEO_SELECT)
      .eq('slug', slug)
      .eq('status', 'published')
      .limit(1);
    if (error) throw error;
    if (data && data.length > 0) return { video: flatten(data[0]), source: 'supabase' };
    return { video: null, source: 'supabase' };
  } catch {
    return { video: FIXTURE_VIDEOS.find((v) => v.slug === slug) ?? null, source: 'fixtures' };
  }
}

/** Race-safe view counter via RPC (see schema.sql §9). Fire-and-forget. */
export function trackView(slug: string) {
  if (!supabase) return;
  supabase.rpc('increment_view_count', { p_slug: slug }).then(
    () => undefined,
    () => undefined
  );
}
