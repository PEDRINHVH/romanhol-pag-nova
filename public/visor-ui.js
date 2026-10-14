import {escapeHTML as e, money, priceOf} from './catalog-utils.js';
import {visorOffers} from './visor-utils.js';

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
  if (!groups.length) return `<section class="visor-bump" aria-label="Compatibilidade de viseiras"><p class="visor-pending">Viseira adicional indisponível para ${e(missing.join(', '))}.</p></section>`;
  return `<section class="visor-bump" aria-label="Viseiras adicionais"><div class="visor-heading"><h2>Viseira adicional</h2><span class="visor-optional">Opcional</span></div>${groups.map(group => {
    const option = group.options.find(o => o.product.id === choices.get(group.model)) || group.options.find(o => o.color === 'Fumê') || group.options[0];
    const p = option.product, size = p.variants.find(v => v.available !== false && priceOf(p,v.size) > 0).size, added = cart.some(line => line.id === p.id);
    return `<div class="visor-offer"><a class="visor-picture" href="${link(p)}" aria-label="Ver detalhes da viseira ${e(option.color)} para ${e(group.model)}">${media(p)}</a><div class="visor-details"><span class="visor-model">Para ${e(group.model)}</span><h3>Cor: ${e(option.color)}</h3><span class="visor-hint">Selecione abaixo</span></div><div class="visor-colors" role="group" aria-label="Cor da viseira para ${e(group.model)}">${group.options.map(o => `<button type="button" class="visor-color ${o.product.id === p.id?'selected':''}" data-visor-choice="${e(o.product.id)}" data-visor-model="${e(group.model)}" aria-pressed="${o.product.id === p.id}" aria-label="${e(o.color)} para ${e(group.model)}" title="${e(o.color)}"><span class="visor-swatch ${swatch(o.color)}" aria-hidden="true"></span><span class="visor-color-name">${e(o.color)}</span></button>`).join('')}</div><div class="visor-purchase"><div class="visor-price"><strong>+ ${money(priceOf(p,size))}</strong><span>no total da sacola</span></div><button type="button" class="button button-blue" data-add-visor="${e(p.id)}" ${added?'disabled':''}>${added?'✓ Na sacola':'+ Adicionar'}</button></div></div>`;
  }).join('')}${missing.length?`<p class="visor-pending">Viseira adicional indisponível para ${e(missing.join(', '))}.</p>`:''}</section>`;
}
