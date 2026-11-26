# IMDb Personal Library MCP

Private MCP service for querying personal IMDb ratings, Watchlist, and lists after importing CSV exports from the account owner.

## Privacy and supported access

- No IMDb login automation, passwords, browser cookies, scraping, or undocumented account API calls.
- Import only CSV files exported manually by the account owner.
- Store the database URL and MCP bearer token as encrypted Vercel Environment Variables.
- The service uses a direct Postgres connection to the private schema created by the Supabase migration.
- No data is written back to IMDb.

IMDb export workflow:
1. Open your IMDb profile and choose Your Ratings; use the Export icon.
2. Open Your Watchlist and use its Export option.
3. Open each additional custom list and export it separately.

## Supabase setup

Apply the migration in the parent repository:
supabase/migrations/20261126000100_imdb_personal_library.sql

It creates the private schema imdb_private with RLS enabled and no grants to public, anon, or authenticated.

## Vercel setup

Create a Vercel project linked to this Git repository with Root Directory set to imdb. Add these sensitive environment variables for Preview and Production:

- DATABASE_URL — Supabase Postgres Session Pooler connection string.
- IMDB_MCP_TOKEN — high-entropy random bearer token generated locally.

Deploy Preview first. Verify /health returns {"ok":true,"database":"connected"}. The MCP endpoint is /mcp.

Connect ChatGPT to the deployed /mcp URL with bearer token authentication. Never commit or paste the token into Git.

## MCP tools

- imdb_search_titles
- imdb_get_title
- imdb_get_my_ratings
- imdb_get_watchlist
- imdb_get_custom_lists
- imdb_get_list_items
- imdb_get_taste_profile
- imdb_import_csv
- imdb_import_status

CSV imports are limited to 1.5 MB per request. Imports merge by default. Setting replace_existing=true replaces only the selected collection (ratings, Watchlist, or one custom list).

## Local checks

    npm install
    npm test
