import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {escapeHTML, money, priceOf} from '../public/catalog-utils.js';

const source = readFileSync(new URL('../public/checkout.js', import.meta.url), 'utf8')
  .replace(/^import .*;\s*$/gm, '').replace(/\bexport /g, '')
  .replace("import('./vendor/qr-code.js')", '__importQr()');
const customerFields = {name:'Maria Silva', email:'maria@example.com', document:'52998224725', phone:'11987654321', zipCode:'01310100', street:'Avenida Paulista', number:'100', complement:'', neighborhood:'Bela Vista', city:'São Paulo', state:'SP'};
const payment = (status='waiting_payment') => ({id:'11111111-1111-4111-8111-111111111111', status, totalCents:10000, subtotalCents:10000, shippingCents:0, items:[], pix:null});
const response = (body, status=200) => ({ok:status < 400, status, json:async()=>structuredClone(body)});
const deferred = () => {let resolve; const promise=new Promise(done=>{resolve=done;}); return {promise,resolve};};

function fixture({store=new Map(), fetch=async()=>response({paymentReady:true,shippingCents:0}), importQr=async()=>({default:{toDataURL:async()=> 'data:image/png;base64,qr'}})}={}) {
  const events=new Map(), timers=new Map(); let timerId=0, uuid=0, renders=0, html='', formVisible=true;
  let fields={...customerFields},fieldsetDisabled=false;
  const cart=[{id:'item',size:'M',qty:1}];
  const products=[{id:'item',name:'Produto',model:'Produto',category:'acessorios',price:100}];
  const form={id:'pix-checkout',querySelector:selector=>selector==='fieldset:disabled'&&fieldsetDisabled?{}:null};
  const controls={'.checkout-submit':{dataset:{totalCents:'10000'}},'[data-config-error]':{},'[data-retry-config]':{hidden:true}};
  const sandbox={
    e:escapeHTML,money,priceOf,console,URL,AbortController,__importQr:importQr,
    mountAddressAutofill:()=>()=>{},mountCheckoutValidation:()=>()=>{},validateCheckoutForm:()=>true,
    location:{hash:'#/checkout'}, navigator:{clipboard:{writeText:async()=>{}}},
    crypto:{randomUUID:()=>`test-key-${++uuid}-1234567890`},
    sessionStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},
    document:{querySelector:selector=>selector==='#pix-checkout'&&formVisible?form:formVisible?controls[selector]||null:null,
      addEventListener:(type,handler)=>{const handlers=events.get(type)||[];handlers.push(handler);events.set(type,handlers);}},
    FormData:class {constructor(){return fieldsetDisabled?[]:Object.entries(fields);}},
    setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),
    fetch:(...args)=>fetch(...args)
  };
  const context=vm.createContext(sandbox);
  vm.runInContext(source,context);
  const evaluate=code=>vm.runInContext(code,context);
  function page(){
    html=evaluate('checkoutPage')({cart,products,media:()=>'',addons:()=>''});
    formVisible=html.includes('id="pix-checkout"');
    fieldsetDisabled=formVisible&&/<fieldset[^>]*\bdisabled/.test(html);
    if(formVisible)fields=Object.fromEntries([...html.matchAll(/<input[^>]* name="([^"]+)" value="([^"]*)"/g)].map(([,name,value])=>[name,value]));
    return html;
  }
  evaluate('configureCheckout')({getCart:()=>cart,getProducts:()=>products,render:()=>{renders++;page();},toast:()=>{},tracker:{track:()=>{},purchase:()=>{},getContext:()=>({consent:false})}});
  page();
  return {cart,store,page,evaluate,controls,
    get renders(){return renders;},get html(){return html;},
    setFields:next=>{fields={...next};},
    state:()=>JSON.parse(evaluate('JSON.stringify({attempt,order,draft,busy,message})')),
    ready:()=>evaluate('configured=true;config={paymentReady:true,shippingCents:0}'),
    mount:()=>evaluate('mountCheckout()'),
    poll:()=>evaluate('checkOrder()'),
    submit:async()=>{for(const handler of events.get('submit')||[])await handler({target:form,preventDefault(){}});},
    click:async selector=>{for(const handler of events.get('click')||[])await handler({target:{closest:value=>value===selector?{}:null}});}
  };
}

test('late order poll cannot replace the checkout after cart changes', async()=>{
  const pending=deferred();const f=fixture({fetch:()=>pending.promise});f.ready();
  f.evaluate(`attempt={signature:JSON.stringify([['item','M',1]]),orderId:'old-order',idempotencyKey:'original-key'};order=null`);
  const poll=f.poll();f.cart[0].qty=2;f.page();
  pending.resolve(response(payment()));await poll;
  assert.equal(f.state().order,null);
  assert.equal(f.state().attempt,null);
  assert.match(f.page(),/id="pix-checkout"/);
});

