-- Songs removed from a playlist are kept, marked with when they were removed,
-- so the removal can be undone.

alter table playlist_tracks add column removed_at timestamptz;
