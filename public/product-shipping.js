export const SHIPPING_OPTIONS = Object.freeze([
  Object.freeze({ id: 'standard', label: 'Correios', days: '4–8 dias úteis', cents: 0 }),
  Object.freeze({ id: 'sedex', label: 'Sedex', days: '2–4 dias úteis', cents: 5781 }),
]);
const STORAGE_KEY = 'norisk.product-shipping.v1';
const METHOD_KEY = 'norisk.shipping-method.v1';
const digits = value => String(value ?? '').replace(/\D/g, '');
export const formatShippingZip = value => digits(value).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');
export const isValidShippingZip = value => /^\d{5}-?\d{3}$/.test(String(value ?? '').trim());
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const price = cents => cents === 0 ? 'Grátis' : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
let quote = null;
let restored = false;
let activeCleanup;
let shippingMethod;

export function getShippingMethod() {
  if (!shippingMethod) {
    try { shippingMethod = globalThis.sessionStorage?.getItem(METHOD_KEY); } catch { /* Storage optional. */ }
    shippingMethod = shippingMethod === 'sedex' ? 'sedex' : 'standard';
  }
  return shippingMethod;
}

export function normalizeShippingAddress(data, zipCode) {
  if (!isValidShippingZip(zipCode) || !data || typeof data.localidade !== 'string' || !data.localidade.trim() || !/^[A-Z]{2}$/.test(data.uf)) return null;
  return { zipCode: digits(zipCode), street: typeof data.logradouro === 'string' ? data.logradouro : '',
    neighborhood: typeof data.bairro === 'string' ? data.bairro : '', city: data.localidade, state: data.uf };
}

function persist() {
  try {
    if (quote) globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(quote));
    else globalThis.sessionStorage?.removeItem(STORAGE_KEY);
  } catch { /* Storage may be blocked; the calculator still works. */ }
}

export function getShippingQuote() {
  if (!restored) {
    restored = true;
    try {
      const saved = JSON.parse(globalThis.sessionStorage?.getItem(STORAGE_KEY) || 'null');
      const address = saved && normalizeShippingAddress({ logradouro: saved.street, bairro: saved.neighborhood, localidade: saved.city, uf: saved.state }, saved.zipCode);
      if (address) quote = { ...address, shippingMethod: getShippingMethod() };
    } catch { /* Invalid or unavailable storage is ignored. */ }
  }
  return quote ? { ...quote } : null;
}

export function updateShippingMethod(method) {
  if (!SHIPPING_OPTIONS.some(option => option.id === method)) return false;
  getShippingQuote();
  shippingMethod = method;
  try { globalThis.sessionStorage?.setItem(METHOD_KEY, method); } catch { /* Storage optional. */ }
  if (quote) quote = { ...quote, shippingMethod: method };
  persist();
  return true;
}

