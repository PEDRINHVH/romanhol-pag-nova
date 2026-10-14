import {PROTECTCAR_KITS,PROTECTCAR_VEHICLES,PROTECTCAR_COLORS,PROTECTCAR_TEXTURES} from './protectcar-data.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const money = value => Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const textureImages = ['tech','ondas','pedra'];
const kitImages = {
  'carro-interno':{file:'kit-carro-interno.webp',width:800,height:800},
  'carro-completo':{file:'kit-carro-completo.webp',width:1200,height:1226},
  'picape-interno':{file:'kit-picape-interno.webp',width:800,height:800},
  'picape-completo':{file:'kit-picape-completo.jpeg',width:1024,height:1024},
};
const colors = {Preto:'#252628',Cinza:'#898b8e',Bege:'#cbb99a'};
const options = (values,selected) => values.map(value => `<option value="${escape(value)}" ${String(selected)===String(value)?'selected':''}>${escape(value)}</option>`).join('');
const select = (field,label,values,value,disabled=false) => `<label class="protectcar-field" for="protectcar-${field}"><span>${label}</span><select id="protectcar-${field}" data-protectcar-field="${field}" required ${disabled?'disabled':''}><option value="">Selecione ${label.toLowerCase()}</option>${options(values,value)}</select></label>`;

export function renderProtectCarConfigurator({size='',configuration={}}={}) {
  const c=configuration || {};
  const kits=PROTECTCAR_KITS.filter(kit=>kit.vehicleType===c.vehicleType);
  const models=PROTECTCAR_VEHICLES[c.brand] || [];
  const selectedModel=models.find(item=>item.model===c.model);
  const years=selectedModel ? Array.from({length:Math.max(0,Number(selectedModel.to)-Number(selectedModel.from)+1)},(_,i)=>String(Number(selectedModel.to)-i)) : [];
  const complete=Boolean(kits.some(kit=>kit.size===size)&&c.brand&&c.model&&c.year&&c.color&&c.texture);
  return `<section class="protectcar-configurator" aria-label="Configure seu tapete">
    <div class="protectcar-heading"><span class="protectcar-kicker">FEITO PARA O SEU DIA A DIA</span><h2>Monte seu kit</h2><p>Escolha o veículo e o acabamento. Todos os campos são obrigatórios.</p></div>
    <fieldset class="protectcar-group"><legend>1. Tipo de veículo</legend><div class="protectcar-options protectcar-types">${[['carro','Carro'],['picape','Picape']].map(([value,label])=>`<label class="protectcar-choice"><input type="radio" name="protectcar-vehicleType" data-protectcar-field="vehicleType" value="${value}" ${c.vehicleType===value?'checked':''} required><span>${label}</span></label>`).join('')}</div></fieldset>
    <fieldset class="protectcar-group"><legend>2. Escolha seu kit</legend>${kits.length?`<div class="protectcar-options protectcar-kits">${kits.map(kit=>`<label class="protectcar-choice"><input type="radio" name="protectcar-kit" data-protectcar-field="size" value="${escape(kit.size)}" ${size===kit.size?'checked':''} required><span><img class="protectcar-kit-image" src="/assets/protectcar/${kitImages[kit.id].file}" alt="" width="${kitImages[kit.id].width}" height="${kitImages[kit.id].height}" loading="lazy" decoding="async"><span class="protectcar-kit-name">${escape(kit.size)}</span><strong>${money(kit.price)}</strong><small>No Pix</small></span></label>`).join('')}</div>`:'<p class="protectcar-hint">Selecione o tipo de veículo para ver os kits.</p>'}</fieldset>
    <fieldset class="protectcar-group"><legend>3. Qual é o seu veículo?</legend><div class="protectcar-vehicle-fields">${select('brand','Marca',Object.keys(PROTECTCAR_VEHICLES),c.brand,!c.vehicleType)}${select('model','Modelo',models.map(item=>item.model),c.model,!c.brand)}${select('year','Ano',years,c.year,!selectedModel)}</div></fieldset>
    <fieldset class="protectcar-group"><legend>4. Cor <span class="protectcar-selection">${escape(c.color || '')}</span></legend><div class="protectcar-options protectcar-colors">${PROTECTCAR_COLORS.map(color=>`<label class="protectcar-choice"><input type="radio" name="protectcar-color" data-protectcar-field="color" value="${escape(color)}" ${c.color===color?'checked':''} required><span><i class="protectcar-swatch" style="--protectcar-swatch:${colors[color] || '#888'}" aria-hidden="true"></i>${escape(color)}</span></label>`).join('')}</div></fieldset>
    <fieldset class="protectcar-group"><legend>5. Textura</legend><div class="protectcar-options protectcar-textures">${PROTECTCAR_TEXTURES.map((texture,index)=>`<label class="protectcar-choice"><input type="radio" name="protectcar-texture" data-protectcar-field="texture" value="${escape(texture)}" ${c.texture===texture?'checked':''} required><span><img src="/assets/protectcar/textura-${textureImages[index]}.webp" alt="" width="${index===1?800:1200}" height="${index===1?800:1200}" loading="lazy" decoding="async"><span>${escape(texture)}</span></span></label>`).join('')}</div></fieldset>
    <p class="protectcar-status ${complete?'protectcar-status-ready':''}" role="status">${complete?'Configuração completa. Seu kit está pronto para adicionar à sacola.':'Complete as escolhas acima para continuar a compra.'}</p>
  </section>`;
}

