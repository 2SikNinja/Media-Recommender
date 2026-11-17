-- Playlists can be reordered and have songs added. position stays each song's
-- fixed ID within its playlist; sort_order is where it shows, and null means
-- "where its position puts it". Added songs take the next position, so
-- positions can now go past the starting length.

alter table playlist_tracks add column sort_order integer;

alter table playlist_tracks drop constraint playlist_tracks_position_check;
alter table playlist_tracks add constraint playlist_tracks_position_check check (position between 1 and 200);
