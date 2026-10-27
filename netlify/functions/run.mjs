// Public Netlify Function. Visitors need no login; the Metamod key stays server-side.
// Warning: a public endpoint can consume your API quota. See README for cost controls.
const UPSTREAM = 'https://app.metamod.ai/api/v1/run/80ff2049-4cf0-4c58-b56a-372b9832398e?stream=true';

// Netlify's code-based per-IP rate limit covers this Function's public /api/run route.
// It is NOT a global cost cap; requests can slip through before enforcement catches up.
export const config = {
  path: '/api/run',
  rateLimit: { windowLimit: 5, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};

function json(message, status) {
  return Response.json({ error: message }, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  });
}

export default async function run(request) {
  if (request.method !== 'POST') return json('Method not allowed', 405);
  // The credential is set in the Netlify site environment with Functions scope.
  if (!process.env.METAMOD_API_KEY) return json('Server credential is not configured', 503);
  // Only accept requests made by browsers at this site's origin. This reduces
  // cross-site drive-by calls; it is not authentication and can be spoofed.
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json('Origin not allowed', 403);
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return json('Expected JSON', 415);
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > 16000) return json('Request too large', 413);
  let payload;
  try { payload = await request.json(); }
  catch { return json('Invalid JSON', 400); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).some(key => !['output_type', 'input_type', 'input_value', 'session_id'].includes(key)) ||
      payload.output_type !== 'chat' || payload.input_type !== 'chat' ||
      typeof payload.input_value !== 'string' || !payload.input_value.trim() || payload.input_value.length > 12000 ||
      typeof payload.session_id !== 'string' || !payload.session_id || payload.session_id.length > 200) {
    return json('Invalid chat request', 400);
  }
  let upstream;
  try {
    upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.METAMOD_API_KEY },
      body: JSON.stringify({ output_type: 'chat', input_type: 'chat', input_value: payload.input_value, session_id: payload.session_id }),
      signal: request.signal
    });
  } catch { return json('Unable to reach agent', 502); }
  if (!upstream.ok || !upstream.body) return json(`Agent request failed (HTTP ${upstream.status})`, upstream.ok ? 502 : upstream.status);
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
