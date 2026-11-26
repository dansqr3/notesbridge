import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getPool, withTransaction } from './db.js';
import { importList, importRatings } from './csv.js';

const asText = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const asError = err => ({
  isError: true,
  content: [{ type: 'text', text: 'Error: ' + (err?.message ?? String(err)) }]
});

export function buildServer() {
  const server = new McpServer({ name: 'imdb-personal-library', version: '0.1.0' });

  server.registerTool('imdb_search_titles', {
    title: 'Search my IMDb library',
    description: 'Search titles already imported from the owner’s IMDb exports. This does not crawl IMDb.',
    inputSchema: {
      query: z.string().min(1).max(200),
      kind: z.enum(['movie', 'tvSeries', 'tvMiniSeries', 'tvEpisode']).optional(),
      genre: z.string().max(60).optional(),
      year_from: z.number().int().min(1870).max(2200).optional(),
      year_to: z.number().int().min(1870).max(2200).optional(),
      limit: z.number().int().min(1).max(100).default(20)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ query, kind, genre, year_from, year_to, limit }) => {
    try {
      const values = ['%' + query.trim() + '%'];
      const conditions = ['title ilike $1'];
      if (kind) { values.push(kind); conditions.push('title_type = $' + values.length); }
      if (genre) { values.push(genre); conditions.push('$' + values.length + ' = any(genres)'); }
      if (year_from) { values.push(year_from); conditions.push('year >= $' + values.length); }
      if (year_to) { values.push(year_to); conditions.push('year <= $' + values.length); }
      values.push(limit);
      const sql = 'select t.*, r.rating as my_rating, (w.imdb_id is not null) as in_watchlist ' +
        'from imdb_private.titles t ' +
        'left join imdb_private.user_ratings r using (imdb_id) ' +
        'left join imdb_private.watchlist_items w using (imdb_id) ' +
        'where ' + conditions.join(' and ') +
        ' order by r.rating desc nulls last, t.imdb_average_rating desc nulls last, t.title limit $' + values.length;
      const result = await getPool().query(sql, values);
      return asText({ total: result.rowCount, results: result.rows });
    } catch (err) { return asError(err); }
  });

  server.registerTool('imdb_get_title', {
    title: 'Get title details from my library',
    description: 'Read imported title metadata, your rating, Watchlist status, and imported list memberships by IMDb ID.',
    inputSchema: { imdb_id: z.string().regex(/^tt\d+$/) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ imdb_id }) => {
    try {
      const title = await getPool().query(
        'select t.*, r.rating as my_rating, r.date_rated, (w.imdb_id is not null) as in_watchlist ' +
        'from imdb_private.titles t ' +
        'left join imdb_private.user_ratings r using (imdb_id) ' +
        'left join imdb_private.watchlist_items w using (imdb_id) where t.imdb_id = $1',
        [imdb_id]
      );
      if (!title.rowCount) return asText({ found: false, imdb_id });
      const lists = await getPool().query(
        'select list_id, list_name, position from imdb_private.custom_lists where imdb_id = $1 order by list_name',
        [imdb_id]
      );
      return asText({ found: true, title: title.rows[0], custom_lists: lists.rows });
    } catch (err) { return asError(err); }
  });

  server.registerTool('imdb_get_my_ratings', {
    title: 'Get my IMDb ratings',
    description: 'List your ratings imported from the IMDb Your Ratings CSV export.',
    inputSchema: {
      min_rating: z.number().int().min(1).max(10).optional(),
      max_rating: z.number().int().min(1).max(10).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ min_rating, max_rating, limit, offset }) => {
    try {
      const values = [];
      const conditions = [];
      if (min_rating) { values.push(min_rating); conditions.push('r.rating >= $' + values.length); }
      if (max_rating) { values.push(max_rating); conditions.push('r.rating <= $' + values.length); }
      const where = conditions.length ? ' where ' + conditions.join(' and ') : '';
      const filterValues = values.slice();
      values.push(limit, offset);
      const result = await getPool().query(
        'select t.*, r.rating as my_rating, r.date_rated ' +
        'from imdb_private.user_ratings r join imdb_private.titles t using (imdb_id)' +
        where + ' order by r.date_rated desc nulls last, t.title limit $' + (values.length - 1) +
        ' offset $' + values.length,
        values
      );
      const count = await getPool().query(
        'select count(*)::int as total from imdb_private.user_ratings r' + where,
        filterValues
      );
      return asText({ total: count.rows[0].total, limit, offset, results: result.rows });
    } catch (err) { return asError(err); }
  });

  server.registerTool('imdb_get_watchlist', {
    title: 'Get my IMDb Watchlist',
    description: 'List titles imported from your IMDb Watchlist CSV export.',
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ limit, offset }) => {
    try {
      const result = await getPool().query(
        'select t.*, w.position, w.added_at, r.rating as my_rating ' +
        'from imdb_private.watchlist_items w join imdb_private.titles t using (imdb_id) ' +
        'left join imdb_private.user_ratings r using (imdb_id) ' +
        'order by w.position nulls last, w.added_at desc nulls last, t.title limit $1 offset $2',
        [limit, offset]
      );
      const count = await getPool().query('select count(*)::int as total from imdb_private.watchlist_items');
      return asText({ total: count.rows[0].total, limit, offset, results: result.rows });
    } catch (err) { return asError(err); }
  });

  server.registerTool('imdb_get_custom_lists', {
    title: 'Get my IMDb lists',
    description: 'List imported custom IMDb lists and their item counts.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => {
    try {
      const result = await getPool().query(
        'select list_id, list_name, count(*)::int as item_count ' +
        'from imdb_private.custom_lists group by list_id, list_name order by list_name'
      );
      return asText({ lists: result.rows });
    } catch (err) { return asError(err); }
  });

  server.registerTool('imdb_get_list_items', {
    title: 'Get IMDb list items',
    description: 'Read the titles of one imported custom list.',
    inputSchema: {
      list_id: z.string().min(1).max(200),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0)
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ list_id, limit, offset }) => {
    try {
      const result = await getPool().query(
        'select t.*, c.position, c.added_at, c.list_name, r.rating as my_rating ' +
        'from imdb_private.custom_lists c join imdb_private.titles t using (imdb_id) ' +
        'left join imdb_private.user_ratings r using (imdb_id) where c.list_id = $1 ' +
        'order by c.position nulls last, t.title limit $2 offset $3',
        [list_id, limit, offset]
      );
      const count = await getPool().query(
        'select count(*)::int as total from imdb_private.custom_lists where list_id = $1',
        [list_id]
      );
      return asText({ list_id, total: count.rows[0].total, limit, offset, results: result.rows });
    } catch (err) { return asError(err); }
  });

  server.registerTool('imdb_get_taste_profile', {
    title: 'Analyze my IMDb taste profile',
    description: 'Summarize imported personal ratings by genre and release year. Statistics are based only on imported data.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async () => {
    try {
      const [summary, genres, years, distribution] = await Promise.all([
        getPool().query(
          'select count(*)::int as rated_titles, round(avg(r.rating)::numeric, 2) as average_rating, ' +
          'count(*) filter (where r.rating >= 8)::int as high_rated, ' +
          'count(*) filter (where r.rating <= 4)::int as low_rated from imdb_private.user_ratings r'
        ),
        getPool().query(
          'select g.genre, count(*)::int as rated_titles, round(avg(r.rating)::numeric, 2) as average_rating ' +
          'from imdb_private.user_ratings r join imdb_private.titles t using (imdb_id) ' +
          'cross join lateral unnest(t.genres) as g(genre) ' +
          'group by g.genre having count(*) >= 2 order by average_rating desc, rated_titles desc'
        ),
        getPool().query(
          'select t.year, count(*)::int as rated_titles, round(avg(r.rating)::numeric, 2) as average_rating ' +
          'from imdb_private.user_ratings r join imdb_private.titles t using (imdb_id) ' +
          'where t.year is not null group by t.year order by t.year'
        ),
        getPool().query(
          'select rating, count(*)::int as count from imdb_private.user_ratings group by rating order by rating'
        )
      ]);
      return asText({
        based_on: summary.rows[0].rated_titles,
        summary: summary.rows[0],
        genres: genres.rows,
        release_years: years.rows,
        rating_distribution: distribution.rows
      });
    } catch (err) { return asError(err); }
  });

  server.registerTool('imdb_import_csv', {
    title: 'Import an IMDb CSV export',
    description: 'Import a CSV exported manually from your own IMDb account. Kinds: ratings, watchlist, custom_list. replace_existing=true replaces only that collection. Never provide passwords or cookies.',
    inputSchema: {
      kind: z.enum(['ratings', 'watchlist', 'custom_list']),
      csv_text: z.string().min(1).max(1_500_000),
      filename: z.string().min(1).max(255).optional(),
      list_id: z.string().min(1).max(200).optional(),
      list_name: z.string().min(1).max(200).optional(),
      replace_existing: z.boolean().default(false)
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  }, async ({ kind, csv_text, filename, list_id, list_name, replace_existing }) => {
    try {
      if (kind === 'custom_list' && (!list_id || !list_name)) {
        return asError(new Error('list_id and list_name are required for custom_list imports'));
      }
      const result = await withTransaction(async client => {
        if (kind === 'ratings') {
          return importRatings(client, csv_text, { filename, replaceExisting: replace_existing });
        }
        return importList(client, csv_text, {
          kind,
          filename,
          listId: kind === 'custom_list' ? list_id : 'watchlist',
          listName: kind === 'custom_list' ? list_name : 'IMDb Watchlist',
          replaceExisting: replace_existing
        });
      });
      return asText(result);
    } catch (err) { return asError(err); }
  });

  server.registerTool('imdb_import_status', {
    title: 'View IMDb import history',
    description: 'Show recent CSV import runs and row counts.',
    inputSchema: { limit: z.number().int().min(1).max(50).default(20) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ limit }) => {
    try {
      const result = await getPool().query(
        'select id, source, filename, rows_seen, rows_imported, rows_skipped, status, error_summary, imported_at ' +
        'from imdb_private.import_runs order by imported_at desc limit $1',
        [limit]
      );
      return asText({ imports: result.rows });
    } catch (err) { return asError(err); }
  });

  return server;
}
