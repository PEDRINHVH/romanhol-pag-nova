"""Import public VTEX catalogue. Source assets/data are kept outside dist."""
import concurrent.futures
import datetime
import html
import json
import re
import urllib.request
import urllib.parse
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
RAW = DATA / 'raw'
BASE = 'https://www.norisk.com.br'

def fetch(start):
    path = RAW / f'products-{start:04}.json'
    if not path.exists():
        url = f'{BASE}/api/catalog_system/pub/products/search?_from={start}&_to={start+49}'
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(request, timeout=90) as response:
            path.write_bytes(response.read())
    return json.loads(path.read_text())

def money(value):
    return float(Decimal(str(value)).quantize(Decimal('.01'), rounding=ROUND_HALF_UP))

def rebrand(value):
    text = re.sub(r'\bnoriskers\b', 'motociclistas', str(value), flags=re.I)
    return re.sub(r'\b(?:norisk|no\s*limite?)\b', 'NO LIMITE', text, flags=re.I)

def plain(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', ' ', rebrand(value)))).strip()

def main():
    RAW.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        batches = list(pool.map(fetch, range(0, 400, 50)))
    source = {p['productId']: p for batch in batches for p in batch}
    products, inventory = [], {}
    downloaded = DATA / 'force-ii-source-images.json'
    hashes = {r['imageId']: r['sha256'] for r in json.loads(downloaded.read_text())} if downloaded.exists() else {}
    roots = {'CAPACETE': 'capacetes', 'VESTUÁRIO': 'vestuario', 'ACESSÓRIOS': 'acessorios', 'LIFESTYLE': 'casual'}
    for p in source.values():
        segments = p['categories'][0].strip('/').split('/')
        category = roots.get(segments[0], 'acessorios')
        specs = {k: [plain(v) for v in p[k]] for k in p.get('allSpecifications', []) if isinstance(p.get(k), list)}
        model = ', '.join(specs.get('MODELOS', []))
        variants, images, seen = [], [], set()
        prices, cash_prices, cash_methods = [], [], []
        for sku in p['items']:
            offer = sku['sellers'][0]['commertialOffer']
            regular = offer.get('Price') or None
            pix = [i['TotalValuePlusInterestRate'] for i in offer.get('Installments', []) if 'pix' in i.get('PaymentSystemName', '').lower() and i.get('TotalValuePlusInterestRate', 0) > 0]
            cash = min(pix) if pix else money(regular * .95) if regular else None
            cash_method = 'api_pix' if pix else 'derived_global_5_percent' if regular else 'unavailable'
            price = 179.90 if model.upper() == 'FORCE II' else money(cash * 179.9 / 854.9) if cash else None
            variants.append({'id': sku['itemId'], 'size': ', '.join(sku.get('TAMANHO', [])) or sku['name'], 'available': None, 'sourceAvailable': bool(offer.get('IsAvailable')), 'sourcePrice': regular, 'sourceCashPrice': cash, 'sourceCashPriceMethod': cash_method, 'price': price})
            if regular:
                prices.append(regular)
                cash_prices.append(cash)
                cash_methods.append(cash_method)
            for img in sku['images']:
                key = img['imageId']
                record = inventory.setdefault(key, {'id': key, 'url': img['imageUrl'], 'categories': [], 'productIds': [], 'models': []})
                for field, value in [('categories', category), ('productIds', p['productId']), ('models', model)]:
                    if value not in record[field]:
                        record[field].append(value)
                filename = urllib.parse.unquote(img['imageUrl'].split('/')[-1]).split('?')[0]
                image_key = hashes.get(key, filename)
                if image_key not in seen and filename not in seen:
                    seen.add(image_key)
                    seen.add(filename)
                    images.append({'url': img['imageUrl'], 'alt': plain(p['productName']) + f' — vista {len(images)+1}', 'sourceImageId': key})
        regular = min(prices) if prices else None
        cash = min(cash_prices) if cash_prices else None
        source_finish = ', '.join(specs.get('ACABAMENTO', []))
        explicit_finish = re.search(r'\b(FOSC[OA]|BRILHO|BRILHANTE)\b', p['productName'], re.I)
        if explicit_finish:
            specs['ACABAMENTO'] = ['FOSCO' if explicit_finish[1].upper().startswith('FOSC') else 'BRILHO']
        products.append({'id': p['productId'], 'slug': re.sub(r'\b(?:norisk|nolimit)\b', 'no-limite', p['linkText'], flags=re.I), 'name': plain(p['productName']), 'sourceName': p['productName'], 'category': category, 'subcategory': segments[1].lower() if len(segments)>1 else '', 'model': model, 'color': ', '.join(specs.get('COR', [])), 'finish': ', '.join(specs.get('ACABAMENTO', [])), 'description': plain(p.get('description', '')), 'specs': specs, 'images': images, 'variants': variants, 'sourceUrl': p['link'], 'sourcePrice': regular, 'sourceCashPrice': cash, 'sourceCashPriceMethod': ','.join(sorted(set(cash_methods))) or 'unavailable', 'price': 179.90 if model.upper() == 'FORCE II' else money(cash * 179.9 / 854.9) if cash else None, 'imageStatus': 'pending', 'specificationStatus': 'source_pending_supplier_validation', 'inventoryStatus': 'pending_nolimit_confirmation'})
        products[-1]['sourceFinish'] = source_finish
        products[-1]['finishNormalization'] = 'explicit_product_name' if explicit_finish else 'source_attribute'
    categories = []
    for key in roots.values():
        group = [p for p in products if p['category'] == key]
        categories.append({'id': key, 'products': len(group), 'skus': sum(len(p['variants']) for p in group), 'uniqueImageAssetIds': sum(key in i['categories'] for i in inventory.values()), 'galleryImages': sum(len(p['images']) for p in group), 'subcategories': sorted({p['subcategory'] for p in group}), 'models': sorted({p['model'] for p in group if p['model']})})
    force = [p for p in products if p['model'].upper() == 'FORCE II']
    meta = {'fetchedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'source': BASE, 'expectedPublicProducts': 399, 'products': len(products), 'skus': sum(len(p['variants']) for p in products), 'uniqueImages': len(inventory), 'categories': categories, 'forceII': {'products': len(force), 'images': len({i['sourceImageId'] for p in force for i in p['images']})}, 'pricing': {'forceII': 179.9, 'ratio': 179.9/854.9, 'basis': 'source API Pix when available; otherwise source selling price times 0.95, from global cash banner', 'missingPriceProducts': sum(p['price'] is None for p in products)}, 'caveats': ['Public active/catalog-visible products only; hidden/deleted products unavailable through public catalogue.', 'Source availability does not establish NoLimit inventory.', 'Technical specifications await supplier validation.', 'Original brand images await replacement and must not be published as rebranded assets.']}
    meta['galleryDeduplication'] = 'Identical downloaded SHA256 when available; otherwise same filename within each product. All original asset IDs remain in image-inventory.json; filename equivalence outside downloaded Force II remains unverified.'
    meta['galleryImages'] = sum(len(p['images']) for p in products)
    meta['caveats'][1] = 'Source availability does not establish No Limite inventory.'
    meta['caveats'][3] = 'Original Norisk-branded photographs are retained as explicitly authorized by the store owner.'
    for name, value in [('catalog.json', products), ('catalog-summary.json', meta), ('image-inventory.json', list(inventory.values())), ('navigation.json', categories)]:
        (DATA/name).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(meta, ensure_ascii=False))

if __name__ == '__main__':
    main()
