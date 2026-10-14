"""Build a source-price-free public catalogue and local non-helmet assets."""
import concurrent.futures
import hashlib
import io
import json
import re
import shutil
import sys
import urllib.request
import urllib.parse
from html.parser import HTMLParser
from pathlib import Path

from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
DIST = ROOT / 'public'
ASSETS = DIST / 'assets' / 'accessories'
SOURCE = ROOT / 'source-images' / 'accessories'
REVIEW = SOURCE / 'review-webp'
SPEC_KEYS = {'MATERIAL', 'ACABAMENTO', 'MODELOS', 'GÊNERO', 'COR'}
INSTITUTIONAL = re.compile(r'\b(certificad[oa]s?|certifica[çc](?:[aã]o|[oõ]es)|homologa[çc](?:[aã]o|[oõ]es)|homologad[oa]s?|inmetro|ece\s*[0-9]|dot\b|garantia|licen[çc]a oficial|parceria|colabora[çc][aã]o|inovou|apresentamos|lan[çc]amento|somos|nossa empresa|melhor do mercado|produto exclusivo|experi[êe]ncia [úu]nica|tem o prazer de|mercado brasileiro|compre|adquira|tudo conversa)\b', re.I)

class DescriptionText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ['script', 'style']:
            self.hidden += 1
        if not self.hidden and tag in ['p', 'div', 'br', 'li', 'h1', 'h2', 'h3']:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ['script', 'style']:
            self.hidden = max(0, self.hidden-1)
        elif not self.hidden and tag in ['p', 'div', 'li', 'h1', 'h2', 'h3']:
            self.parts.append('\n')

    def handle_data(self, value):
        if not self.hidden:
            self.parts.append(value)

def technical_description(p):
    parser = DescriptionText()
    parser.feed(p['description'])
    text = re.sub(r'\b(?:norisk|no\s*limite?)\b', 'Norisk', ''.join(parser.parts), flags=re.I)
    paragraphs = []
    for raw in text.splitlines():
        raw = re.sub(r'\s+', ' ', raw).strip()
        if not raw:
            continue
        sentences = re.split(r'(?<=[.!?;])\s+(?=[A-ZÀ-Ú•])|\s*(?=•)', raw)
        retained = []
        for sentence in sentences:
            sentence = re.sub(r'(?:,\s*(?:com|também)|\s+(?:e|com))\s+certific.*$', '.', sentence, flags=re.I)
            sentence = re.sub(r'\s+CE\s+Nível\s+\d+', '', sentence, flags=re.I).strip()
            if not sentence or INSTITUTIONAL.search(sentence) or re.match(r'^(?:(?:Norisk|No\s+Limite)\s+X\s+|Que foi cuidadosamente projetad|É urbano, é atual)', sentence, re.I):
                continue
            retained.append(sentence)
        # Source bullets remain distinct; longer prose is grouped into short paragraphs.
        group = []
        for sentence in retained:
            if sentence.startswith('•'):
                if group:
                    paragraphs.append(' '.join(group))
                    group = []
                paragraphs.append(sentence)
            else:
                group.append(sentence)
                if len(group) == 2:
                    paragraphs.append(' '.join(group))
                    group = []
        if group:
            paragraphs.append(' '.join(group))
    result = '\n\n'.join(paragraphs)
    return result or re.sub(r'\b(?:norisk|no\s*limite?)\b', 'Norisk', p['name'].capitalize(), flags=re.I) + '.'

def public_product(p):
    keys = ['id', 'slug', 'name', 'category', 'subcategory', 'model', 'color', 'finish', 'price', 'imageStatus']
    public = {k: p[k] for k in keys}
    public['description'] = technical_description(p)
    public['specs'] = {k: v for k, v in p['specs'].items() if k in SPEC_KEYS}
    public['images'] = [{'url': i['url'], 'alt': i['alt']} for i in p['images']]
    public['variants'] = [{k: v[k] for k in ['id', 'size', 'available', 'price']} for v in p['variants']]
    return public

