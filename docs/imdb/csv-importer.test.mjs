import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, normalizeRating, normalizeListItem, summarizeImport } from './csv-importer.mjs';

test('parses IMDb quoted CSV and BOM', () => {
  const rows = parseCsv('\uFEFFConst,Title,Genres\r\ntt001,"Film, The One","Drama,Comedy"\r\n');
  assert.equal(rows[0].Title, 'Film, The One');
  assert.equal(rows[0].Genres, 'Drama,Comedy');
});

test('normalizes a rating and preserves IMDb id', () => {
  const value = normalizeRating({ Const: 'tt123', 'Your Rating': '9', Title: 'Example', Year: '2020', Genres: 'Drama,Comedy' });
  assert.equal(value.ok, true);
  assert.equal(value.rating.rating, 9);
  assert.deepEqual(value.title.genres, ['Drama', 'Comedy']);
});

test('rejects invalid IDs and rating ranges', () => {
  assert.equal(normalizeRating({ Const: '123', 'Your Rating': '9' }).reason, 'invalid_imdb_id');
  assert.equal(normalizeRating({ Const: 'tt123', 'Your Rating': '11' }).reason, 'invalid_rating');
});

test('normalizes Watchlist rows', () => {
  const value = normalizeListItem({ Const: 'tt5', Position: '2', Title: 'Queued' });
  assert.equal(value.ok, true);
  assert.equal(value.item.position, 2);
});

test('summarizes skipped rows', () => {
  const out = summarizeImport([{Const:'tt1','Your Rating':'7'}, {Const:'no','Your Rating':'9'}], normalizeRating);
  assert.equal(out.summary.seen, 2);
  assert.equal(out.summary.imported, 1);
  assert.equal(out.summary.skipped, 1);
});