export async function lookupShippingAddress(zipCode, { fetchImpl = globalThis.fetch, signal, timeoutMs = 6000 } = {}) {
  if (!isValidShippingZip(zipCode)) return { status: 'invalid' };
  const controller = new AbortController();
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const abort = () => { controller.abort(); rejectAbort(new DOMException('Consulta cancelada', 'AbortError')); };
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    if (signal?.aborted) { abort(); return await aborted; }
    const request = (async () => {
      const response = await fetchImpl(`https://viacep.com.br/ws/${digits(zipCode)}/json/`, { signal: controller.signal });
      if (!response.ok) throw new Error('CEP unavailable');
      const data = await response.json();
      if (data.erro === true || data.erro === 'true') return { status: 'not-found' };
      const address = normalizeShippingAddress(data, zipCode);
      if (!address) throw new Error('Invalid CEP response');
      return { status: 'success', address };
    })();
    return await Promise.race([request, aborted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function resultMarkup(value) {
  if (!value) return '';
  const address = [value.street, value.neighborhood, `${value.city} — ${value.state}`].filter(Boolean).join(', ');
  return `<p class="product-shipping__success">Você ganhou frete grátis</p>
    <p class="product-shipping__address">${escape(address)}</p>
    <fieldset class="product-shipping__options"><legend>Escolha a entrega</legend>${SHIPPING_OPTIONS.map(option => `
      <label class="product-shipping__option"><input type="radio" name="productShippingMethod" value="${option.id}" ${value.shippingMethod === option.id ? 'checked' : ''}>
      <span><strong>${option.label}</strong><small>${option.days}</small></span><b>${price(option.cents)}</b></label>`).join('')}</fieldset>`;
}

export function renderProductShipping() {
  const value = getShippingQuote();
  return `<section class="product-shipping" data-product-shipping aria-label="Calcular frete e prazo">
    <label class="product-shipping__title" for="product-shipping-zip">Frete e prazo de entrega</label>
    <div class="product-shipping__controls"><input id="product-shipping-zip" data-shipping-zip inputmode="numeric" autocomplete="postal-code" maxlength="9" placeholder="Digite seu CEP" aria-describedby="product-shipping-status" value="${value ? formatShippingZip(value.zipCode) : ''}">
    <button type="button" data-shipping-submit>Calcular frete</button></div>
    <p id="product-shipping-status" class="product-shipping__status" data-shipping-status role="status" aria-live="polite" aria-atomic="true"></p>
    <div data-shipping-result>${resultMarkup(value)}</div></section>`;
}

/** Mount after rendering; the previous mount is disposed to cancel stale requests. */
export function mountProductShipping(root = document, { lookup = lookupShippingAddress, onChange = () => {} } = {}) {
  activeCleanup?.();
  const card = root.matches?.('[data-product-shipping]') ? root : root.querySelector('[data-product-shipping]');
  if (!card) return () => {};
  const input = card.querySelector('[data-shipping-zip]'), button = card.querySelector('[data-shipping-submit]');
  const status = card.querySelector('[data-shipping-status]'), result = card.querySelector('[data-shipping-result]');
  let controller, revision = 0, disposed = false;
  const announce = (text, invalid = false) => { status.textContent = text; input.setAttribute('aria-invalid', String(invalid)); };
  const cancel = () => { revision++; controller?.abort(); button.disabled = false; button.textContent = 'Calcular frete'; card.removeAttribute('aria-busy'); };
  const edit = () => {
    cancel();
    input.value = formatShippingZip(input.value);
    result.innerHTML = '';
    announce('');
    quote = null;
    persist();
    onChange(null);
  };
  const run = async () => {
    cancel();
    const zipCode = digits(input.value);
    if (!isValidShippingZip(zipCode)) { announce('Informe um CEP com 8 dígitos.', true); input.focus(); return; }
    const id = revision;
    controller = new AbortController();
    button.disabled = true;
    button.textContent = 'Consultando…';
    card.setAttribute('aria-busy', 'true');
    announce('Consultando o CEP…');
    result.innerHTML = '';
    try {
      const response = await lookup(zipCode, { signal: controller.signal });
      if (disposed || id !== revision) return;
      if (response.status === 'not-found') { announce('CEP não encontrado. Confira e tente novamente.', true); return; }
      if (response.status !== 'success') throw new Error('Invalid CEP');
      quote = { ...response.address, shippingMethod: getShippingMethod() };
      persist();
      result.innerHTML = resultMarkup(quote);
      announce('CEP encontrado. Confira o endereço e escolha a entrega.');
      onChange(getShippingQuote());
    } catch {
      if (!disposed && id === revision) announce('Não foi possível consultar o CEP. Tente calcular novamente.');
    } finally {
      if (!disposed && id === revision) { button.disabled = false; button.textContent = 'Calcular frete'; card.removeAttribute('aria-busy'); }
    }
  };
  const enter = event => { if (event.key === 'Enter') { event.preventDefault(); run(); } };
  const select = event => { if (event.target.name === 'productShippingMethod' && updateShippingMethod(event.target.value)) onChange(getShippingQuote()); };
  input.addEventListener('input', edit);
  input.addEventListener('keydown', enter);
  button.addEventListener('click', run);
  result.addEventListener('change', select);
  const cleanup = () => {
    disposed = true;
    cancel();
    input.removeEventListener('input', edit);
    input.removeEventListener('keydown', enter);
    button.removeEventListener('click', run);
    result.removeEventListener('change', select);
    if (activeCleanup === cleanup) activeCleanup = undefined;
  };
  activeCleanup = cleanup;
  return cleanup;
}
