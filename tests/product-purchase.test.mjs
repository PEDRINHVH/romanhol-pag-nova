import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { priceOf } from '../public/catalog-utils.js';

// Execute the production purchase branch without bootstrapping catalog/network/UI.
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = source.indexOf("if(target.matches('[data-add-cart]'))");
const end = source.indexOf("if(target.matches('[data-qty]'))", start);
assert.ok(start >= 0 && end > start, 'Production purchase handler must remain discoverable');
const purchase = new Function('target', 'currentProduct', 'selectedSize', 'cart', 'priceOf', 'toast', 'document', 'save', 'tracker', 'location', 'link', source.slice(start, end));
const product = { id: 'helmet', price: 200, variants: [{ size: '56' }, { size: '58', price: 220 }] };

function run({ selectedSize = '58', cart = [], item = product } = {}) {
  const saved = [], tracking = [], messages = [];
  const location = { hash: '#/produto/helmet' };
  let focused = 0;
  purchase(
    { matches(selector) { return selector === '[data-add-cart]'; } },
    () => item, selectedSize, cart, priceOf, message => messages.push(message),
    { querySelector() { return { focus() { focused++; } }; } },
    () => saved.push(structuredClone(cart)),
    { track(...args) { tracking.push(args); } }, location, path => `#${path}`,
  );
  return { cart, saved, tracking, messages, location, focused };
}

test('primary purchase without a size cannot save, track or navigate', () => {
  const result = run({ selectedSize: '' });
  assert.deepEqual(result.cart, []);
  assert.deepEqual(result.saved, []);
  assert.deepEqual(result.tracking, []);
  assert.equal(result.location.hash, '#/produto/helmet');
  assert.equal(result.focused, 1);
  assert.match(result.messages[0], /tamanho/i);
});

test('valid purchase saves one selected line, tracks its variant price and opens the bag', () => {
  const result = run();
  const expected = [{ id: 'helmet', size: '58', qty: 1 }];
  assert.deepEqual(result.cart, expected);
  assert.deepEqual(result.saved, [expected]);
  assert.deepEqual(result.tracking, [['AddToCart', {
    items: [{ id: 'helmet', quantity: 1, unitPriceCents: 22000 }], valueCents: 22000,
  }]]);
  assert.equal(result.location.hash, '#/sacola');
});

test('buying an existing size increments that line without duplicating it', () => {
  const result = run({ cart: [{ id: 'helmet', size: '56', qty: 1 }, { id: 'helmet', size: '58', qty: 2 }] });
  assert.deepEqual(result.cart, [{ id: 'helmet', size: '56', qty: 1 }, { id: 'helmet', size: '58', qty: 3 }]);
  assert.equal(result.saved.length, 1);
  assert.equal(result.tracking.length, 1);
  assert.equal(result.tracking[0][1].items[0].quantity, 1);
  assert.equal(result.location.hash, '#/sacola');
});

test('unavailable product price blocks all purchase side effects', () => {
  const result = run({ item: { ...product, price: null, variants: [{ size: '58' }] } });
  assert.deepEqual(result.cart, []);
  assert.deepEqual(result.saved, []);
  assert.deepEqual(result.tracking, []);
  assert.equal(result.location.hash, '#/produto/helmet');
  assert.match(result.messages[0], /preço/i);
});