def download(record):
    image = record['image']
    source_path = SOURCE / (image['sourceImageId'] + '.source')
    url = urllib.parse.quote(re.sub(r'/ids/(\d+)/', r'/ids/\1-800-800/', image['url']), safe=':/?&=%')
    if not source_path.exists():
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=90) as response:
            source_path.write_bytes(response.read())
    with Image.open(source_path) as original:
        image800 = ImageOps.exif_transpose(original).convert('RGB')
        image800.thumbnail((800, 800))
        digest = hashlib.sha256(image800.tobytes() + str(image800.size).encode()).hexdigest()
        path = REVIEW / (digest[:24] + '.webp')
        if not path.exists():
            image800.save(path, 'WEBP', quality=88, method=6)
    return {'url': record['image']['url'], 'path': '/assets/accessories/' + path.name, 'localPath': str(path), 'sha256': digest, 'sourceImageId': record['image']['sourceImageId'], 'productIds': record['productIds'], 'status': 'needsReview', 'reviewReason': 'Brand visibility has not yet been individually verified.'}

def main():
    for folder in [DIST / 'data', ASSETS, SOURCE, REVIEW]:
        folder.mkdir(parents=True, exist_ok=True)
    catalogue = json.loads((DATA / 'catalog.json').read_text())
    public = [public_product(p) for p in catalogue]
    (DIST / 'data' / 'catalog.json').write_text(json.dumps(public, ensure_ascii=False, separators=(',', ':'))+'\n')
    if '--catalog-only' in sys.argv:
        print(json.dumps({'products': len(public), 'mode': 'catalog-only'}))
        return
    records = {}
    for product in catalogue:
        if product['category'] == 'capacetes':
            continue
        for image in product['images']:
            record = records.setdefault(image['url'], {'image': image, 'productIds': []})
            record['productIds'].append(product['id'])
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(download, records.values()))
    previous_path = DATA / 'accessory-image-manifest.json'
    previous = json.loads(previous_path.read_text()).get('byUrl', {}) if previous_path.exists() else {}
    for record in results:
        prior = previous.get(record['url'], {})
        if prior.get('sha256') == record['sha256']:
            for key in ['status', 'reviewReason', 'reviewedAt']:
                if key in prior:
                    record[key] = prior[key]
        public_path = ASSETS / Path(record['localPath']).name
        if record['status'] == 'clean':
            shutil.copy2(record['localPath'], public_path)
        else:
            record['path'] = None
            public_path.unlink(missing_ok=True)
    by_url = {r['url']: {k: v for k, v in r.items() if k != 'url'} for r in results}
    manifest = {'byUrl': by_url, 'referenceCount': len(results), 'uniqueImages': len({r['sha256'] for r in results}), 'reviewPolicy': 'needsReview until visual inspection establishes no visible Norisk branding. Source images are outside dist; reviewed presentation must use manifest status.'}
    manifest['statusCounts'] = {status: sum(r['status'] == status for r in results) for status in ['clean', 'needsReview']}
    manifest['publicationPolicy'] = 'Only clean images are copied into dist/assets/accessories; all pending review WebPs remain in source-images/accessories/review-webp.'
    (DATA / 'accessory-image-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
    unique = list({r['sha256']: r for r in results}.values())
    for start in range(0, len(unique), 80):
        subset = unique[start:start+80]
        sheet = Image.new('RGB', (1400, ((len(subset)+7)//8)*165), 'white')
        draw = ImageDraw.Draw(sheet)
        for index, record in enumerate(subset):
            with Image.open(record['localPath']) as img:
                img.thumbnail((165, 140))
                x, y = (index % 8)*175, (index // 8)*165
                sheet.paste(img, (x+(175-img.width)//2, y))
                draw.text((x+5,y+141), str(start+index)+': '+','.join(record['productIds']), fill='black')
        sheet.save(SOURCE / f'contact-{start//80+1}.jpg', quality=85)
    (DATA / 'accessory-contact-index.json').write_text(json.dumps(unique, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'products': len(public), 'nonHelmetProducts': sum(p['category']!='capacetes' for p in public), 'urlReferences': len(results), 'uniqueImages': len(unique), 'contactSheets': (len(unique)+79)//80}))

if __name__ == '__main__':
    main()
