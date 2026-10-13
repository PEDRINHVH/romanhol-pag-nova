"""Download Force II source references at 800px, without modifying pixels."""
import concurrent.futures
import hashlib
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'source-images' / 'force-ii'

def download(job):
    product, image = job
    extension = image['url'].split('?')[0].rsplit('.', 1)[-1].lower()
    path = OUT / product['id'] / (image['sourceImageId'] + '.' + extension)
    path.parent.mkdir(parents=True, exist_ok=True)
    url = re.sub(r'/ids/(\d+)/', r'/ids/\1-800-800/', image['url'])
    if not path.exists():
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=60) as response:
            path.write_bytes(response.read())
    return {'productId': product['id'], 'productName': product['name'], 'imageId': image['sourceImageId'], 'sourceUrl': image['url'], 'downloadUrl': url, 'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'bytes': path.stat().st_size}

products = json.loads((ROOT / 'data' / 'catalog.json').read_text())
jobs = [(p, i) for p in products if p['model'].upper() == 'FORCE II' for i in p['images']]
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    results = list(pool.map(download, jobs))
(ROOT / 'data' / 'force-ii-source-images.json').write_text(json.dumps(results, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'downloads': len(results), 'uniqueContentHashes': len({r['sha256'] for r in results}), 'bytes': sum(r['bytes'] for r in results)}))
