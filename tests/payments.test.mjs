import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handlePaymentRequest, retryPaymentTracking, validCPF } from '../worker/payments.mjs';
import { checkoutItems } from '../worker/catalog.mjs';

const origin = 'https://shop.example';
const customer = { name: 'Maria Silva', email: 'maria@example.com', phone: '11987654321', document: '52998224725', address: { zipCode: '01310100', street: 'Avenida Paulista', number: '100', complement: '', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP' } };
const input = () => ({ idempotencyKey: crypto.randomUUID(), items: [{ id: '394', size: '58/M', quantity: 1, unitPriceCents: 1 }], customer: structuredClone(customer), tracking: { consent: false } });
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0000_payments.sql', import.meta.url), 'utf8'));
  const DB = { prepare(sql) { const stmt = sqlite.prepare(sql); return { bind(...values) { return { async first() { return stmt.get(...values) ?? null; }, async all() { return { results: stmt.all(...values) }; }, async run() { return { meta: { changes: Number(stmt.run(...values).changes) } }; } }; } }; } };
  const state = { posts: [], tracking: [], status: 'pending', amount: 17990, createAmount: 17990, timeout: false, metaFail: false };
  const env = { DB, PAYMENT_API_TOKEN: 'test-only-not-a-secret', SHIPPING_AMOUNT_CENTS: '0', META_PIXEL_ID: '12345', META_API_VERSION: 'v25.0', META_ACCESS_TOKEN: 'fake', UTMIFY_API_TOKEN: 'fake',
    async PAYMENT_FETCH(url, options) {
      const path = new URL(url).pathname;
      assert.equal(new URL(url).searchParams.get('api_token'), 'test-only-not-a-secret');
      if (path.endsWith('/transactions') && options.method === 'POST') {
        state.posts.push(JSON.parse(options.body));
        if (state.timeout) throw new Error('simulated timeout');
        return Response.json({ hash: 'txn123', amount: state.createAmount, payment_method: 'pix', payment_status: 'paid', pix: { pix_qr_code: '00020101021226880014BR.GOV.BCB.PIX.test-payload' } });
      }
      if (path.endsWith('/transactions/txn123') && options.method === 'GET') return Response.json({ success: true, data: { hash: 'txn123', amount: state.amount, payment_method: 'pix', status: state.status } });
      throw new Error(`Unexpected mocked path: ${path}`);
    },
    async TRACKING_FETCH(url, options) { state.tracking.push({ url, body: JSON.parse(options.body) }); return Response.json({}, { status: state.metaFail && url.includes('facebook') ? 503 : 200 }); },
  };
  async function request(path, body, method = body ? 'POST' : 'GET', headers = {}) {
    const pending = [];
    const response = await handlePaymentRequest(new Request(origin + path, { method, headers: { origin, 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, { waitUntil: promise => pending.push(promise) });
    await Promise.all(pending);
    return { status: response.status, body: await response.json() };
  }
  return { env, state, sqlite, request, tick() { sqlite.exec('UPDATE payment_orders SET last_checked_at = 0'); } };
}

test('trusted catalogue overrides tampered prices and validates variants, availability, quantity', () => {
  const item = checkoutItems(input().items)[0];
  assert.equal(item.unitPriceCents, 17990);
  assert.equal(item.variantId, '1531');
  assert.throws(() => checkoutItems([{ id: '394', size: 'BAD', quantity: 1 }]));
  assert.throws(() => checkoutItems([{ id: '394', size: '58/M', quantity: 11 }]));
  assert.throws(() => checkoutItems([{ id: '394', variantId: '1531', size: '60/L', quantity: 1 }]));
  assert.throws(() => checkoutItems([...input().items, ...input().items]));
  const other = checkoutItems([{ id: '675', size: '54/XS', quantity: 1 }])[0];
  assert.equal(other.unitPriceCents, 21041);
});

test('checkout validates CPF, customer/address, origin and explicit shipping configuration before dispatch', async () => {
  const f = fixture();
  assert.equal(validCPF(customer.document), true);
  assert.equal(validCPF('11111111111'), false);
  const bad = input(); bad.customer.document = '12345678900';
  assert.equal((await f.request('/api/checkout', bad)).status, 400);
  bad.customer = structuredClone(customer); bad.customer.address.zipCode = '123';
  assert.equal((await f.request('/api/checkout', bad)).status, 400);
  const response = await handlePaymentRequest(new Request(origin + '/api/checkout', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify(input()) }), f.env, {});
  assert.equal(response.status, 403);
  delete f.env.SHIPPING_AMOUNT_CENTS;
  assert.equal((await f.request('/api/checkout', input())).status, 503);
  assert.equal(f.state.posts.length, 0);
});

test('Pix creation uses server total, physical address, seed mapping and sanitized order; POST paid alone is not proof', async () => {
  const f = fixture();
  const response = await f.request('/api/checkout', input());
  assert.equal(response.status, 201);
  assert.equal(response.body.status, 'waiting_payment');
  assert.equal(response.body.totalCents, 17990);
  assert.equal(response.body.shippingCents, 0);
  assert.equal(response.body.customer, undefined);
  assert.equal(response.body.providerHash, undefined);
  assert.equal(response.body.purchaseEventId, undefined);
  const sent = f.state.posts[0];
  assert.equal(sent.amount, 17990);
  assert.equal(sent.offer_hash, 'kxgcb');
  assert.equal(sent.cart[0].product_hash, 'xurol3z1la');
  assert.equal(sent.cart[0].tangible, true);
  assert.equal(sent.customer.street_name, customer.address.street);
  assert.equal(sent.postback_url, origin + '/api/payment/postback');
});

test('approved storefronts preserve checkout source and backend postback without proxy IP', async () => {
  for (const storefront of [origin, 'https://nolimitemotors.com', 'https://www.nolimitemotors.com']) {
    const f = fixture();
    const body = input();
    body.tracking = { consent: true, eventSourceUrl: storefront + '/produto/capacete?email=private' };
    const result = await f.request('/api/checkout', body, 'POST', { origin: storefront, 'cf-connecting-ip': '192.0.2.1', 'x-forwarded-for': '198.51.100.1', 'user-agent': 'buyer-agent' });
    assert.equal(result.status, 201);
    const saved = JSON.parse(f.sqlite.prepare('SELECT data_json FROM payment_orders').get().data_json);
    assert.equal(saved.tracking.eventSourceUrl, storefront + '/produto/capacete');
    assert.equal(saved.userAgent, 'buyer-agent');
    assert.equal(f.state.posts[0].postback_url, origin + '/api/payment/postback');
    assert.equal(f.state.tracking[0].body.customer.ip, storefront === origin ? '192.0.2.1' : undefined);
    assert.equal(saved.clientIp, storefront === origin ? '192.0.2.1' : '');
  }
});

test('checkout denies non-approved storefront origins before payment dispatch', async () => {
  const f = fixture();
  for (const invalid of ['https://evil.example', 'https://nolimitemotors.com.evil.example', 'http://nolimitemotors.com', 'https://other.nolimitemotors.com']) {
    assert.equal((await f.request('/api/checkout', input(), 'POST', { origin: invalid })).status, 403);
  }
  assert.equal(f.state.posts.length, 0);
});

test('idempotency returns same order once and rejects a changed cart', async () => {
  const f = fixture(); const body = input();
  const first = await f.request('/api/checkout', body);
  const next = await f.request('/api/checkout', body);
  assert.equal(first.body.id, next.body.id);
  assert.equal(f.state.posts.length, 1);
  body.items[0].quantity = 2;
  assert.equal((await f.request('/api/checkout', body)).status, 409);
  assert.equal(f.state.posts.length, 1);
});

test('concurrent requests sharing one idempotency key dispatch only one payment', async () => {
  const f = fixture(); const body = input();
  const results = await Promise.all([f.request('/api/checkout', body), f.request('/api/checkout', body)]);
  assert.equal(results[0].body.id, results[1].body.id);
  assert.equal(f.state.posts.length, 1);
});

test('on-demand physical product registration reuses returned default offer and persists mapping', async () => {
  const f = fixture(); const original = f.env.PAYMENT_FETCH; let productsCreated = 0;
  const storefront = 'https://nolimitemotors.com';
  f.env.PAYMENT_FETCH = async (url, options) => {
    if (new URL(url).pathname.endsWith('/products')) {
      productsCreated++;
      const product = JSON.parse(options.body);
      assert.equal(product.product_type, 'fisico');
      assert.equal(product.id_category, 6);
      assert.equal(product.amount, 21041);
      assert.ok(product.cover.startsWith('https://'));
      assert.ok(product.sale_page.startsWith(storefront + '/produto/'));
      return Response.json({ hash: 'own675', offers: [{ hash: 'offer675', status: 1 }] });
    }
    return original(url, options);
  };
  f.state.amount = f.state.createAmount = 21041;
  const body = input(); body.items = [{ id: '675', size: '54/XS', quantity: 1 }];
  const result = await f.request('/api/checkout', body, 'POST', { origin: storefront });
  assert.equal(result.status, 201);
  assert.equal(f.state.posts[0].cart[0].product_hash, 'own675');
  assert.equal(f.state.posts[0].offer_hash, 'offer675');
  assert.equal(productsCreated, 1);
  assert.equal(f.sqlite.prepare('SELECT state FROM payment_products WHERE product_id = ?').get('675').state, 'ready');
});

test('ambiguous product registration recovers unique existing product through reads only', async () => {
  const f = fixture(); const original = f.env.PAYMENT_FETCH; const item = checkoutItems([{ id: '675', size: '54/XS', quantity: 1 }])[0];
  f.sqlite.prepare("INSERT INTO payment_products (product_id,state,updated_at) VALUES ('675','needs_review',0)").run();
  let registrationPosts = 0;
  f.env.PAYMENT_FETCH = async (url, options) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/products') && options.method === 'GET') return Response.json({ data: [{ title: item.name, hash: 'recovered675' }], pagination: { total_pages: 1 } });
    if (path.endsWith('/products/recovered675')) return Response.json({ title: item.name, hash: 'recovered675', offers: [{ hash: 'recoveredOffer', status: 1 }] });
    if (path.endsWith('/products') && options.method === 'POST') registrationPosts++;
    return original(url, options);
  };
  f.state.amount = f.state.createAmount = 21041;
  const body = input(); body.items = [{ id: '675', size: '54/XS', quantity: 1 }];
  const result = await f.request('/api/checkout', body);
  assert.equal(result.status, 201);
  assert.equal(registrationPosts, 0);
  assert.equal(f.state.posts[0].offer_hash, 'recoveredOffer');
});

test('ambiguous POST timeout is persisted and never dispatched again', async () => {
  const f = fixture(); f.state.timeout = true; const body = input();
  const first = await f.request('/api/checkout', body);
  assert.equal(first.status, 503);
  assert.equal(first.body.status, 'payment_uncertain');
  await f.request('/api/checkout', body);
  await f.request('/api/orders/' + first.body.id);
  assert.equal(f.state.posts.length, 1);
});

test('unsigned webhook cannot mark paid; authenticated status/amount controls confirmation and tracking deduplication', async () => {
  const f = fixture(); const body = input(); body.tracking.consent = true;
  const initial = await f.request('/api/checkout', body);
  assert.equal(f.state.tracking.filter(t => t.url.includes('facebook')).length, 0);
  assert.equal(f.state.tracking[0].body.status, 'waiting_payment');
  f.tick();
  await f.request('/api/payment/postback', { hash: 'txn123', payment_status: 'paid', amount: 17990 });
  assert.equal((await f.request('/api/orders/' + initial.body.id)).body.status, 'waiting_payment');
  f.state.status = 'paid'; f.state.amount = 1; f.tick();
  assert.equal((await f.request('/api/orders/' + initial.body.id)).body.status, 'waiting_payment');
  f.state.amount = 17990; f.tick();
  const paid = await f.request('/api/orders/' + initial.body.id);
  assert.equal(paid.body.status, 'paid');
  assert.equal(paid.body.purchaseEventId, 'purchase:' + initial.body.id);
  assert.equal(f.state.tracking.filter(t => t.url.includes('facebook')).length, 1);
  await f.request('/api/orders/' + initial.body.id);
  await f.request('/api/payment/postback', { hash: 'txn123', status: 'paid' });
  assert.equal(f.state.tracking.filter(t => t.url.includes('facebook')).length, 1);
  f.state.status = 'pending'; f.tick();
  assert.equal((await f.request('/api/orders/' + initial.body.id)).body.status, 'paid');
});

test('tracking transient failures retry from persistent queue without repeating successful providers', async () => {
  const f = fixture(); f.state.status = 'paid'; f.state.metaFail = true;
  const body = input(); body.tracking.consent = true;
  await f.request('/api/checkout', body);
  assert.equal(f.state.tracking.length, 2);
  f.sqlite.exec('UPDATE payment_tracking SET next_attempt_at = 0');
  f.state.metaFail = false;
  await retryPaymentTracking(f.env);
  assert.equal(f.state.tracking.filter(t => t.url.includes('utmify')).length, 1);
  assert.equal(f.state.tracking.filter(t => t.url.includes('facebook')).length, 2);
  await retryPaymentTracking(f.env);
  assert.equal(f.state.tracking.length, 3);
});

test('provider amount mismatch never exposes an unverified Pix code', async () => {
  const f = fixture(); f.state.createAmount = 1; f.state.amount = 1;
  const response = await f.request('/api/checkout', input());
  assert.equal(response.body.status, 'payment_uncertain');
  assert.equal(response.body.pix, null);
});
