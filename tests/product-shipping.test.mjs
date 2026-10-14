import test from 'node:test';
import assert from 'node:assert/strict';
import { SHIPPING_OPTIONS, formatShippingZip, isValidShippingZip, normalizeShippingAddress,
  lookupShippingAddress, mountProductShipping, renderProductShipping, getShippingQuote,
  getShippingMethod, updateShippingMethod } from '../public/product-shipping.js';

const address = { zipCode: '01001000', street: 'Praça da Sé', neighborhood: 'Sé', city: 'São Paulo', state: 'SP' };
const response = data => ({ ok: true, json: async () => data });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(lookup) {
  class Element extends EventTarget {
    value = ''; textContent = ''; innerHTML = ''; attrs = {}; disabled = false;
    setAttribute(name, value) { this.attrs[name] = value; }
    removeAttribute(name) { delete this.attrs[name]; }
    focus() { this.focused = true; }
  }
  const fields = Object.fromEntries(['zip', 'submit', 'status', 'result'].map(name => [name, new Element()]));
  const card = new Element();
  card.matches = () => true;
  card.querySelector = selector => fields[selector.match(/data-shipping-(\w+)/)[1]];
  const cleanup = mountProductShipping(card, { lookup });
  return { ...fields, button: fields.submit, card, cleanup,
    enter(value) { fields.zip.value = value; fields.zip.dispatchEvent(new Event('input')); },
    submit() { fields.submit.dispatchEvent(new Event('click')); } };
}

test('CEP normalization rejects incomplete or injected input and retains public address only', () => {
  assert.equal(formatShippingZip('01001000'), '01001-000');
  for (const value of ['', '123', '010010000', 'A01001000']) assert.equal(isValidShippingZip(value), false);
  assert.equal(isValidShippingZip('01001-000'), true);
  assert.deepEqual(normalizeShippingAddress({ logradouro: address.street, bairro: address.neighborhood, localidade: address.city, uf: 'SP', numero: '42' }, address.zipCode), address);
  assert.equal(normalizeShippingAddress({ localidade: 'X', uf: 'invalid' }, address.zipCode), null);
});

test('delivery method exists for direct checkout and rejects arbitrary methods', () => {
  assert.deepEqual(SHIPPING_OPTIONS.map(({ id, cents }) => ({ id, cents })), [{ id: 'standard', cents: 0 }, { id: 'sedex', cents: 5781 }]);
  assert.equal(updateShippingMethod('sedex'), true);
  assert.equal(getShippingMethod(), 'sedex');
  assert.equal(updateShippingMethod('express'), false);
  updateShippingMethod('standard');
});

test('ViaCEP lookup separates unknown CEP from service failures and enforces timeout', async () => {
  let calls = 0;
  assert.equal((await lookupShippingAddress('123', { fetchImpl: () => { calls++; } })).status, 'invalid');
  assert.equal(calls, 0);
  const value = await lookupShippingAddress('01001-000', { fetchImpl: async url => {
    assert.equal(url, 'https://viacep.com.br/ws/01001000/json/');
    return response({ localidade: 'São Paulo', uf: 'SP' });
  } });
  assert.equal(value.address.zipCode, '01001000');
  assert.equal((await lookupShippingAddress(address.zipCode, { fetchImpl: async () => response({ erro: true }) })).status, 'not-found');
  await assert.rejects(lookupShippingAddress(address.zipCode, { fetchImpl: async () => response({}) }), /Invalid/);
  await assert.rejects(lookupShippingAddress(address.zipCode, { fetchImpl: () => new Promise(() => {}), timeoutMs: 5 }), { name: 'AbortError' });
});

test('explicit calculation ignores stale requests after CEP changes and cleanup', async () => {
  const requests = [];
  const f = fixture((zip, { signal }) => new Promise(resolve => requests.push({ zip, signal, resolve })));
  f.enter('01001000');
  assert.equal(requests.length, 0);
  assert.equal(f.zip.value, '01001-000');
  f.submit();
  f.enter('20040002');
  assert.equal(requests[0].signal.aborted, true);
  f.submit();
  requests[1].resolve({ status: 'success', address: { ...address, zipCode: '20040002', city: 'Rio de Janeiro', state: 'RJ' } });
  await tick();
  requests[0].resolve({ status: 'success', address });
  await tick();
  assert.equal(getShippingQuote().city, 'Rio de Janeiro');
  assert.match(f.result.innerHTML, /Você ganhou frete grátis/);
  assert.match(f.result.innerHTML, /57,81/);
  assert.match(f.result.innerHTML, /4–8 dias úteis/);
  f.enter('01001000'); f.submit(); f.cleanup();
  requests[2].resolve({ status: 'success', address });
  await tick();
  assert.equal(getShippingQuote(), null);
});

test('errors permit retry, invalid input focuses field, and returned markup escapes addresses', async () => {
  let count = 0;
  const f = fixture(async () => { if (++count === 1) throw new Error('offline'); return { status: 'success', address: { ...address, street: '<img src=x onerror=alert(1)>' } }; });
  f.enter('123'); f.submit();
  assert.equal(f.zip.focused, true);
  assert.equal(count, 0);
  f.enter('01001000'); f.submit(); await tick();
  assert.match(f.status.textContent, /Tente calcular novamente/);
  assert.equal(f.button.disabled, false);
  f.submit(); await tick();
  assert.match(renderProductShipping(), /&lt;img/);
  assert.doesNotMatch(renderProductShipping(), /<img/);
  f.cleanup();
});
