-- How the user has responded to each artist in a session: picks count for,
-- skips and "Not for me" count against. Keyed by artist key.

alter table sessions add column artist_feedback jsonb not null default '{}'::jsonb;
