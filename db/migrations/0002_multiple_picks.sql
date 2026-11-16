-- Allow picking several songs per round.
--
-- session_rounds.picked_track_key (one song) becomes picked_track_keys (a list
-- of 1 to 10 songs). Existing picks are copied over as one-song lists.

alter table session_rounds add column picked_track_keys text[];

update session_rounds
   set picked_track_keys = array[picked_track_key]
 where picked_track_key is not null;

alter table session_rounds drop constraint pick_complete;
alter table session_rounds drop column picked_track_key;

alter table session_rounds add constraint pick_complete check (
  (picked_track_keys is null and picked_at is null)
  or (picked_track_keys is not null and picked_at is not null and cardinality(picked_track_keys) between 1 and 10)
);
