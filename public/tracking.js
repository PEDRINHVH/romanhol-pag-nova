const KEY = 'nolimit:attribution:v1';
const CONSENT_KEY = 'nolimit:marketing-consent:v1';
const PARAMS = ['src', 'sck', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];
const EVENTS = new Set(['PageView', 'ViewContent', 'Search', 'AddToWishlist', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo']);
export function captureAttribution(url, previous = null) {
  if (PARAMS.some(key => typeof previous?.[key] === 'string' && previous[key].trim())) return previous;
  const parsed = new URL(url);
  const hashQuery = parsed.hash.indexOf('?');
  const hashParams = new URLSearchParams(hashQuery < 0 ? '' : parsed.hash.slice(hashQuery + 1));
  const params = Object.fromEntries(PARAMS.map(key => [key, (parsed.searchParams.get(key) ?? hashParams.get(key))?.trim().slice(0, 256) || null]));
  if (previous && !PARAMS.some(key => params[key])) return previous;
  return { ...params, landedAt: Date.now(), landingPage: parsed.origin + parsed.pathname };
}
export function createTracker({ pixelId = '1146535704713953', endpoint = '/api/events', window: win = globalThis.window } = {}) {
  const read = (store, key) => { try { return JSON.parse(store.getItem(key)); } catch { return null; } };
  const write = (store, key, value) => { try { store.setItem(key, JSON.stringify(value)); } catch {} };
  let consent = read(win.localStorage, CONSENT_KEY) === true;
  let attribution = captureAttribution(win.location.href, read(win.sessionStorage, KEY));
  write(win.sessionStorage, KEY, attribution);
  const refreshAttribution = () => {
    const next = captureAttribution(win.location.href, attribution);
    if (next !== attribution) { attribution = next; write(win.sessionStorage, KEY, attribution); }
  };
  win.addEventListener?.('hashchange', refreshAttribution);
  win.addEventListener?.('popstate', refreshAttribution);
  let loaded = false;
  let lastPage = '';
  const cookie = key => win.document.cookie.split('; ').find(part => part.startsWith(`${key}=`))?.slice(key.length + 1) || '';
  const load = () => {
    if (loaded || !consent) return;
    loaded = true;
    if (!win.fbq) {
      const queue = function (...args) { queue.callMethod ? queue.callMethod(...args) : queue.queue.push(args); };
      queue.queue = []; queue.loaded = true; queue.version = '2.0'; queue.push = queue; win.fbq = queue; win._fbq = queue;
      const script = win.document.createElement('script'); script.async = true; script.src = 'https://connect.facebook.net/en_US/fbevents.js'; win.document.head.appendChild(script);
    }
    win.fbq('consent', 'grant');
    win.fbq('set', 'autoConfig', false, pixelId);
    win.fbq('init', pixelId); // No browser-side advanced matching / personal data.
  };
  const getContext = () => {
    refreshAttribution();
    return { consent, attribution: { ...attribution }, eventSourceUrl: win.location.origin + win.location.pathname + (win.location.hash || '').split('?')[0], ...(consent ? { fbp: cookie('_fbp'), fbc: cookie('_fbc') || (attribution.fbclid ? `fb.1.${attribution.landedAt}.${attribution.fbclid}` : '') } : {}) };
  };
  const emit = (eventName, data = {}, purchase = false) => {
    if (!consent || (!EVENTS.has(eventName) && !(purchase && eventName === 'Purchase'))) return null;
    load();
    const eventId = data.eventId || win.crypto.randomUUID();
    const items = (data.items || []).map(item => ({ id: String(item.id), quantity: item.quantity, unitPriceCents: item.unitPriceCents }));
    const custom = { currency: 'BRL', content_type: 'product', content_ids: items.map(i => i.id), contents: items.map(i => ({ id: i.id, quantity: i.quantity, item_price: i.unitPriceCents / 100 })), num_items: items.reduce((sum, i) => sum + i.quantity, 0) };
    if (Number.isSafeInteger(data.valueCents)) custom.value = data.valueCents / 100;
    if (eventName === 'AddPaymentInfo') custom.payment_method = 'pix';
    win.fbq('track', eventName, custom, { eventID: eventId });
    if (!purchase) win.fetch(endpoint, { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventName, eventId, items, valueCents: data.valueCents, paymentMethod: eventName === 'AddPaymentInfo' ? 'pix' : undefined, tracking: getContext() }) }).catch(() => {});
    return eventId;
  };
  const pageView = () => { const path = win.location.pathname + win.location.hash; if (consent && path !== lastPage) { lastPage = path; return emit('PageView'); } return null; };
  return {
    getContext, pageView, track: (name, data) => emit(name, data),
    setConsent(value) { consent = value === true; write(win.localStorage, CONSENT_KEY, consent); if (!consent) { win.fbq?.('consent', 'revoke'); lastPage = ''; } else { load(); win.fbq?.('consent', 'grant'); pageView(); } },
    purchase(order) {
      // The caller supplies the authenticated server status response, never local PIX generation.
      if (order.status !== 'paid' || !order.paidAt || !order.purchaseEventId) return null;
      const key = `nolimit:purchase:${order.id}`;
      if (read(win.localStorage, key)) return null;
      const id = emit('Purchase', { items: order.items, valueCents: order.totalCents, eventId: order.purchaseEventId }, true);
      if (id) write(win.localStorage, key, true);
      return id;
    },
  };
}
