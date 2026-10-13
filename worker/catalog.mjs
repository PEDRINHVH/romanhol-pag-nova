import catalog from '../public/data/catalog.json' with { type: 'json' };
import { normalizeProducts, priceOf } from '../public/catalog-utils.js';

const products = new Map(normalizeProducts(catalog).map(product => [product.id, product]));
export function checkoutItems(input) {
  if (!Array.isArray(input) || !input.length || input.length > 20) throw new Error('invalid_items');
  const seen = new Set();
  return input.map(item => {
    const product = products.get(String(item?.id));
    if (!product || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10) throw new Error('invalid_items');
    const variant = product.variants.find(v => item.variantId ? v.id === String(item.variantId) : v.size === String(item.size));
    if (!variant || variant.available === false || (item.size && variant.size !== String(item.size))) throw new Error('invalid_variant');
    const key = `${product.id}:${variant.id}`;
    if (seen.has(key)) throw new Error('duplicate_item');
    seen.add(key);
    const price = priceOf(product, variant.size);
    const unitPriceCents = Math.round(Number(price) * 100);
    if (price === null || !Number.isSafeInteger(unitPriceCents) || unitPriceCents < 1) throw new Error('unavailable_price');
    return { id: product.id, variantId: variant.id, name: product.name, size: variant.size, quantity: item.quantity, unitPriceCents };
  });
}
export const catalogProduct = id => products.get(String(id));
