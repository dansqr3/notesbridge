import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, normalizeRating, normalizeListItem, summarizeImport } from '../src/csv.js';

test('parses BOM and quoted commas', () => {
  const rows = parseCsv('\uFEFFConst,Title,Genres\r\ntt001,"Film, The One","Drama,Comedy"\r\n');
  assert.equal(rows[0].Title, 'Film, The One');
  assert.equal(rows[0].Genres, 'Drama,Comedy');
});

test('normalizes a personal rating', () => {
  const value = normalizeRating({ Const: 'tt123', 'Your Rating': '9', Title: 'Example', Year: '2020', Genres: 'Drama,Comedy' });
  assert.equal(value.ok, true);
  assert.equal(value.item.rating, 9);
  assert.deepEqual(value.title.genres, ['Drama', 'Comedy']);
});

test('rejects invalid IMDb IDs and ratings', () => {
  assert.equal(normalizeRating({ Const: '123', 'Your Rating': '9' }).reason, 'invalid_imdb_id');
  assert.equal(normalizeRating({ Const: 'tt123', 'Your Rating': '11' }).reason, 'invalid_rating');
});

test('normalizes Watchlist positions', () => {
  const value = normalizeListItem({ Const: 'tt5', Position: '2', Title: 'Queued' });
  assert.equal(value.ok, true);
  assert.equal(value.item.position, 2);
});

test('summarizes invalid rows', () => {
  const output = summarizeImport(
    [{ Const: 'tt1', 'Your Rating': '7' }, { Const: 'bad', 'Your Rating': '9' }],
    normalizeRating
  );
  assert.equal(output.summary.seen, 2);
  assert.equal(output.summary.imported, 1);
  assert.equal(output.summary.skipped, 1);
});
