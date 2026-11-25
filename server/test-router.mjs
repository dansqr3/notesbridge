import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import handler, { routes, routePath, resolveHandler } from './api/router.js';

const publicRoutes = [
  'agent/devices', 'agent/ping', 'agent/poll', 'agent/result', 'agent/revoke', 'agent/status',
  'challenge', 'health', 'login', 'mcp', 'me', 'oauth/authorize', 'oauth/register', 'oauth/token',
  'pair/claim', 'pair/start', 'resend-verification', 'signup', 'verify', 'wellknown',
];

function response() {
  return {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    on() { return this; },
  };
}

test('catch-all route table covers every existing public API URL', () => {
  assert.equal(Object.keys(routes).length, publicRoutes.length);
  for (const path of publicRoutes) {
    assert.equal(typeof resolveHandler(path), 'function', `${path} resolves to its handler`);
  }
});

test('Vercel sees one API function and rewrites API paths to the router', async () => {
  const files = await readdir(new URL('./api/', import.meta.url), { withFileTypes: true });
  assert.deepEqual(files.filter((entry) => entry.isFile()).map((entry) => entry.name), ['router.js']);
  assert.equal(files.filter((entry) => entry.isDirectory()).length, 0);

  const config = JSON.parse(await readFile(new URL('./vercel.json', import.meta.url), 'utf8'));
  const apiRewrite = config.rewrites.find((rewrite) => rewrite.source === '/api/:path*');
  assert.equal(apiRewrite?.destination, '/api/router?path=:path*');
  for (const [source, destination] of [
    ['/.well-known/oauth-authorization-server', '/api/router?path=wellknown&type=as'],
    ['/.well-known/oauth-protected-resource', '/api/router?path=wellknown&type=pr'],
    ['/verify', '/api/router?path=verify'],
    ['/.well-known/openai-apps-challenge', '/api/router?path=challenge'],
    ['/mcp', '/api/router?path=mcp'],
  ]) {
    assert.equal(config.rewrites.find((rewrite) => rewrite.source === source)?.destination, destination);
  }
  assert.deepEqual(config.functions, { 'api/router.js': { maxDuration: 60 } });
  assert.equal(Object.keys(config.functions).length, 1);
});

test('catch-all path supports Vercel string and segment-array parameters', () => {
  assert.equal(routePath({ query: { path: 'oauth/token' } }), 'oauth/token');
  assert.equal(routePath({ query: { path: ['agent', 'poll'] } }), 'agent/poll');
  assert.equal(routePath({ query: { path: '/agent/poll/' } }), 'agent/poll');
});

test('all 20 routes dispatch without becoming 404s', async (t) => {
  for (const path of publicRoutes) {
    await t.test(`/api/${path}`, async () => {
      const req = {
        method: ['challenge', 'health', 'me', 'agent/devices', 'agent/status', 'agent/ping', 'agent/poll', 'mcp', 'verify', 'wellknown'].includes(path) ? 'GET' : 'POST',
        query: { path: path.split('/') },
        headers: { host: 'localhost', 'x-forwarded-proto': 'http' },
        body: {},
      };
      const res = response();
      await handler(req, res);
      assert.notEqual(res.statusCode, 404, `${path} must dispatch to its existing handler`);
    });
  }
});

test('unknown route returns the existing JSON 404 shape', async () => {
  const res = response();
  await handler({ method: 'GET', query: { path: ['unknown'] }, headers: {} }, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'not_found' });
});

test('OAuth metadata rewrite query selects the original document', async () => {
  const req = {
    method: 'GET',
    query: { path: 'wellknown', type: 'as' },
    headers: { host: 'notesbridge.example', 'x-forwarded-proto': 'https' },
  };
  const res = response();
  await handler(req, res);
  assert.equal(res.body.authorization_endpoint, 'https://notesbridge.example/oauth/authorize');
  assert.equal(res.body.token_endpoint, 'https://notesbridge.example/api/oauth/token');
});

test('onboarding commands use the checked-out CLI and the current relay origin', async () => {
  const page = await readFile(new URL('./public/index.html', import.meta.url), 'utf8');
  assert.match(page, /node cli\.mjs pair/);
  assert.match(page, /--server ' \+ esc\(location\.origin\)/);
  assert.match(page, /node cli\.mjs install/);
  assert.doesNotMatch(page, /npx apple-notes-agent/);
});
