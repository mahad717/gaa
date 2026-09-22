-- ============================================================================
-- WASMO PLATFORM — Supabase / PostgreSQL Schema
-- ----------------------------------------------------------------------------
-- Design goals:
--   1. SEO/AEO: slug lookups, full-text + trigram search, 50–100 word summary
--      field (direct-answer block for LLMs / answer engines), FAQ entities.
--   2. Security: strict RLS — public can only read PUBLISHED videos; all
--      writes go through admin/moderator policies or service_role only.
--   3. Performance: B-tree indexes on slugs, composite hot-path indexes,
--      GIN full-text index, trigram fuzzy title index.
--   4. Video security: `stream_id` / internal media paths are NEVER exposed
--      through public SELECTs used by the frontend — the Cloudflare Worker
--      exchanges a slug for short-lived signed HLS URLs (see worker.js).
-- Apply: Supabase Dashboard → SQL Editor → paste → Run.
-- ============================================================================

create extension if not exists pg_trgm;

-- ============================================================================
-- 1. PROFILES (1:1 with auth.users — age verification & roles)
-- ============================================================================
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  username        text unique check (char_length(username) between 3 and 32),
  role            text not null default 'user'
                    check (role in ('user','creator','moderator','admin')),
  date_of_birth   date,
  age_verified    boolean not null default false,
  age_verified_at timestamptz,
  country_code    char(2),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists profiles_role_idx on public.profiles (role);

-- ============================================================================
-- 2. CATEGORIES & TAGS (many-to-many with videos)
-- ============================================================================
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 80),
  slug        text not null unique,               -- unique => implicit B-tree idx
  description text,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 60),
  slug       text not null unique,                -- unique => implicit B-tree idx
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 3. VIDEOS
-- ============================================================================
-- AEO summary validator: allows NULL, else requires 50–100 whitespace words.
create or replace function public.is_aeo_summary(s text)
returns boolean language sql immutable as $$
  select s is null
      or array_length(regexp_split_to_array(trim(s), '\s+'), 1) between 50 and 100;
$$;

create table if not exists public.videos (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,            -- unique => implicit B-tree idx
  title          text not null check (char_length(title) between 3 and 200),
  description    text,
  summary        text check (public.is_aeo_summary(summary)),  -- AEO: 50–100 words
  transcript     text,                            -- AEO: full crawlable transcript
  duration       integer check (duration > 0),    -- seconds
  thumbnail_url  text,
  -- ⚠ INTERNAL ONLY — never select these columns into client payloads.
  --   The edge worker (worker.js) signs short-lived HLS URLs per request.
  stream_id      text,                            -- Cloudflare Stream asset id
  hls_path       text,                            -- e.g. /media/{slug}/manifest.m3u8
  status         text not null default 'draft'
                   check (status in ('draft','scheduled','published','removed')),
  age_restricted boolean not null default true,
  category_id    uuid references public.categories(id) on delete set null,
  view_count     bigint not null default 0 check (view_count >= 0),
  like_count     integer not null default 0 check (like_count >= 0),
  published_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Hot paths: listing published (newest first), per-category listings
create index if not exists videos_published_idx
  on public.videos (status, published_at desc nulls last);
create index if not exists videos_category_idx
  on public.videos (category_id) where status = 'published';
create index if not exists videos_trending_idx
  on public.videos (view_count desc) where status = 'published';

-- Full-text search column (SEO + AEO retrieval over title/summary/description/transcript)
alter table public.videos add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')),       'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')),     'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(transcript, '')),  'D')
  ) stored;
create index if not exists videos_search_vector_idx
  on public.videos using gin (search_vector);

-- Fuzzy title matching (typo-tolerant search suggestions)
create index if not exists videos_title_trgm_idx
  on public.videos using gin (title gin_trgm_ops);

-- ============================================================================
-- 4. VIDEO TAGS (junction) & FAQS (AEO entities)
-- ============================================================================
create table if not exists public.video_tags (
  video_id uuid not null references public.videos(id) on delete cascade,
  tag_id   uuid not null references public.tags(id)   on delete cascade,
  primary key (video_id, tag_id)
);
create index if not exists video_tags_tag_idx on public.video_tags (tag_id);

