import {escapeHTML as e, money, priceOf} from './catalog-utils.mjs';

const sessionKey = 'nolimit:checkout:attempt';
const readAttempt = () => {try {return JSON.parse(sessionStorage.getItem(sessionKey));} catch {return null;}};
let attempt = readAttempt(), draft = {}, order = null, busy = false, message = '', pollTimer, pollRunning = false;
let config = {paymentReady:false, shippingCents:null}, configured = false, qrCode = '', qrImage = '';
let hooks;
const persist = () => {try {sessionStorage.setItem(sessionKey, JSON.stringify(attempt));} catch {}};
const signature = cart => JSON.stringify(cart.map(({id,size,qty}) => [id,size,qty]).sort());
const field = (name,label,attrs='',wide=false) => `<label class="checkout-field ${wide?'field-wide':''}"><span>${label}</span><input name="${name}" value="${e(draft[name] || '')}" ${attrs}></label>`;
const itemsFor = (cart,products) => cart.map(line => {const p=products.find(p=>p.id===line.id);return {id:line.id,quantity:line.qty,unitPriceCents:Math.round(priceOf(p,line.size)*100)};});
const statusCopy = {waiting_payment:['Pague com Pix','Abra o aplicativo do seu banco e escolha Pix. Escaneie o QR Code ou use o código copia e cola.'],paid:['Pagamento confirmado','Recebemos a confirmação do seu Pix. Guarde o número do pedido abaixo.'],refused:['Pagamento não concluído','Revise seus dados antes de tentar novamente.'],refunded:['Pagamento devolvido','A devolução foi informada pelo Pagar.me.'],processing:['Gerando Pix','Aguarde a confirmação do Pagar.me.'],payment_uncertain:['Pagamento em verificação','Aguardando a resposta do Pagar.me. Não gere outro Pix.']};

