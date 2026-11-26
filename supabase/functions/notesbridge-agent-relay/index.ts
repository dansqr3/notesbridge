// Fixed-purpose transport for the Mac agent. The Vercel application remains
// the authority for pairing codes, JWTs, revocation, and job ownership.
// This function is intentionally not a general-purpose URL proxy.

const VERCEL_ORIGIN = 'https://notesbridge-server-prod-gorod.vercel.app';
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const ROUTES = Object.freeze({
  pairClaim: { method: 'POST', path: '/api/pair/claim', needsAgentToken: false },
  agentPing: { method: 'GET', path: '/api/agent/ping', needsAgentToken: true },
  agentPoll: { method: 'GET', path: '/api/agent/poll', needsAgentToken: true },
  agentResult: { method: 'POST', path: '/api/agent/result', needsAgentToken: true },
});

function json(status: number, body: Record<string, unknown>, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

Deno.serve(async (request: Request) => {
  const incoming = new URL(request.url);
  const routeName = incoming.searchParams.get('route') || '';
  const route = ROUTES[routeName as keyof typeof ROUTES];
  if (!route) return json(404, { error: 'not_found' });

  if (request.method !== route.method) {
    return json(405, { error: 'method_not_allowed' }, { allow: route.method });
  }

  const authorization = request.headers.get('authorization');
  if (route.needsAgentToken && !/^Bearer\s+\S+/i.test(authorization || '')) {
    return json(401, { error: 'unauthorized' });
  }

  const upstreamUrl = new URL(route.path, VERCEL_ORIGIN);
  if (routeName === 'agentPoll') {
    const wait = incoming.searchParams.get('wait');
    if (wait !== null) {
      if (!/^(0|[1-9]\d*)$/.test(wait) || Number(wait) > 25) {
        return json(400, { error: 'invalid_wait' });
      }
      upstreamUrl.searchParams.set('wait', wait);
    }
  }

  const headers = new Headers();
  if (authorization) headers.set('authorization', authorization);

  let body: Uint8Array | undefined;
  if (route.method === 'POST') {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
      return json(415, { error: 'application_json_required' });
    }
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_BODY_BYTES) return json(413, { error: 'payload_too_large' });
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_BODY_BYTES) return json(413, { error: 'payload_too_large' });
    body = new Uint8Array(bytes);
    headers.set('content-type', 'application/json');
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: route.method,
      headers,
      body,
      signal: AbortSignal.timeout(35_000),
      redirect: 'manual',
    });
  } catch {
    return json(502, { error: 'upstream_unavailable' });
  }

  const responseHeaders = new Headers({ 'cache-control': 'no-store' });
  for (const name of ['content-type', 'retry-after', 'x-vercel-id', 'x-vercel-mitigated']) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
});
