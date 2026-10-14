import test from 'node:test';
import assert from 'node:assert/strict';
import { mountProductSticky } from '../public/product-sticky.js';

function fixture({ bottom = 400, disabled = false, observer = true } = {}) {
  const events = new Map();
  let clicked = 0, disconnected = 0, sizeFocused = 0, primaryFocused = 0, removed = false;
  const primary = { disabled, click() { clicked++; }, focus() { primaryFocused++; }, getBoundingClientRect() { return { bottom }; } };
  const buy = { addEventListener(_, fn) { this.activate = fn; }, removeEventListener() { this.activate = null; } };
  const bar = { setAttribute() {}, querySelector() { return buy; }, contains(el) { return el === buy; }, remove() { removed = true; } };
  const classes = new Set();
  const root = {
    body: { append() {}, classList: { add(v) { classes.add(v); }, remove(v) { classes.delete(v); } } },
    createElement() { return bar; },
    querySelector(selector) { return selector === '[data-add-cart]' ? primary : selector.startsWith('.size-button') ? { focus() { sizeFocused++; } } : null; },
  };
  const view = {
    addEventListener(name, fn) { events.set(name, fn); },
    removeEventListener(name) { events.delete(name); },
    IntersectionObserver: observer ? class { observe() {} disconnect() { disconnected++; } } : undefined,
  };
  return { root, view, bar, buy, classes, events, scroll(value) { bottom = value; events.get('scroll')(); }, state() { return { clicked, disconnected, sizeFocused, primaryFocused, removed }; } };
}
const product = { name: 'Capacete <Norisk>', price: 200, variants: [{ size: '58', price: 220 }, { size: '60', available: false }] };

test('only appears after passing primary CTA; restores focus and disposes all hooks', () => {
  const f = fixture();
  const cleanup = mountProductSticky({ product, selectedSize: '58', ...f });
  assert.equal(f.bar.hidden, true);
  f.scroll(900); // Button below the viewport is not considered passed.
  assert.equal(f.bar.hidden, true);
  f.scroll(-1);
  assert.equal(f.bar.hidden, false);
  f.root.activeElement = f.buy;
  f.scroll(1);
  assert.equal(f.bar.hidden, true);
  assert.equal(f.state().primaryFocused, 1);
  cleanup();
  assert.equal(f.events.size, 0);
  assert.equal(f.classes.size, 0);
  assert.equal(f.state().disconnected, 1);
  assert.equal(f.state().removed, true);
  assert.equal(f.buy.activate, null);
});

test('escapes product and forwards exactly one click using selected variant price', () => {
  const f = fixture({ bottom: -50, observer: false });
  mountProductSticky({ product, selectedSize: '58', ...f });
  assert.equal(f.bar.hidden, false);
  assert.match(f.bar.innerHTML, /Capacete &lt;Norisk&gt;/);
  assert.match(f.bar.innerHTML, /220,00/);
  assert.match(f.bar.innerHTML, /Tamanho 58/);
  f.buy.activate();
  assert.equal(f.state().clicked, 1);
});

test('missing size delegates to primary validation without selecting a size', () => {
  const f = fixture();
  mountProductSticky({ product, ...f });
  assert.match(f.bar.innerHTML, /Escolher tamanho/);
  f.buy.activate();
  assert.equal(f.state().clicked, 1);
  assert.equal(f.state().sizeFocused, 0);
});

test('unavailable or unknown selection focuses sizes without buying', () => {
  for (const selectedSize of ['60', 'invalid']) {
    const f = fixture();
    mountProductSticky({ product, selectedSize, ...f });
    f.buy.activate();
    assert.equal(f.state().clicked, 0);
    assert.equal(f.state().sizeFocused, 1);
  }
});

test('unavailable prices and disabled primary prevent a purchase', () => {
  for (const price of [null, NaN, Infinity, 0, -1]) {
    const f = fixture();
    mountProductSticky({ product, price, ...f });
    assert.equal(f.buy.disabled, true);
    f.buy.activate();
    assert.equal(f.state().clicked, 0);
  }
  const f = fixture({ disabled: true });
  mountProductSticky({ product, ...f });
  assert.equal(f.buy.disabled, true);
  f.buy.activate();
  assert.equal(f.state().clicked, 0);
});
