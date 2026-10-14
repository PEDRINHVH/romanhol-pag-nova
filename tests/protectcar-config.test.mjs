import test from 'node:test';
import assert from 'node:assert/strict';
import {PROTECTCAR_PRODUCT, PROTECTCAR_KITS, PROTECTCAR_VEHICLES, PROTECTCAR_COLORS, PROTECTCAR_TEXTURES} from '../public/protectcar-data.js';
import {isProtectCar, normalizeConfiguration, configurationKey} from '../public/protectcar-config.js';
import {checkoutItems} from '../worker/catalog.mjs';
import {changeCheckoutCart, renderCheckoutItems} from '../public/checkout-cart.js';

const brand = Object.keys(PROTECTCAR_VEHICLES)[0];
const vehicle = PROTECTCAR_VEHICLES[brand][0];
const configuration = {vehicleType:'carro',brand,model:vehicle.model,year:String(vehicle.from),color:PROTECTCAR_COLORS[0],texture:PROTECTCAR_TEXTURES[0]};
const size = PROTECTCAR_KITS[0].size;
const line = {id:PROTECTCAR_PRODUCT.id,size,configuration,qty:1};

test('ProtectCar is strictly scoped and requires a complete valid configuration', () => {
  assert.equal(isProtectCar(PROTECTCAR_PRODUCT),true);
  assert.equal(isProtectCar({...PROTECTCAR_PRODUCT,id:'helmet'}),false);
  assert.equal(isProtectCar({...PROTECTCAR_PRODUCT,configurationType:undefined}),false);
  assert.equal(normalizeConfiguration({id:'helmet'},size,configuration),undefined);
  assert.deepEqual(normalizeConfiguration(PROTECTCAR_PRODUCT,size,{...configuration,brand:` ${brand} `,extra:'ignored'}),configuration);
  for (const invalid of [undefined,{}, {...configuration,vehicleType:'picape'}, {...configuration,brand:'__proto__'}, {...configuration,model:'unknown'}, {...configuration,year:String(vehicle.from-1)}, {...configuration,year:String(vehicle.to+1)}, {...configuration,year:vehicle.from}, {...configuration,color:'unknown'}, {...configuration,texture:'unknown'}]) {
    assert.throws(()=>normalizeConfiguration(PROTECTCAR_PRODUCT,size,invalid),/invalid_configuration/);
  }
});

test('server prices all four kits and separates configurations without accepting duplicate lines', () => {
  for (const kit of PROTECTCAR_KITS) {
    const [item] = checkoutItems([{id:line.id,size:kit.size,quantity:1,configuration:{...configuration,vehicleType:kit.vehicleType},unitPriceCents:1}]);
    assert.equal(item.unitPriceCents,Math.round(kit.price*100));
    assert.equal(item.configuration.vehicleType,kit.vehicleType);
  }
  const request = {...line,quantity:1};
  const different = {...request,configuration:{...configuration,color:PROTECTCAR_COLORS[1]}};
  assert.equal(checkoutItems([request,different]).length,2);
  assert.throws(()=>checkoutItems([request,{...request,configuration:{...configuration,brand:` ${brand} `}}]),/duplicate_item/);
  assert.throws(()=>checkoutItems([{...request,configuration:undefined}]),/invalid_configuration/);
});

test('cart controls address the chosen vehicle and prevent changing a configured kit', () => {
  const other = {...line,configuration:{...configuration,color:PROTECTCAR_COLORS[1]}};
  const cart = [line,other];
  const change = {id:line.id,size,type:'increase',configurationKey:configurationKey(other.configuration)};
  const result = changeCheckoutCart(cart,[PROTECTCAR_PRODUCT],change);
  assert.deepEqual(result.cart.map(item=>item.qty),[1,2]);
  assert.deepEqual(changeCheckoutCart(cart,[PROTECTCAR_PRODUCT],{...change,type:'remove'}).cart,[line]);
  assert.equal(changeCheckoutCart(cart,[PROTECTCAR_PRODUCT],{...change,type:'size',value:PROTECTCAR_KITS[2].size}).changed,false);
  assert.equal(changeCheckoutCart(cart,[PROTECTCAR_PRODUCT],{...change,configurationKey:undefined}).changed,false);
  const markup = renderCheckoutItems([{...line,product:PROTECTCAR_PRODUCT}]);
  assert.doesNotMatch(markup,/<select|>Tamanho</);
  assert.match(markup,/>Kit</);
  assert.ok(markup.includes(vehicle.model));
});
