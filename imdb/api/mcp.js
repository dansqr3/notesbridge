import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from '../src/server.js';

function authorized(req) {
  const expected = process.env.IMDB_MCP_TOKEN;
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!expected || !match) return false;
  const actual = Buffer.from(match[1], 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export default async function handler(req, res) {
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'database_not_configured' });
  if (!process.env.IMDB_MCP_TOKEN) return res.status(503).json({ error: 'mcp_token_not_configured' });
  if (!authorized(req)) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (req.method === 'GET' || req.method === 'DELETE') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[imdb-mcp] request failed', err);
    if (!res.headersSent) res.status(500).json({ error: 'internal_error' });
  }
}
