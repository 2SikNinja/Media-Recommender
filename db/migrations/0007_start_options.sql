-- Sessions can start from up to three seed songs and choose their playlist
-- length (25, 50 or 100 songs). Rounds already have total_rounds.

alter table sessions
  add column extra_seeds jsonb not null default '[]'::jsonb
    check (jsonb_typeof(extra_seeds) = 'array' and jsonb_array_length(extra_seeds) <= 2),
  add column playlist_size integer not null default 50 check (playlist_size between 10 and 100);

alter table playlist_tracks drop constraint playlist_tracks_position_check;
alter table playlist_tracks add constraint playlist_tracks_position_check check (position between 1 and 100);
