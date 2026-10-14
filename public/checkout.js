import {escapeHTML as e, money, priceOf} from './catalog-utils.js?v=20261014-norisk-products';
import {renderCheckoutItems, renderCheckoutGift, changeCheckoutCart} from './checkout-cart.js?v=20261014-cart-shipping';
import {SHIPPING_OPTIONS, getShippingQuote, getShippingMethod, updateShippingMethod} from './product-shipping.js?v=20261014-cart-shipping';
import {mountAddressAutofill} from './address-autofill.js';
import {mountCheckoutValidation, validateCheckoutForm, validationError} from './checkout-validation.js?v=20261014-phone-mask';

const sessionKey = 'nolimit:checkout:attempt';
const readAttempt = () => {try {const value=JSON.parse(sessionStorage.getItem(sessionKey));return value&&typeof value.idempotencyKey==='string'&&typeof value.signature==='string'?value:null;} catch {return null;}};
const customerDraft = customer => customer ? {name:customer.name,email:customer.email,phone:customer.phone,document:customer.document,...customer.address} : {};
let attempt = readAttempt(), draft = customerDraft(attempt?.orderRequest?.customer), order = null, busy = false, message = '', pollTimer, pollRunning = false;
let config = {paymentReady:false, shippingCents:null}, configured = false, configLoading = false, configFailed = false, qrCode = '', qrImage = '';
let cleanupAddress, cleanupValidation, mountedForm;
const addressState = {};
let hooks;
const persist = () => {try {if(attempt)sessionStorage.setItem(sessionKey, JSON.stringify(attempt));else sessionStorage.removeItem(sessionKey);} catch {}};
const giftKey = 'nolimit:checkout:gift';
const readGift = () => {try {return sessionStorage.getItem(giftKey)==='true';} catch {return false;}};
let giftWrap=attempt?.orderRequest?.giftWrap ?? attempt?.giftWrap ?? readGift();
let shippingMethod=attempt?.orderRequest?.shippingMethod ?? attempt?.shippingMethod ?? getShippingMethod();
let appliedShippingZip='';
let checkoutStep=attempt?.orderRequest||attempt?.orderId?4:1;
const stepLabels=['Seus dados','Endereço','Frete','Pagamento'];
const cartLocked = () => busy || !!order || !!attempt?.orderRequest || !!attempt?.orderId;
const delivery = () => SHIPPING_OPTIONS.find(option=>option.id===shippingMethod) || SHIPPING_OPTIONS[0];
const signature = cart => {
  const items=cart.map(({id,size,qty})=>[id,size,qty]).sort();
  return JSON.stringify(giftWrap||shippingMethod!=='standard'?{items,giftWrap,shippingMethod}:items);
};
const deliveryChoices = locked => `<fieldset class="checkout-delivery" ${locked?'disabled':''}><legend>Entrega</legend>${SHIPPING_OPTIONS.map(option=>`<label><input type="radio" name="checkout-delivery" data-checkout-shipping value="${option.id}" ${shippingMethod===option.id?'checked':''}><span><strong>${e(option.label)}</strong><small>${e(option.days)}</small></span><b>${option.cents?money(option.cents/100):'Grátis'}</b></label>`).join('')}</fieldset>`;
function updateCart(change) {
  if(cartLocked())return;
  snapshotCheckoutForm();
  const result=changeCheckoutCart(hooks.getCart(),hooks.getProducts(),change);
  if(result.changed){
    hooks.setCart(result.cart);refresh();
    const controls=Array.from(document.querySelectorAll('[data-checkout-action]'));
    const focus=controls.find(control=>control.dataset.productId===change.id&&control.dataset.size===(change.type==='size'?change.value:change.size)&&control.dataset.checkoutAction===change.type);
    (focus || document.querySelector('.checkout-items summary') || document.querySelector('.checkout-empty a'))?.focus({preventScroll:true});
  }
  if(result.message)hooks.toast(result.message);
}
const field = (name,label,attrs='',wide=false) => `<label class="checkout-field ${wide?'field-wide':''}" for="checkout-${name}"><span id="checkout-label-${name}">${label}</span><input id="checkout-${name}" name="${name}" value="${e(draft[name] || '')}" aria-labelledby="checkout-label-${name}" aria-describedby="checkout-error-${name}${name==='zipCode'?' cep-status':''}" ${attrs}><small class="checkout-field-error" id="checkout-error-${name}" data-field-error="${name}"></small></label>`;
const pixLogo = '<img class="pix-method-logo" src="/assets/payments/pix.svg" alt="Pix" width="90" height="36">';
const submitLabel = total => busy ? 'Gerando Pix…' : configLoading ? 'Carregando pagamento…' : !config.paymentReady ? 'Pagamento temporariamente indisponível' : attempt?.orderRequest ? 'Recuperar Pix do pedido' : `Gerar Pix de ${money(total/100)}`;
const itemsFor = (cart,products) => cart.map(line => {const p=products.find(p=>p.id===line.id);return {id:line.id,quantity:line.qty,unitPriceCents:Math.round(priceOf(p,line.size)*100)};});
const statusCopy = {waiting_payment:['Pague com Pix','Abra o aplicativo do seu banco e escolha Pix. Escaneie o QR Code ou use o código copia e cola.'],paid:['Pagamento confirmado','Recebemos a confirmação do seu Pix. Guarde o número do pedido abaixo.'],refused:['Pagamento não concluído','Revise seus dados antes de tentar novamente.'],refunded:['Pagamento devolvido','A devolução foi informada pelo Pagar.me.'],processing:['Gerando Pix','Aguarde a confirmação do Pagar.me.'],payment_uncertain:['Pagamento em verificação','Aguardando a resposta do Pagar.me. Não gere outro Pix.']};

