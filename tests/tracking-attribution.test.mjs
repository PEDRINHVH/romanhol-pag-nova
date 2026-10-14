import test from 'node:test';
import assert from 'node:assert/strict';
import { captureAttribution, createTracker } from '../public/tracking.js';

test('captures hash campaign parameters, with query taking precedence per key', () => {
  const result = captureAttribution('https://shop.test/?utm_source=query&utm_term=#/product?utm_source=hash&utm_campaign=launch%20sale&fbclid=click&src=ad&sck=key&utm_medium=cpc&utm_content=creative&utm_term=hash');
  assert.equal(result.utm_source, 'query');
  assert.equal(result.utm_campaign, 'launch sale');
  assert.equal(result.utm_medium, 'cpc');
  assert.equal(result.utm_content, 'creative');
  assert.equal(result.utm_term, null);
  assert.equal(result.fbclid, 'click');
  assert.equal(result.src, 'ad');
  assert.equal(result.sck, 'key');
  assert.equal(result.landingPage, 'https://shop.test/');
});

test('direct visits can acquire a campaign, then preserve the first campaign', () => {
  const direct = captureAttribution('https://shop.test/');
  assert.equal(captureAttribution('https://shop.test/#/product', direct), direct);
  const campaign = captureAttribution('https://shop.test/#/product?utm_source=facebook', direct);
  assert.equal(campaign.utm_source, 'facebook');
  assert.equal(captureAttribution('https://shop.test/?utm_source=other&fbclid=other', campaign), campaign);
  assert.equal(captureAttribution('https://shop.test/?utm_source=new', {}).utm_source, 'new');
  assert.equal(captureAttribution('https://shop.test/?utm_source=new', { utm_source: '  ' }).utm_source, 'new');
});

test('limits attribution values and ignores unrelated hash route text', () => {
  assert.equal(captureAttribution('https://shop.test/#/utm_source=fake').utm_source, null);
  assert.equal(captureAttribution('https://shop.test/#/product?utm_content=' + 'a'.repeat(300)).utm_content.length, 256);
});

function fixture() {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  const listeners = {}, calls = [], fetches = [];
  const win = {
    location: new URL('https://shop.test/'), localStorage: storage, sessionStorage: storage,
    addEventListener: (name, handler) => { listeners[name] = handler; },
    document: { cookie: '' }, crypto: { randomUUID: () => 'event-id' },
    fbq: (...args) => calls.push(args),
    fetch: (url, init) => { fetches.push(JSON.parse(init.body)); return Promise.resolve({}); },
  };
  return { win, data, listeners, calls, fetches };
}

test('hash refresh persists campaign without emitting events or bypassing consent', () => {
  const { win, data, listeners, calls, fetches } = fixture();
  const tracker = createTracker({ window: win });
  win.location = new URL('https://shop.test/#/product?utm_source=facebook&fbclid=click');
  listeners.hashchange();
  assert.equal(JSON.parse(data.get('nolimit:attribution:v1')).utm_source, 'facebook');
  assert.equal(tracker.getContext().consent, false);
  assert.equal(tracker.getContext().fbc, undefined);
  assert.equal(calls.length, 0);
  assert.equal(fetches.length, 0);
  tracker.setConsent(true);
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].tracking.attribution.utm_source, 'facebook');
  tracker.pageView();
  assert.equal(fetches.length, 1);
  win.location = new URL('https://shop.test/#/cart?utm_source=other');
  listeners.hashchange();
  assert.equal(fetches.length, 1);
  assert.equal(tracker.getContext().attribution.utm_source, 'facebook');
});

test('context refresh catches navigation before hashchange and restores session first touch', () => {
  const { win, listeners } = fixture();
  const tracker = createTracker({ window: win });
  win.location = new URL('https://shop.test/#/product?utm_campaign=launch');
  assert.equal(tracker.getContext().attribution.utm_campaign, 'launch');
  win.location = new URL('https://shop.test/?utm_campaign=second');
  listeners.popstate();
  assert.equal(createTracker({ window: win }).getContext().attribution.utm_campaign, 'launch');
});

