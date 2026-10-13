import test from 'node:test';
import assert from 'node:assert/strict';
import { storefrontOrigin } from '../worker/storefront-origin.mjs';
import { handleTrackingRequest } from '../worker/tracking.mjs';

const backend = 'https://nolimit-capacetes.tarcalmix.chatgpt.site';
const origins = [backend, 'https://nolimitemotos.com', 'https://www.nolimitemotos.com'];
const env = { META_ACCESS_TOKEN: 'fake', META_PIXEL_ID: '12345', META_API_VERSION: 'v26.0' };
function request(origin, source = origin, consent = true) {
  return new Request(backend + '/api/events', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1', 'x-forwarded-for': '198.51.100.1', 'user-agent': 'buyer-agent' },
    body: JSON.stringify({ eventName: 'PageView', eventId: 'test-event', tracking: { consent, eventSourceUrl: source + '/produto/test?email=private' } }),
  });
}

test('tracking accepts the original site and exact approved storefronts with their source and user agent', async () => {
  for (const origin of origins) {
    let sent;
    const response = await handleTrackingRequest(request(origin), env, { fetchImpl: async (_url, init) => { sent = JSON.parse(init.body).data[0]; return Response.json({}); } });
    assert.equal(response.status, 202);
    assert.equal(sent.event_source_url, origin + '/produto/test');
    assert.equal(sent.user_data.client_user_agent, 'buyer-agent');
    assert.equal(sent.user_data.client_ip_address, origin === backend ? '192.0.2.1' : undefined);
    assert.equal(response.headers.has('access-control-allow-origin'), false);
  }
});

test('tracking rejects unknown, lookalike, HTTP, subdomain, port and missing origins', async () => {
  for (const origin of ['https://evil.test', 'https://nolimitemotos.com.evil.test', 'http://nolimitemotos.com', 'https://other.nolimitemotos.com', 'https://nolimitemotos.com:444', 'https://nolimitemotors.com', 'https://www.nolimitemotors.com', 'null', '']) {
    const req = request(origin);
    assert.equal(storefrontOrigin(req), null);
    assert.equal((await handleTrackingRequest(req, env)).status, 403);
  }
});

test('source must match the specific approved request origin and consent remains required', async () => {
  const origin = origins[1];
  for (const other of [backend, origins[2], 'https://evil.test']) {
    assert.equal((await handleTrackingRequest(request(origin, other), env)).status, 400);
  }
  const response = await handleTrackingRequest(request(origin, origin, false), env);
  assert.deepEqual(await response.json(), { accepted: false });
});
