import { escapeHTML, money, priceOf } from './catalog-utils.js';

// Mount after the primary CTA is configured; dispose before every page render.
export function mountProductSticky({ product, selectedSize = '', price = priceOf(product, selectedSize), root = document, view = window }) {
  const primary = root.querySelector('[data-add-cart]');
  if (!primary || !product || !root.body) return () => {};
  const bar = root.createElement('section');
  bar.className = 'product-sticky';
  bar.setAttribute('aria-label', 'Compra do produto');
  bar.hidden = true;
  const variant = product.variants?.find(item => String(item.size) === String(selectedSize));
  const unavailable = selectedSize && (variant?.available === false || (product.variants?.length && !variant));
  const hasPrice = price !== null && price !== undefined && Number.isFinite(Number(price)) && Number(price) > 0;
  bar.innerHTML = `<div class="product-sticky-inner"><div class="product-sticky-info"><strong>${escapeHTML(product.name)}</strong><span>${escapeHTML(hasPrice ? money(price) : 'Preço em preparação')} · ${escapeHTML(selectedSize ? `Tamanho ${selectedSize}${unavailable ? ' indisponível' : ''}` : 'Escolha o tamanho')}</span></div><button type="button" class="button button-blue product-sticky-buy">${hasPrice ? (selectedSize && !unavailable ? 'Comprar no Pix' : 'Escolher tamanho') : 'Preço em preparação'}</button></div>`;
  const buy = bar.querySelector('button');
  buy.disabled = primary.disabled || !hasPrice;
  const activate = () => {
    if (primary.disabled || !hasPrice) return;
    if (unavailable) {
      const sizes = root.querySelector('.sizes');
      sizes?.scrollIntoView({ behavior: view.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
      root.querySelector('.size-button:not(:disabled)')?.focus({ preventScroll: true });
      return;
    }
    primary.click();
  };
  buy.addEventListener('click', activate);
  root.body.append(bar);
  root.body.classList.add('has-product-sticky');
  const sync = () => {
    const hidden = primary.getBoundingClientRect().bottom > 0;
    if (hidden && !bar.hidden && bar.contains(root.activeElement)) primary.focus({ preventScroll: true });
    bar.hidden = hidden;
  };
  const observer = view.IntersectionObserver ? new view.IntersectionObserver(sync, { threshold: [0, 1] }) : null;
  observer?.observe(primary);
  // Scroll also covers jumps from below the viewport to above it, and older browsers.
  view.addEventListener('scroll', sync, { passive: true });
  view.addEventListener('resize', sync);
  sync();
  return () => {
    observer?.disconnect();
    view.removeEventListener('scroll', sync);
    view.removeEventListener('resize', sync);
    buy.removeEventListener('click', activate);
    bar.remove();
    root.body.classList.remove('has-product-sticky');
  };
}