export function configureCheckout(options) {hooks=options;}
export function snapshotCheckoutForm() {if(order||attempt?.orderRequest||busy)return;const form=document.querySelector('#pix-checkout');if(form&&!form.querySelector('fieldset:disabled'))draft=Object.fromEntries(new FormData(form));}
export function checkoutPage({cart,products,media,addons}) {
  snapshotCheckoutForm();
  if(!cartLocked())shippingMethod=getShippingMethod();
  const quote=getShippingQuote();
  if(quote&&quote.zipCode!==appliedShippingZip&&!cartLocked()){
    for(const name of ['zipCode','street','neighborhood','city','state'])if(!draft[name])draft[name]=quote[name]||'';
    appliedShippingZip=quote.zipCode;
  }
  const cartSignature=signature(cart);
  if(attempt && attempt.signature!==cartSignature){attempt=null;order=null;busy=false;message='';qrImage='';qrCode='';persist();}
  const lines=cart.map(line=>({...line,product:products.find(p=>p.id===line.id)})).filter(line=>line.product);
  if(!lines.length)return '<div class="wrap checkout-empty"><h1>Sua sacola está vazia.</h1><a class="button button-dark" href="#/catalogo">Ver produtos</a></div>';
  const subtotal=lines.reduce((total,line)=>total+Math.round(priceOf(line.product,line.size)*100)*line.qty,0);
  const shippingCents=order?.shippingCents ?? delivery().cents;
  const total=order?.totalCents ?? subtotal+shippingCents;
  const locked=cartLocked();
  const itemCount=lines.reduce((count,line)=>count+line.qty,0);
  const summary=`<aside class="checkout-summary"><div class="checkout-section-title"><h2>Sua sacola</h2><a href="#/catalogo">Continuar comprando</a></div><details class="checkout-items" open><summary>${itemCount} ${itemCount===1?'item':'itens'} no pedido<span>Ver itens</span></summary>${renderCheckoutItems(lines,{media,locked})}</details>${renderCheckoutGift({giftWrap:order?.giftWrap??giftWrap,locked})}${locked?'<p class="checkout-cart-locked" role="status">Sua seleção está confirmada para este pedido.</p>':''}<dl class="checkout-totals"><div><dt>Produtos</dt><dd>${money(subtotal/100)}</dd></div>${checkoutStep>=3||locked?`<div><dt>Frete · ${e(order?.shippingLabel || delivery().label)}</dt><dd class="${shippingCents?'':'free-shipping'}">${shippingCents?money(shippingCents/100):'Grátis'}</dd></div>`:""}${(order?.giftWrap??giftWrap)?'<div><dt>Embalagem para presente</dt><dd class="free-shipping">Grátis</dd></div>':''}<div class="checkout-total"><dt>${checkoutStep>=3||locked?'Total no Pix':'Subtotal'}</dt><dd aria-live="polite">${money((checkoutStep>=3||locked?total:subtotal)/100)}</dd></div></dl><div class="pix-only-note"><span>Oferta de aniversário exclusiva no Pix.</span></div><p class="checkout-protection">Pagamento processado pelo Pagar.me.</p></aside>`;
  let main;
  if(order){
    const [title,description]=statusCopy[order.status] || statusCopy.processing;
    main=`<section class="checkout-panel pix-result" aria-live="polite"><span class="pix-result-mark">${order.status==='paid'?'✓':pixLogo}</span><span class="eyebrow">${order.status==='paid'?'PAGAMENTO CONFIRMADO':'PAGAMENTO VIA PIX'}</span><h2>${title}</h2><p>${description}</p><strong class="pix-amount">${money(order.totalCents/100)}</strong>${order.status==='waiting_payment'&&order.pix?.code?`<div class="pix-qr">${qrImage?`<img src="${e(qrImage)}" alt="QR Code Pix deste pedido" width="224" height="224">`:'<span>Preparando QR Code…</span>'}</div><button type="button" class="button button-dark pix-copy" data-copy-pix>Copiar código Pix</button><details class="pix-code-details"><summary>Ver código copia e cola</summary><textarea aria-label="Código Pix" readonly>${e(order.pix.code)}</textarea></details>${order.pix.expiresAt?`<p class="pix-expiry">Válido até ${e(new Date(order.pix.expiresAt).toLocaleString('pt-BR'))}.</p>`:''}<p class="pix-waiting"><span></span>Aguardando a confirmação do banco</p>`:''}<p class="order-reference">Pedido <strong>${e(order.id)}</strong></p><p class="checkout-error" role="status">${e(message)}</p>${order.status==='refused'?'<button type="button" class="button button-dark" data-retry-checkout>Revisar dados e tentar novamente</button>':['waiting_payment','processing','payment_uncertain'].includes(order.status)?'<button type="button" class="text-link" data-refresh-payment>Já paguei · verificar pagamento</button>':''}<a class="text-link pix-back" href="#/catalogo">Voltar à loja</a></section>`;
  }else{
    main=`<form id="pix-checkout" class="checkout-panel" novalidate>
      <ol class="checkout-progress" aria-label="Etapas da compra">${stepLabels.map((label,index)=>`<li class="${checkoutStep===index+1?'is-current':checkoutStep>index+1?'is-complete':''}" ${checkoutStep===index+1?'aria-current="step"':''}><span aria-hidden="true">${index+1}</span>${label}</li>`).join('')}</ol>
      ${attempt?.orderRequest?'<p class="checkout-recovery" role="status">Sua solicitação já foi enviada. Recuperaremos o mesmo Pix, sem criar outro pedido.</p>':''}
      <fieldset class="checkout-fields-group" ${busy||attempt?.orderRequest?'disabled':''}>
        <section data-checkout-step="1" ${checkoutStep===1?'':'hidden'} aria-labelledby="checkout-step-1">
          <div class="checkout-section-title"><h2 id="checkout-step-1" tabindex="-1">Seus dados</h2></div>
          <p class="checkout-section-note">Dados para pagamento e entrega. Não é preciso criar uma conta.</p>
          <div class="checkout-fields">${field('name','Nome completo','autocomplete="name" required minlength="5" maxlength="120"',true)}${field('email','E-mail','type="email" autocomplete="email" required maxlength="180"',true)}${field('document','CPF','inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" required maxlength="14"')}${field('phone','Celular com DDD','type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="(11) 99999-9999" required maxlength="15"')}</div>
        </section>
        <section data-checkout-step="2" ${checkoutStep===2?'':'hidden'} aria-labelledby="checkout-step-2">
          <div class="checkout-section-title"><h2 id="checkout-step-2" tabindex="-1">Endereço de entrega</h2></div>
          <p class="checkout-section-note">Informe o CEP e complete o endereço para escolher o frete. O complemento é opcional.</p>
          <div class="checkout-fields">${field('zipCode','CEP','inputmode="numeric" autocomplete="postal-code" placeholder="00000-000" required maxlength="9"')}${field('state','Estado (UF)','autocomplete="address-level1" placeholder="SP" required minlength="2" maxlength="2"')}<div class="cep-feedback field-wide"><p id="cep-status" data-cep-status role="status" aria-live="polite">Informe o CEP para preencher o endereço automaticamente.</p><button type="button" class="text-link" data-cep-retry hidden>Tentar buscar CEP novamente</button></div>${field('street','Rua ou avenida','autocomplete="address-line1" required maxlength="160"',true)}${field('number','Número','autocomplete="off" required maxlength="20"')}${field('complement','Complemento (opcional)','autocomplete="address-line2" maxlength="80"')}${field('neighborhood','Bairro','autocomplete="address-level3" required maxlength="80"')}${field('city','Cidade','autocomplete="address-level2" required maxlength="80"')}</div>
        </section>
        <section data-checkout-step="3" ${checkoutStep===3?'':'hidden'} aria-labelledby="checkout-step-3">
          <div class="checkout-section-title"><h2 id="checkout-step-3" tabindex="-1">Escolha o frete</h2></div>
          <p class="checkout-section-note">Confira o endereço e escolha como receber seu pedido.</p>
          <p class="checkout-address-review">${e(draft.street||'')}, ${e(draft.number||'')}${draft.complement?` · ${e(draft.complement)}`:''}<br>${e(draft.neighborhood||'')} · ${e(draft.city||'')} / ${e(draft.state||'')}<br>CEP ${e(draft.zipCode||'')}</p>
          ${deliveryChoices(locked)}
        </section>
        <section data-checkout-step="4" ${checkoutStep===4?'':'hidden'} aria-labelledby="checkout-step-4">
          <div class="checkout-section-title"><h2 id="checkout-step-4" tabindex="-1">Pagamento</h2></div>
          <p class="checkout-section-note">${e(delivery().label)} · ${shippingCents?money(shippingCents/100):'Grátis'} · ${e(delivery().days)}</p>
          <div class="checkout-method">${pixLogo}<div><strong>Pix à vista</strong><span>Oferta de aniversário exclusiva no Pix</span></div><span class="method-selected" aria-hidden="true">✓</span></div>
        </section>
      </fieldset>
      <div ${checkoutStep===4?'':'hidden'}><p class="checkout-config-error" data-config-error role="status">${configFailed?'Não foi possível carregar o pagamento. Sua sacola está salva.':''}</p><button type="button" class="text-link config-retry" data-retry-config ${configFailed?'':'hidden'}>Tentar carregar pagamento novamente</button></div>
      <p class="checkout-error" role="alert">${e(message)}</p>
      <div class="checkout-step-actions">
        ${checkoutStep>1&&!locked?'<button type="button" class="text-link checkout-back" data-checkout-back>← Voltar</button>':''}
        ${checkoutStep<4?`<button class="button button-dark checkout-next" type="submit">${['','Continuar para endereço','Continuar para frete','Continuar para pagamento'][checkoutStep]}</button>`:`<button class="button button-dark checkout-submit" type="submit" data-total-cents="${total}" aria-busy="${busy}" ${busy||!config.paymentReady?'disabled':''}>${submitLabel(total)}</button>`}
      </div>
      <p class="checkout-privacy">Seus dados serão usados para processar e entregar seu pedido. <a href="#/privacidade">Saiba mais</a>.</p>
    </form>`;
  }
  return `<div class="wrap checkout-page"><div class="checkout-breadcrumb"><a href="#/sacola">← Sacola</a><span>Pagamento via Pagar.me</span></div><div class="checkout-heading"><h1>Finalizar compra</h1><p>Pix à vista · <strong>Frete grátis para todo o Brasil.</strong></p></div><div class="checkout-layout"><div>${main}${!cartLocked()?addons(lines.map(line=>line.product)):''}</div>${summary}</div></div>`;
}

