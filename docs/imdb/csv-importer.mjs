/**
 * Safe CSV parser for IMDb account exports.
 * No network calls, cookies, scraping, or automatic login.
 * Runtime: Node.js 22+.
 */
export function parseCsv(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (quoted) throw new Error('Malformed CSV: unterminated quoted field');
  if (cell !== '' || row.length) { row.push(cell); if (row.some(v => v !== '')) rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(values => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ''])));
}

const clean = value => value && value !== '\\N' ? value.trim() : null;
const parseYear = value => { const m = String(value ?? '').match(/^(\d{4})/); return m ? Number(m[1]) : null; };

export function normalizeRating(row) {
  const imdbId = clean(row.Const);
  const rating = Number(clean(row['Your Rating']));
  if (!imdbId || !/^tt\d+$/.test(imdbId)) return { ok: false, reason: 'invalid_imdb_id' };
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) return { ok: false, reason: 'invalid_rating' };
  return { ok: true, title: {
    imdb_id: imdbId, title: clean(row.Title), title_type: clean(row['Title Type']),
    year: parseYear(row.Year), genres: clean(row.Genres)?.split(',').map(x => x.trim()).filter(Boolean) ?? []
  }, rating: { imdb_id: imdbId, rating, date_rated: clean(row['Date Rated']) } };
}

export function normalizeListItem(row) {
  const imdbId = clean(row.Const);
  if (!imdbId || !/^tt\d+$/.test(imdbId)) return { ok: false, reason: 'invalid_imdb_id' };
  return { ok: true, title: {
    imdb_id: imdbId, title: clean(row.Title), title_type: clean(row['Title Type']),
    year: parseYear(row.Year), genres: clean(row.Genres)?.split(',').map(x => x.trim()).filter(Boolean) ?? []
  }, item: {
    imdb_id: imdbId,
    position: Number.isInteger(Number(row.Position)) ? Number(row.Position) : null,
    added_at: clean(row.Created)
  } };
}

export function summarizeImport(rows, normalizer) {
  const result = { seen: rows.length, imported: 0, skipped: 0, errors: {} };
  const accepted = [];
  for (const row of rows) {
    const item = normalizer(row);
    if (item.ok) { result.imported++; accepted.push(item); }
    else { result.skipped++; result.errors[item.reason] = (result.errors[item.reason] ?? 0) + 1; }
  }
  return { summary: result, accepted };
}
