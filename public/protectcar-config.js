import {PROTECTCAR_KITS, PROTECTCAR_VEHICLES, PROTECTCAR_COLORS, PROTECTCAR_TEXTURES} from './protectcar-data.js';

const fields = ['vehicleType', 'brand', 'model', 'year', 'color', 'texture'];
export const isProtectCar = product => product?.id === 'protectcar-bandeja-3d' && product?.configurationType === 'protectcar';

export function normalizeConfiguration(product, size, input) {
  if (!isProtectCar(product)) return undefined;
  const invalid = () => { throw new Error('invalid_configuration'); };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  if (fields.some(field => typeof input[field] !== 'string')) return invalid();
  const configuration = Object.fromEntries(fields.map(field => [field, input[field].trim()]));
  const kit = PROTECTCAR_KITS.find(item => item.size === size);
  const vehicles = Object.hasOwn(PROTECTCAR_VEHICLES, configuration.brand) ? PROTECTCAR_VEHICLES[configuration.brand] : [];
  const vehicle = vehicles.find(item => item.model === configuration.model);
  const year = Number(configuration.year);
  if (!kit || kit.vehicleType !== configuration.vehicleType || !vehicle || !/^\d{4}$/.test(configuration.year) || year < vehicle.from || year > vehicle.to || !PROTECTCAR_COLORS.includes(configuration.color) || !PROTECTCAR_TEXTURES.includes(configuration.texture)) return invalid();
  return configuration;
}

export const configurationKey = configuration => configuration ? JSON.stringify(fields.map(field => configuration[field] ?? '')) : '';
export const configurationLabel = configuration => configuration ? `${configuration.vehicleType === 'picape' ? 'Picape' : 'Carro'} · ${configuration.brand} ${configuration.model} ${configuration.year} · ${configuration.color} · ${configuration.texture}` : '';