export function configureCheckout(options) {hooks=options;}
export function snapshotCheckoutForm() {if(order)return;const form=document.querySelector('#pix-checkout');if(form)draft=Object.fromEntries(new FormData(form));}
export function checkoutPage({cart,products,media,addons}) {
  snapshotCheckoutForm();
  const cartSignature=signature(cart);
  if(attempt && attempt.signature!==cartSignature){attempt=null;order=null;qrImage='';qrCode='';persist();}
  const lines=cart.map(line=>({...line,product:products.find(p=>p.id===line.id)})).filter(line=>line.product);
  if(!lines.length)return '<div class="wrap checkout-empty"><h1>Sua sacola está vazia.</h1><a class="button button-dark" href="#/catalogo">Ver produtos</a></div>';
  const subtotal=lines.reduce((total,line)=>total+Math.round(priceOf(line.product,line.size)*100)*line.qty,0);
  const total=order?.totalCents ?? subtotal+(config.shippingCents || 0);
  const itemCount=lines.reduce((count,line)=>count+line.qty,0);
  const summary=`<aside class="checkout-summary"><div class="checkout-section-title"><h2>Resumo do pedido</h2><a href="#/sacola">Editar</a></div><details class="checkout-items"><summary>${itemCount} ${itemCount===1?'item':'itens'} no pedido<span>Ver itens</span></summary>${lines.map(line=>`<div class="checkout-item"><div class="checkout-thumb">${media(line.product)}</div><div><h3>${e(line.product.name)}</h3><p>Tamanho ${e(line.size)} · Qtd. ${line.qty}</p></div><strong>${money(priceOf(line.product,line.size)*line.qty)}</strong></div>`).join('')}</details><dl class="checkout-totals"><div><dt>Produtos</dt><dd>${money(subtotal/100)}</dd></div><div><dt>Frete</dt><dd class="free-shipping">Grátis</dd></div><div class="checkout-total"><dt>Total no Pix</dt><dd>${money(total/100)}</dd></div></dl><div class="pix-only-note"><span>Oferta de aniversário exclusiva no Pix.</span></div><p class="checkout-protection">Pagamento processado pelo Pagar.me.</p></aside>`;
  let main;
  if(order){
    const [title,description]=statusCopy[order.status] || statusCopy.processing;
    main=`<section class="checkout-panel pix-result" aria-live="polite"><span class="pix-result-mark">${order.status==='paid'?'✓':'◇'}</span><span class="eyebrow">${order.status==='paid'?'PAGAMENTO CONFIRMADO':'PAGAMENTO VIA PIX'}</span><h2>${title}</h2><p>${description}</p><strong class="pix-amount">${money(order.totalCents/100)}</strong>${order.status==='waiting_payment'&&order.pix?.code?`<div class="pix-qr">${qrImage?`<img src="${e(qrImage)}" alt="QR Code Pix deste pedido" width="224" height="224">`:'<span>Preparando QR Code…</span>'}</div><button type="button" class="button button-dark pix-copy" data-copy-pix>Copiar código Pix</button><details class="pix-code-details"><summary>Ver código copia e cola</summary><textarea aria-label="Código Pix" readonly>${e(order.pix.code)}</textarea></details>${order.pix.expiresAt?`<p class="pix-expiry">Válido até ${e(new Date(order.pix.expiresAt).toLocaleString('pt-BR'))}.</p>`:''}<p class="pix-waiting"><span></span>Aguardando a confirmação do banco</p>`:''}<p class="order-reference">Pedido <strong>${e(order.id)}</strong></p><p class="checkout-error" role="status">${e(message)}</p>${order.status==='refused'?'<button type="button" class="button button-dark" data-retry-checkout>Revisar dados e tentar novamente</button>':order.status!=='paid'?'<button type="button" class="text-link" data-refresh-payment>Já paguei · verificar pagamento</button>':''}<a class="text-link pix-back" href="#/catalogo">Voltar à loja</a></section>`;
  }else{
    main=`<form id="pix-checkout" class="checkout-panel"><div class="checkout-section-title"><span class="step-number">1</span><h2>Seus dados</h2></div><p class="checkout-section-note">Dados para pagamento e entrega. Não é preciso criar uma conta.</p><div class="checkout-fields">${field('name','Nome completo','autocomplete="name" required minlength="5" maxlength="120"',true)}${field('email','E-mail','type="email" autocomplete="email" required maxlength="180"',true)}${field('document','CPF','inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" required maxlength="14"')}${field('phone','Celular com DDD','type="tel" autocomplete="tel-national" placeholder="(11) 99999-9999" required maxlength="17"')}</div><div class="checkout-section-title delivery-title"><span class="step-number">2</span><h2>Endereço de entrega</h2><span class="free-shipping">Frete grátis</span></div><div class="checkout-fields">${field('zipCode','CEP','inputmode="numeric" autocomplete="postal-code" placeholder="00000-000" required maxlength="9"')}${field('state','Estado (UF)','autocomplete="address-level1" placeholder="SP" required minlength="2" maxlength="2"')}${field('street','Rua ou avenida','autocomplete="address-line1" required maxlength="160"',true)}${field('number','Número','autocomplete="off" required maxlength="20"')}${field('complement','Complemento (opcional)','autocomplete="address-line2" maxlength="80"')}${field('neighborhood','Bairro','autocomplete="address-level3" required maxlength="80"')}${field('city','Cidade','autocomplete="address-level2" required maxlength="80"')}</div><div class="checkout-method"><span class="pix-method-symbol">◇</span><div><strong>Pix à vista</strong><span>Pagamento à vista pelo Pagar.me</span></div><span class="method-selected">✓</span></div><p class="checkout-error" role="alert">${e(message)}</p><button class="button button-dark checkout-submit" type="submit" ${busy||!config.paymentReady?'disabled':''}>${busy?'Gerando Pix…':!configured?'Carregando pagamento…':!config.paymentReady?'Pagamento temporariamente indisponível':`Gerar Pix de ${money(total/100)}`}</button><p class="checkout-privacy">Ao continuar, seus dados serão usados para processar e entregar seu pedido. <a href="#/privacidade">Saiba mais</a>.</p></form>`;
  }
  return `<div class="wrap checkout-page"><div class="checkout-breadcrumb"><a href="#/sacola">← Sacola</a><span>Pagamento via Pagar.me</span></div><div class="checkout-heading"><h1>Finalizar compra</h1><p>Pix à vista · <strong>Frete grátis para todo o Brasil.</strong></p></div><div class="checkout-layout"><div>${main}${!order?addons(lines.map(line=>line.product)):''}</div>${summary}</div></div>`;
}

