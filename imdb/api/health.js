import { getPool } from '../src/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  if (!process.env.IMDB_MCP_TOKEN) return res.status(503).json({ ok: false, reason: 'token_missing' });
  try {
    await getPool().query('select 1');
    return res.status(200).json({ ok: true, database: 'connected' });
  } catch (err) {
    console.error('[imdb-health] database check failed', err);
    return res.status(503).json({ ok: false, database: 'unavailable' });
  }
}
