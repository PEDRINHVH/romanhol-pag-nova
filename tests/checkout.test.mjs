import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {validateCheckoutForm as validateFields, validationError} from '../public/checkout-validation.js';
import {escapeHTML, money, priceOf} from '../public/catalog-utils.js';
import {renderCheckoutItems, renderCheckoutGift, changeCheckoutCart} from '../public/checkout-cart.js';

const shippingSource = readFileSync(new URL('../public/product-shipping.js', import.meta.url), 'utf8').replace(/\bexport /g, '');

const source = readFileSync(new URL('../public/checkout.js', import.meta.url), 'utf8')
  .replace(/^import .*;\s*$/gm, '').replace(/\bexport /g, '')
  .replace("import('./vendor/qr-code.js')", '__importQr()');
const customerFields = {name:'Maria Silva', email:'maria@example.com', document:'52998224725', phone:'11987654321', zipCode:'01310100', street:'Avenida Paulista', number:'100', complement:'', neighborhood:'Bela Vista', city:'São Paulo', state:'SP'};
const payment = (status='waiting_payment') => ({id:'11111111-1111-4111-8111-111111111111', status, totalCents:10000, subtotalCents:10000, shippingCents:0, items:[], pix:null});
const response = (body, status=200) => ({ok:status < 400, status, json:async()=>structuredClone(body)});
const deferred = () => {let resolve; const promise=new Promise(done=>{resolve=done;}); return {promise,resolve};};

