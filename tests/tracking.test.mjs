import test from 'node:test';
import assert from 'node:assert/strict';

test('Utmify Purchase mode preserves nonpurchase Meta ingestion', async () => {
  const calls = [];
  const request = new Request('https://shop.test/api/events', {
    method: 'POST', headers: { origin: 'https://shop.test', 'content-type': 'application/json' },
    body: JSON.stringify({ eventName: 'PageView', eventId: 'page:test', tracking }),
  });
  const response = await handleTrackingRequest(request, { ...env, META_PURCHASE_SOURCE: 'utmify' }, {
    fetchImpl: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return Response.json({}); },
  });
  assert.equal(response.status, 202);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes('graph.facebook.com'));
  assert.equal(calls[0].body.data[0].event_name, 'PageView');
});


test('Utmify-managed Purchase suppresses direct Meta on success and failure', async () => {
  const managed = { ...env, META_PURCHASE_SOURCE: 'utmify' };
  const paid = { ...order, status: 'paid', paidAt: order.createdAt };
  for (const status of [200, 503]) {
    const calls = [];
    const result = await sendOrderTracking(paid, managed, { fetchImpl: async url => { calls.push(url); return new Response('{}', { status }); } });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('utmify.com.br'));
    assert.deepEqual(result.meta, { success: true, retry: false, skipped: 'utmify_managed' });
    assert.equal(result.utmify.success, status === 200);
    assert.equal(result.utmify.retry, status === 503);
  }
  const skipped = await sendOrderTracking({ ...paid, tracking: { consent: false } }, managed, { fetchImpl: async () => { throw new Error('must not send'); } });
  assert.equal(skipped.meta.skipped, 'no_consent');
  assert.equal(skipped.utmify.skipped, 'no_consent');
  await assert.rejects(sendOrderTracking({ ...paid, paidAt: undefined }, managed), /unconfirmed_payment/);
});

