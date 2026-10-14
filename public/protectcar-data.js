// Product options transcribed from https://www.lojaprotectcar.com/ on 2026-10-14.
export {PROTECTCAR_VEHICLES} from './protectcar-vehicles.js';

export const PROTECTCAR_COLORS = ['Preto', 'Cinza', 'Bege'];
export const PROTECTCAR_TEXTURES = ['Circuito / Tech', 'Fluxo / Ondas', 'Pedra / Off-Road'];
export const PROTECTCAR_KITS = [
  {id:'carro-interno', size:'Carro — kit interno', vehicleType:'carro', price:97.83},
  {id:'carro-completo', size:'Carro — interno + porta-malas', vehicleType:'carro', price:123.50},
  {id:'picape-interno', size:'Picape — kit interno', vehicleType:'picape', price:138.90},
  {id:'picape-completo', size:'Picape — interno + caçamba', vehicleType:'picape', price:167.96},
];

export const PROTECTCAR_PRODUCT = {
  id:'protectcar-bandeja-3d',
  slug:'tapete-bandeja-3d-protectcar',
  configurationType:'protectcar',
  name:'Tapete Bandeja 3D ProtectCar',
  category:'acessorios',
  subcategory:'tapetes-automotivos',
  model:'Bandeja 3D',
  price:97.83,
  description:'Tapete automotivo em formato bandeja, com bordas elevadas, base antiderrapante e espessura de 3 mm. Configure o kit para carro ou picape e informe marca, modelo e ano do veículo. Escolha a cor e a textura para sua configuração. O kit completo inclui porta-malas para carro ou caçamba para picape.',
  specs:{'Tipo':'Tapete automotivo em formato bandeja','Material':'Polipropileno de alta densidade + TPE moldado em 3D','Espessura':'3 mm','Base':'Antiderrapante','Configuração':'Marca, modelo e ano do veículo','Cores':PROTECTCAR_COLORS,'Texturas':PROTECTCAR_TEXTURES},
  images:[
    {url:'/assets/protectcar/produto.webp',alt:'Tapete Bandeja 3D ProtectCar'},
    {url:'/assets/protectcar/produto-2.webp',alt:'Detalhes do tapete Bandeja 3D ProtectCar'},
    {url:'/assets/protectcar/kit-completo.webp',alt:'Kit de tapetes ProtectCar'},
  ],
  variants:PROTECTCAR_KITS.map(kit=>({id:kit.id,size:kit.size,price:kit.price,available:true})),
};
