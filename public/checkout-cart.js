import {escapeHTML as e, money, priceOf, productTitle} from './catalog-utils.js?v=20261014-protectcar';
import {isProtectCar, normalizeConfiguration, configurationKey, configurationLabel} from './protectcar-config.js';

const MAX_QUANTITY = 10;
const availableSizes = product => (product.variants || []).filter(variant => variant.available !== false && priceOf(product, variant.size) > 0);

export function changeCheckoutCart(cart, products, {type, id, size, value, configuration, configurationKey: key}) {
  const reject = message => ({cart, changed:false, message});
  const index = cart.findIndex(line => String(line.id) === String(id) && String(line.size) === String(size) && configurationKey(line.configuration) === (key ?? configurationKey(configuration)));
  if (index < 0) return reject('Este item não está mais na sacola.');
  const line = cart[index];
  if (type === 'remove') return {cart:cart.filter((_, i) => i !== index), changed:true, message:'Item removido da sacola.'};
  if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > MAX_QUANTITY) return reject('Quantidade inválida.');
  if (type === 'decrease') {
    if (line.qty === 1) return reject('Para retirar este item, use Remover.');
    return {cart:cart.map((item, i) => i === index ? {...item, qty:item.qty - 1} : item), changed:true, message:'Quantidade atualizada.'};
  }
  const product = products.find(item => String(item.id) === String(id));
  if (!product) return reject('Produto indisponível.');
  if (isProtectCar(product)) {
    try { normalizeConfiguration(product, size, line.configuration); } catch { return reject('Configuração do veículo inválida. Selecione novamente o produto.'); }
    if (type === 'size') return reject('Para alterar o kit, configure novamente o produto.');
  }
  if (type === 'increase') {
    if (!availableSizes(product).some(variant => String(variant.size) === String(size))) return reject('Tamanho indisponível.');
    if (line.qty === MAX_QUANTITY) return reject('Limite de 10 unidades por tamanho.');
    return {cart:cart.map((item, i) => i === index ? {...item, qty:item.qty + 1} : item), changed:true, message:'Quantidade atualizada.'};
  }
  if (type !== 'size') return reject('Alteração inválida.');
  const nextSize = String(value ?? '');
  if (nextSize === String(size)) return reject('');
  if (!availableSizes(product).some(variant => String(variant.size) === nextSize)) return reject('Tamanho indisponível.');
  const target = cart.findIndex((item, i) => i !== index && String(item.id) === String(id) && String(item.size) === nextSize);
  if (target >= 0 && (!Number.isInteger(cart[target].qty) || cart[target].qty < 1 || cart[target].qty + line.qty > MAX_QUANTITY)) return reject('Limite de 10 unidades por tamanho.');
  const updated = cart.map((item, i) => i === target ? {...item, qty:item.qty + line.qty} : i === index ? {...item, size:nextSize} : item);
  return {cart:target >= 0 ? updated.filter((_, i) => i !== index) : updated, changed:true, message:'Tamanho atualizado.'};
}

export function renderCheckoutItems(lines, {media = () => '', locked = false} = {}) {
  return lines.map(({id, size, qty, product, configuration}) => {
    const configured = isProtectCar(product);
    const title = productTitle(product), description = configured ? configurationLabel(configuration) : [product.color, product.finish].filter(Boolean).join(' · ');
    const attributes = `data-product-id="${e(id)}" data-size="${e(size)}" data-configuration-key="${e(configurationKey(configuration))}"`;
    const label = configured ? `${title}, ${size}, ${description}` : `${title}, tamanho ${size}`;
    const sizes = availableSizes(product), currentAvailable = sizes.some(variant => String(variant.size) === String(size));
    const button = (action, text, accessible, disabled = false) => `<button type="button" data-checkout-action="${action}" ${attributes} aria-label="${e(`${accessible}: ${label}`)}"${locked || disabled ? ' disabled' : ''}>${text}</button>`;
    return `<div class="checkout-item checkout-cart-item"><div class="checkout-thumb">${media(product)}</div><div class="checkout-cart-description"><h3>${e(title)}</h3>${description ? `<p>${e(description)}</p>` : ''}<strong class="checkout-cart-price">${money(priceOf(product, size) * qty)}</strong></div><div class="checkout-cart-controls">${configured ? `<p class="checkout-cart-size"><span>Kit</span><strong>${e(size)}</strong></p>` : `<label class="checkout-cart-size"><span>Tamanho</span><select data-checkout-action="size" ${attributes} aria-label="${e(`Tamanho: ${label}`)}"${locked ? ' disabled' : ''}>${!currentAvailable ? `<option value="${e(size)}" selected disabled>${e(size)} — indisponível</option>` : ''}${sizes.map(variant => `<option value="${e(variant.size)}"${String(variant.size) === String(size) ? ' selected' : ''}>${e(variant.size)}</option>`).join('')}</select></label>`}<div class="checkout-cart-quantity" role="group" aria-label="${e(`Quantidade: ${label}`)}">${button('decrease', '−', 'Diminuir quantidade', qty <= 1)}<span aria-label="${e(`${qty} unidades`)}">${qty}</span>${button('increase', '+', 'Aumentar quantidade', qty >= MAX_QUANTITY || !currentAvailable)}</div>${button('remove', 'Remover', 'Remover')}</div></div>`;
  }).join('');
}

export function renderCheckoutGift({giftWrap = false, locked = false} = {}) {
  return `<div class="checkout-gift"><label><input type="checkbox" data-checkout-gift${giftWrap ? ' checked' : ''}${locked ? ' disabled' : ''} aria-describedby="checkout-gift-note"><span>Embalar para presente <strong>Grátis</strong></span></label><p id="checkout-gift-note">Seu pedido será preparado para presente.</p></div>`;
}
