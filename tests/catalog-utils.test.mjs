import test from 'node:test';
import assert from 'node:assert/strict';
import {filterProducts,priceOf,productImage,approvedImageIndex,itemCountLabel,findProductByPath,normalizeProducts,facetValues,clearedFilters} from '../public/catalog-utils.js';
const products = [{id:'1',name:'Capacete FORCE II',model:'Force II',price:599,color:'Preto',category:'capacetes',variants:[{size:'58'}]},{id:'2',name:'Jaqueta',price:220,category:'vestuario',variants:[{size:'M'}]}];
test('Force II uses the fixed launch price',()=>assert.equal(priceOf(products[0]),179.90));
test('search, size and category combine',()=>assert.deepEqual(filterProducts(products,{q:'capacête',size:'58',category:'capacetes'}),[products[0]]));
test('price sorting uses display prices',()=>assert.equal(filterProducts(products,{sort:'price-asc'})[0].id,'1'));
test('unprocessed images never leak into storefront',()=>assert.equal(productImage({images:[{url:'https://original.example/cap.jpg'}]}),null));
test('approved local edited images display',()=>assert.equal(productImage({images:[{url:'original'}]},{byUrl:{original:{status:'edited',url:'/assets/products/edited.png'}}}),'/assets/products/edited.png'));
test('normalization accepts product wrapper and preserves the Norisk brand',()=>assert.equal(normalizeProducts({products:[{name:'Norisk Force',id:12}]})[0].name,'Norisk Force'));
test('product titles remove variant attributes and retain models and editions',()=>{
  const examples = [
    ['CAPACETE NO LIMITE FORCE II MONOCOLOR PRETO FOSCO','Capacete Norisk Force II'],
    ['CAPACETE NORISK SOUL II GRAND PRIX GERMANY','Capacete Norisk Soul II Grand Prix Germany'],
    ['CAPACETE NOLIMIT RAZOR MONOCOLOR FOSCO BLACK EDITION','Capacete Norisk Razor Black Edition'],
    ['CAPACETE NO LIMITE RAZOR MENINAS SUPER PODEROSAS','Capacete Norisk Razor Meninas Super Poderosas'],
    ['VISEIRA REVO ROSA NO LIMITE CAPACETE RAZOR','Viseira Norisk Razor'],
    ['PINLOCK CAPACETE NO LIMITE STRADA II/FORCE II','Pinlock Norisk Strada II/Force II'],
    ['SUPORTE DE VISEIRA CAPACETE NORISK STUNT/FF389/FF369','Suporte de Viseira Norisk Stunt/FF389/FF369'],
    ['FORRAÇÃO COMPLETA NO LIMITE FF302','Forração Completa Norisk FF302'],
    ['ÓCULOS INTERNO FUMÊ NO LIMITE CAPACETE FORCE','Óculos Interno Norisk Force'],
    ['JAQUETA NO LIMITE TRIP AIR FEMININA ROSA','Jaqueta Norisk Trip Air Feminina'],
    ['MACACÃO NO LIMITE SS PRETO/VERMELHO/BRANCO','Macacão Norisk SS'],
    ['LUVA NO LIMITE RAPTOR CINZA TAMANHO M','Luva Norisk Raptor'],
    ['BONÉ NO LIMITE NEW ERA PRETO','Boné Norisk New Era'],
    ['CAPACETE NORISK CARBON R SOLID MATTE CARBON','Capacete Norisk Carbon R Solid'],
    ['PALA CAPACETE NORISK DARTH MATTE BLACK U','Pala Norisk Darth'],
    ['CAPACETE NORISK FORCE II PRETO FOSCO 58','Capacete Norisk Force II'],
    ['CAPACETE NORISK SOUL II GRAND PRIX USA','Capacete Norisk Soul II Grand Prix USA'],
  ];
  for (const [name,expected] of examples) assert.equal(normalizeProducts([{name}])[0].name,expected,name);
});
test('short titles preserve full names, variant data, compatibility and identifiers',()=>{
  const original={id:'helmet-1',slug:'capacete-no-limite-force-ii-preto',name:'CAPACETE NO LIMITE FORCE II PRETO FOSCO',category:'capacetes',model:'FORCE II',color:'PRETO',finish:'FOSCO',price:500,description:'NO LIMITE com casco ABS e viseira de 2 mm.',specifications:{compatibility:'FORCE II'},variants:[{id:'sku-58',size:'58',price:510,available:true}]};
  const product=normalizeProducts([original])[0];
  for(const key of ['id','slug','category','model','color','finish','price','specifications','variants']) assert.deepEqual(product[key],original[key],key);
  assert.equal(product.fullName,'CAPACETE Norisk FORCE II PRETO FOSCO');
  assert.equal(product.description,'Norisk com casco ABS e viseira de 2 mm.');
  assert.equal(original.name,'CAPACETE NO LIMITE FORCE II PRETO FOSCO');
  assert.deepEqual(normalizeProducts([product])[0],product);
  assert.deepEqual(filterProducts([product],{q:'fosco'}),[product]);
});
test('Force II compatible accessories keep their own price',()=>assert.equal(priceOf({name:'Viseira Force II',category:'acessorios',price:25}),25));
test('missing prices stay missing',()=>assert.equal(priceOf({price:null}),null));
test('selected sizes use the variant price',()=>assert.equal(priceOf({price:200,variants:[{size:'58',price:210}]},'58'),210));
test('verified clean local images display',()=>assert.equal(productImage({images:[{url:'original'}]},{byUrl:{original:{status:'clean',url:'/assets/products/clean.png'}}}),'/assets/products/clean.png'));
test('model selection limits sizes to matching products',()=>assert.deepEqual(facetValues(products,{model:'Force II'},'size'),['58']));
test('facets ignore their own selection but retain other selections',()=>assert.deepEqual(facetValues([...products,{...products[0],id:'3',color:'Azul'}],{model:'Force II',color:'Preto'},'color'),['Azul','Preto']));
test('model facet excludes unrelated categories even on a model-only link',()=>assert.deepEqual(facetValues([...products,{...products[1],model:'Casual'}],{model:'Force II'},'model'),['Force II']));
test('clearing filters keeps category and search context',()=>assert.deepEqual(clearedFilters({category:'capacetes',q:'preto',model:'Force II',size:'58',sort:'name'}),{category:'capacetes',q:'preto',sort:'name'}));
const galleryProduct={images:[{url:'pending'},{url:'approved'},{url:'another'}]};
const galleryManifest={byUrl:{approved:{status:'edited',url:'/assets/products/approved.png'},another:{status:'clean',url:'/assets/products/another.png'}}};
test('first approved image can be after index zero',()=>assert.equal(approvedImageIndex(galleryProduct,galleryManifest),1));
test('invalid preferred image falls back to an approved image',()=>assert.equal(approvedImageIndex(galleryProduct,galleryManifest,0),1));
test('valid gallery selection remains selected',()=>assert.equal(approvedImageIndex(galleryProduct,galleryManifest,2),2));
test('unapproved gallery never falls back to original image',()=>assert.equal(approvedImageIndex(galleryProduct,{}),null));
test('cart count uses singular and plural correctly',()=>{assert.equal(itemCountLabel(1),'1 item');assert.equal(itemCountLabel(0),'0 itens');assert.equal(itemCountLabel(2),'2 itens');});
test('explicitly authorized original images display over HTTPS',()=>assert.equal(productImage({images:[{url:'source-image'}]},{byUrl:{'source-image':{status:'original',url:'https://noriskbr.vteximg.com.br/arquivos/ids/123/product.jpg'}}}),'https://noriskbr.vteximg.com.br/arquivos/ids/123/product.jpg'));
test('authorized local originals are eligible for gallery selection',()=>assert.equal(approvedImageIndex({images:[{url:'source-image'}]},{byUrl:{'source-image':{status:'original',url:'/assets/products/original.jpg'}}}),0));
test('original approval does not allow unsafe URL schemes',()=>assert.equal(productImage({images:[{url:'source-image'}]},{byUrl:{'source-image':{status:'original',url:'javascript:alert(1)'}}}),null));
test('legacy nolimit slug resolves to renamed no-limite product',()=>{const product={slug:'capacete-no-limite-razor-full-rosa-brilho'};assert.equal(findProductByPath([product],'/produto/capacete-nolimit-razor-full-rosa-brilho'),product);});
test('current slug keeps exact-match priority and absent slug stays missing',()=>{const product={slug:'capacete-no-limite-razor'};assert.equal(findProductByPath([product],'/produto/capacete-no-limite-razor'),product);assert.equal(findProductByPath([product],'/produto/inexistente'),undefined);});