async function api(path,options={}) {
  const response=await fetch(path,{...options,credentials:'same-origin',headers:{'content-type':'application/json',...options.headers}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.message || data.error || 'Não foi possível concluir agora. Tente novamente em instantes.');error.status=response.status;error.data=data;throw error;}
  return data;
}
const refresh=()=>hooks?.render({preserveScroll:true});
async function prepareQr() {
  if(!order?.pix?.code || qrCode===order.pix.code)return;
  qrCode=order.pix.code;
  try {const {default:QRCode}=await import('./vendor/qr-code.mjs');qrImage=await QRCode.toDataURL(qrCode,{width:256,margin:2,errorCorrectionLevel:'M',color:{dark:'#101828',light:'#ffffff'}});refresh();} catch {qrCode='';message='Use o código copia e cola para pagar este Pix.';refresh();}
}
async function checkOrder() {
  if(!attempt?.orderId || pollRunning)return;
  pollRunning=true;
  try {order=await api('/api/orders/'+encodeURIComponent(attempt.orderId));message='';if(order.status==='paid')hooks.tracker.purchase(order);refresh();await prepareQr();}
  catch {message='Não conseguimos atualizar a confirmação agora. Seu Pix continua disponível; verificaremos novamente.';refresh();}
  finally {pollRunning=false;schedulePoll();}
}
function schedulePoll(){clearTimeout(pollTimer);if(location.hash.startsWith('#/checkout')&&attempt?.orderId&&(!order||['waiting_payment','processing','payment_uncertain'].includes(order.status)))pollTimer=setTimeout(checkOrder,10000);}
export async function mountCheckout(){
  clearTimeout(pollTimer);
  if(!location.hash.startsWith('#/checkout'))return;
  if(!configured){configured=true;try {config=await api('/api/config');}catch {message='Pagamento indisponível no momento. Sua sacola está salva.';}refresh();}
  if(attempt?.orderId&&!order)await checkOrder();
  else {prepareQr();schedulePoll();}
}
document.addEventListener('input',event=>{if(event.target.closest('#pix-checkout'))draft[event.target.name]=event.target.value;});
document.addEventListener('submit',async event=>{
  if(event.target.id!=='pix-checkout')return;
  event.preventDefault();if(busy)return;snapshotCheckoutForm();
  const cart=hooks.getCart(),products=hooks.getProducts(),sig=signature(cart);
  if(!attempt||attempt.signature!==sig)attempt={idempotencyKey:crypto.randomUUID(),signature:sig};
  persist();busy=true;message='';refresh();
  const clean=value=>String(value||'').replace(/\D/g,'');
  const customer={name:draft.name,email:draft.email,phone:clean(draft.phone),document:clean(draft.document),address:{zipCode:clean(draft.zipCode),street:draft.street,number:draft.number,complement:draft.complement||'',neighborhood:draft.neighborhood,city:draft.city,state:String(draft.state||'').toUpperCase()}};
  const items=itemsFor(cart,products);
  hooks.tracker.track('AddPaymentInfo',{items,valueCents:items.reduce((s,i)=>s+i.quantity*i.unitPriceCents,0)+(config.shippingCents||0)});
  try {
    order=await api('/api/checkout',{method:'POST',body:JSON.stringify({idempotencyKey:attempt.idempotencyKey,items:cart.map(line=>({id:line.id,size:line.size,quantity:line.qty})),customer,tracking:hooks.tracker.getContext()})});
    attempt.orderId=order.id;persist();draft={};await prepareQr();
  }catch(error){message=error.message;if(error.data?.id){attempt.orderId=error.data.id;order=error.data;persist();}if(error.status===400||error.status===422){attempt=null;persist();}}
  finally{busy=false;refresh();schedulePoll();}
});
document.addEventListener('click',async event=>{
  if(event.target.closest('[data-retry-checkout]')&&order?.status==='refused'){attempt=null;order=null;message='';persist();refresh();}
  if(event.target.closest('[data-refresh-payment]')){message='Verificando pagamento…';refresh();await checkOrder();}
  if(event.target.closest('[data-copy-pix]')&&order?.pix?.code){try{await navigator.clipboard.writeText(order.pix.code);hooks.toast('Código Pix copiado. Cole no aplicativo do seu banco.');}catch{document.querySelector('.pix-code-details')?.setAttribute('open','');document.querySelector('.pix-code-details textarea')?.select();hooks.toast('Selecione e copie o código Pix exibido.');}}
});
