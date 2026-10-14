import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPhone, mountCheckoutValidation } from '../public/checkout-validation.js';

function fixture(value = '') {
  class Phone extends EventTarget {
    name = 'phone';
    value = value;
    selectionStart = value.length;
    removeAttribute() {}
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  }
  const phone = new Phone();
  const cleanup = mountCheckoutValidation({ querySelector: selector => selector === '[name="phone"]' ? phone : null });
  const input = (value, cursor = value.length, inputType = 'insertText') => {
    phone.value = value; phone.setSelectionRange(cursor, cursor);
    const event = new Event('input');
    Object.defineProperty(event, 'inputType', { value: inputType });
    phone.dispatchEvent(event);
  };
  return { phone, input, cleanup };
}

test('phone formats while typing, limits to 11 digits and sanitizes paste', () => {
  const f = fixture();
  for (const digit of '11987654321') f.input(f.phone.value + digit);
  assert.equal(f.phone.value, '(11) 98765-4321');
  assert.equal(f.phone.selectionStart, 15);
  f.input(f.phone.value + '9');
  assert.equal(f.phone.value, '(11) 98765-4321');
  f.input('abc (21) 99876-5432 987');
  assert.equal(f.phone.value, '(21) 99876-5432');
  assert.equal(formatPhone('1133334444'), '(11) 3333-4444');
  assert.equal(formatPhone('11'), '(11)');
  assert.equal(formatPhone(''), '');
});

test('phone can be edited in the middle and erased through mask separators', () => {
  const f = fixture('11987654321');
  assert.equal(f.phone.value, '(11) 98765-4321');
  f.input('(21) 98765-4321', 2);
  assert.equal(f.phone.selectionStart, 2);
  f.phone.setSelectionRange(f.phone.value.length, f.phone.value.length);
  for (let i = 0; f.phone.value && i < 20; i++) {
    const cursor = f.phone.selectionStart;
    assert.ok(cursor > 0, 'Backspace must continue through the mask');
    f.input(f.phone.value.slice(0, cursor - 1) + f.phone.value.slice(cursor), cursor - 1, 'deleteContentBackward');
  }
  assert.equal(f.phone.value, '');
  f.input('21987654321', 2);
  assert.equal(f.phone.value, '(21) 98765-4321');
  assert.equal(f.phone.selectionStart, 5, 'cursor remains after the DDD, not at the end');
  f.cleanup();
  f.input('123');
  assert.equal(f.phone.value, '123', 'cleanup detaches the mask');
});
