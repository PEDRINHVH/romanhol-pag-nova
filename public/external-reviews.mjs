import { escapeHTML as escape } from './catalog-utils.mjs';
import { reviewPhotos } from './review-photos.mjs';

export const reviewSource = 'https://www.mercadolivre.com.br/capacete-integral-norisk-razor-preto-fosco-monocolor-tamanho-58/p/MLB61810688';

// Editorial summaries of the first 30 opinions shown by the source on 2026-10-12.
// No copied testimonials, invented identities, or store-purchase claims.
// Photos are matched to their original opinion by the source order below.
export const razorOpinions = [
  [5, 'Valoriza acabamento, fecho e acolchoamento.'],
  [5, 'Considera a compra vantajosa.'],
  [5, 'Elogia visual; relata ajuste justo.'],
  [5, 'Sem comentário escrito.'],
  [5, 'Considera o investimento compensador.'],
  [5, 'Aponta riscos visíveis no fosco.'],
  [5, 'Relata pressão nas bochechas.'],
  [5, 'Esperava viseira colorida; recebeu transparente.'],
  [5, 'Relata aperto nas bochechas.'],
  [5, 'Encontrou diferença de ajuste entre marcas.'],
  [5, 'Destaca conforto e aparência.'],
  [4, 'Elogia aparência; achou pequeno.'],
  [5, 'Demonstra satisfação com o produto.'],
  [5, 'Relata dificuldade inicial ao vestir.'],
  [5, 'Sem comentário escrito.'],
  [5, 'Elogia produto; numeração entregue incorreta.'],
  [5, 'Recomenda após experiência positiva.'],
  [5, 'Destaca transparência; ainda sem rodagem.'],
  [5, 'Relata conforto durante uma viagem.'],
  [5, 'Expressa entusiasmo pela compra.'],
  [5, 'Elogia visual; achou o encaixe apertado.'],
  [5, 'Sem comentário escrito.'],
  [5, 'Sem comentário escrito.'],
  [5, 'Elogia viseira; menciona bochechas apertadas.'],
  [5, 'Aprova especialmente a aparência.'],
  [5, 'Valoriza custo-benefício; ressalva ajuste facial.'],
  [5, 'Destaca ventilação, leveza e conforto.'],
  [5, 'Valoriza visibilidade, vedação e acabamento.'],
  [5, 'Relata aprovação após a compra.'],
  [5, 'Expressa satisfação com emojis.'],
];

export const photoOpinions = razorOpinions.map(([rating, summary], index) => ({rating, summary, sourceIndex:index + 1, photo:reviewPhotos[index + 1]})).filter(opinion => opinion.photo?.src);

const opinionCard = ({rating, summary, sourceIndex, photo}) => `<article class="external-review"><div><span>Opinião ${String(sourceIndex).padStart(2, '0')}</span><strong aria-label="Nota ${rating} de 5 na origem">${rating}/5 <span aria-hidden="true">★</span></strong></div><a class="external-review-photo" href="${escape(photo.src)}" target="_blank" rel="noopener" aria-label="Ampliar foto da opinião ${sourceIndex}"><img src="${escape(photo.src)}" alt="Foto do produto anexada à opinião ${sourceIndex} sobre o Norisk Razor no Mercado Livre" width="480" height="360" loading="lazy" decoding="async"></a><p>${escape(summary)}</p></article>`;

export function renderExternalReviews(product) {
  if (product?.category !== 'capacetes') return '';
  const isRazor = String(product.model).toUpperCase() === 'RAZOR';
  return `<section class="external-reviews" aria-labelledby="external-reviews-title">
    <div class="section-heading"><h2 id="external-reviews-title">${isRazor ? 'Opiniões sobre o Norisk Razor' : 'Referência externa: opiniões sobre o Norisk Razor'}</h2></div>
    <p class="external-reviews-origin">${photoOpinions.length} opiniões com fotos · Mercado Livre</p>
    <p class="external-reviews-context">${isRazor ? '' : `<strong>Estes comentários são de outro modelo: Norisk Razor. Não avaliam o ${escape(product.model || 'capacete desta página')}.</strong> `}Resumos editoriais de opiniões sobre o Norisk Razor, incluindo diferentes variações. Não são avaliações de compras na No Limite nem dos outros modelos.</p>
    <div class="external-reviews-grid">${photoOpinions.slice(0, 6).map(opinionCard).join('')}</div>
    ${photoOpinions.length > 6 ? `<details class="external-reviews-more"><summary>Ver mais ${photoOpinions.length - 6} opiniões com fotos <span aria-hidden="true">+</span></summary><div class="external-reviews-grid">${photoOpinions.slice(6).map(opinionCard).join('')}</div></details>` : ''}
    <p class="external-reviews-source">${photoOpinions.length} opiniões com fotos selecionadas entre as primeiras 30 da consulta de 12/10/2026. Uma foto original por opinião. Notas preservadas; textos resumidos, sem transcrição. <a href="${reviewSource}" target="_blank" rel="noopener noreferrer">Ler comentários originais no Mercado Livre ↗</a></p>
  </section>`;
}
