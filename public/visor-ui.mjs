import {escapeHTML as e, money, priceOf} from './catalog-utils.mjs';
import {visorOffers} from './visor-utils.mjs';

const swatch = color => {
  const label = color.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if (/azul/.test(label)) return 'blue';
  if (/rosa/.test(label)) return 'pink';
  if (/roxa/.test(label)) return 'purple';
  if (/vermelha/.test(label)) return 'red';
  if (/dourad/.test(label)) return 'gold';
  if (/iridium|irid|camale|furta/.test(label)) return 'iridium';
  if (/prat|crom|espelh/.test(label)) return 'silver';
  if (/fume|preta|preto|cinza/.test(label)) return 'smoke';
  return 'clear';
};

export function visorBump(products, helmets, {choices, cart, media, link}) {
  const selectedHelmets = helmets.filter(p => p?.category === 'capacetes');
  if (!selectedHelmets.length) return '';
  const groups = visorOffers(products, selectedHelmets);
  const missing = [...new Set(selectedHelmets.filter(p => !groups.some(g => g.helmets.includes(p))).map(p => p.model || 'este modelo'))];
  if (!groups.length) return `<section class="visor-bump" aria-label="Compatibilidade de viseiras"><p class="visor-pending">Não há viseira colorida com compatibilidade confirmada para ${e(missing.join(', '))} disponível nesta loja.</p></section>`;
  return `<section class="visor-bump" aria-label="Viseiras adicionais"><div class="visor-heading"><span class="eyebrow">ADICIONAL OPCIONAL</span><h2>Viseira adicional</h2><p>Escolha a cor e toque em “Adicionar viseira”. O valor será somado à sacola.</p></div>${groups.map(group => {
    const option = group.options.find(o => o.product.id === choices.get(group.model)) || group.options[0];
    const p = option.product, size = p.variants.find(v => v.available !== false && priceOf(p,v.size) > 0).size, added = cart.some(line => line.id === p.id);
    return `<div class="visor-offer"><div class="visor-picture">${media(p)}</div><div class="visor-details"><span class="visor-model">PARA ${e(group.model)}</span><h3>Viseira ${e(option.color)}</h3><div class="visor-colors" role="group" aria-label="Cor da viseira para ${e(group.model)}">${group.options.map(o => `<button type="button" class="visor-color ${o.product.id === p.id?'selected':''}" data-visor-choice="${e(o.product.id)}" data-visor-model="${e(group.model)}" aria-pressed="${o.product.id === p.id}" aria-label="${e(o.color)} para ${e(group.model)}"><span class="visor-swatch ${swatch(o.color)}" aria-hidden="true"></span>${e(o.color)}</button>`).join('')}</div><div class="visor-purchase"><strong>+ ${money(priceOf(p,size))}</strong><button type="button" class="button button-blue" data-add-visor="${e(p.id)}" ${added?'disabled':''}>${added?'✓ Na sacola':'Adicionar viseira'}</button></div><a class="visor-detail-link" href="${link(p)}">Ver detalhes da viseira ↗</a></div></div>`;
  }).join('')}${missing.length?`<p class="visor-pending">Sem viseira colorida com compatibilidade confirmada disponível para ${e(missing.join(', '))}.</p>`:''}</section>`;
}