import { buildMetaEvent, buildUtmifyOrder, sendOrderTracking, handleTrackingRequest, purchaseEventId } from '../worker/tracking.mjs';
import { createTracker, captureAttribution } from '../public/tracking.js';
const env = { META_ACCESS_TOKEN: 'test-token', META_PIXEL_ID: '1146535704713953', META_API_VERSION: 'v26.0', UTMIFY_API_TOKEN: 'test-utm' };
const tracking = { consent: true, eventSourceUrl: 'https://shop.test/product?email=private', attribution: { utm_source: 'facebook', utm_campaign: 'launch' }, fbc: 'fb.1.1700000000000.click' };
const order = { id: 'order-1', status: 'waiting_payment', createdAt: '2026-10-12T10:00:00Z', totalCents: 9990, items: [{ id: 'helmet', name: 'Capacete', quantity: 2, unitPriceCents: 4995 }], customer: { name: 'Cliente Teste', email: ' TEST@EXAMPLE.COM ', phone: '(11) 99999-0000', document: '123.456.789-00' }, tracking };
test('Meta normalizes and hashes consented identifiers and uses cent amounts', async () => {
  const event = await buildMetaEvent({ eventName: 'AddPaymentInfo', eventId: 'pix:one', tracking, items: order.items, valueCents: order.totalCents, paymentMethod: 'pix' }, { customer: order.customer, now: 1700000000000 });
  assert.equal(event.custom_data.value, 99.9);
  assert.equal(event.custom_data.contents[0].item_price, 49.95);
  assert.equal(event.custom_data.payment_method, 'pix');
  assert.equal(event.event_source_url, 'https://shop.test/product');
  assert.match(event.user_data.em[0], /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(event).includes('123.456'), false);
  assert.equal(await buildMetaEvent({ eventName: 'PageView', tracking: { consent: false } }), null);
});
test('UTMify uses documented order states, UTC and integer cents', () => {
  const body = buildUtmifyOrder(order, { isTest: true });
  assert.equal(body.status, 'waiting_payment'); assert.equal(body.approvedDate, null);
  assert.equal(body.commission.totalPriceInCents, 9990); assert.equal(body.products[0].priceInCents, 4995);
  assert.equal(body.createdAt, '2026-10-12 10:00:00'); assert.equal(body.trackingParameters.utm_source, 'facebook');
  assert.equal(body.trackingParameters.sck, null); assert.equal(body.isTest, true);
  assert.throws(() => buildUtmifyOrder({ ...order, status: 'paid' }), /unconfirmed_payment/);
  assert.throws(() => buildUtmifyOrder({ ...order, totalCents: 99.9 }), /invalid_amount/);
  assert.equal(buildUtmifyOrder({ ...order, status: 'refused' }).status, 'refused');
  assert.equal(buildUtmifyOrder({ ...order, status: 'refunded', refundedAt: order.createdAt }).status, 'refunded');
});
test('PIX generation never emits Purchase; confirmed paid deduplicates deterministically', async () => {
  const calls = []; const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response('{}'); };
  await sendOrderTracking(order, env, { fetchImpl }); assert.equal(calls.length, 1);
  assert.equal(calls[0].body.status, 'waiting_payment');
  await sendOrderTracking({ ...order, status: 'paid', paidAt: order.createdAt }, env, { fetchImpl });
  assert.equal(calls[2].body.data[0].event_name, 'Purchase'); assert.equal(calls[2].body.data[0].event_id, purchaseEventId(order.id));
  const before = calls.length;
  await sendOrderTracking({ ...order, tracking: { consent: false } }, env, { fetchImpl }); assert.equal(calls.length, before);
});
test('delivery returns sanitized retry information without provider data', async () => {
  const result = await sendOrderTracking(order, env, { fetchImpl: async () => new Response('secret customer token', { status: 503 }) });
  assert.deepEqual(result.utmify, { success: false, retry: true, code: 'http_503' });
  assert.equal(JSON.stringify(result).includes('secret'), false);
});
test('public ingestion rejects Purchase and oversized/foreign requests', async () => {
  const req = (body, origin = 'https://shop.test') => new Request('https://shop.test/api/events', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await handleTrackingRequest(req({ eventName: 'Purchase' }), env)).status, 400);
  assert.equal((await handleTrackingRequest(req({ eventName: 'PageView' }, 'https://evil.test'), env)).status, 403);
  assert.equal((await handleTrackingRequest(req({ x: 'x'.repeat(13000) }), env)).status, 413);
});
test('first-touch attribution persists and pixel/CAPI share the event ID only after consent', () => {
  const data = new Map(); const store = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  const calls = [], fetches = [], scripts = [];
  const win = { localStorage: store, sessionStorage: store, location: { href: 'https://shop.test/?utm_source=facebook&fbclid=click', origin: 'https://shop.test', pathname: '/', hash: '' }, crypto: { randomUUID: () => 'event-123' }, document: { cookie: '', createElement: () => ({}), head: { appendChild: script => scripts.push(script) } }, fbq: (...args) => calls.push(args), fetch: (url, init) => { fetches.push(JSON.parse(init.body)); return Promise.resolve({}); } };
  const tracker = createTracker({ window: win }); tracker.pageView(); assert.equal(calls.length, 0); assert.equal(fetches.length, 0);
  tracker.setConsent(true);
  assert.equal(fetches[0].eventId, calls.find(c => c[0] === 'track')[3].eventID);
  assert.equal(tracker.getContext().fbc.endsWith('.click'), true);
  tracker.pageView(); assert.equal(fetches.length, 1);
  win.location.pathname = '/product'; tracker.pageView(); assert.equal(fetches.length, 2);
  assert.equal(tracker.track('Purchase', {}), null);
  assert.equal(tracker.purchase({ ...order, purchaseEventId: 'purchase:order-1' }), null);
  const paid = { ...order, status: 'paid', paidAt: order.createdAt, purchaseEventId: 'purchase:order-1' };
  assert.equal(tracker.purchase(paid), 'purchase:order-1'); assert.equal(tracker.purchase(paid), null);
  assert.equal(fetches.length, 2);
  assert.equal(captureAttribution('https://shop.test/?utm_source=other', tracker.getContext().attribution).utm_source, 'facebook');
  tracker.setConsent(false); tracker.track('AddToCart', {}); assert.equal(fetches.length, 2);
});
