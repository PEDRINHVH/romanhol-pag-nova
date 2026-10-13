import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const [source, catalog, manifest] = await Promise.all([
  read('data/catalog.json'), read('public/data/catalog.json'), read('public/data/image-manifest.json'),
]);
const originals = new Map(source.map(p => [p.id, p]));
const factor = 179.90 / 854.90;
const rounded = n => Math.round((n + Number.EPSILON) * 100) / 100;
const approved = image => image?.status === 'original';
let variants = 0, force = 0, priced = 0, pictures = 0, withPhoto = 0;
const paths = new Set();
assert.equal(catalog.length, 399, 'Complete public catalogue');
assert.equal(new Set(catalog.map(p => p.id)).size, 399, 'Unique product IDs');
assert.equal(new Set(catalog.map(p => p.slug)).size, 399, 'Unique slugs');

for (const product of catalog) {
  const original = originals.get(product.id);
  assert.ok(original, `Source product ${product.id}`);
  const forceII = product.category === 'capacetes' && product.model === 'FORCE II';
  const expected = forceII ? 179.90 : original.sourceCashPrice == null ? null : rounded(original.sourceCashPrice * factor);
  assert.equal(product.price, expected, `Product price ${product.id}`);
  if (forceII) force++;
  if (product.price != null) priced++;
  const { images, ...text } = product;
  assert.ok(!/norisk/i.test(JSON.stringify(text)), `Public text branding ${product.id}`);
  assert.ok(!Object.keys(product).some(k => k.startsWith('source')), `Private source fields ${product.id}`);
  let productHasPhoto = false;
  for (const item of product.variants) {
    const src = original.variants.find(v => v.id === item.id);
    assert.ok(src, `Source variant ${item.id}`);
    assert.equal(item.available, null, `Inventory must await platform ${item.id}`);
    const expectedVariant = forceII ? 179.90 : src.sourceCashPrice == null ? null : rounded(src.sourceCashPrice * factor);
    assert.equal(item.price, expectedVariant, `Variant price ${item.id}`);
    variants++;
  }
  for (const image of images) {
    const entry = manifest.byUrl[image.url];
    assert.ok(entry, `Manifest includes every image: ${product.id}`);
    if (approved(entry)) {
      assert.equal(entry.backgroundRemoved, true, `Transparent background: ${product.id}`);
      assert.match(entry.url, /^\/assets\/[a-zA-Z0-9/_.-]+$/);
      assert.ok(!entry.url.includes('..'), 'No path traversal');
      paths.add(entry.url);
      pictures++;
      productHasPhoto = true;
    } else {
      assert.equal(entry.url, null, 'Pending images cannot expose source assets');
    }
  }
  if (productHasPhoto) withPhoto++;
}
assert.equal(variants, 1421);
assert.equal(force, 10);
assert.equal(priced, 398);
assert.equal(catalog.find(p => p.id === '692').price, null);
assert.equal(withPhoto, 399, 'Every product has its original photographs');
assert.equal(Object.values(manifest.byUrl).filter(approved).length, 4401, 'Every catalogue image is original');
await Promise.all([...paths].map(async asset => {
  const file = await stat(path.join(root, 'public', asset));
  assert.ok(file.isFile() && file.size > 0, `Published file exists: ${asset}`);
}));
const report = {
  verifiedAt: new Date().toISOString(), products: catalog.length, variants, forceII: force,
  pricedProducts: priced, productsWithApprovedPhoto: withPhoto,
  approvedGalleryReferences: pictures, uniquePublishedImages: paths.size,
  remainingProductsWithoutApprovedPhoto: catalog.length - withPhoto,
  imageCoverage: manifest.coverage, imagePolicy: 'original_branding_explicitly_requested',
  paymentIntegration: 'pending_user_platform',
};
await writeFile(path.join(root, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
