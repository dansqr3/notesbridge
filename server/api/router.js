// Single Vercel entry point for the API. Keeping implementation modules in
// ../handlers prevents Vercel from discovering one Serverless Function per
// handler while preserving the public /api/* URLs through vercel.json rewrites.
import agentDevices from '../handlers/agent/devices.js';
import agentPing from '../handlers/agent/ping.js';
import agentPoll from '../handlers/agent/poll.js';
import agentResult from '../handlers/agent/result.js';
import agentRevoke from '../handlers/agent/revoke.js';
import agentStatus from '../handlers/agent/status.js';
import challenge from '../handlers/challenge.js';
import health from '../handlers/health.js';
import login from '../handlers/login.js';
import mcp from '../handlers/mcp.js';
import me from '../handlers/me.js';
import oauthAuthorize from '../handlers/oauth/authorize.js';
import oauthRegister from '../handlers/oauth/register.js';
import oauthToken from '../handlers/oauth/token.js';
import pairClaim from '../handlers/pair/claim.js';
import pairStart from '../handlers/pair/start.js';
import resendVerification from '../handlers/resend-verification.js';
import signup from '../handlers/signup.js';
import verify from '../handlers/verify.js';
import wellknown from '../handlers/wellknown.js';

export const routes = Object.freeze({
  'agent/devices': agentDevices,
  'agent/ping': agentPing,
  'agent/poll': agentPoll,
  'agent/result': agentResult,
  'agent/revoke': agentRevoke,
  'agent/status': agentStatus,
  challenge,
  health,
  login,
  mcp,
  me,
  'oauth/authorize': oauthAuthorize,
  'oauth/register': oauthRegister,
  'oauth/token': oauthToken,
  'pair/claim': pairClaim,
  'pair/start': pairStart,
  'resend-verification': resendVerification,
  signup,
  verify,
  wellknown,
});

export function routePath(req) {
  const value = req.query?.path;
  return (Array.isArray(value) ? value.join('/') : String(value || '')).replace(/^\/+|\/+$/g, '');
}

export function resolveHandler(path) {
  return routes[path] || null;
}

export default async function handler(req, res) {
  const route = resolveHandler(routePath(req));
  if (!route) return res.status(404).json({ error: 'not_found' });
  return route(req, res);
}
