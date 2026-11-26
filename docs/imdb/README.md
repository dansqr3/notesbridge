# IMDb + ChatGPT + Notion integration

## Status and boundary

This is a personal, non-commercial integration. It is deliberately separate from the Apple Notes MCP relay. Do not add IMDb handlers to NotesBridge's OAuth/MCP routes.

IMDb does not provide a supported public API for reading a user's private Watchlist and ratings. The account owner exports CSV files manually. Never ask for an IMDb password, session cookie, or browser storage. Do not scrape imdb.com or automate account login.

Official account exports:
- Ratings: IMDb profile menu -> Your Ratings -> Export.
- Watchlist: Your Lists -> Your Watchlist -> Export.
- Custom list: open the list -> Export.
Each list is exported separately. Preserve IMDb's `Const` column as the canonical `imdb_id`.

## Components

- Supabase: private schema `imdb_private`; tables for title metadata, personal ratings, Watchlist, custom lists, and import audit.
- Vercel: standalone MCP/API service, separate project and deployment; secrets stay server-side.
- ChatGPT: call MCP tools for search, ratings, Watchlist, summaries and recommendations.
- Notion: optional presentation/catalog mirror. Supabase remains canonical; Notion must not overwrite IMDb source data.

## Data model

See `supabase/migrations/20261126000100_imdb_personal_library.sql`.

All tables are in a non-exposed schema with RLS enabled and no public grants. Only a trusted service-side secret can access them. Do not expose a Supabase secret/service_role key to browser code.

## Import workflow

1. Export ratings.csv and watchlist.csv from the signed-in IMDb account.
2. Upload the CSVs through an authenticated private import endpoint, or run the importer locally.
3. Validate headers and IMDb IDs; reject files over a configurable size.
4. Upsert title identifiers and user data. For a re-import, replace the matching source collection in one transaction; never delete other collections.
5. Record an import_runs row with counts. Retain no raw CSV after import unless the user explicitly requests it.
6. The owner can export/import custom lists one file at a time.

Expected common columns:
- Ratings: `Const`, `Your Rating`, `Date Rated`, `Title`, `Title Type`, `Year`, `Genres`.
- Watchlist/list: `Const`, `Position`, `Created`, `Title`, `Title Type`, `Year`.

The importer must tolerate extra columns, BOM, quoted delimiters, and missing optional fields. Invalid IDs/ratings are skipped with counts, not guessed.

## MCP tool contract

A standalone MCP service should expose:
- `imdb_search_titles(query, type?, genre?, year_from?, year_to?, min_rating?, limit?)`
- `imdb_get_title(imdb_id)`
- `imdb_get_my_ratings(limit?, offset?, min_rating?, max_rating?)`
- `imdb_get_watchlist(limit?, offset?)`
- `imdb_get_custom_lists()`
- `imdb_get_list_items(list_id, limit?, offset?)`
- `imdb_get_taste_profile()` — aggregate own ratings by genre/year/type; no claims beyond imported data.
- `imdb_recommend_titles(limit?, exclude_watchlist?, min_rating?, genres?)` — recommendation candidates from licensed/public data sources; clearly label provenance.
- `imdb_import_status()`

All tools are read-only except an explicitly requested CSV import operation. No tool should write ratings back into IMDb because no supported public write API was verified.

## Metadata source

For title metadata, prefer an appropriately licensed source. IMDb non-commercial datasets are limited to personal/non-commercial use and their terms prohibit scraping and republishing/creating a general database. Keep use individual and private; include IMDb's required attribution wherever applicable. The datasets do not contain personal account ratings or Watchlist; those come only from the owner's account exports.

Do not bulk copy IMDb datasets into Notion or publish a hosted database. For broad metadata/search, consider a separately licensed provider and preserve source attribution.

## Notion

Suggested databases:
- Films & Series: IMDb ID, title, type, year, genres, IMDb rating, vote count, personal rating, status, IMDb URL, last synced.
- Lists: name, source list ID.
- Imports: source, filename, rows seen/imported/skipped, timestamp, status.

Sync direction is Supabase -> Notion. Personal status and notes in Notion are user-owned fields and must not be overwritten by sync.

## Deploy checklist

- Create a separate Vercel project (e.g. `imdb-mcp`) from this repository using a dedicated root directory.
- Use a separate Supabase project for production data if desired; do not put IMDb tables in NotesBridge.
- Configure secret environment variables only on the server.
- Add OAuth/authentication before enabling any private import/read tools.
- Use region EU (Frankfurt) where supported by the chosen deployment and data plan.
- Configure a daily metadata refresh only for permitted/licensed sources; user CSV imports remain manual.
- Test CSV parsing, idempotent re-import, authorization, and RLS. Deploy Preview first.
- Do not merge/deploy to production until the user explicitly reviews the PR and connects the IMDb account exports.

## Official references

- IMDb ratings export: https://help.imdb.com/article/imdb/featured-content/ratings-faq/G67Y87TFYYP6TWAV
- IMDb list export: https://help.imdb.com/article/imdb/track-movies-tv/lists-faq/GNQMN47VZSE7KW38
- IMDb software/data use terms: https://origin-help.imdb.com/article/imdb/general-information/can-i-use-imdb-data-in-my-software/G5JTRESSHJBBHTGX
- IMDb non-commercial datasets: https://www.imdb.com/interfaces/