function fixture({store=new Map(), realValidation=false, fetch=async()=>response({paymentReady:true,shippingCents:0}), importQr=async()=>({default:{toDataURL:async()=> 'data:image/png;base64,qr'}})}={}) {
  const events=new Map(), timers=new Map(); let timerId=0, uuid=0, renders=0, html='', formVisible=true;
  let fields={...customerFields},fieldsetDisabled=false;
  const cart=[{id:'item',size:'M',qty:1}];
  const products=[{id:'item',name:'Produto',model:'Produto',category:'acessorios',price:100,variants:[{size:'M'},{size:'G'}]}];
  const focused=[];
  const personal=new Set(['name','email','document','phone']);
  function query(selector,step) {
    const section=selector.match(/data-checkout-step="([1-4])"/);
    if(section)return {querySelector:selector=>query(selector,Number(section[1]))};
    const named=selector.match(/^\[name="([^"]+)"\]$/);
    if(named&&(!step||(step===1?personal.has(named[1]):step===2&&!personal.has(named[1])))) {
      const name=named[1];
      return {name,get value(){return fields[name]||'';},setAttribute(){},removeAttribute(){},focus(){focused.push(name);}};
    }
    if(selector==='fieldset:disabled')return fieldsetDisabled?{}:null;
    if(selector.includes('h2'))return {focus(){focused.push('heading');}};
    return null;
  }
  const form={id:'pix-checkout',querySelector:query};
  const controls={'.checkout-submit':{dataset:{totalCents:'10000'}},'[data-config-error]':{},'[data-retry-config]':{hidden:true}};
  const sandbox={
    e:escapeHTML,money,priceOf,renderCheckoutItems,renderCheckoutGift,changeCheckoutCart,console,URL,AbortController,__importQr:importQr,
    mountAddressAutofill:()=>()=>{},mountCheckoutValidation:()=>()=>{},validationError,
    validateCheckoutForm:realValidation?validateFields:()=>true,
    location:{hash:'#/checkout'}, navigator:{clipboard:{writeText:async()=>{}}},
    crypto:{randomUUID:()=>`test-key-${++uuid}-1234567890`},
    sessionStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},
    document:{querySelector:selector=>selector==='#pix-checkout'&&formVisible?form:controls[selector]||(/checkout-(?:items summary|empty a)|data-checkout-(?:gift|shipping)/.test(selector)?{focus(){}}:null),
      querySelectorAll:()=>[],
      addEventListener:(type,handler)=>{const handlers=events.get(type)||[];handlers.push(handler);events.set(type,handlers);}},
    FormData:class {constructor(){return fieldsetDisabled?[]:Object.entries(fields);}},
    setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),
    fetch:(...args)=>fetch(...args)
  };
  const shippingContext=vm.createContext({sessionStorage:sandbox.sessionStorage});
  vm.runInContext(shippingSource,shippingContext);
  Object.assign(sandbox,vm.runInContext('({SHIPPING_OPTIONS,getShippingQuote,getShippingMethod,updateShippingMethod})',shippingContext));
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
  evaluate('configureCheckout')({getCart:()=>cart,setCart:next=>cart.splice(0,cart.length,...next),getProducts:()=>products,render:()=>{renders++;page();},toast:()=>{},tracker:{track:()=>{},purchase:()=>{},getContext:()=>({consent:false})}});
  page();
  const advance=async()=>{for(const handler of events.get('submit')||[])await handler({target:form,preventDefault(){}});};
  return {cart,store,page,evaluate,controls,focused,advance,
    get renders(){return renders;},get html(){return html;},
    setFields:next=>{fields={...next};},
    state:()=>JSON.parse(evaluate('JSON.stringify({attempt,order,draft,busy,message,giftWrap,shippingMethod,checkoutStep})')),
    ready:()=>evaluate('configured=true;config={paymentReady:true,shippingCents:0}'),
    mount:()=>evaluate('mountCheckout()'),
    poll:()=>evaluate('checkOrder()'),
    submit:async()=>{evaluate('checkoutStep=4');await advance();},
    click:async (selector,dataset={})=>{for(const handler of events.get('click')||[])await handler({target:{closest:value=>value===selector?{dataset}:null}});},
    change:async (selector,properties={})=>{for(const handler of events.get('change')||[])await handler({target:{matches:value=>value.split(',').includes(selector),...properties}});}
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

test('summary quantity, size merge and removal preserve customer draft', async()=>{
  const f=fixture();f.ready();
  const edited={...customerFields,email:'edited@example.com',complement:'Apartamento 7'};
  f.setFields(edited);
  await f.click('button[data-checkout-action]',{checkoutAction:'increase',productId:'item',size:'M'});
  assert.equal(f.cart[0].qty,2);
  assert.deepEqual(f.state().draft,edited);
  f.cart.push({id:'item',size:'G',qty:3});
  await f.change('[data-checkout-action="size"]',{dataset:{productId:'item',size:'M'},value:'G'});
  assert.equal(f.cart.length,1);assert.equal(f.cart[0].size,'G');assert.equal(f.cart[0].qty,5);
  assert.match(f.html,/value="edited@example.com"/);
  await f.click('button[data-checkout-action]',{checkoutAction:'decrease',productId:'item',size:'G'});
  assert.equal(f.cart[0].qty,4);
  await f.click('button[data-checkout-action]',{checkoutAction:'remove',productId:'item',size:'G'});
  assert.equal(f.cart.length,0);
  assert.match(f.html,/checkout-empty/);
  assert.deepEqual(f.state().draft,edited);
});

test('gift and Sedex persist on reload, preserve fields and enter payment payload', async()=>{
  const store=new Map(), requests=[];
  const f=fixture({store});f.ready();f.setFields(customerFields);
  await f.change('[data-checkout-gift]',{checked:true});
  await f.change('[data-checkout-shipping]',{value:'sedex'});
  assert.deepEqual(f.state().draft,customerFields);
  assert.equal(f.state().giftWrap,true);assert.equal(f.state().shippingMethod,'sedex');
  await f.advance();await f.advance();await f.advance();
  assert.match(f.html,/data-total-cents="15781"/);
  assert.match(f.html,/Embalagem para presente<\/dt><dd class="free-shipping">Grátis/);
  const reopened=fixture({store,fetch:async(path,options)=>{requests.push(JSON.parse(options.body));return response({...payment(),shippingCents:5781,totalCents:15781,giftWrap:true,shippingMethod:'sedex'});}});
  reopened.ready();reopened.setFields(customerFields);
  assert.equal(reopened.state().giftWrap,true);assert.equal(reopened.state().shippingMethod,'sedex');
  await reopened.advance();await reopened.advance();await reopened.advance();
  assert.match(reopened.html,/data-total-cents="15781"/);
  await reopened.submit();
  assert.equal(requests[0].giftWrap,true);assert.equal(requests[0].shippingMethod,'sedex');
  assert.equal(reopened.state().order.shippingCents,5781);
  assert.equal(reopened.state().order.totalCents,15781);
});

test('invalid delivery and size events cannot change selections or discard fields', async()=>{
  const f=fixture();f.ready();f.setFields(customerFields);
  const before=JSON.stringify(f.cart);
  await f.change('[data-checkout-shipping]',{value:'free-sedex'});
  await f.change('[data-checkout-action="size"]',{dataset:{productId:'item',size:'M'},value:'XXL'});
  assert.equal(f.state().shippingMethod,'standard');assert.equal(JSON.stringify(f.cart),before);
  assert.deepEqual(f.state().draft,customerFields);
});

for(const lock of ['busy','orderRequest','orderId','order'])test(`cart and options reject programmatic edits when locked by ${lock}`,async()=>{
  const f=fixture();f.ready();
  const frozen={idempotencyKey:'frozen-key',signature:JSON.stringify([['item','M',1]])};
  if(lock==='busy')f.evaluate('busy=true');
  else if(lock==='order')f.evaluate(`order=${JSON.stringify(payment())}`);
  else f.evaluate(`attempt=${JSON.stringify({...frozen,[lock]:lock==='orderId'?'existing-order':{giftWrap:false,shippingMethod:'standard'}})}`);
  f.page();
  if(lock==='order')assert.doesNotMatch(f.html,/data-checkout-shipping/);
  else assert.match(f.html,/<fieldset class="checkout-delivery" disabled/);
  assert.match(f.html,/data-checkout-gift disabled/);
  const before=JSON.stringify(f.cart);
  await f.click('button[data-checkout-action]',{checkoutAction:'remove',productId:'item',size:'M'});
  await f.change('[data-checkout-action="size"]',{dataset:{productId:'item',size:'M'},value:'G'});
  await f.change('[data-checkout-gift]',{checked:true});
  await f.change('[data-checkout-shipping]',{value:'sedex'});
  assert.equal(JSON.stringify(f.cart),before);
  assert.equal(f.state().giftWrap,false);assert.equal(f.state().shippingMethod,'standard');
});

test('four checkout steps validate their own fields and create Pix only after shipping', async()=>{
  const requests=[];
  const f=fixture({realValidation:true,fetch:async(path,options)=>{requests.push(JSON.parse(options.body));return response(payment());}});
  f.ready();
  assert.equal(f.state().checkoutStep,1);
  f.setFields({...customerFields,name:'Maria',zipCode:''});
  await f.advance();
  assert.equal(f.state().checkoutStep,1);
  assert.equal(f.focused.at(-1),'name');
  f.setFields({...customerFields,zipCode:'123',street:''});
  await f.advance();
  assert.equal(f.state().checkoutStep,2);
  await f.advance();
  assert.equal(f.state().checkoutStep,2);
  assert.equal(f.focused.at(-1),'zipCode');
  assert.equal(requests.length,0);
  f.setFields(customerFields);
  await f.advance();
  assert.equal(f.state().checkoutStep,3);
  const summary=f.html.match(/<aside\b[^>]*>[\s\S]*?<\/aside>/)?.[0];
  assert.ok(summary);
  assert.doesNotMatch(summary,/data-checkout-shipping/);
  assert.match(f.html,/<section[^>]*data-checkout-step="3"[^>]*>[\s\S]*?data-checkout-shipping/);
  await f.change('[data-checkout-shipping]',{value:'sedex'});
  await f.advance();
  assert.equal(f.state().checkoutStep,4);
  assert.equal(requests.length,0);
  await f.click('[data-checkout-back]');
  assert.equal(f.state().checkoutStep,3);
  assert.equal(f.state().draft.street,customerFields.street);
  assert.equal(f.state().shippingMethod,'sedex');
  await f.advance();
  await f.advance();
  assert.equal(requests.length,1);
  assert.equal(requests[0].shippingMethod,'sedex');
  assert.equal(requests[0].customer.address.zipCode,customerFields.zipCode);
});

test('payment revalidates earlier sections and returns to the first invalid step',async()=>{
  let requests=0;
  const f=fixture({realValidation:true,fetch:async()=>{requests++;return response(payment());}});
  f.ready();f.setFields(customerFields);
  await f.advance();await f.advance();await f.advance();
  f.setFields({...customerFields,document:'11111111111'});
  await f.advance();
  assert.equal(f.state().checkoutStep,1);
  assert.equal(requests,0);
  f.setFields({...customerFields,zipCode:'123'});
  await f.advance();
  f.evaluate('checkoutStep=4');
  await f.advance();
  assert.equal(f.state().checkoutStep,2);
  assert.equal(requests,0);
});

test('reopened ambiguous payment resumes at payment and keeps the frozen request',async()=>{
  const store=new Map(),requests=[];
  const f=fixture({store,fetch:async(path,options)=>{requests.push(JSON.parse(options.body));throw new Error('offline');}});
  f.ready();f.setFields(customerFields);await f.submit();
  const reopened=fixture({store,realValidation:true,fetch:async(path,options)=>{requests.push(JSON.parse(options.body));return response(payment());}});
  reopened.ready();
  assert.equal(reopened.state().checkoutStep,4);
  await reopened.advance();
  assert.deepEqual(requests[1],requests[0]);
});
