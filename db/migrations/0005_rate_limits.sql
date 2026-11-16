-- Per-client request counters for rate limiting, one row per client, kind of
-- request and time window. Client keys are hashed, so no IP addresses are stored.
-- Old windows are deleted by the app as it goes.

create table rate_limit_hits (
  bucket text not null,
  client_key text not null,
  window_start timestamptz not null,
  hits integer not null default 1,
  primary key (bucket, client_key, window_start)
);

create index rate_limit_hits_window_start_idx on rate_limit_hits (window_start);
