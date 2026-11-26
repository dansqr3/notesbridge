const MAX_CSV_BYTES = 1_500_000;

export function parseCsv(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '');
  if (Buffer.byteLength(input, 'utf8') > MAX_CSV_BYTES) {
    throw new Error('CSV exceeds the 1.5 MB import limit');
  }
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') {
      if (cell.length) throw new Error('Malformed CSV: unexpected quote');
      quoted = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new Error('Malformed CSV: unterminated quoted field');
  if (cell !== '' || row.length) {
    row.push(cell);
    if (row.some(value => value !== '')) rows.push(row);
  }
  if (!rows.length) return [];

  const headers = rows[0].map(value => value.trim());
  if (headers.some(value => !value)) throw new Error('CSV contains an empty column header');
  return rows.slice(1).map(values =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  );
}

const clean = value => {
  const result = String(value ?? '').trim();
  return result && result !== '\\N' ? result : null;
};

const parseYear = value => {
  const match = String(value ?? '').match(/^\d{4}/);
  return match ? Number(match[0]) : null;
};

const parseDate = value => {
  const raw = clean(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
};

const parseGenres = value => clean(value)
  ?.split(',')
  .map(genre => genre.trim())
  .filter(Boolean) ?? [];

function titleFromRow(row) {
  const imdbId = clean(row.Const);
  if (!imdbId || !/^tt\d+$/.test(imdbId)) return null;
  const rawRating = clean(row['IMDb Rating'] ?? row['IMDb Rating ']);
  const imdbRating = rawRating && /^\d{1,2}(\.\d)?$/.test(rawRating) ? Number(rawRating) : null;
  const rawVotes = clean(row['Num Votes']);
  const votes = rawVotes && /^\d+$/.test(rawVotes) ? Number(rawVotes) : null;
  return {
    imdb_id: imdbId,
    title: clean(row.Title),
    title_type: clean(row['Title Type']),
    year: parseYear(row.Year),
    genres: parseGenres(row.Genres),
    imdb_average_rating: imdbRating,
    imdb_num_votes: votes
  };
}

export function normalizeRating(row) {
  const title = titleFromRow(row);
  if (!title) return { ok: false, reason: 'invalid_imdb_id' };
  const rating = Number(clean(row['Your Rating']));
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
    return { ok: false, reason: 'invalid_rating' };
  }
  return {
    ok: true,
    title,
    item: { imdb_id: title.imdb_id, rating, date_rated: parseDate(row['Date Rated']) }
  };
}

export function normalizeListItem(row) {
  const title = titleFromRow(row);
  if (!title) return { ok: false, reason: 'invalid_imdb_id' };
  const rawPosition = clean(row.Position);
  const position = rawPosition && /^\d+$/.test(rawPosition) ? Number(rawPosition) : null;
  return {
    ok: true,
    title,
    item: {
      imdb_id: title.imdb_id,
      position,
      added_at: parseDate(row.Created ?? row['Date Added'])
    }
  };
}

export function summarizeImport(rows, normalizer) {
  const summary = { seen: rows.length, imported: 0, skipped: 0, errors: {} };
  const accepted = [];
  for (const row of rows) {
    const normalized = normalizer(row);
    if (normalized.ok) {
      summary.imported++;
      accepted.push(normalized);
    } else {
      summary.skipped++;
      summary.errors[normalized.reason] = (summary.errors[normalized.reason] ?? 0) + 1;
    }
  }
  return { summary, accepted };
}

async function upsertTitles(client, titles) {
  const unique = new Map(titles.map(title => [title.imdb_id, title]));
  const values = [...unique.values()];
  for (let start = 0; start < values.length; start += 500) {
    const chunk = values.slice(start, start + 500);
    const params = Array.from({ length: 7 }, () => []);
    for (const title of chunk) {
      params[0].push(title.imdb_id);
      params[1].push(title.title);
      params[2].push(title.title_type);
      params[3].push(title.year);
      params[4].push(title.genres);
      params[5].push(title.imdb_average_rating);
      params[6].push(title.imdb_num_votes);
    }
    await client.query(
      'insert into imdb_private.titles ' +
      '(imdb_id, title, title_type, year, genres, imdb_average_rating, imdb_num_votes) ' +
      'select * from unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::text[][], $6::numeric[], $7::bigint[]) ' +
      'on conflict (imdb_id) do update set ' +
      'title = coalesce(excluded.title, imdb_private.titles.title), ' +
      'title_type = coalesce(excluded.title_type, imdb_private.titles.title_type), ' +
      'year = coalesce(excluded.year, imdb_private.titles.year), ' +
      'genres = case when cardinality(excluded.genres) > 0 then excluded.genres else imdb_private.titles.genres end, ' +
      'imdb_average_rating = coalesce(excluded.imdb_average_rating, imdb_private.titles.imdb_average_rating), ' +
      'imdb_num_votes = coalesce(excluded.imdb_num_votes, imdb_private.titles.imdb_num_votes), ' +
      'updated_at = now()',
      params
    );
  }
}

