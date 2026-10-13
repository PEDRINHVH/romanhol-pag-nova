import test from 'node:test';
import assert from 'node:assert/strict';
import { validationError, validateCheckoutForm, mountCheckoutValidation } from '../public/checkout-validation.js';
import { validCPF } from '../worker/payments.mjs';

const valid = { name: 'Maria Silva', email: 'maria@example.com', document: '529.982.247-25', phone: '(11) 99999-9999', zipCode: '01001-000', street: 'Praça da Sé', number: 'S/N', complement: '', neighborhood: 'Sé', city: 'São Paulo', state: 'sp' };

test('field rules accept the same basic customer/address formats as the payment backend', () => {
  for (const [name, value] of Object.entries(valid)) assert.equal(validationError(name, value), '', name);
  assert.equal(validationError('phone', '(11) 3333-4444'), '');
  assert.equal(validationError('name', '  Maria   Silva  '), '');
  for (const name of Object.keys(valid).filter(name => name !== 'complement')) {
    assert.ok(validationError(name, ''), name);
  }
  for (const [name, value] of [['name', 'Maria'], ['email', 'a@b'], ['email', 'a b@c.com'], ['phone', '119999999'], ['phone', '5511999999999'], ['zipCode', '1234567'], ['zipCode', '123456789'], ['street', 'A'], ['city', 'X'], ['state', 'XX'], ['state', 'SPA']]) {
    assert.ok(validationError(name, value), `${name}: ${value}`);
  }
});

test('CPF uses both check digits and rejects repeated sequences, matching server checksum', () => {
  for (const cpf of ['529.982.247-25', '52998224725', '11144477735', '52998224724', '52998224715', '00000000000', '11111111111', '1234', '']) {
    assert.equal(validationError('document', cpf) === '', validCPF(cpf), cpf);
  }
});

function fixture(values = {}) {
  const focused = [];
  class Field extends EventTarget {
    attrs = {};
    constructor(name, value) { super(); this.name = name; this.value = value; }
    setAttribute(name, value) { this.attrs[name] = value; }
    removeAttribute(name) { delete this.attrs[name]; }
    focus() { focused.push(this.name); }
  }
  const fields = Object.fromEntries(Object.keys(valid).map(name => [name, new Field(name, values[name] ?? '')]));
  const errors = Object.fromEntries(Object.keys(valid).map(name => [name, { textContent: '' }]));
  const form = { querySelector(selector) {
    const name = selector.match(/="([^"]+)"/)[1];
    return selector.startsWith('[data-field-error') ? errors[name] : fields[name];
  } };
  return { form, fields, errors, focused };
}

test('submit reports every field, marks aria-invalid and focuses only the first invalid input', () => {
  const f = fixture();
  assert.equal(validateCheckoutForm(f.form), false);
  assert.deepEqual(f.focused, ['name']);
  for (const name of Object.keys(valid).filter(name => name !== 'complement')) {
    assert.equal(f.fields[name].attrs['aria-invalid'], 'true');
    assert.ok(f.errors[name].textContent);
  }
  for (const [name, value] of Object.entries(valid)) f.fields[name].value = value;
  assert.equal(validateCheckoutForm(f.form), true);
  assert.deepEqual(f.focused, ['name']);
  assert.equal(f.fields.name.attrs['aria-invalid'], undefined);
  assert.equal(f.errors.name.textContent, '');
});

test('blur validates without stealing focus, input clears errors, UF normalizes and cleanup detaches', () => {
  const f = fixture(valid);
  const cleanup = mountCheckoutValidation(f.form);
  f.fields.email.value = 'invalid';
  f.fields.email.dispatchEvent(new Event('blur'));
  assert.ok(f.errors.email.textContent);
  assert.equal(f.fields.email.attrs['aria-invalid'], 'true');
  assert.deepEqual(f.focused, []);
  f.fields.email.dispatchEvent(new Event('input'));
  assert.equal(f.errors.email.textContent, '');
  let normalized;
  f.fields.state.addEventListener('input', () => { normalized = f.fields.state.value; });
  f.fields.state.dispatchEvent(new Event('blur'));
  assert.equal(f.fields.state.value, 'SP');
  assert.equal(normalized, 'SP');
  assert.deepEqual(f.focused, []);
  cleanup();
  f.fields.email.dispatchEvent(new Event('blur'));
  assert.equal(f.errors.email.textContent, '');
});
