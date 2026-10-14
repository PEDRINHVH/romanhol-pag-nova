import {normalize, priceOf} from './catalog-utils.js?v=20261014-norisk-products';

const modelKey = value => normalize(value).trim().replace(/\s+/g, ' ');
const compare = (a, b) => String(a).localeCompare(String(b), 'pt-BR', {numeric:true});
const colors = [
  [/\brevo rosa\b/, 'Revo rosa'], [/\bdourad[ao]\b/, 'Dourada'],
  [/\bespel(?:hada|ahda)\b/, 'Espelhada'], [/\bcamaleao\b/, 'Camaleão'],
  [/\bfume\b/, 'Fumê'], [/\bazul\b/, 'Azul'], [/\bcinza\b/, 'Cinza'],
  [/\bvermelh[ao]\b/, 'Vermelha'], [/\brox[ao]\b/, 'Roxa'], [/\bros[ao]\b/, 'Rosa'],
  [/\b(cristal|transparente|incolor)\b/, 'Cristal'],
];

/** Exterior visors only; names distinguish finishes from generic catalogue colors. */
export function visorColor(product) {
  const name = normalize(product.fullName || product.name);
  if (product.category !== 'acessorios' || normalize(product.subcategory) !== 'viseiras'
    || !/\bviseira\b/.test(name)
    || /\b(suporte|mecanismo|reparo|solar|intern[ao]|pelicula|pinlock|filme)\b/.test(name)) return null;
  return colors.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

/**
 * Optional offers for full helmet products, grouped by exact catalogue model.
 * Generation aliases are excluded except FORCE visors for FORCE II, confirmed by the store owner.
 * References are preserved; callers can use product.variants to select a SKU.
 * Unknown stock is retained, while explicitly unavailable SKUs are excluded.
 */
export function visorOffers(products, helmets) {
  const groups = new Map();
  for (const helmet of helmets) {
    const key = modelKey(helmet.model);
    if (helmet.category !== 'capacetes' || !key) continue;
    if (!groups.has(key)) groups.set(key, {model:key.toUpperCase(), helmets:[], options:[]});
    const group = groups.get(key);
    if (!group.helmets.some(item => String(item.id) === String(helmet.id))) group.helmets.push(helmet);
  }
  for (const product of products) {
    // Store owner explicitly confirmed FORCE visors also fit FORCE II in this conversation.
    const compatibleGroups = [...groups.entries()].filter(([key]) => key === modelKey(product.model) || (key === 'force ii' && modelKey(product.model) === 'force')).map(([, group]) => group);
    if (!compatibleGroups.length) continue;
    const color = visorColor(product);
    const pricedSKU = (product.variants || []).some(variant => variant.available !== false && priceOf(product, variant.size) > 0);
    if (!color || !(priceOf(product) > 0) || !pricedSKU || product.available === false) continue;
    for (const group of compatibleGroups) {
      if (!group.options.some(option => String(option.product.id) === String(product.id))) group.options.push({product, color});
    }
  }
  return [...groups.values()].filter(group => group.options.length).sort((a, b) => compare(a.model, b.model)).map(group => ({
    ...group,
    helmets:group.helmets.sort((a, b) => compare(a.id, b.id)),
    options:group.options
      .sort((a, b) => compare(a.color, b.color) || priceOf(a.product) - priceOf(b.product) || compare(a.product.id, b.product.id))
      .filter((option, index, options) => !options.slice(0, index).some(previous => previous.color === option.color && normalize(previous.product.fullName || previous.product.name) === normalize(option.product.fullName || option.product.name))),
  }));
}