export async function importRatings(client, csvText, options = {}) {
  const rows = parseCsv(csvText);
  const parsed = summarizeImport(rows, normalizeRating);
  const run = await client.query(
    "insert into imdb_private.import_runs(source, filename, rows_seen, rows_imported, rows_skipped, status) " +
    "values ('ratings', $1, $2, $3, $4, 'processing') returning id",
    [options.filename ?? 'ratings.csv', parsed.summary.seen, parsed.summary.imported, parsed.summary.skipped]
  );
  await upsertTitles(client, parsed.accepted.map(item => item.title));
  if (options.replaceExisting === true) await client.query('delete from imdb_private.user_ratings');

  for (let start = 0; start < parsed.accepted.length; start += 500) {
    const chunk = parsed.accepted.slice(start, start + 500);
    const ids = chunk.map(item => item.item.imdb_id);
    const ratings = chunk.map(item => item.item.rating);
    const dates = chunk.map(item => item.item.date_rated);
    await client.query(
      'insert into imdb_private.user_ratings(imdb_id, rating, date_rated) ' +
      'select * from unnest($1::text[], $2::smallint[], $3::date[]) ' +
      'on conflict (imdb_id) do update set rating = excluded.rating, date_rated = excluded.date_rated, imported_at = now()',
      [ids, ratings, dates]
    );
  }
  await client.query("update imdb_private.import_runs set status = 'completed' where id = $1", [run.rows[0].id]);
  return { ...parsed.summary, import_id: run.rows[0].id, mode: options.replaceExisting ? 'replace' : 'merge' };
}

export async function importList(client, csvText, options = {}) {
  const kind = options.kind === 'watchlist' ? 'watchlist' : 'custom_list';
  const rows = parseCsv(csvText);
  const parsed = summarizeImport(rows, normalizeListItem);
  const listId = options.listId || kind;
  const listName = options.listName || (kind === 'watchlist' ? 'IMDb Watchlist' : listId);
  const run = await client.query(
    'insert into imdb_private.import_runs(source, filename, rows_seen, rows_imported, rows_skipped, status) ' +
    "values ($1, $2, $3, $4, $5, 'processing') returning id",
    [kind, options.filename ?? (kind + '.csv'), parsed.summary.seen, parsed.summary.imported, parsed.summary.skipped]
  );
  await upsertTitles(client, parsed.accepted.map(item => item.title));

  if (options.replaceExisting === true) {
    if (kind === 'watchlist') await client.query('delete from imdb_private.watchlist_items');
    else await client.query('delete from imdb_private.custom_lists where list_id = $1', [listId]);
  }

  for (let start = 0; start < parsed.accepted.length; start += 500) {
    const chunk = parsed.accepted.slice(start, start + 500);
    const ids = chunk.map(item => item.item.imdb_id);
    const positions = chunk.map(item => item.item.position);
    const dates = chunk.map(item => item.item.added_at);
    if (kind === 'watchlist') {
      await client.query(
        'insert into imdb_private.watchlist_items(imdb_id, position, added_at) ' +
        'select * from unnest($1::text[], $2::int[], $3::date[]) ' +
        'on conflict (imdb_id) do update set position = excluded.position, added_at = excluded.added_at, imported_at = now()',
        [ids, positions, dates]
      );
    } else {
      await client.query(
        'insert into imdb_private.custom_lists(list_id, list_name, imdb_id, position, added_at) ' +
        'select $1, $2, item_id, item_position, item_added ' +
        'from unnest($3::text[], $4::int[], $5::date[]) as items(item_id, item_position, item_added) ' +
        'on conflict (list_id, imdb_id) do update set ' +
        'list_name = excluded.list_name, position = excluded.position, added_at = excluded.added_at, imported_at = now()',
        [listId, listName, ids, positions, dates]
      );
    }
  }
  await client.query("update imdb_private.import_runs set status = 'completed' where id = $1", [run.rows[0].id]);
  return { ...parsed.summary, import_id: run.rows[0].id, collection: listName, mode: options.replaceExisting ? 'replace' : 'merge' };
}