export function mountProtectCarConfigurator({product,size='',configuration={},onChange}) {
  const element=document.querySelector('.protectcar-configurator');
  if(!element) return ()=>{};
  const change=event=>{
    const input=event.target.closest('[data-protectcar-field]');
    if(!input || !element.contains(input)) return;
    const field=input.dataset.protectcarField;
    const next={...configuration};
    let nextSize=size;
    if(field==='size') nextSize=input.value;
    else next[field]=input.value;
    if(field==='vehicleType') {nextSize=PROTECTCAR_KITS.find(kit=>kit.vehicleType===next.vehicleType)?.size || '';next.brand='';next.model='';next.year='';}
    if(field==='brand') {next.model='';next.year='';}
    if(field==='model') next.year='';
    const value=input.value;
    onChange({size:nextSize,configuration:next});
    const candidates=document.querySelectorAll(`[data-protectcar-field="${field}"]`);
    Array.from(candidates).find(candidate=>candidate.value===value)?.focus({preventScroll:true});
  };
  element.addEventListener('change',change);
  return ()=>element.removeEventListener('change',change);
}

function comparison(position,label) {
  const height=position==='frente'?772:1280;
  return `<article class="protectcar-comparison"><h3>${label}</h3><div class="protectcar-comparison-stage" style="--protectcar-reveal:50%"><img class="protectcar-before" src="/assets/protectcar/antes-${position}.webp" alt="Área ${label.toLowerCase()} antes da instalação do tapete" width="1280" height="${height}" loading="lazy" decoding="async"><img class="protectcar-after" src="/assets/protectcar/depois-${position}.webp" alt="Área ${label.toLowerCase()} com o Tapete Bandeja 3D ProtectCar" width="1280" height="${position==='frente'?762:1280}" loading="lazy" decoding="async"><span class="protectcar-before-label">Antes</span><span class="protectcar-after-label">Depois</span><span class="protectcar-comparison-divider" aria-hidden="true"><span>↔</span></span></div><label class="protectcar-comparison-control" for="protectcar-compare-${position}">Deslize para comparar · ${label.toLowerCase()}<input id="protectcar-compare-${position}" data-protectcar-compare type="range" min="0" max="100" value="50" aria-label="Comparar antes e depois, ${label.toLowerCase()}" aria-valuetext="50% da imagem depois visível"></label></article>`;
}

const productVideos = [
  {id:'encaixe',title:'Encaixe e fixação',description:'Veja como o tapete é posicionado e fixado no assoalho.',height:720},
  {id:'cobertura',title:'Proteção por todos os lados',description:'Confira a cobertura das áreas dianteira e traseira do veículo.',height:720},
  {id:'limpeza',title:'Sujeira para fora',description:'Retire o tapete e sacuda para remover os resíduos acumulados.',height:960},
];

