import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {visorColor, visorOffers} from '../public/visor-utils.js';
import {visorBump} from '../public/visor-ui.js';
import {priceOf} from '../public/catalog-utils.js';

const helmet = (model, id = model) => ({id, model, category:'capacetes'});
const visor = (overrides = {}) => ({id:'visor', name:'VISEIRA FUMÊ CAPACETE FORCE', model:'FORCE', category:'acessorios', subcategory:'viseiras', price:23.97, variants:[{id:'sku', size:'ÚNICO', available:null}], ...overrides});

test('model generations and suffixes never inherit compatibility', () => {
  for (const [original, newer] of [['FORCE II','FORCE'], ['FORCE','FORCE III'], ['STRADA','STRADA II'], ['DOWNTOWN','DOWNTOWN II'], ['ORION','ORION SV']]) {
    assert.deepEqual(visorOffers([visor({model:original})], [helmet(newer)]), []);
  }
});
test('exact model grouping keeps helmet and SKU references without mutating inputs', () => {
  const cap = helmet(' force '), product = visor();
  const offers = visorOffers([product, product], [cap, cap]);
  assert.equal(offers.length, 1);
  assert.deepEqual(offers[0], {model:'FORCE', helmets:[cap], options:[{product, color:'Fumê'}]});
  assert.equal(offers[0].options[0].product.variants[0], product.variants[0]);
});
test('only tinted exterior visors qualify, including malformed mirrored catalogue spelling', () => {
  for (const name of ['SUPORTE DE VISEIRA FUMÊ','MECANISMO VISEIRA AZUL','VISEIRA SOLAR FUMÊ','VISEIRA INTERNA AZUL','PELÍCULA VISEIRA AZUL','VISEIRA CRISTAL','VISEIRA TRANSPARENTE','VISEIRA PINLOCK FUMÊ']) {
    assert.equal(visorColor(visor({name})), null, name);
  }
  assert.equal(visorColor(visor({name:'VISEIRA DOURADA',color:'AMARELO'})), 'Dourada');
  assert.equal(visorColor(visor({name:'VISEIRA ESPELAHDA',color:'CINZA'})), 'Espelhada');
  assert.equal(visorColor(visor({name:'VISEIRA REVO ROSA'})), 'Revo rosa');
});
test('unpriced, unavailable and SKU-less accessories are not offered', () => {
  for (const overrides of [{price:null},{price:''},{price:0},{price:-1},{price:'invalid'},{variants:[]},{available:false},{variants:[{size:'ÚNICO',available:false}]},{variants:[{size:'ÚNICO',price:0}]}]) {
    assert.deepEqual(visorOffers([visor(overrides)], [helmet('FORCE')]), []);
  }
  assert.equal(visorOffers([visor()], [helmet('FORCE')]).length, 1);
});
test('unknown helmets and non-helmet products produce no offers', () => {
  assert.deepEqual(visorOffers([visor()], [helmet(''),helmet('UNIVERSAL'),{...helmet('FORCE'),category:'acessorios'}]), []);
});
test('groups and color options are deterministic across input ordering', () => {
  const products = [visor(),visor({id:'red',name:'VISEIRA VERMELHA'}),visor({id:'city',model:'CITY'})];
  const helmets = [helmet('FORCE','2'),helmet('CITY'),helmet('FORCE','1')];
  assert.deepEqual(visorOffers(products, helmets), visorOffers([...products].reverse(), [...helmets].reverse()));
});
test('real catalogue only offers explicitly matched models and all Razor colors', () => {
  const products = JSON.parse(readFileSync(new URL('../public/data/catalog.json', import.meta.url),'utf8'));
  const groups = visorOffers(products, products);
  assert.deepEqual(groups.map(group => group.model), ['CARBON R','CITY','FLOW','FORCE','FORCE II','RAZOR','ROUTE','STRADA II']);
  assert.deepEqual(groups.find(group => group.model === 'RAZOR').options.map(option => option.color), ['Azul','Cinza','Dourada','Fumê','Revo rosa']);
  assert.equal(groups.find(group => group.model === 'FORCE').options[0].product.id, '429');
  assert.equal(groups.find(group => group.model === 'STRADA II').options.length, 3);
  for (const group of groups) for (const option of group.options) assert.equal(option.product.model, group.model === 'FORCE II' ? 'FORCE' : group.model);
});

