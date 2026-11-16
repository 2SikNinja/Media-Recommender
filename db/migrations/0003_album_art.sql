-- Remember when album art was last looked up for a song, including lookups
-- that found nothing, so missing covers aren't searched for on every visit.

alter table track_cache add column art_checked_at timestamptz;