function renderProductVideos() {
  return `<section class="protectcar-media" aria-labelledby="protectcar-media-title"><div class="protectcar-media-heading"><h2 id="protectcar-media-title">Veja o tapete em ação.</h2><p>Do encaixe à limpeza, acompanhe os detalhes nas demonstrações do produto.</p></div><div class="protectcar-videos" role="region" aria-label="Vídeos de demonstração do tapete" tabindex="0">${productVideos.map(video=>`<article class="protectcar-video"><video controls playsinline preload="none" width="540" height="${video.height}" poster="/assets/protectcar/demo-${video.id}-poster.jpg" aria-label="${video.title}" aria-describedby="protectcar-video-${video.id}"><source src="/assets/protectcar/demo-${video.id}.mp4" type="video/mp4"><a href="/assets/protectcar/demo-${video.id}.mp4">Assistir: ${video.title}</a></video><div class="protectcar-video-copy"><h3>${video.title}</h3><p id="protectcar-video-${video.id}">${video.description}</p></div></article>`).join('')}</div><p class="protectcar-media-hint">Deslize para ver os 3 vídeos. Toque no play para assistir.</p></section>`;
}

export function renderProtectCarDescription() {
  return `<section class="protectcar-description" aria-labelledby="protectcar-description-title"><div class="protectcar-description-heading"><span class="protectcar-kicker">TAPETE BANDEJA 3D PROTECTCAR</span><h2 id="protectcar-description-title">Proteção que acompanha sua rotina.</h2><p>Um interior mais cuidado, da cidade à estrada. O formato bandeja com bordas elevadas ajuda a conter sujeira e líquidos, facilitando a limpeza no dia a dia.</p></div><div class="protectcar-benefits"><article><span>01</span><h3>Formato bandeja</h3><p>Bordas elevadas ajudam a manter a sujeira sobre o tapete.</p></article><article><span>02</span><h3>Material e estrutura</h3><p>TPE + polipropileno, com espessura de 3 mm.</p></article><article><span>03</span><h3>Limpeza simples</h3><p>Retire o tapete, lave com água e sabão neutro e deixe secar antes de recolocar.</p></article></div>${renderProductVideos()}<div class="protectcar-comparison-heading"><h2>Veja a diferença no interior.</h2><p>Compare as imagens de apresentação. Arraste o controle ou use as setas do teclado.</p></div><div class="protectcar-comparisons">${comparison('frente','Dianteira')}${comparison('traseira','Traseira')}</div><p class="protectcar-image-note">Imagens de apresentação. O resultado pode variar conforme o veículo e o acabamento escolhido.</p></section>`;
}

export function mountProtectCarComparisons() {
  const cleanups=[];
  document.querySelectorAll('[data-protectcar-compare]').forEach(input=>{
    const stage=input.closest('.protectcar-comparison').querySelector('.protectcar-comparison-stage');
    let activePointer=null;
    const update=()=>{
      stage.style.setProperty('--protectcar-reveal',`${input.value}%`);
      input.setAttribute('aria-valuetext',`${input.value}% da imagem depois visível`);
    };
    const move=event=>{
      if(event.pointerId!==activePointer) return;
      const bounds=stage.getBoundingClientRect();
      if(!bounds.width) return;
      input.value=String(Math.round(Math.max(0,Math.min(100,(event.clientX-bounds.left)/bounds.width*100))));
      update();
    };
    const start=event=>{
      if(event.button!==0 || activePointer!==null) return;
      activePointer=event.pointerId;
      stage.setPointerCapture(event.pointerId);
      input.focus({preventScroll:true});
      move(event);
    };
    const end=event=>{
      if(event.pointerId!==activePointer) return;
      activePointer=null;
      if(stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    };
    input.addEventListener('input',update);
    stage.addEventListener('pointerdown',start);
    stage.addEventListener('pointermove',move);
    stage.addEventListener('pointerup',end);
    stage.addEventListener('pointercancel',end);
    cleanups.push(()=>{
      input.removeEventListener('input',update);
      stage.removeEventListener('pointerdown',start);
      stage.removeEventListener('pointermove',move);
      stage.removeEventListener('pointerup',end);
      stage.removeEventListener('pointercancel',end);
      if(activePointer!==null && stage.hasPointerCapture(activePointer)) stage.releasePointerCapture(activePointer);
    });
  });
  return ()=>cleanups.forEach(cleanup=>cleanup());
}