create table if not exists public.video_faqs (
  id       uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  question text not null check (char_length(question) between 8 and 300),
  answer   text not null check (char_length(answer)   between 8 and 1000),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists video_faqs_video_idx on public.video_faqs (video_id, position);

-- ============================================================================
-- 5. BOOKMARKS (per-user library)
-- ============================================================================
create table if not exists public.bookmarks (
  user_id   uuid not null references auth.users(id)    on delete cascade,
  video_id  uuid not null references public.videos(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);
create index if not exists bookmarks_user_recent_idx
  on public.bookmarks (user_id, created_at desc);

-- ============================================================================
-- 6. VIEW EVENTS (lightweight analytics feed for view_count increments)
-- ============================================================================
create table if not exists public.view_events (
  id         bigint generated always as identity primary key,
  video_id   uuid not null references public.videos(id) on delete cascade,
  viewer_fingerprint text,          -- hashed ip/ua from the edge worker, no raw PII
  created_at timestamptz not null default now()
);
create index if not exists view_events_video_idx on public.view_events (video_id, created_at desc);

-- ============================================================================
-- 7. HELPERS & TRIGGERS
-- ============================================================================
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists videos_set_updated_at on public.videos;
create trigger videos_set_updated_at before update on public.videos
  for each row execute function public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile when a user signs up via Supabase Auth
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'username',
      'user_' || left(replace(new.id::text, '-', ''), 10)
    )
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role check helper (used by RLS policies)
create or replace function public.is_moderator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('moderator','admin')
  );
$$;

-- ============================================================================
-- 8. ROW-LEVEL SECURITY
-- ============================================================================
alter table public.profiles   enable row level security;
alter table public.categories enable row level security;
alter table public.tags       enable row level security;
alter table public.videos     enable row level security;
alter table public.video_tags enable row level security;
alter table public.video_faqs enable row level security;
alter table public.bookmarks  enable row level security;
alter table public.view_events enable row level security;

-- profiles: readable (public usernames), writable by owner; admins see all
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (true);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select p.role from public.profiles p where p.id = auth.uid())
  );
-- NOTE: role escalation is blocked — an updater must keep their existing role.

-- categories / tags: public read, admin-only writes
drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories
  for select using (true);
drop policy if exists categories_admin_write on public.categories;
create policy categories_admin_write on public.categories
  for all using (public.is_moderator()) with check (public.is_moderator());

drop policy if exists tags_select on public.tags;
create policy tags_select on public.tags
  for select using (true);
drop policy if exists tags_admin_write on public.tags;
create policy tags_admin_write on public.tags
  for all using (public.is_moderator()) with check (public.is_moderator());

-- videos: PUBLIC can only SELECT published rows. There is intentionally NO
-- insert/update/delete policy for anon or normal users — even with the anon
-- key, nothing can be written without service_role or a moderator account.
drop policy if exists videos_select_published on public.videos;
create policy videos_select_published on public.videos
  for select using (status = 'published');

drop policy if exists videos_moderator_insert on public.videos;
create policy videos_moderator_insert on public.videos
  for insert with check (public.is_moderator());

drop policy if exists videos_moderator_update on public.videos;
create policy videos_moderator_update on public.videos
  for update using (public.is_moderator()) with check (public.is_moderator());

drop policy if exists videos_admin_delete on public.videos;
create policy videos_admin_delete on public.videos
  for delete using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- junction / faqs: public read, admin writes
drop policy if exists video_tags_select on public.video_tags;
create policy video_tags_select on public.video_tags for select using (true);
drop policy if exists video_tags_admin_write on public.video_tags;
create policy video_tags_admin_write on public.video_tags
  for all using (public.is_moderator()) with check (public.is_moderator());

drop policy if exists video_faqs_select on public.video_faqs;
create policy video_faqs_select on public.video_faqs for select using (true);
drop policy if exists video_faqs_admin_write on public.video_faqs;
create policy video_faqs_admin_write on public.video_faqs
  for all using (public.is_moderator()) with check (public.is_moderator());

-- bookmarks: strictly per-user
drop policy if exists bookmarks_select_own on public.bookmarks;
create policy bookmarks_select_own on public.bookmarks
  for select using (user_id = auth.uid());
drop policy if exists bookmarks_write_own on public.bookmarks;
create policy bookmarks_write_own on public.bookmarks
  for insert with check (user_id = auth.uid());
drop policy if exists bookmarks_delete_own on public.bookmarks;
create policy bookmarks_delete_own on public.bookmarks
  for delete using (user_id = auth.uid());

-- view_events: anyone may log a view, only moderators may read analytics
drop policy if exists view_events_insert on public.view_events;
create policy view_events_insert on public.view_events
  for insert with check (true);
drop policy if exists view_events_select_admin on public.view_events;
create policy view_events_select_admin on public.view_events
  for select using (public.is_moderator());