async function api(path,options={}) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),path==='/api/checkout'?45000:12000);
  try {
    const response=await fetch(path,{...options,signal:controller.signal,credentials:'same-origin',headers:{'content-type':'application/json',...options.headers}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(data.message || data.error || 'Não foi possível concluir agora. Tente novamente em instantes.');error.status=response.status;error.data=data;throw error;}
    return data;
  } finally {clearTimeout(timer);}
}
const refresh=()=>{if(location.hash.startsWith('#/checkout'))hooks?.render({preserveScroll:true});};
const currentAttempt = pending => attempt===pending && pending.signature===signature(hooks.getCart());
function updatePaymentControls() {
  const button=document.querySelector('.checkout-submit');
  if(button){button.disabled=busy||!config.paymentReady;button.textContent=submitLabel(Number(button.dataset.totalCents));}
  const error=document.querySelector('[data-config-error]');
  if(error)error.textContent=configFailed?'Não foi possível carregar o pagamento. Sua sacola está salva.':'';
  const retry=document.querySelector('[data-retry-config]');
  if(retry){retry.hidden=!configFailed;retry.disabled=configLoading;}
}
async function loadConfig() {
  if(configLoading)return;
  configLoading=true;configFailed=false;updatePaymentControls();
  try {config=await api('/api/config');configured=true;configFailed=!config.paymentReady;}
  catch {configured=false;configFailed=true;}
  finally {configLoading=false;updatePaymentControls();}
}
function setCheckoutStep(step) {
  snapshotCheckoutForm();
  checkoutStep=step;message='';refresh();
  document.querySelector(`[data-checkout-step="${step}"] h2`)?.focus();
}
function validateStep(form, step) {
  const section=form.querySelector(`[data-checkout-step="${step}"]`);
  return section ? validateCheckoutForm(section) : false;
}
async function prepareQr() {
  if(!order?.pix?.code || qrCode===order.pix.code)return;
  const pendingId=order.id,code=order.pix.code;qrCode=code;
  const current=()=>order?.id===pendingId&&order?.pix?.code===code;
  try {const {default:QRCode}=await import('./vendor/qr-code.js');const image=await QRCode.toDataURL(code,{width:256,margin:2,errorCorrectionLevel:'M',color:{dark:'#101828',light:'#ffffff'}});if(!current())return;qrImage=image;refresh();} catch {if(!current())return;qrCode='';message='Use o código copia e cola para pagar este Pix.';refresh();}
}
async function checkOrder() {
  if(!attempt?.orderId || pollRunning)return;
  const pending=attempt;pollRunning=true;
  try {
    const updated=await api('/api/orders/'+encodeURIComponent(pending.orderId));
    if(!currentAttempt(pending))return;
    const changed=JSON.stringify(order)!==JSON.stringify(updated)||!!message;
    order=updated;message='';
    if(order.status==='paid'){hooks.tracker.purchase(order);draft={};}
    if(changed)refresh();await prepareQr();
  }
  catch {if(currentAttempt(pending)){const next='Não conseguimos atualizar a confirmação agora. Seu Pix continua disponível; verificaremos novamente.';if(message!==next){message=next;refresh();}}}
  finally {pollRunning=false;schedulePoll();}
}
function schedulePoll(){clearTimeout(pollTimer);if(location.hash.startsWith('#/checkout')&&attempt?.orderId&&(!order||['waiting_payment','processing','payment_uncertain'].includes(order.status)))pollTimer=setTimeout(checkOrder,10000);}
export async function mountCheckout(){
  clearTimeout(pollTimer);
  const form=document.querySelector('#pix-checkout');
  if(form!==mountedForm){
    cleanupAddress?.();cleanupValidation?.();mountedForm=form;
    cleanupAddress=form&&!attempt?.orderRequest?mountAddressAutofill(form,{state:addressState,onUpdate:({name,value})=>{
      draft[name]=value;
      if(!validationError(name,value)){
        form.querySelector(`[name="${name}"]`)?.removeAttribute('aria-invalid');
        const error=form.querySelector(`[data-field-error="${name}"]`);if(error)error.textContent='';
      }
    }}):null;
    cleanupValidation=form&&!attempt?.orderRequest?mountCheckoutValidation(form):null;
  }
  if(!location.hash.startsWith('#/checkout'))return;
  if(!configured&&!configFailed)await loadConfig();
  if(attempt?.orderId&&!order)await checkOrder();
  else {prepareQr();schedulePoll();}
}
document.addEventListener('change',event=>{
  const target=event.target;
  if(target.matches('[data-checkout-action="size"]')){
    updateCart({type:'size',id:target.dataset.productId,size:target.dataset.size,value:target.value});return;
  }
  if(!target.matches('[data-checkout-gift],[data-checkout-shipping]'))return;
  if(cartLocked()){refresh();return;}
  snapshotCheckoutForm();
  if(target.matches('[data-checkout-gift]')){
    giftWrap=target.checked;
    try {sessionStorage.setItem(giftKey,String(giftWrap));} catch {}
  }else{
    if(!SHIPPING_OPTIONS.some(option=>option.id===target.value))return;
    shippingMethod=target.value;updateShippingMethod(shippingMethod);
  }
  refresh();
  document.querySelector(target.matches('[data-checkout-gift]')?'[data-checkout-gift]':'[data-checkout-shipping]:checked')?.focus({preventScroll:true});
});
document.addEventListener('click',event=>{
  if(event.target.closest('[data-checkout-back]')&&!cartLocked()&&checkoutStep>1){setCheckoutStep(checkoutStep-1);return;}
  const target=event.target.closest('button[data-checkout-action]');
  if(target)updateCart({type:target.dataset.checkoutAction,id:target.dataset.productId,size:target.dataset.size});
});
document.addEventListener('input',event=>{if(event.target.closest('#pix-checkout'))draft[event.target.name]=event.target.value;});
document.addEventListener('submit',async event=>{
  if(event.target.id!=='pix-checkout')return;
  event.preventDefault();if(busy)return;
  if(!attempt?.orderRequest){
    if(checkoutStep<4){
      if(validateStep(event.target,checkoutStep))setCheckoutStep(checkoutStep+1);
      return;
    }
    for(const step of [1,2]){
      if(!validateStep(event.target,step)){
        setCheckoutStep(step);
        validateStep(document.querySelector('#pix-checkout'),step);
        return;
      }
    }
  }
  if(!config.paymentReady)return;
  snapshotCheckoutForm();
  const cart=hooks.getCart(),products=hooks.getProducts(),sig=signature(cart);
  if(!attempt||attempt.signature!==sig)attempt={idempotencyKey:crypto.randomUUID(),signature:sig,giftWrap,shippingMethod};
  const clean=value=>String(value||'').replace(/\D/g,'');
  const customer={name:draft.name,email:draft.email,phone:clean(draft.phone),document:clean(draft.document),address:{zipCode:clean(draft.zipCode),street:draft.street,number:draft.number,complement:draft.complement||'',neighborhood:draft.neighborhood,city:draft.city,state:String(draft.state||'').toUpperCase()}};
  const recovering=!!attempt.orderRequest;
  if(!recovering)attempt.orderRequest={idempotencyKey:attempt.idempotencyKey,items:cart.map(line=>({id:line.id,size:line.size,quantity:line.qty})),customer,giftWrap,shippingMethod,tracking:hooks.tracker.getContext()};
  const pending=attempt;
  persist();busy=true;message='';refresh();
  if(!recovering){const items=itemsFor(cart,products);hooks.tracker.track('AddPaymentInfo',{items,valueCents:items.reduce((s,i)=>s+i.quantity*i.unitPriceCents,0)+delivery().cents});}
  try {
    const created=await api('/api/checkout',{method:'POST',body:JSON.stringify(pending.orderRequest)});
    if(!currentAttempt(pending))return;
    if(!created.id)throw new Error('Não recebemos a confirmação do pedido.');
    order=created;pending.orderId=order.id;delete pending.orderRequest;persist();await prepareQr();
  }catch(error){
    if(!currentAttempt(pending))return;
    message=error.message;
    if(error.data?.id){pending.orderId=error.data.id;order=error.data;delete pending.orderRequest;persist();}
    else if(error.status===400||error.status===422){attempt=null;persist();}
    else message='A conexão foi interrompida antes da confirmação. Toque em “Recuperar Pix do pedido” para consultar a mesma solicitação com segurança.';
  }
  finally{if(attempt===pending||attempt===null){busy=false;refresh();schedulePoll();}}
});
document.addEventListener('click',async event=>{
  if(event.target.closest('[data-retry-config]'))await loadConfig();
  if(event.target.closest('[data-retry-checkout]')&&order?.status==='refused'){attempt=null;order=null;checkoutStep=1;message='';persist();refresh();}
  if(event.target.closest('[data-refresh-payment]')){message='Verificando pagamento…';refresh();await checkOrder();}
  if(event.target.closest('[data-copy-pix]')&&order?.pix?.code){try{await navigator.clipboard.writeText(order.pix.code);hooks.toast('Código Pix copiado. Cole no aplicativo do seu banco.');}catch{document.querySelector('.pix-code-details')?.setAttribute('open','');document.querySelector('.pix-code-details textarea')?.select();hooks.toast('Selecione e copie o código Pix exibido.');}}
});
