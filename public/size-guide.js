import { escapeHTML as escape } from './catalog-utils.js';

const mounted = new WeakSet();
const nominalLabels = product => [...new Set((product?.variants || []).map(variant => String(variant.size || '').trim()).filter(Boolean))];
const formatCm = value => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

export function parseHeadMeasurement(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,3}(?:[.,]\d{1,2})?$/.test(text)) return null;
  const cm = Number(text.replace(',', '.'));
  return cm > 0 && cm <= 200 ? cm : null;
}

export function renderSizeGuide({ product } = {}) {
  const labels = nominalLabels(product);
  return `<section class="size-guide" data-size-guide data-size-labels="${escape(JSON.stringify(labels))}">
    <header class="size-guide-heading"><h2>Como escolher o tamanho do capacete</h2><p>Meça a cabeça e confira o ajuste do modelo antes de escolher.</p></header>
    <div class="size-guide-layout">
      <figure class="size-guide-figure"><img src="/assets/brand/helmet-measuring-guide.webp" alt="Fita métrica nivelada ao redor da cabeça, acima das sobrancelhas e passando pela parte mais larga atrás da cabeça." width="1254" height="1254" loading="lazy" decoding="async"><figcaption>A fita deve ficar nivelada, sem apertar.</figcaption></figure>
      <div class="size-guide-instructions">
        <section class="size-guide-step"><h3><span aria-hidden="true">1</span>Meça a circunferência</h3><p>Use uma fita métrica flexível acima das sobrancelhas, passando pela parte mais larga atrás da cabeça. Repita a medida para conferir.</p></section>
        <section class="size-guide-step"><h3><span aria-hidden="true">2</span>Confira os tamanhos do modelo</h3>
          <form class="size-guide-form" novalidate>
            <label><span>Sua medida em centímetros</span><div class="size-guide-input"><input name="headMeasurement" type="text" inputmode="decimal" autocomplete="off" placeholder="Ex.: 58,5" maxlength="6" required aria-label="Circunferência da cabeça em centímetros"><span aria-hidden="true">cm</span></div></label>
            <button type="submit">Conferir medida</button>
          </form>
          <p class="size-guide-feedback" data-size-feedback role="status" aria-live="polite" aria-atomic="true">A medida ajuda na comparação. O encaixe precisa ser conferido no capacete.</p>
          ${labels.length ? `<div class="size-guide-options"><p>Tamanhos listados ${product?.name ? `para <strong>${escape(product.name)}</strong>` : 'para este modelo'}:</p><ul aria-label="Tamanhos nominais do catálogo">${labels.map(label => `<li>${escape(label)}</li>`).join('')}</ul><p class="size-guide-note">São numerações do catálogo, não uma tabela de conversão em centímetros nem confirmação de estoque.</p></div>` : '<p class="size-guide-note">Abra a página do capacete para consultar os tamanhos listados para aquele modelo.</p>'}
        </section>
        <section class="size-guide-step size-guide-fit"><h3><span aria-hidden="true">3</span>Confira o ajuste</h3><ul><li>Experimente o capacete por alguns minutos.</li><li>Ele deve ficar firme, sem folga e sem causar dor.</li><li>Se a medida ficar entre numerações, confirme a tabela específica do modelo. Não arredonde automaticamente.</li></ul><p>Modelos diferentes podem ter encaixes diferentes. A numeração sozinha não garante o ajuste.</p></section>
      </div>
    </div>
    <p class="size-guide-source"><a href="https://www.norisk.com.br/institucional/Perguntas-frequentes" target="_blank" rel="noopener noreferrer">Orientação do fabricante sobre ajuste</a></p>
  </section>`;
}

export function mountSizeGuide(root = document) {
  const guides = [...(root.matches?.('[data-size-guide]') ? [root] : []), ...root.querySelectorAll('[data-size-guide]')];
  for (const guide of guides) {
    const form = guide.querySelector('.size-guide-form');
    if (!form || mounted.has(form)) continue;
    mounted.add(form);
    const input = form.querySelector('[name="headMeasurement"]');
    const feedback = guide.querySelector('[data-size-feedback]');
    form.addEventListener('submit', event => {
      event.preventDefault();
      const measurement = parseHeadMeasurement(input.value);
      if (measurement === null) {
        input.setAttribute('aria-invalid', 'true');
        feedback.dataset.state = 'error';
        feedback.textContent = 'Informe a medida em centímetros, por exemplo 58 ou 58,5.';
        input.focus();
        return;
      }
      input.removeAttribute('aria-invalid');
      delete feedback.dataset.state;
      let labels = [];
      try { labels = JSON.parse(guide.dataset.sizeLabels); } catch {}
      feedback.textContent = `Sua medida: ${formatCm(measurement)} cm. ${labels.length ? `O catálogo deste modelo lista ${labels.join(', ')}. ` : ''}Confira a tabela específica e experimente o modelo antes de escolher. Não arredonde a medida para outro tamanho.`;
    });
  }
}