test('late checkout POST cannot attach the old order to a changed cart', async()=>{
  const pending=deferred();const f=fixture({fetch:()=>pending.promise});f.ready();
  const submit=f.submit();f.cart[0].qty=2;f.page();
  pending.resolve(response(payment()));await submit;
  assert.equal(f.state().order,null);
  assert.equal(f.state().attempt,null);
  assert.equal(f.state().busy,false);
  assert.doesNotMatch(f.state().message,/Cannot set|orderId/);
});

test('configuration failure exposes an explicit retry that restores checkout', async()=>{
  let calls=0;const f=fixture({fetch:async path=>{assert.equal(path,'/api/config');if(++calls===1)throw new Error('offline');return response({paymentReady:true,shippingCents:0});}});
  const renders=f.renders;
  await f.mount();assert.equal(f.controls['[data-retry-config]'].hidden,false);
  await f.click('[data-retry-config]');
  assert.equal(calls,2);
  assert.equal(f.controls['[data-retry-config]'].hidden,true);
  assert.match(f.controls['.checkout-submit'].textContent,/Gerar Pix de/);
  assert.equal(f.controls['.checkout-submit'].disabled,false);
  assert.equal(f.renders,renders,'config updates preserve the mounted form');
});

test('identical polling does not rerender and a status transition does', async()=>{
  let current=payment();const f=fixture({fetch:async()=>response(current)});f.ready();
  f.evaluate(`attempt={signature:JSON.stringify([['item','M',1]]),orderId:'old-order',idempotencyKey:'original-key'}`);
  await f.poll();const before=f.renders;
  await f.poll();assert.equal(f.renders,before);
  current=payment('paid');await f.poll();
  assert.ok(f.renders>before);assert.equal(f.state().order.status,'paid');
});

test('refused payment review keeps the original customer fields', async()=>{
  let current=payment();const f=fixture({fetch:async()=>response(current)});f.ready();
  await f.submit();current=payment('refused');await f.poll();
  await f.click('[data-retry-checkout]');
  assert.equal(f.state().order,null);
  assert.match(f.page(),/name="name" value="Maria Silva"/);
  assert.match(f.html,/name="email" value="maria@example.com"/);
  assert.match(f.html,/name="street" value="Avenida Paulista"/);
});

test('lost creation response retries its frozen payload after edits and reload', async()=>{
  const store=new Map(),requests=[];
  const f=fixture({store,fetch:async(path,options)=>{assert.equal(path,'/api/checkout');requests.push(JSON.parse(options.body));throw new Error('response lost');}});f.ready();
  await f.submit();
  const saved=JSON.parse(store.get('nolimit:checkout:attempt'));
  assert.deepEqual(saved.orderRequest,requests[0]);
  const reopened=fixture({store,fetch:async(path,options)=>{assert.equal(path,'/api/checkout');requests.push(JSON.parse(options.body));return response(payment());}});reopened.ready();
  reopened.setFields({...customerFields,email:'changed@example.com',number:'200'});
  await reopened.submit();
  assert.equal(requests.length,2);
  assert.deepEqual(requests[1],requests[0]);
  assert.equal(reopened.state().order.id,payment().id);
  assert.equal(reopened.state().attempt.orderId,payment().id);
});

for(const status of [400,422])test(`checkout rejection ${status} preserves fields disabled during submission`, async()=>{
  const pending=deferred();const f=fixture({fetch:()=>pending.promise});f.ready();
  const submit=f.submit();
  assert.match(f.html,/<fieldset[^>]*\bdisabled/);
  pending.resolve(response({error:'invalid_items',message:'Revise sua seleção.'},status));
  await submit;
  assert.equal(f.state().attempt,null);
  assert.equal(f.state().busy,false);
  assert.deepEqual(f.state().draft,customerFields);
  assert.match(f.html,/name="name" value="Maria Silva"/);
  assert.match(f.html,/name="street" value="Avenida Paulista"/);
  assert.doesNotMatch(f.html,/<fieldset[^>]*\bdisabled/);
});

test('identical poll while QR module loads does not discard the generated image', async()=>{
  const loading=deferred(),current={...payment(),pix:{code:'pix-code'}};
  const f=fixture({fetch:async()=>response(current),importQr:()=>loading.promise});f.ready();
  f.evaluate(`attempt={signature:JSON.stringify([['item','M',1]]),orderId:'${current.id}',idempotencyKey:'original-key'};order=${JSON.stringify(current)}`);
  const generating=f.evaluate('prepareQr()');
  await f.poll();
  loading.resolve({default:{toDataURL:async()=> 'data:image/png;base64,ready'}});
  await generating;
  assert.equal(f.evaluate('qrImage'),'data:image/png;base64,ready');
  assert.match(f.html,/src="data:image\/png;base64,ready"/);
});
