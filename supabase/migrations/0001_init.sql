-- Pickify initial schema.
--
-- Sessions are anonymous for v1: the API routes use the service role key and
-- identify a session by its random UUID. RLS is enabled on every table with no
-- policies, so the public anon key cannot read or write anything directly.

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- One row per song we have seen, keyed by normalized "artist::title".
-- Caches Last.fm similar tracks and the YouTube match so we don't repeat lookups.
create table track_cache (
  track_key text primary key check (length(track_key) between 3 and 500),
  artist text not null check (length(artist) between 1 and 200),
  title text not null check (length(title) between 1 and 200),
  duration_seconds integer check (duration_seconds between 0 and 7200),
  image_url text,
  similar_tracks jsonb,
  similar_fetched_at timestamptz,
  youtube_video_id text check (youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  youtube_source text check (youtube_source in ('ytmusicSongs', 'ytmusicVideos', 'youtubeDataApi')),
  youtube_confidence real check (youtube_confidence between 0 and 1),
  youtube_resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint youtube_match_complete check (
    (youtube_video_id is null and youtube_source is null and youtube_resolved_at is null)
    or (youtube_video_id is not null and youtube_source is not null and youtube_resolved_at is not null)
  )
);

create trigger track_cache_set_updated_at
  before update on track_cache
  for each row execute function set_updated_at();

-- One picking session: a seed song, a few rounds of 10 choices, then a playlist.
-- candidate_pool holds the scored pool (see src/lib/candidatePool.ts).
create table sessions (
  id uuid primary key default gen_random_uuid(),
  seed_track_key text not null,
  seed_artist text not null,
  seed_title text not null,
  status text not null default 'picking' check (status in ('picking', 'complete')),
  current_round integer not null default 1 check (current_round >= 1),
  total_rounds integer not null default 5 check (total_rounds between 1 and 10),
  candidate_pool jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint current_round_in_range check (current_round <= total_rounds + 1)
);

create trigger sessions_set_updated_at
  before update on sessions
  for each row execute function set_updated_at();

-- The 10 songs shown in each round and the one the user picked.
-- The primary key makes "submit pick for round N" safe to retry.
create table session_rounds (
  session_id uuid not null references sessions (id) on delete cascade,
  round_number integer not null check (round_number >= 1),
  candidates jsonb not null check (jsonb_typeof(candidates) = 'array'),
  picked_track_key text,
  picked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (session_id, round_number),
  constraint pick_complete check ((picked_track_key is null) = (picked_at is null))
);

-- The final playlist built from a finished session.
create table playlists (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references sessions (id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  created_at timestamptz not null default now()
);

create table playlist_tracks (
  playlist_id uuid not null references playlists (id) on delete cascade,
  position integer not null check (position between 1 and 50),
  track_key text not null,
  artist text not null,
  title text not null,
  youtube_video_id text check (youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  primary key (playlist_id, position),
  unique (playlist_id, track_key)
);

-- Lets us clean up old abandoned sessions later.
create index sessions_created_at_idx on sessions (created_at);

alter table track_cache enable row level security;
alter table sessions enable row level security;
alter table session_rounds enable row level security;
alter table playlists enable row level security;
alter table playlist_tracks enable row level security;
