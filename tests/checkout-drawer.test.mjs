import test from 'node:test';
import assert from 'node:assert/strict';
import {createCheckoutDrawer} from '../public/checkout-drawer.js';

function fixture() {
  const root = {documentElement:{style:{overflow:'auto'}}};
  const scrolls = [];
  const view = {scrollY:620, scrollTo:options=>scrolls.push(options)};
  class Element {
    constructor(tag) { this.tag=tag; this.listeners=new Map(); this.children=[]; this.scrollTop=0; this.isConnected=true; this.tabIndex=['button','input'].includes(tag)?0:-1; }
    setAttribute(name,value) { this[name]=value; }
    addEventListener(type,handler) { this.listeners.set(type,handler); }
    dispatch(type,properties={}) { const event={target:this,preventDefault(){this.defaultPrevented=true;},...properties}; this.listeners.get(type)?.(event); return event; }
    focus(options) { root.activeElement=this; this.focusOptions=options; }
    append(child) { this.children.push(child); child.parent=this; }
    remove() { this.parent.children=this.parent.children.filter(child=>child!==this); this.isConnected=false; }
    showModal() { this.open=true; this.modalCalls=(this.modalCalls||0)+1; }
    close() { this.open=false; }
    contains(element) { return this.children.includes(element); }
    getBoundingClientRect() { return {left:700,right:1200,top:0,bottom:800}; }
    getClientRects() { return this.hidden?[]:[this.getBoundingClientRect()]; }
    matches(selector) { return selector===':disabled'&&Boolean(this.disabled); }
    querySelector(selector) { return this.children.find(child=>selector==='.'+child.className); }
    querySelectorAll(selector) { return this.children.flatMap(child=>[child,...child.querySelectorAll(selector)]).filter(child=>selector==='[id], [name]'?child.id||child.name:['button','input'].includes(child.tag)); }
    set innerHTML(html) {
      this.html=html;
      for (const child of this.children) child.isConnected=false;
      this.children=[];
      this.scrollTop=0;
      if (this.tag==='dialog') {
        for (const className of ['checkout-drawer-close','checkout-drawer-content']) {
          const child=new Element(className==='checkout-drawer-close'?'button':'div'); child.className=className; this.append(child);
        }
      } else {
        for (const match of html.matchAll(/<input\b([^>]*)>/g)) {
          const child=new Element('input');
          for (const attribute of match[1].matchAll(/(id|name|value)="([^"]*)"/g)) child[attribute[1]]=attribute[2];
          this.append(child);
        }
      }
    }
  }
  root.body=new Element('body');
  root.createElement=tag=>new Element(tag);
  const background=new Element('main'); background.html='Existing product DOM'; root.body.append(background);
  const trigger=new Element('button'); trigger.focus();
  let closes=0;
  const drawer=createCheckoutDrawer({root,view,onClose:()=>closes++});
  return {drawer,root,view,scrolls,background,trigger,get closes(){return closes;},get dialog(){return root.body.children.find(child=>child.tag==='dialog');},get content(){return this.dialog.querySelector('.checkout-drawer-content');}};
}

test('opening checkout creates one modal and locks scrolling without replacing the background',()=>{
  const f=fixture();
  assert.equal(f.drawer.isOpen,false);
  f.drawer.open('<input id="checkout-email" name="email" value="maria@example.com">');
  assert.equal(f.drawer.isOpen,true);
  assert.equal(f.drawer.scrollY,620);
  assert.equal(f.dialog.modalCalls,1);
  assert.equal(f.dialog['aria-labelledby'],'checkout-drawer-title');
  assert.equal(f.root.documentElement.style.overflow,'hidden');
  assert.equal(f.root.body.children[0],f.background);
  assert.equal(f.background.html,'Existing product DOM');
  assert.equal(f.root.activeElement,f.dialog.querySelector('.checkout-drawer-close'));
});

