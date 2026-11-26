-- IMDb personal library schema.
-- This migration is intentionally isolated from NotesBridge storage.
create schema if not exists imdb_private;

create table if not exists imdb_private.titles (
  imdb_id text primary key check (imdb_id ~ '^tt[0-9]+$'),
  title text,
  original_title text,
  title_type text,
  year integer,
  end_year integer,
  genres text[] not null default '{}',
  runtime_minutes integer,
  imdb_average_rating numeric(3,1),
  imdb_num_votes bigint,
  imdb_url text generated always as ('https://www.imdb.com/title/' || imdb_id || '/') stored,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists imdb_private.user_ratings (
  imdb_id text primary key references imdb_private.titles(imdb_id) on delete cascade,
  rating smallint not null check (rating between 1 and 10),
  date_rated date,
  imported_at timestamptz not null default now()
);

create table if not exists imdb_private.watchlist_items (
  imdb_id text primary key references imdb_private.titles(imdb_id) on delete cascade,
  position integer,
  added_at timestamptz,
  imported_at timestamptz not null default now()
);

create table if not exists imdb_private.custom_lists (
  list_id text not null,
  list_name text not null,
  imdb_id text not null references imdb_private.titles(imdb_id) on delete cascade,
  position integer,
  added_at timestamptz,
  imported_at timestamptz not null default now(),
  primary key (list_id, imdb_id)
);

create table if not exists imdb_private.import_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('ratings','watchlist','custom_list','checkins')),
  filename text not null,
  rows_seen integer not null default 0,
  rows_imported integer not null default 0,
  rows_skipped integer not null default 0,
  status text not null default 'completed' check (status in ('processing','completed','failed')),
  error_summary text,
  imported_at timestamptz not null default now()
);

create index if not exists imdb_titles_genres_idx on imdb_private.titles using gin (genres);
create index if not exists imdb_watchlist_position_idx on imdb_private.watchlist_items(position);
create index if not exists imdb_custom_lists_name_idx on imdb_private.custom_lists(list_name);

alter table imdb_private.titles enable row level security;
alter table imdb_private.user_ratings enable row level security;
alter table imdb_private.watchlist_items enable row level security;
alter table imdb_private.custom_lists enable row level security;
alter table imdb_private.import_runs enable row level security;

revoke all on schema imdb_private from public, anon, authenticated;
grant usage on schema imdb_private to service_role;
grant select, insert, update, delete on all tables in schema imdb_private to service_role;
alter default privileges in schema imdb_private grant select, insert, update, delete on tables to service_role;

comment on schema imdb_private is 'Private personal IMDb library. Access only from trusted server-side integration; not exposed through Supabase Data API.';
comment on table imdb_private.user_ratings is 'Personal ratings exported by the IMDb account owner. Source of truth for personal scores.';
comment on table imdb_private.watchlist_items is 'Personal IMDb Watchlist imported from an owner-exported CSV.';
