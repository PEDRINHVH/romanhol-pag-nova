// Marketing delivery is separate from payment processing. Callers persist delivery results.
import { storefrontOrigin, storefrontClientIp } from './storefront-origin.mjs';
export const FUNNEL_EVENTS = new Set(['PageView', 'ViewContent', 'Search', 'AddToWishlist', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo']);
const UTM_KEYS = ['src', 'sck', 'utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term'];
const clean = (value, max = 256) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const digits = value => clean(value).replace(/\D/g, '');
const cents = value => { if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_amount'); return value; };
const utc = value => { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new Error('invalid_date'); return date.toISOString().slice(0, 19).replace('T', ' '); };
export const purchaseEventId = id => `purchase:${clean(id, 120)}`;
export async function hashIdentifier(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
export function customData({ items = [], valueCents, paymentMethod } = {}) {
  if (!Array.isArray(items) || items.length > 100) throw new Error('invalid_items');
  const contents = items.map(item => {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) throw new Error('invalid_quantity');
    return { id: clean(String(item.id), 120), quantity: item.quantity, item_price: cents(item.unitPriceCents) / 100 };
  });
  const data = { currency: 'BRL', content_type: 'product', content_ids: contents.map(item => item.id), contents, num_items: contents.reduce((n, item) => n + item.quantity, 0) };
  if (valueCents !== undefined) data.value = cents(valueCents) / 100;
  if (paymentMethod === 'pix') data.payment_method = 'pix';
  return data;
}
export async function buildMetaEvent(input, { customer, clientIp, userAgent, now = Date.now() } = {}) {
  if (input.tracking?.consent !== true) return null;
  if (!FUNNEL_EVENTS.has(input.eventName) && input.eventName !== 'Purchase') throw new Error('invalid_event');
  if (!/^[\w:.-]{1,160}$/.test(input.eventId || '')) throw new Error('invalid_event_id');
  const userData = {};
  for (const key of ['fbp', 'fbc']) {
    const value = clean(input.tracking[key]);
    if (/^fb\.\d+\.\d+\.[\w.-]+$/.test(value)) userData[key] = value;
  }
  if (clientIp) userData.client_ip_address = clean(clientIp, 64);
  if (userAgent) userData.client_user_agent = clean(userAgent, 512);
  if (customer?.email) userData.em = [await hashIdentifier(clean(customer.email).toLowerCase())];
  if (customer?.phone) {
    let phone = digits(customer.phone);
    if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
    if (phone) userData.ph = [await hashIdentifier(phone)];
  }
  if (customer?.document && digits(customer.document)) userData.external_id = [await hashIdentifier(digits(customer.document))];
  const event = { event_name: input.eventName, event_id: input.eventId, event_time: Math.floor(now / 1000), action_source: 'website', user_data: userData, custom_data: customData(input) };
  try { const source = new URL(input.tracking.eventSourceUrl); if (/^https?:$/.test(source.protocol)) event.event_source_url = source.origin + source.pathname + source.hash.split('?')[0]; } catch {}
  return event;
}
async function deliver(url, body, headers, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: controller.signal });
    // Provider bodies can contain customer data or credentials: never return or log them.
    if (response.ok) return { success: true, retry: false };
    return { success: false, retry: response.status === 429 || response.status >= 500, code: `http_${response.status}` };
  } catch { return { success: false, retry: true, code: 'delivery_failed' }; }
  finally { clearTimeout(timer); }
}
export async function sendMetaEvent(event, env, { fetchImpl = fetch } = {}) {
  if (!event) return { success: true, retry: false, skipped: 'no_consent' };
  // Pin explicitly in deployment; do not silently guess an API version.
  if (!env.META_ACCESS_TOKEN || !/^\d+$/.test(env.META_PIXEL_ID || '') || !/^v\d+\.\d+$/.test(env.META_API_VERSION || '')) return { success: false, retry: false, code: 'not_configured' };
  const body = { data: [event] };
  if (env.META_TEST_EVENT_CODE) body.test_event_code = env.META_TEST_EVENT_CODE;
  return deliver(`https://graph.facebook.com/${env.META_API_VERSION}/${env.META_PIXEL_ID}/events`, body, { authorization: `Bearer ${env.META_ACCESS_TOKEN}` }, fetchImpl);
}
export function buildUtmifyOrder(order, { isTest = false } = {}) {
  if (!['waiting_payment', 'paid', 'refused', 'refunded', 'chargedback'].includes(order.status)) throw new Error('invalid_status');
  const total = cents(order.totalCents);
  const fee = cents(order.gatewayFeeCents ?? 0);
  if (fee > total) throw new Error('invalid_fee');
  if (order.status === 'paid' && !order.paidAt) throw new Error('unconfirmed_payment');
  if (order.status === 'refunded' && !order.refundedAt) throw new Error('unconfirmed_refund');
  customData({ items: order.items });
  return {
    orderId: clean(order.id, 120), platform: 'NoLimite', paymentMethod: 'pix', status: order.status,
    createdAt: utc(order.createdAt), approvedDate: order.paidAt ? utc(order.paidAt) : null, refundedAt: order.refundedAt ? utc(order.refundedAt) : null,
    customer: { name: clean(order.customer.name), email: clean(order.customer.email).toLowerCase(), phone: digits(order.customer.phone) || null, document: digits(order.customer.document) || null, country: 'BR', ...(order.clientIp ? { ip: clean(order.clientIp, 64) } : {}) },
    products: order.items.map(item => ({ id: clean(String(item.id), 120), name: clean(item.name), planId: null, planName: null, quantity: item.quantity, priceInCents: cents(item.unitPriceCents) })),
    trackingParameters: Object.fromEntries(UTM_KEYS.map(key => [key, clean(order.tracking?.attribution?.[key]) || null])),
    commission: { totalPriceInCents: total, gatewayFeeInCents: fee, userCommissionInCents: total - fee, currency: 'BRL' }, isTest,
  };
}
export async function sendOrderTracking(order, env, options = {}) {
  const skip = { success: true, retry: false, skipped: 'no_consent' };
  if (order.tracking?.consent !== true) return { meta: skip, utmify: skip };
  const payload = buildUtmifyOrder(order, { isTest: options.isTest === true || env.UTMIFY_IS_TEST === 'true' });
  const utmify = options.skipUtmify ? { success: true, retry: false, skipped: 'already_sent' } : env.UTMIFY_API_TOKEN
    ? await deliver('https://api.utmify.com.br/api-credentials/orders', payload, { 'x-api-token': env.UTMIFY_API_TOKEN }, options.fetchImpl)
    : { success: false, retry: false, code: 'not_configured' };
  let meta = { success: true, retry: false, skipped: options.skipMeta ? 'already_sent' : 'not_paid' };
  if (order.status === 'paid' && env.META_PURCHASE_SOURCE === 'utmify') {
    meta = { success: true, retry: false, skipped: 'utmify_managed' };
  } else if (order.status === 'paid' && !options.skipMeta) {
    const event = await buildMetaEvent({ eventName: 'Purchase', eventId: purchaseEventId(order.id), tracking: order.tracking, items: order.items, valueCents: order.totalCents }, { customer: order.customer, clientIp: order.clientIp, userAgent: order.userAgent, now: new Date(order.paidAt).getTime() });
    meta = await sendMetaEvent(event, env, options);
  }
  return { meta, utmify };
}
export async function handleTrackingRequest(request, env, options = {}) {
  const reply = (value, status) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  const origin = storefrontOrigin(request);
  if (!origin) return reply({ error: 'invalid_origin' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'invalid_content_type' }, 415);
  if (Number(request.headers.get('content-length')) > 12000) return reply({ error: 'too_large' }, 413);
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: 'invalid_event' }, 400);
    let size = 0; const chunks = [];
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 12000) { await reader.cancel(); return reply({ error: 'too_large' }, 413); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const input = JSON.parse(new TextDecoder().decode(bytes));
    if (!FUNNEL_EVENTS.has(input.eventName)) return reply({ error: 'invalid_event' }, 400);
    if (input.tracking?.consent !== true) return reply({ accepted: false }, 200);
    const source = new URL(input.tracking.eventSourceUrl);
    if (source.origin !== origin) return reply({ error: 'invalid_source' }, 400);
    const event = await buildMetaEvent(input, { clientIp: storefrontClientIp(request), userAgent: request.headers.get('user-agent') });
    const result = await sendMetaEvent(event, env, options);
    return reply({ accepted: result.success }, result.success ? 202 : result.retry ? 503 : 202);
  } catch { return reply({ error: 'invalid_event' }, 400); }
}
