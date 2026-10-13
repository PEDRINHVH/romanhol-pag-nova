import test from 'node:test';
import assert from 'node:assert/strict';
import { razorOpinions, photoOpinions, renderExternalReviews } from '../public/external-reviews.js';
import { existsSync } from 'node:fs';

test('external opinions appear only on helmet product pages', () => {
  for (const product of [undefined, {category:'vestuario',model:'SS'}, {category:'acessorios',model:'RAZOR'}]) {
    assert.equal(renderExternalReviews(product), '');
  }
});

test('other helmets explicitly identify Razor as a different model', () => {
  const html = renderExternalReviews({category:'capacetes',model:'FORCE II'});
  assert.match(html,/Referência externa: opiniões sobre o Norisk Razor/);
  assert.match(html,/Estes comentários são de outro modelo: Norisk Razor/);
  assert.match(html,/Não avaliam o FORCE II/);
  assert.equal((html.match(/class="external-review"/g)||[]).length,25);
});

test('source opinions retain attribution and distinguish summaries from store reviews', () => {
  const html=renderExternalReviews({category:'capacetes',model:'RAZOR'});
  assert.equal(razorOpinions.length,30);
  assert.equal(razorOpinions.filter(([rating])=>rating===4).length,1);
  assert.match(html,/Não são avaliações de compras na No Limite/);
  assert.match(html,/textos resumidos, sem transcrição/);
  assert.match(html,/mercadolivre\.com\.br/);
  assert.equal((html.match(/class="external-review"/g)||[]).length,25);
  assert.match(html,/25 opiniões com fotos/);
  assert.match(html,/Ver mais 19 opiniões com fotos/);
});

test('only opinions with a matched real photo are rendered, including the four-star opinion', () => {
  assert.equal(photoOpinions.length,25);
  assert.deepEqual(photoOpinions.filter(opinion=>opinion.rating===4).map(opinion=>opinion.sourceIndex),[12]);
  for (const index of [7,10,21,26,27]) assert.equal(photoOpinions.some(opinion=>opinion.sourceIndex===index),false);
  for (const {photo} of photoOpinions) {
    assert.match(photo.source,/^https:\/\/http2\.mlstatic\.com\//);
    assert.ok(existsSync(new URL(`../public${photo.src}`,import.meta.url)));
  }
  const html=renderExternalReviews({category:'capacetes',model:'RAZOR'});
  assert.equal((html.match(/class="external-review-photo"/g)||[]).length,25);
  assert.equal((html.match(/<img /g)||[]).length,25);
});
