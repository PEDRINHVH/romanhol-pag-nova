import test from 'node:test';
import assert from 'node:assert/strict';
import {changeCheckoutCart, renderCheckoutItems, renderCheckoutGift} from '../public/checkout-cart.js';

const products = [{id:'helmet', name:'Capacete Norisk Razor Preto Fosco', color:'Preto', finish:'Fosco', price:200, variants:[{size:'56'},{size:'58', price:220},{size:'60', available:false},{size:'62',price:0}]}];
const line = (size = '56', qty = 1) => ({id:'helmet',size,qty});
const change = (cart, type, value) => changeCheckoutCart(cart, products, {type,id:'helmet',size:'56',value});

test('quantity bounds preserve cart and never delete at minimum', () => {
  for (const [cart, action] of [[[line()], 'decrease'], [[line('56',10)], 'increase']]) {
    const result = change(cart, action);
    assert.equal(result.cart, cart);
    assert.equal(result.changed, false);
    assert.ok(result.message);
  }
  assert.equal(change([line('56', 2)], 'decrease').cart[0].qty, 1);
  assert.equal(change([line('56', 9)], 'increase').cart[0].qty, 10);
});

test('size changes use an available priced variant without mutating input', () => {
  const cart = [line()];
  const result = change(cart, 'size', '58');
  assert.deepEqual(result.cart, [line('58')]);
  assert.equal(cart[0].size, '56');
  for (const invalid of ['60','62','64','56']) assert.equal(change(cart, 'size', invalid).cart, cart);
});

test('size merges conserve quantity and reject totals above ten', () => {
  const cart = [line('56',4), line('58',6)];
  assert.deepEqual(change(cart,'size','58').cart, [line('58',10)]);
  const overflow = [line('56',5), line('58',6)];
  assert.equal(change(overflow,'size','58').cart, overflow);
  assert.deepEqual(cart, [line('56',4),line('58',6)]);
  assert.deepEqual(change([line('58',6),line('56',4)],'size','58').cart, [line('58',10)]);
});

test('remove can empty the cart and missing items preserve it', () => {
  assert.deepEqual(change([line()], 'remove').cart, []);
  const empty = [];
  assert.equal(change(empty,'remove').cart, empty);
});

test('unavailable products cannot be increased', () => {
  const cart = [line('60')];
  assert.equal(changeCheckoutCart(cart, products, {type:'increase',id:'helmet',size:'60'}).cart,cart);
});

test('locked rendering disables every control and offers only available sizes', () => {
  const markup = renderCheckoutItems([{...line(),product:products[0]}], {locked:true,media:() => '<img alt="Capacete">'});
  const controls = markup.match(/<(?:button|select)\b[^>]*>/g);
  assert.equal(controls.length, 4);
  assert.ok(controls.every(control => / disabled/.test(control)));
  assert.match(markup,/value="58"/);
  assert.doesNotMatch(markup,/value="(?:60|62)"/);
  assert.match(markup,/Preto · Fosco/);
  assert.match(markup,/tamanho 56/);
  assert.doesNotMatch(markup,/<details/);
});

test('dynamic text and action attributes are escaped', () => {
  const product = {...products[0],name:'<script>"&',color:'<img onerror="bad">',variants:[{size:'56" onclick="bad'}]};
  const markup = renderCheckoutItems([{id:'" onfocus="bad',size:'56" onclick="bad',qty:1,product}]);
  assert.doesNotMatch(markup,/<script>|<img onerror|data-product-id=""/);
  assert.match(markup,/data-product-id="&quot; onfocus=&quot;bad"/);
  assert.match(markup,/value="56&quot; onclick=&quot;bad" selected/);
});

test('gift wrapping is free, optional and locked along with the cart', () => {
  const markup = renderCheckoutGift({giftWrap:true,locked:true});
  assert.match(markup,/data-checkout-gift checked disabled/);
  assert.match(markup,/Embalar para presente/);
  assert.match(markup,/Grátis/);
  assert.doesNotMatch(renderCheckoutGift(),/ checked| disabled/);
});