-- ============================================================================
-- 9. RPCs (callable from client via supabase.rpc / edge worker)
-- ============================================================================
-- Atomic, race-safe view counter. SECURITY DEFINER is required because anon
-- has no UPDATE grant on videos; the function is slug-scoped and exposes no data.
create or replace function public.increment_view_count(p_slug text, p_fingerprint text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  select id into v_id from public.videos where slug = p_slug and status = 'published';
  if v_id is null then return; end if;
  update public.videos set view_count = view_count + 1 where id = v_id;
  insert into public.view_events (video_id, viewer_fingerprint) values (v_id, p_fingerprint);
end $$;
grant execute on function public.increment_view_count(text, text) to anon, authenticated;

-- AEO-ready search: ranked full-text over title/summary/description/transcript.
-- SECURITY INVOKER (default) → RLS applies → only published videos are returned.
create or replace function public.search_videos(
  q text,
  page_size integer default 24,
  page integer default 1
)
returns table (
  id uuid, slug text, title text, summary text, description text,
  duration integer, thumbnail_url text, view_count bigint,
  published_at timestamptz, rank real
)
language sql stable as $$
  select v.id, v.slug, v.title, v.summary, v.description,
         v.duration, v.thumbnail_url, v.view_count, v.published_at,
         ts_rank(v.search_vector, websearch_to_tsquery('english', q)) as rank
  from public.videos v
  where v.status = 'published'
    and v.search_vector @@ websearch_to_tsquery('english', q)
  order by rank desc, v.view_count desc
  limit least(page_size, 50) offset (greatest(page, 1) - 1) * least(page_size, 50)
$$;

-- ============================================================================
-- 10. SEED DATA — ⚠ DEMO CONTENT ONLY. Delete this section before production.
--     Content is intentionally neutral placeholder media.
-- ============================================================================
insert into public.categories (id, name, slug, description, position) values
  ('11111111-1111-4111-8111-111111111111', 'Somali Wasmo', 'somali-wasmo', 'Somali wasmo videos.', 1),
  ('22222222-2222-4222-8222-222222222222', 'Wasmo',        'wasmo',        'Wasmo videos.',        2)
on conflict (id) do nothing;

insert into public.tags (id, name, slug) values
  ('aaaa1111-0000-4000-8000-000000000001', 'Tutorial',      'tutorial'),
  ('aaaa1111-0000-4000-8000-000000000002', 'Streaming',     'streaming'),
  ('aaaa1111-0000-4000-8000-000000000003', 'Nature',        'nature'),
  ('aaaa1111-0000-4000-8000-000000000004', 'Engineering',   'engineering'),
  ('aaaa1111-0000-4000-8000-000000000005', 'Photography',   'photography')
on conflict (id) do nothing;

insert into public.videos
  (id, slug, title, description, summary, transcript, duration, thumbnail_url,
   stream_id, hls_path, status, age_restricted, category_id, view_count, published_at)
values
  ('c0000000-0000-4000-8000-000000000001', 'coral-reefs-silent-cities',
   'Coral Reefs: The Silent Cities',
   'A short documentary exploring how coral reef ecosystems build vast underwater structures that shelter roughly a quarter of all marine species.',
   'Coral reefs are massive living structures built by tiny animals called polyps. This documentary explains how reefs form over thousands of years, why they shelter about a quarter of all marine species, and how coral bleaching threatens them when ocean temperatures rise. You will learn the three main threats reefs face today, what restoration projects are doing with coral gardening, and the single most effective action individuals can take to support reef conservation worldwide.',
   E'[00:00] Coral reefs are often called the rainforests of the sea, and for good reason.\n[00:14] Each reef begins with a single polyp — an animal the size of a pencil eraser.\n[00:31] Over thousands of years, colonies of polyps deposit calcium carbonate, building structures visible from space.\n[01:05] Scientists estimate reefs support roughly a quarter of all marine species despite covering less than one percent of the ocean floor.\n[01:42] When water temperatures rise, corals expel the algae living in their tissues — a process called bleaching.\n[02:18] Restoration teams now grow coral fragments in underwater nurseries and replant them onto damaged reefs.\n[03:02] The takeaway: reducing carbon emissions remains the single most effective way to protect reefs worldwide.',
   754, 'https://picsum.photos/seed/coral-reef/640/360',
   'demo-stream-coral', '/media/coral-reefs-silent-cities/manifest.m3u8',
   'published', true, '22222222-2222-4222-8222-222222222222', 15230, now() - interval '9 days'),

  ('c0000000-0000-4000-8000-000000000002', 'building-an-hls-video-pipeline',
   'Building an HLS Video Pipeline That Resists Downloading',
   'An engineering walkthrough of adaptive bitrate streaming: HLS manifests, segmenting, signed playback tokens and edge caching with Cloudflare Workers.',
   'This tutorial shows how a production video pipeline works end to end. First, a master file is transcoded into multiple bitrate renditions and packaged as an HLS manifest with short segments. Next, an edge worker signs playback tokens that expire in ten minutes, so playlist URLs cannot be reused or shared. Finally, strict referer and origin checks block third-party embeds. The result is smooth adaptive playback that keeps casual downloaders out without hurting viewer experience or startup time.',
   E'[00:00] Every video platform you use daily relies on the same core idea: chop the file into small segments.\n[00:22] HLS packaging produces a master manifest listing several bitrate renditions.\n[00:47] The player measures available bandwidth and switches renditions on the fly — this is adaptive bitrate streaming.\n[01:20] Serving raw MP4 files makes downloading trivial, so production platforms sign every manifest request.\n[01:58] A signed token is an HMAC of the video slug plus an expiry timestamp; ten minutes is a practical window.\n[02:35] Segment requests carry the same token, and the edge validates it before every response.\n[03:11] Combine tokens with referer checks and strict CORS, and hotlinking scripts stop working.',
   982, 'https://picsum.photos/seed/hls-pipeline/640/360',
   'demo-stream-hls', '/media/building-an-hls-video-pipeline/manifest.m3u8',
   'published', true, '33333333-3333-4333-8333-333333333333', 8421, now() - interval '3 days'),

  ('c0000000-0000-4000-8000-000000000003', 'sunrise-photography-basics',
   'Sunrise Photography Basics: Light, Timing and Composition',
   'A practical guide to photographing sunrise: planning the shoot around golden hour, exposing for highlights, and composing landscapes that read well.',
   'Good sunrise photography starts the evening before. Check what time golden hour begins, scout an east-facing location, and arrive twenty minutes early to set up. Meter for the highlights so the sky keeps its color, and let the foreground fall into soft silhouette. Use a tripod with a two-second timer to avoid shake at slow shutter speeds. Compose with a clear subject in the lower third so the sun has somewhere to rise into. Bracket your exposures when the dynamic range is too wide for one frame.',
   E'[00:00] Sunrise light is brief, directional, and warm — three qualities that make it worth waking up for.\n[00:19] Golden hour starts roughly thirty minutes before the sun crests the horizon.\n[00:41] Scout your location in daylight: you want an unobstructed east-facing view plus a strong foreground subject.\n[01:12] Expose for the sky, not the land. Highlight detail is nearly impossible to recover; shadow detail is not.\n[01:47] A sturdy tripod and a two-second timer eliminate the camera shake that ruins long exposures.\n[02:20] Place your subject in the lower third so the composition has room for the sun to rise into.\n[02:58] When the scene exceeds your sensor''s dynamic range, bracket three frames and blend them later.',
   613, 'https://picsum.photos/seed/sunrise-photography/640/360',
   'demo-stream-sunrise', '/media/sunrise-photography-basics/manifest.m3u8',
   'published', true, '11111111-1111-4111-8111-111111111111', 4217, now() - interval '1 day')
on conflict (id) do nothing;

insert into public.video_tags (video_id, tag_id) values
  ('c0000000-0000-4000-8000-000000000001', 'aaaa1111-0000-4000-8000-000000000003'),
  ('c0000000-0000-4000-8000-000000000002', 'aaaa1111-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000002', 'aaaa1111-0000-4000-8000-000000000002'),
  ('c0000000-0000-4000-8000-000000000002', 'aaaa1111-0000-4000-8000-000000000004'),
  ('c0000000-0000-4000-8000-000000000003', 'aaaa1111-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000003', 'aaaa1111-0000-4000-8000-000000000005')
on conflict do nothing;

insert into public.video_faqs (video_id, question, answer, position) values
  ('c0000000-0000-4000-8000-000000000001', 'Why are coral reefs important to ocean ecosystems?',
   'Coral reefs shelter roughly a quarter of all marine species, protect coastlines from storm surge, and support fishing and tourism economies worth billions of dollars annually.', 1),
  ('c0000000-0000-4000-8000-000000000001', 'What causes coral bleaching?',
   'When ocean water stays too warm, corals expel the symbiotic algae living in their tissues. The coral turns white and, if temperatures do not fall, can starve and die.', 2),
  ('c0000000-0000-4000-8000-000000000002', 'Why do video platforms use HLS instead of MP4 files?',
   'HLS splits video into short segments served over plain HTTP, which enables adaptive bitrate switching, fast seeking, CDN caching, and short-lived signed playback tokens that make bulk downloading impractical.', 1),
  ('c0000000-0000-4000-8000-000000000002', 'How long should a signed playback token stay valid?',
   'Ten to fifteen minutes is the sweet spot: long enough that a viewer never sees a mid-playback expiry, short enough that a leaked URL becomes useless to scrapers.', 2),
  ('c0000000-0000-4000-8000-000000000003', 'What camera settings work best for sunrise photos?',
   'Start at ISO 100, an aperture around f/8 for landscape depth of field, and let shutter speed fall where the highlight metering puts it — often 1/15 to 1 second on a tripod.', 1)
on conflict do nothing;

-- ============================================================================
-- End of schema. Optional next steps:
--   * Create an admin: insert into public.profiles (id, role)
--     values ('<auth-user-uuid>', 'admin') on conflict (id)
--     do update set role = 'admin';
--   * Upload assets to Cloudflare Stream and backfill stream_id + hls_path.
-- ============================================================================
