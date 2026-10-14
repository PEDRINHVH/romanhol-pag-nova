import test from 'node:test';
import assert from 'node:assert/strict';
import {renderProtectCarConfigurator,mountProtectCarConfigurator,renderProtectCarDescription,mountProtectCarComparisons} from '../public/protectcar-ui.js';
import {PROTECTCAR_KITS} from '../public/protectcar-data.js';

function eventNode(extra={}) {
  const listeners=new Map();
  return {...extra,listeners,addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);},emit(type,event){listeners.get(type)?.(event);}};
}

test('type chooses compatible kit and clears vehicle; brand/model clear dependents',()=>{
  const originalDocument=globalThis.document;
  const configuration={vehicleType:'carro',brand:'Marca',model:'Modelo',year:'2024',color:'Preto',texture:'Circuito / Tech'};
  const root=eventNode({contains:()=>true});
  globalThis.document={querySelector:()=>root,querySelectorAll:()=>[]};
  try {
    for(const [field,value,expected] of [
      ['vehicleType','picape',{vehicleType:'picape',brand:'',model:'',year:''}],
      ['brand','Outra',{brand:'Outra',model:'',year:''}],
      ['model','Outro',{model:'Outro',year:''}],
    ]) {
      let result;
      const cleanup=mountProtectCarConfigurator({size:PROTECTCAR_KITS[0].size,configuration,onChange:next=>{result=next;}});
      const input={dataset:{protectcarField:field},value,closest(){return this;}};
      root.emit('change',{target:input});
      assert.deepEqual(result.configuration,{...configuration,...expected});
      assert.equal(result.size,field==='vehicleType'?PROTECTCAR_KITS.find(kit=>kit.vehicleType==='picape').size:PROTECTCAR_KITS[0].size);
      assert.equal(configuration.year,'2024','original configuration is not mutated');
      cleanup();
      assert.equal(root.listeners.size,0);
    }
  } finally {globalThis.document=originalDocument;}
});

test('renderer labels required dependent selects and both accessible comparisons',()=>{
  const html=renderProtectCarConfigurator();
  for(const field of ['brand','model','year']) {
    assert.match(html,new RegExp(`for="protectcar-${field}"`));
    assert.match(html,new RegExp(`<select id="protectcar-${field}"[^>]*required disabled`));
  }
  const selected=renderProtectCarConfigurator({configuration:{vehicleType:'carro'}});
  assert.match(selected,/<select id="protectcar-brand"[^>]*required >/);
  assert.equal((selected.match(/data-protectcar-field="size"/g)||[]).length,2);
  const description=renderProtectCarDescription();
  assert.equal((description.match(/data-protectcar-compare/g)||[]).length,2);
  for(const position of ['frente','traseira']) {
    assert.match(description,new RegExp(`antes-${position}.webp`));
    assert.match(description,new RegExp(`depois-${position}.webp`));
    assert.match(description,new RegExp(`for="protectcar-compare-${position}"`));
  }
  assert.match(description,/class="protectcar-before-label">Antes/);
  assert.match(description,/class="protectcar-after-label">Depois/);
});

test('image drag and keyboard range synchronize reveal, clamp, cancel and clean up',()=>{
  const originalDocument=globalThis.document;
  let reveal;
  let captured=null;
  const stage=eventNode({style:{setProperty:(key,value)=>{reveal=value;}},getBoundingClientRect:()=>({left:20,width:200}),setPointerCapture:id=>{captured=id;},hasPointerCapture:id=>captured===id,releasePointerCapture:()=>{captured=null;}});
  const input=eventNode({value:'50',closest:()=>({querySelector:()=>stage}),setAttribute(key,value){this[key]=value;},focus(){}});
  globalThis.document={querySelectorAll:()=>[input]};
  try {
    const cleanup=mountProtectCarComparisons();
    stage.emit('pointerdown',{button:0,pointerId:1,clientX:70});
    assert.equal(reveal,'25%');
    assert.equal(input.value,'25');
    stage.emit('pointermove',{pointerId:1,clientX:400});
    assert.equal(reveal,'100%');
    stage.emit('pointercancel',{pointerId:1});
    assert.equal(captured,null);
    stage.emit('pointermove',{pointerId:1,clientX:20});
    assert.equal(reveal,'100%');
    input.value='40';
    input.emit('input');
    assert.equal(reveal,'40%');
    assert.match(input['aria-valuetext'],/40%/);
    cleanup();
    assert.equal(stage.listeners.size,0);
    assert.equal(input.listeners.size,0);
  } finally {globalThis.document=originalDocument;}
});