const catalog = JSON.parse(readFileSync(new URL('../public/data/catalog.json', import.meta.url),'utf8'));
const ui = (helmets, choices = new Map(), cart = []) => visorBump(catalog, helmets, {choices, cart, media:()=>'', link:p=>`#/produto/${p.slug}`});
test('owner-confirmed FORCE II compatibility exposes only the real FORCE tinted visor', () => {
  const cap = catalog.find(p=>p.id==='394');
  const [group] = visorOffers(catalog,[cap]);
  assert.equal(group.model,'FORCE II');
  assert.deepEqual(group.options.map(o=>[o.product.id,o.color]),[['429','Fumê']]);
  assert.match(ui([cap]),/PARA FORCE II/);
  assert.match(ui([cap]),/data-add-visor="429"/);
});
test('unmatched helmets do not advertise an available optional add-on', () => {
  const html = ui([helmet('UNKNOWN')]);
  assert.match(html,/Não há viseira colorida com compatibilidade confirmada/);
  assert.doesNotMatch(html,/ADICIONAL OPCIONAL|data-add-visor/);
});
test('Razor choice changes the purchasable SKU and marks an added visor', () => {
  const cap = catalog.find(p=>p.id==='580');
  const html = ui([cap],new Map([['RAZOR','615']]),[{id:'615',size:'ÚNICO',qty:1}]);
  assert.match(html,/Viseira Revo rosa/);
  assert.match(html,/type="button" class="button button-blue" data-add-visor="615" disabled/);
  assert.doesNotMatch(ui([helmet(' force ')]),/visor-pending/);
});
// Exercise the real delegated handler without importing browser bootstrap code.
const appSource = readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const addHandler = appSource.slice(appSource.indexOf("  if(target.matches('[data-add-visor]')){"),appSource.indexOf("  if(target.matches('[data-add-cart]'))"));
function clickVisor(id,cart,path,cap) {
  const messages=[], events=[], location={hash:''}; let saved=0, rendered=0;
  const args={target:{matches:()=>true,dataset:{addVisor:id}},event:{preventDefault(){}},route:()=>({path}),currentProduct:()=>cap,cart,products:catalog,visorOffers,priceOf,toast:m=>messages.push(m),save:()=>saved++,tracker:{track:(...args)=>events.push(args)},location,link:p=>`#${p}`,render:()=>rendered++};
  Function(...Object.keys(args),addHandler)(...Object.values(args));
  return {messages,events,location,saved,rendered};
}
test('real handler adds selected Razor SKU once and preserves PDP checkout redirect', () => {
  const cart=[{id:'580',size:'58/M',qty:1}];
  const result=clickVisor('615',cart,'/produto/razor',catalog.find(p=>p.id==='580'));
  assert.deepEqual(cart[1],{id:'615',size:'ÚNICO',qty:1});
  assert.equal(result.saved,1);
  assert.equal(result.events[0][0],'AddToCart');
  assert.equal(result.location.hash,'#/checkout');
  assert.equal(clickVisor('615',cart,'/checkout').saved,0);
  assert.equal(cart.length,2);
});
test('checkout handler adds owner-approved FORCE II visor and refuses other model', () => {
  const cart=[{id:'394',size:'58/M',qty:1}];
  assert.equal(clickVisor('429',cart,'/checkout').rendered,1);
  assert.equal(cart[1].id,'429');
  const result=clickVisor('441',cart,'/checkout');
  assert.equal(result.saved,0);
  assert.match(result.messages[0],/não está disponível/);
});