for (const identity of ['id','name']) test(`rerender preserves drawer scroll and restores field focus by ${identity}`,()=>{
  const f=fixture();
  const html=`<input ${identity}="email" value="maria@example.com">`;
  f.drawer.open(html);
  const dialog=f.dialog, oldInput=f.content.children[0];
  oldInput.focus(); f.content.scrollTop=390; f.view.scrollY=0;
  f.drawer.open(html);
  assert.equal(f.dialog,dialog);
  assert.equal(f.dialog.modalCalls,1);
  assert.equal(f.root.body.children.length,2);
  assert.equal(f.content.scrollTop,390);
  assert.notEqual(f.root.activeElement,oldInput);
  assert.equal(f.root.activeElement[identity],'email');
  assert.deepEqual(f.root.activeElement.focusOptions,{preventScroll:true});
  assert.equal(f.drawer.scrollY,620);
});

test('Escape, close button and backdrop request closure while clicks inside do not',()=>{
  const f=fixture(); f.drawer.open('');
  const event=f.dialog.dispatch('cancel');
  assert.equal(event.defaultPrevented,true);
  assert.equal(f.closes,1);
  f.dialog.querySelector('.checkout-drawer-close').dispatch('click');
  assert.equal(f.closes,2);
  f.dialog.dispatch('click',{clientX:500,clientY:100});
  assert.equal(f.closes,3);
  f.dialog.dispatch('click',{clientX:800,clientY:100});
  f.dialog.dispatch('click',{target:f.content,clientX:500,clientY:100});
  assert.equal(f.closes,3);
  assert.equal(f.drawer.isOpen,true,'routing owns actual close');
});

test('Tab and Shift+Tab wrap at drawer edges and skip unavailable controls',()=>{
  const f=fixture();
  f.drawer.open('<input name="email"><input name="phone"><input name="disabled"><input name="hidden"><input name="excluded">');
  const first=f.dialog.querySelector('.checkout-drawer-close');
  const [email,last,disabled,hidden,excluded]=f.content.children;
  disabled.disabled=true; hidden.hidden=true; excluded.tabIndex=-1;
  first.focus();
  const backwards=f.dialog.dispatch('keydown',{key:'Tab',shiftKey:true});
  assert.equal(backwards.defaultPrevented,true);
  assert.equal(f.root.activeElement,last);
  const forwards=f.dialog.dispatch('keydown',{key:'Tab',shiftKey:false});
  assert.equal(forwards.defaultPrevented,true);
  assert.equal(f.root.activeElement,first);
  email.focus();
  for (const shiftKey of [false,true]) {
    const interior=f.dialog.dispatch('keydown',{key:'Tab',shiftKey});
    assert.equal(interior.defaultPrevented,undefined,'native Tab handles interior controls');
    assert.equal(f.root.activeElement,email);
  }
  first.focus();
  const otherKey=f.dialog.dispatch('keydown',{key:'ArrowLeft',shiftKey:true});
  assert.equal(otherKey.defaultPrevented,undefined);
  assert.equal(f.root.activeElement,first);
});

test('close removes modal and restores original overflow, page scroll and trigger focus',()=>{
  const f=fixture(); f.drawer.open('');
  const dialog=f.dialog;
  f.drawer.open('Updated payment state');
  f.drawer.close();
  assert.equal(f.drawer.isOpen,false);
  assert.equal(dialog.open,false);
  assert.equal(dialog.isConnected,false);
  assert.deepEqual(f.root.body.children,[f.background]);
  assert.equal(f.root.documentElement.style.overflow,'auto');
  assert.deepEqual(f.scrolls,[{top:620,behavior:'instant'}]);
  assert.equal(f.root.activeElement,f.trigger);
  assert.deepEqual(f.trigger.focusOptions,{preventScroll:true});
  f.drawer.close();
  assert.equal(f.scrolls.length,1);
});

test('reopening captures the current page and does not focus a disconnected trigger on close',()=>{
  const f=fixture(); f.drawer.open(''); f.drawer.close();
  f.view.scrollY=910; f.root.documentElement.style.overflow='clip';
  f.drawer.open(''); f.trigger.isConnected=false;
  const focused=f.root.activeElement;
  f.drawer.close();
  assert.equal(f.root.documentElement.style.overflow,'clip');
  assert.deepEqual(f.scrolls.at(-1),{top:910,behavior:'instant'});
  assert.equal(f.root.activeElement,focused);
});
