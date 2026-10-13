export const money = value => value === null || value === undefined ? 'Preço em preparação' : Number(value).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export const brandText = value => String(value ?? '').replace(/norisk|nolimit\b|no limite/gi, 'No Limite');
export const isForce = product => product.category === 'capacetes' && /force\s*-?\s*(ii|2)/i.test(`${product.model} ${product.name}`);
export const priceOf = (product, size) => {
  if (isForce(product)) return 179.90;
  const variant = size ? product.variants?.find(v => String(v.size) === String(size)) : null;
  const value = variant?.price ?? product.price;
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
};
export const values = (products, key) => [...new Set(products.flatMap(p => key === 'size' ? (p.variants || []).map(v => v.size) : [p[key]]).filter(Boolean))].sort((a,b) => String(a).localeCompare(String(b),'pt-BR',{numeric:true}));
export function facetValues(products, filters, key) {
  const context = {...filters};
  delete context[key];
  if (key === 'model' && !context.category && filters.model) {
    const categories = values(products.filter(p => p.model === filters.model), 'category');
    if (categories.length === 1) context.category = categories[0];
  }
  return values(filterProducts(products, context), key);
}
export const clearedFilters = filters => Object.fromEntries(Object.entries(filters).filter(([key]) => ['category','q','sort'].includes(key)));
export function filterProducts(products, filters = {}) {
  const query = normalize(filters.q);
  let result = products.filter(p => (!query || normalize(`${p.name} ${p.model} ${p.category} ${p.color}`).includes(query)) && ['category','model','color','finish'].every(k => !filters[k] || p[k] === filters[k]) && (!filters.size || (p.variants || []).some(v => String(v.size) === String(filters.size))));
  if (filters.sort === 'price-asc') result.sort((a,b) => (priceOf(a) ?? Infinity) - (priceOf(b) ?? Infinity));
  if (filters.sort === 'price-desc') result.sort((a,b) => (priceOf(b) ?? -Infinity) - (priceOf(a) ?? -Infinity));
  if (filters.sort === 'name') result.sort((a,b) => a.name.localeCompare(b.name,'pt-BR'));
  if (filters.sort === 'recent') result.reverse();
  return result;
}
export function productImage(product, manifest = {}, index = 0) {
  const candidate = product.images?.[index];
  const original = typeof candidate === 'string' ? candidate : candidate?.url;
  const resolved = manifest.byUrl?.[original];
  if (['edited','clean'].includes(resolved?.status) && /^\/assets\//.test(resolved.url)) return resolved.url;
  if (resolved?.status === 'original' && /^(\/assets\/|https:\/\/)/.test(resolved.url)) return resolved.url;
  return null;
}
export function approvedImageIndex(product, manifest = {}, preferred = null) {
  if (preferred !== null && productImage(product, manifest, preferred)) return preferred;
  const index = (product.images || []).findIndex((_,i) => productImage(product,manifest,i));
  return index < 0 ? null : index;
}
export const itemCountLabel = count => `${count} ${count === 1 ? 'item' : 'itens'}`;
export function findProductByPath(products, path) {
  const prefix='/produto/';
  if (!path.startsWith(prefix)) return undefined;
  let slug;
  try {slug=decodeURIComponent(path.slice(prefix.length));} catch {return undefined;}
  const normalized = value => String(value).replace(/nolimit/g,'no-limite');
  return products.find(product => product.slug === slug) || products.find(product => normalized(product.slug) === normalized(slug));
}
export function normalizeProducts(data) {
  const input = Array.isArray(data) ? data : data.products || [];
  return input.map((p, index) => ({...p, id:String(p.id ?? p.slug ?? index), slug:p.slug || String(p.id ?? index), name:brandText(p.name || 'Produto No Limite'), category:p.category || 'acessorios', model:brandText(p.model || ''), description:brandText(p.description || ''), variants:(p.variants || []).map(v => ({...v,id:String(v.id ?? v.size),size:String(v.size || 'Único')}))}));
}
