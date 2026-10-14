import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {money,priceOf} from '../public/catalog-utils.js';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf('function mountProtectCarProduct(');
const end=source.indexOf('function render(',start);
assert.ok(start>=0&&end>start);
const mount=new Function('document','window','mountProtectCarConfigurator','renderProtectCarConfigurator','mountProtectCarComparisons','mountProductSticky','money','priceOf',`
  let selectedSize='',selectedConfiguration={},cleanupProductSticky=()=>{};
  ${source.slice(start,end)}
  return mountProtectCarProduct;
`);

test('configuration changes replace only form, price and sticky while retaining media and comparisons',()=>{
  let listener,formCleanups=0,comparisonMounts=0,comparisonCleanups=0,stickyCleanups=0;
  const renders=[],stickies=[],scrolls=[],queries=[];
  const form={outerHTML:''},price={textContent:''};
  const gallery={},description={},video={currentTime:12,paused:false},comparison={value:73};
  const nodes={'.protectcar-configurator':form,'.pdp-price':price,'.pdp-gallery':gallery,'.protectcar-description':description,video,comparison};
  const document={querySelector(selector){queries.push(selector);assert.ok(nodes[selector],`Unexpected page access: ${selector}`);return nodes[selector];}};
  const window={scrollX:0,scrollY:850,scrollTo(position){scrolls.push(position);}};
  const product={price:97.83,variants:[{size:'Carro',price:97.83},{size:'Picape',price:167.96}]};
  const dispose=mount(document,window,
    options=>{listener=options;return ()=>{formCleanups++;};},
    selection=>{renders.push(selection);return '<section>updated form</section>';},
    ()=>{comparisonMounts++;return ()=>{comparisonCleanups++;};},
    options=>{stickies.push(options);return ()=>{stickyCleanups++;};},money,priceOf)(product);
  listener.onChange({size:'Picape',configuration:{vehicleType:'picape'}});
  assert.equal(price.textContent,money(167.96));
  assert.equal(stickies[0].price,167.96);
  assert.equal(listener.size,'Picape');
  assert.equal(listener.configuration.vehicleType,'picape');
  listener.onChange({size:'Picape',configuration:{vehicleType:'picape',color:'Bege'}});
  assert.equal(renders.length,2);
  assert.equal(formCleanups,2);
  assert.equal(stickyCleanups,1);
  assert.equal(comparisonMounts,1);
  assert.equal(comparisonCleanups,0);
  assert.deepEqual([...new Set(queries)],['.protectcar-configurator','.pdp-price']);
  assert.deepEqual(scrolls,[{left:0,top:850,behavior:'instant'},{left:0,top:850,behavior:'instant'}]);
  assert.equal(nodes['.pdp-gallery'],gallery);
  assert.equal(nodes['.protectcar-description'],description);
  assert.deepEqual(video,{currentTime:12,paused:false});
  assert.equal(comparison.value,73);
  dispose();
  assert.equal(formCleanups,3);
  assert.equal(comparisonCleanups,1);
});
