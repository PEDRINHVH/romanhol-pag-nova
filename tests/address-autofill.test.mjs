import test from 'node:test';
import assert from 'node:assert/strict';
import { formatZipCode, lookupAddress, mountAddressAutofill } from '../public/address-autofill.js';

const address = { street: 'Praça da Sé', neighborhood: 'Sé', city: 'São Paulo', state: 'SP' };
const response = data => ({ ok: true, json: async () => data });
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
function fixture(options = {}, initialValues = {}) {
  class Element extends EventTarget {
    value = ''; dataset = {}; hidden = false; textContent = ''; attrs = {};
    selectionStart = 0; selectionEnd = 0;
    setAttribute(name, value) { this.attrs[name] = value; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    enter(value, type = 'input') {
      this.value = value; this.selectionStart = this.selectionEnd = value.length;
      this.dispatchEvent(new Event(type));
    }
  }
  const fields = Object.fromEntries(['zipCode', ...Object.keys(address)].map(name => [name, new Element()]));
  for (const [name, value] of Object.entries(initialValues)) fields[name].value = value;
  const status = new Element(), retry = new Element(), updates = [];
  const form = { querySelector(selector) {
    if (selector === '[data-cep-status]') return status;
    if (selector === '[data-cep-retry]') return retry;
    return fields[selector.match(/name="(.*?)"/)[1]];
  } };
  const cleanup = mountAddressAutofill(form, { debounceMs: 0, onUpdate: update => updates.push(update), ...options });
  return { fields, status, retry, updates, cleanup };
}

test('formats CEP and validates before accessing the documented ViaCEP HTTPS endpoint', async () => {
  assert.equal(formatZipCode('01001000'), '01001-000');
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    assert.equal(url, 'https://viacep.com.br/ws/01001000/json/');
    assert.ok(options.signal instanceof AbortSignal);
    return response({ logradouro: address.street, bairro: address.neighborhood, localidade: address.city, uf: 'SP' });
  };
  assert.deepEqual(await lookupAddress('01001000', { fetchImpl }), { status: 'success', address });
  for (const value of ['123', '123456789', '01001A00']) assert.equal((await lookupAddress(value, { fetchImpl })).status, 'invalid');
  assert.equal(calls, 1);
});

test('inexistent CEP is distinguished from network/malformed/timeout errors', async () => {
  assert.deepEqual(await lookupAddress('99999999', { fetchImpl: async () => response({ erro: true }) }), { status: 'not-found' });
  await assert.rejects(lookupAddress('01001000', { fetchImpl: async () => { throw new Error('offline'); } }), /offline/);
  await assert.rejects(lookupAddress('01001000', { fetchImpl: async () => response({}) }), /Invalid/);
  await assert.rejects(lookupAddress('01001000', { fetchImpl: () => new Promise(() => {}), timeoutMs: 5 }), { name: 'AbortError' });
});

test('pasted CEP fills address, reports draft values and keeps mask caret at the end', async () => {
  const f = fixture({ lookup: async () => ({ status: 'success', address }) });
  f.fields.zipCode.enter('01001000');
  assert.equal(f.fields.zipCode.value, '01001-000');
  assert.equal(f.fields.zipCode.selectionStart, 9);
  await tick();
  assert.equal(f.status.dataset.state, 'success');
  assert.equal(f.status.attrs['aria-live'], 'polite');
  for (const [name, value] of Object.entries(address)) {
    assert.equal(f.fields[name].value, value);
    assert.ok(f.updates.some(update => update.name === name && update.value === value));
  }
  f.fields.street.enter('Minha rua');
  f.fields.zipCode.enter('123');
  assert.equal(f.fields.street.value, 'Minha rua');
  assert.equal(f.fields.city.value, '');
  f.cleanup();
});

test('old requests cannot overwrite latest CEP or manual edits made during a request', async () => {
  const requests = [];
  const f = fixture({ lookup: (cep, { signal }) => new Promise(resolve => requests.push({ cep, signal, resolve })) });
  f.fields.zipCode.enter('01001000', 'change');
  assert.equal(f.status.dataset.state, 'loading');
  f.fields.zipCode.enter('20040002', 'blur');
  assert.equal(requests[0].signal.aborted, true);
  f.fields.street.enter('Rua manual');
  requests[1].resolve({ status: 'success', address: { ...address, city: 'Rio de Janeiro', state: 'RJ' } });
  await tick();
  requests[0].resolve({ status: 'success', address });
  await tick();
  assert.equal(f.fields.city.value, 'Rio de Janeiro');
  assert.equal(f.fields.street.value, 'Rua manual');
  f.cleanup();
});

test('not found and failed requests allow manual entry; explicit retry succeeds', async () => {
  let calls = 0;
  const f = fixture({ lookup: async () => {
    calls++;
    if (calls === 1) return { status: 'not-found' };
    if (calls === 2) throw new Error('offline');
    return { status: 'success', address };
  } });
  f.fields.zipCode.enter('99999999', 'blur');
  await tick();
  assert.equal(f.status.dataset.state, 'not-found');
  f.fields.zipCode.enter('01001000', 'change');
  await tick();
  assert.equal(f.status.dataset.state, 'error');
  assert.equal(f.retry.hidden, false);
  f.fields.city.enter('Cidade manual');
  f.retry.dispatchEvent(new Event('click'));
  await tick();
  assert.equal(f.status.dataset.state, 'success');
  assert.equal(f.fields.city.value, 'Cidade manual');
  f.cleanup();
});

test('cleanup cancels listeners and pending requests even when transport ignores abort', async () => {
  let resolve, signal;
  const f = fixture({ lookup: (_cep, options) => {
    signal = options.signal;
    return new Promise(done => { resolve = done; });
  } });
  f.fields.zipCode.enter('01001000', 'change');
  f.cleanup();
  assert.equal(signal.aborted, true);
  resolve({ status: 'success', address });
  await tick();
  assert.equal(f.fields.city.value, '');
  f.fields.zipCode.enter('20040002');
  assert.equal(f.fields.zipCode.value, '20040002');
});

test('session ownership survives remount and only automatic fields follow the next CEP', async () => {
  const state = {};
  const nextAddress = { street: 'Rua nova', neighborhood: 'Bairro novo', city: 'Rio de Janeiro', state: 'RJ' };
  const options = { state, lookup: async cep => ({ status: 'success', address: cep === '01001000' ? address : nextAddress }) };
  const first = fixture(options);
  first.fields.zipCode.enter('01001000', 'change');
  await tick();
  first.fields.street.enter('Rua editada');
  const draft = Object.fromEntries(Object.entries(first.fields).map(([name, field]) => [name, field.value]));
  first.cleanup();
  // A draft edit made outside the old form must also revoke automatic ownership.
  draft.neighborhood = 'Bairro editado no draft';
  const second = fixture(options, draft);
  assert.equal(second.fields.city.value, 'São Paulo');
  second.fields.zipCode.enter('20040002', 'change');
  assert.equal(second.fields.city.value, '');
  assert.equal(second.fields.state.value, '');
  assert.equal(second.fields.street.value, 'Rua editada');
  assert.equal(second.fields.neighborhood.value, 'Bairro editado no draft');
  await tick();
  assert.equal(second.fields.city.value, 'Rio de Janeiro');
  assert.equal(second.fields.state.value, 'RJ');
  assert.equal(second.fields.street.value, 'Rua editada');
  assert.equal(second.fields.neighborhood.value, 'Bairro editado no draft');
  second.cleanup();
});
