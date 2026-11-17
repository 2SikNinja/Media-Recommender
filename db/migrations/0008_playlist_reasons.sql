-- Why each song is in its playlist: the seed, one of the user's picks, or
-- similar to some of them. Null for playlists built before this was recorded.

alter table playlist_tracks
  add column reason jsonb check (reason is null or jsonb_typeof(reason) = 'object');
