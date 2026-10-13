import { checkoutItems, catalogProduct } from './catalog.mjs';
import { sendOrderTracking, purchaseEventId } from './tracking.mjs';

const API = 'https://api.ironpayapp.com.br/api/public/v1';
// Verified in the account on 2026-10-12; data initialization belongs outside migrations.
const VERIFIED_PRODUCTS = { '394': { product_hash: 'xurol3z1la', offer_hash: 'kxgcb' } };
const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const clean = (value, max = 180) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const digits = value => clean(value).replace(/\D/g, '');
const query = (db, sql, ...args) => db.prepare(sql).bind(...args);
const changes = result => result.meta?.changes ?? result.changes ?? 0;
const byId = (db, id) => query(db, 'SELECT * FROM payment_orders WHERE id = ?', id).first();
const fromRow = row => row ? { ...JSON.parse(row.data_json), status: row.status, providerHash: row.provider_hash } : null;
class PaymentError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function validCPF(input) {
  const cpf = digits(input);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false;
  return [9, 10].every(length => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (length + 1 - i);
    const value = (sum * 10) % 11;
    return Number(cpf[length]) === (value === 10 ? 0 : value);
  });
}
export function validateCustomer(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PaymentError('invalid_customer');
  const a = input.address || {};
  const customer = { name: clean(input.name), email: clean(input.email, 254).toLowerCase(), phone: digits(input.phone), document: digits(input.document), address: { zipCode: digits(a.zipCode), street: clean(a.street), number: clean(a.number, 20), complement: clean(a.complement), neighborhood: clean(a.neighborhood), city: clean(a.city), state: clean(a.state, 2).toUpperCase() } };
  if (!validCPF(customer.document)) throw new PaymentError('invalid_cpf');
  if (!/\S+\s+\S+/.test(customer.name) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) || !/^\d{10,11}$/.test(customer.phone)) throw new PaymentError('invalid_customer');
  const address = customer.address;
  if (!/^\d{8}$/.test(address.zipCode) || address.street.length < 3 || !address.number || !address.neighborhood || address.city.length < 2 || !'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').includes(address.state)) throw new PaymentError('invalid_address');
  return customer;
}
function clientTracking(value = {}, request) {
  value = value && typeof value === 'object' ? value : {};
  const attribution = {};
  for (const key of ['src', 'sck', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) attribution[key] = clean(value.attribution?.[key], 256);
  let eventSourceUrl = new URL(request.url).origin + '/checkout';
  try { const source = new URL(value.eventSourceUrl); if (source.origin === new URL(request.url).origin) eventSourceUrl = source.origin + source.pathname; } catch {}
  return { consent: value.consent === true, fbp: clean(value.fbp), fbc: clean(value.fbc), attribution, eventSourceUrl };
}
async function readBody(request, max = 24000) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new PaymentError('invalid_content_type', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new PaymentError('invalid_body');
  const chunks = []; let size = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > max) { await reader.cancel(); throw new PaymentError('body_too_large', 413); } chunks.push(value); }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  try { const body = JSON.parse(new TextDecoder().decode(bytes)); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; } catch { throw new PaymentError('invalid_body'); }
}
async function sha(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join(''); }
async function gateway(env, method, path, body) {
  const url = new URL(API + path); url.searchParams.set('api_token', env.PAYMENT_API_TOKEN);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await (env.PAYMENT_FETCH || fetch)(url.toString(), { method, headers: { accept: 'application/json', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
    if (!response.ok) throw new PaymentError(response.status >= 500 || response.status === 429 ? 'gateway_uncertain' : 'gateway_rejected', 502);
    const parsed = await response.json();
    return parsed.data && !Array.isArray(parsed.data) ? parsed.data : parsed;
  } catch (error) { if (error instanceof PaymentError) throw error; throw new PaymentError('gateway_uncertain', 502); }
  finally { clearTimeout(timer); }
}
async function productMapping(env, item, origin) {
  const verified = VERIFIED_PRODUCTS[item.id];
  if (verified) await query(env.DB, "INSERT OR IGNORE INTO payment_products (product_id, product_hash, offer_hash, state, updated_at) VALUES (?, ?, ?, 'ready', ?)", item.id, verified.product_hash, verified.offer_hash, Date.now()).run();
  let row = await query(env.DB, 'SELECT * FROM payment_products WHERE product_id = ?', item.id).first();
  if (row?.state === 'ready' && row.product_hash && row.offer_hash) return row;
  if (row) {
    // Reconcile an ambiguous registration through reads only; never repeat its POST.
    if (Date.now() - row.updated_at < 30000) throw new PaymentError('product_preparing', 503);
    const claimed = await query(env.DB, "UPDATE payment_products SET state = 'reconciling', updated_at = ? WHERE product_id = ? AND updated_at = ?", Date.now(), item.id, row.updated_at).run();
    if (!changes(claimed)) throw new PaymentError('product_preparing', 503);
    try {
      const product = catalogProduct(item.id);
      let matches = [];
      if (row.product_hash) matches = [await gateway(env, 'GET', `/products/${encodeURIComponent(row.product_hash)}`)];
      else {
        for (let page = 1; page <= 20; page++) {
          const result = await gateway(env, 'GET', `/products?page=${page}&per_page=100`);
          const list = Array.isArray(result.data) ? result.data : Array.isArray(result) ? result : [];
          matches.push(...list.filter(value => value.title === product.name));
          if (!result.pagination || page >= result.pagination.total_pages || list.length === 0) break;
        }
        if (matches.length === 1) matches = [await gateway(env, 'GET', `/products/${encodeURIComponent(matches[0].hash)}`)];
      }
      const match = matches.length === 1 && matches[0];
      const offer = match?.offers?.find(value => value.hash && value.status !== 0);
      if (match?.title === product.name && /^[\w-]{1,100}$/.test(match.hash || '') && /^[\w-]{1,100}$/.test(offer?.hash || '')) {
        await query(env.DB, "UPDATE payment_products SET product_hash = ?, offer_hash = ?, state = 'ready', updated_at = ? WHERE product_id = ?", match.hash, offer.hash, Date.now(), item.id).run();
        return { product_hash: match.hash, offer_hash: offer.hash };
      }
    } catch { /* Keep the registration blocked when reads cannot establish a unique mapping. */ }
    await query(env.DB, "UPDATE payment_products SET state = 'needs_review', updated_at = ? WHERE product_id = ?", Date.now(), item.id).run();
    throw new PaymentError('product_preparing', 503);
  }
  const claimed = await query(env.DB, "INSERT OR IGNORE INTO payment_products (product_id, state, updated_at) VALUES (?, 'registering', ?)", item.id, Date.now()).run();
  if (!changes(claimed)) throw new PaymentError('product_preparing', 503);
  try {
    const product = catalogProduct(item.id);
    const cover = product.images?.[0];
    const created = await gateway(env, 'POST', '/products', { title: product.name, payment_type: 1, product_type: 'fisico', id_category: 6, amount: item.unitPriceCents, cover: typeof cover === 'string' ? cover : cover?.url, sale_page: `${origin}/produto/${encodeURIComponent(product.slug)}` });
    if (typeof created.hash !== 'string' || !/^[\w-]{1,100}$/.test(created.hash)) throw new PaymentError('gateway_uncertain', 502);
    await query(env.DB, 'UPDATE payment_products SET product_hash = ?, updated_at = ? WHERE product_id = ?', created.hash, Date.now(), item.id).run();
    let offer = created.offers?.find(value => value.hash && value.status !== 0);
    if (!offer) offer = await gateway(env, 'POST', `/products/${encodeURIComponent(created.hash)}/offers`, { title: `${product.name} — Pix`, amount: item.unitPriceCents, cover: typeof cover === 'string' ? cover : cover?.url });
    if (typeof offer.hash !== 'string' || !/^[\w-]{1,100}$/.test(offer.hash)) throw new PaymentError('gateway_uncertain', 502);
    await query(env.DB, "UPDATE payment_products SET offer_hash = ?, state = 'ready', updated_at = ? WHERE product_id = ?", offer.hash, Date.now(), item.id).run();
    return { product_hash: created.hash, offer_hash: offer.hash };
  } catch (error) {
    await query(env.DB, "UPDATE payment_products SET state = 'needs_review', updated_at = ? WHERE product_id = ?", Date.now(), item.id).run();
    throw error;
  }
}
export function publicOrder(order) {
  return { id: order.id, status: order.status, retryAllowed: order.status === 'refused', totalCents: order.totalCents, subtotalCents: order.subtotalCents, shippingCents: order.shippingCents, items: order.items.map(({ id, name, size, quantity, unitPriceCents }) => ({ id, name, size, quantity, unitPriceCents })), pix: order.pix || null, createdAt: order.createdAt, paidAt: order.paidAt || null, ...(order.status === 'paid' ? { purchaseEventId: purchaseEventId(order.id) } : {}) };
}
async function saveOrder(env, order) {
  await query(env.DB, 'UPDATE payment_orders SET status = ?, provider_hash = ?, data_json = ?, updated_at = ? WHERE id = ?', order.status, order.providerHash || null, JSON.stringify(order), Date.now(), order.id).run();
}
async function deliverTracking(order, env) {
  if (!['waiting_payment', 'paid', 'refused', 'refunded'].includes(order.status)) return;
  const current = await byId(env.DB, order.id);
  if (!current || current.status !== order.status) return;
  const providers = order.status === 'paid' ? ['meta', 'utmify'] : ['utmify'];
  const claimed = [];
  for (const provider of providers) {
    await query(env.DB, 'INSERT OR IGNORE INTO payment_tracking (order_id, order_status, provider) VALUES (?, ?, ?)', order.id, order.status, provider).run();
    const now = Date.now();
    const result = await query(env.DB, "UPDATE payment_tracking SET state = 'sending', attempts = attempts + 1, lease_until = ? WHERE order_id = ? AND order_status = ? AND provider = ? AND attempts < 10 AND next_attempt_at <= ? AND (state IN ('pending', 'retry') OR (state = 'sending' AND lease_until < ?)) AND NOT EXISTS (SELECT 1 FROM payment_tracking active WHERE active.order_id = ? AND active.provider = ? AND active.order_status != ? AND active.state = 'sending' AND active.lease_until > ?)", now + 60000, order.id, order.status, provider, now, now, order.id, provider, order.status, now).run();
    if (changes(result)) claimed.push(provider);
  }
  if (!claimed.length) return;
  let result;
  try { result = await sendOrderTracking(order, env, { skipMeta: !claimed.includes('meta'), skipUtmify: !claimed.includes('utmify'), fetchImpl: env.TRACKING_FETCH }); }
  catch { result = Object.fromEntries(claimed.map(provider => [provider, { success: false, retry: true, code: 'delivery_failed' }])); }
  for (const provider of claimed) {
    const delivery = result[provider];
    await query(env.DB, 'UPDATE payment_tracking SET state = ?, code = ?, lease_until = 0, next_attempt_at = ? WHERE order_id = ? AND order_status = ? AND provider = ?', delivery.success ? 'sent' : delivery.retry ? 'retry' : 'failed', delivery.code || delivery.skipped || null, Date.now() + 60000, order.id, order.status, provider).run();
  }
}
function background(ctx, promise) { const task = promise.catch(() => {}); if (ctx?.waitUntil) ctx.waitUntil(task); return task; }
async function refreshOrder(env, row) {
  let order = fromRow(row);
  if (!order.providerHash || !env.PAYMENT_API_TOKEN || Date.now() - row.last_checked_at < 5000) return order;
  const claimed = await query(env.DB, 'UPDATE payment_orders SET last_checked_at = ? WHERE id = ? AND last_checked_at = ?', Date.now(), order.id, row.last_checked_at).run();
  if (!changes(claimed)) return fromRow(await byId(env.DB, order.id));
  try {
    const transaction = await gateway(env, 'GET', `/transactions/${encodeURIComponent(order.providerHash)}`);
    if (transaction.hash !== order.providerHash || Number(transaction.amount) !== order.totalCents || transaction.payment_method !== 'pix') return order;
    order = fromRow(await byId(env.DB, order.id));
    const code = transaction.pix?.pix_qr_code;
    if (!order.pix && typeof code === 'string' && code.length > 20 && code.length < 4096) order.pix = { code, expiresAt: new Date(new Date(order.createdAt).getTime() + 86400000).toISOString() };
    const liquid = Number(transaction.amount_liquid);
    if (transaction.amount_liquid != null && Number.isSafeInteger(liquid) && liquid >= 0 && liquid <= order.totalCents) order.gatewayFeeCents = order.totalCents - liquid;
    const status = transaction.payment_status || transaction.status;
    if (status === 'paid' && order.status !== 'refunded') { order.status = 'paid'; order.paidAt ||= new Date().toISOString(); }
    else if (status === 'refunded') { order.status = 'refunded'; order.refundedAt ||= new Date().toISOString(); }
    else if (['canceled', 'cancelled', 'refused', 'failed'].includes(status) && order.status !== 'paid' && order.status !== 'refunded') order.status = 'refused';
    else if (status === 'pending' && !['paid', 'refunded', 'refused'].includes(order.status)) order.status = order.pix ? 'waiting_payment' : 'payment_uncertain';
    await saveOrder(env, order);
  } catch { /* A polling failure never changes payment state or recreates a payment. */ }
  return order;
}
async function checkout(request, env, ctx) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new PaymentError('invalid_origin', 403);
  if (!env.DB || !env.PAYMENT_API_TOKEN || !/^\d+$/.test(String(env.SHIPPING_AMOUNT_CENTS ?? ''))) throw new PaymentError('checkout_unavailable', 503);
  const input = await readBody(request);
  if (typeof input.idempotencyKey !== 'string' || !/^[\w-]{16,100}$/.test(input.idempotencyKey)) throw new PaymentError('invalid_idempotency_key');
  let items;
  try { items = checkoutItems(input.items); } catch { throw new PaymentError('invalid_items'); }
  const customer = validateCustomer(input.customer);
  const shippingCents = Number(env.SHIPPING_AMOUNT_CENTS);
  const subtotalCents = items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  const totalCents = subtotalCents + shippingCents;
  if (!Number.isSafeInteger(totalCents) || totalCents < 1 || totalCents > 10000000) throw new PaymentError('invalid_total');
  const fingerprint = await sha({ items, customer, shippingCents });
  let existing = await query(env.DB, 'SELECT * FROM payment_orders WHERE idempotency_key = ?', input.idempotencyKey).first();
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new PaymentError('idempotency_conflict', 409);
    const order = await refreshOrder(env, existing); background(ctx, deliverTracking(order, env));
    return json(publicOrder(order), order.status === 'processing' ? 202 : 200);
  }
  const order = { id: crypto.randomUUID(), status: 'processing', items, customer, totalCents, subtotalCents, shippingCents, createdAt: new Date().toISOString(), tracking: clientTracking(input.tracking, request), clientIp: clean(request.headers.get('cf-connecting-ip'), 64), userAgent: clean(request.headers.get('user-agent'), 512) };
  const inserted = await query(env.DB, 'INSERT OR IGNORE INTO payment_orders (id, idempotency_key, fingerprint, status, data_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)', order.id, input.idempotencyKey, fingerprint, order.status, JSON.stringify(order), Date.now()).run();
  if (!changes(inserted)) {
    existing = await query(env.DB, 'SELECT * FROM payment_orders WHERE idempotency_key = ?', input.idempotencyKey).first();
    if (existing.fingerprint !== fingerprint) throw new PaymentError('idempotency_conflict', 409);
    return json(publicOrder(fromRow(existing)), 202);
  }
  let dispatched = false;
  try {
    const mapped = [];
    for (const item of items) mapped.push(await productMapping(env, item, new URL(request.url).origin));
    const address = customer.address;
    const payload = { amount: totalCents, offer_hash: mapped[0].offer_hash, payment_method: 'pix', installments: 1, customer: { name: customer.name, email: customer.email, phone_number: customer.phone, document: customer.document, street_name: address.street, number: address.number, complement: address.complement, neighborhood: address.neighborhood, city: address.city, state: address.state, zip_code: address.zipCode }, cart: items.map((item, index) => ({ product_hash: mapped[index].product_hash, title: `${item.name} — ${item.size}`, price: item.unitPriceCents, quantity: item.quantity, operation_type: 1, tangible: true })), transaction_origin: 'api', expire_in_days: 1, tracking: order.tracking.attribution, postback_url: new URL('/api/payment/postback', request.url).href };
    dispatched = true;
    const transaction = await gateway(env, 'POST', '/transactions', payload);
    if (typeof transaction.hash !== 'string' || !/^[\w-]{1,100}$/.test(transaction.hash)) throw new PaymentError('gateway_uncertain', 502);
    order.providerHash = transaction.hash;
    const code = transaction.pix?.pix_qr_code;
    order.pix = Number(transaction.amount) === totalCents && transaction.payment_method === 'pix' && typeof code === 'string' && code.length > 20 && code.length < 4096 ? { code, expiresAt: new Date(Date.now() + 86400000).toISOString() } : null;
    order.status = order.pix ? 'waiting_payment' : 'payment_uncertain';
    await saveOrder(env, order);
    const checked = await refreshOrder(env, await byId(env.DB, order.id));
    background(ctx, deliverTracking(checked, env));
    return json(publicOrder(checked), 201);
  } catch (error) {
    order.status = dispatched && error.code !== 'gateway_rejected' ? 'payment_uncertain' : 'refused';
    await saveOrder(env, order);
    return json({ ...publicOrder(order), error: dispatched ? 'payment_creation_failed' : 'checkout_preparing', message: dispatched ? 'Não foi possível confirmar a geração do Pix no Pagar.me. Acompanhe este pedido antes de tentar novamente.' : 'Estamos preparando este produto para pagamento no Pagar.me. Tente novamente mais tarde.' }, 503);
  }
}
export async function retryPaymentTracking(env) {
  if (!env.DB) return;
  const pending = await query(env.DB, "SELECT DISTINCT o.* FROM payment_orders o JOIN payment_tracking t ON t.order_id = o.id AND t.order_status = o.status WHERE t.state IN ('pending', 'retry', 'sending') AND t.next_attempt_at <= ? AND t.lease_until <= ? AND t.attempts < 10 LIMIT 20", Date.now(), Date.now()).all();
  for (const row of pending.results || []) await deliverTracking(fromRow(row), env);
}
export async function reconcilePayments(env) {
  if (!env.DB || !env.PAYMENT_API_TOKEN) return;
  const rows = await query(env.DB, "SELECT * FROM payment_orders WHERE provider_hash IS NOT NULL AND status IN ('waiting_payment', 'payment_uncertain') ORDER BY last_checked_at ASC LIMIT 20").all();
  for (const row of rows.results || []) await deliverTracking(await refreshOrder(env, row), env);
  await retryPaymentTracking(env);
}
export async function handlePaymentRequest(request, env, ctx) {
  const path = new URL(request.url).pathname;
  if (path !== '/api/checkout' && path !== '/api/payment/postback' && !path.startsWith('/api/orders/')) return null;
  try {
    if (path === '/api/checkout') { if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405); return await checkout(request, env, ctx); }
    if (!env.DB) throw new PaymentError('checkout_unavailable', 503);
    if (path === '/api/payment/postback') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      const body = await readBody(request);
      const hash = body.hash || body.data?.hash;
      if (typeof hash === 'string' && /^[\w-]{1,100}$/.test(hash)) {
        const row = await query(env.DB, 'SELECT * FROM payment_orders WHERE provider_hash = ?', hash).first();
        if (row) { const order = await refreshOrder(env, row); background(ctx, deliverTracking(order, env)); }
      }
      return json({ received: true });
    }
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    const id = path.slice('/api/orders/'.length);
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'order_not_found' }, 404);
    const row = await byId(env.DB, id);
    if (!row) return json({ error: 'order_not_found' }, 404);
    const order = await refreshOrder(env, row); background(ctx, deliverTracking(order, env));
    return json(publicOrder(order));
  } catch (error) {
    const messages = {invalid_cpf:'Confira o CPF informado. Digite os 11 números de um CPF válido.',invalid_customer:'Confira seu nome completo, e-mail e celular com DDD.',invalid_address:'Confira o CEP e preencha seu endereço de entrega completo.',invalid_items:'Um item ou tamanho da sacola está indisponível. Revise sua seleção.',idempotency_conflict:'Os dados deste pedido já foram enviados. Verifique o pagamento antes de iniciar outro pedido.'};
    return json({ error: error instanceof PaymentError ? error.code : 'checkout_unavailable', message: messages[error.code] || 'Não foi possível concluir esta etapa do pagamento no Pagar.me. Confira os dados e tente novamente.' }, error instanceof PaymentError ? error.status : 503);
  }
}
