import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHeadMeasurement, renderSizeGuide, mountSizeGuide } from '../public/size-guide.mjs';

test('measurement accepts decimal comma/dot without accepting units, malformed values or negatives', () => {
  assert.equal(parseHeadMeasurement(' 58,5 '), 58.5);
  assert.equal(parseHeadMeasurement('58.5'), 58.5);
  assert.equal(parseHeadMeasurement('58'), 58);
  for (const value of ['', '-58', '58cm', '58,5.2', 'Infinity', '0', '1000']) assert.equal(parseHeadMeasurement(value), null);
});

test('guide preserves actual model sizes and escapes product content without inventing a conversion', () => {
  const html = renderSizeGuide({ product: { name: '<script>unsafe</script>', variants: [{size:'56/S'}, {size:'58/M'}, {size:'58/M'}] } });
  assert.ok(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
  assert.ok(html.includes('<li>56/S</li><li>58/M</li>'));
  assert.ok(!html.includes('<li>60/L</li>'));
  assert.ok(html.includes('não uma tabela de conversão'));
  assert.ok(html.includes('loading="lazy"'));
});

test('mount is idempotent, announces invalid input and never selects a larger size', () => {
  let handler, listeners = 0;
  const input = { value: '57,5', attrs: {}, setAttribute(k,v){this.attrs[k]=v;}, removeAttribute(k){delete this.attrs[k];}, focus(){} };
  const feedback = { dataset: {}, textContent: '' };
  const form = { querySelector(){return input;}, addEventListener(name,fn){assert.equal(name,'submit');listeners++;handler=fn;} };
  const guide = { dataset: {sizeLabels:'["56/S","58/M"]'}, querySelector(selector){return selector==='.size-guide-form'?form:feedback;} };
  const root = {querySelectorAll(){return [guide];}};
  mountSizeGuide(root);mountSizeGuide(root);
  assert.equal(listeners,1);
  handler({preventDefault(){}});
  assert.match(feedback.textContent,/57,5 cm/);
  assert.match(feedback.textContent,/Não arredonde/);
  input.value='abc';handler({preventDefault(){}});
  assert.equal(input.attrs['aria-invalid'],'true');
  assert.equal(feedback.dataset.state,'error');
});
