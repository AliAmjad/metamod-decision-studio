import assert from 'node:assert/strict';
import { ReadableStream } from 'node:stream/web';

process.env.METAMOD_API_KEY = 'MOCK_UPSTREAM_SECRET_NOT_REAL';
let upstreamCalls = 0;
const upstreamFrames = '{"event":"token","data":{"id":"one","chunk":"Hi"}}\n{"event":"end","data":{"result":{"session_id":"session-1","outputs":[]}}}\n';
globalThis.fetch = async (url, options) => {
  upstreamCalls++;
  assert.equal(url, 'https://app.metamod.ai/api/v1/run/80ff2049-4cf0-4c58-b56a-372b9832398e?stream=true');
  assert.equal(options.headers['x-api-key'], process.env.METAMOD_API_KEY);
  assert.equal(JSON.parse(options.body).input_value, 'Test chart');
  return new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(upstreamFrames.slice(0, 30)));
    controller.enqueue(new TextEncoder().encode(upstreamFrames.slice(30)));
    controller.close();
  } }), { headers: { 'content-type': 'application/x-ndjson' } });
};
const { default: run, config } = await import('./netlify/functions/run.mjs');
assert.equal(config.path, '/api/run');
assert.deepEqual(config.rateLimit, { windowLimit: 5, windowSize: 60, aggregateBy: ['ip', 'domain'] });
function request(origin = 'https://public.example', payload = { output_type: 'chat', input_type: 'chat', input_value: 'Test chart', session_id: 'session-1' }) {
  return new Request('https://public.example/api/run', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(payload)
  });
}
assert.equal((await run(request('https://other.example'))).status, 403);
assert.equal((await run(request(undefined, { output_type: 'chat', input_type: 'chat', input_value: 'Hi', session_id: 'x', extra: 'x' }))).status, 400);
assert.equal(upstreamCalls, 0);
const response = await run(request()); // No visitor login or browser credential.
assert.equal(response.status, 200);
assert.equal(response.headers.get('cache-control'), 'no-store');
assert.equal(await response.text(), upstreamFrames);
assert.equal(upstreamCalls, 1);
delete process.env.METAMOD_API_KEY;
assert.equal((await run(request())).status, 503);
console.log('Passed: public visitor, rate-limit declaration, validation, streamed pass-through, and server-only credential fixture.');
