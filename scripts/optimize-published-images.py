"""Reduce published image transfer sizes, preserving source backups and alpha."""
from pathlib import Path
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
import shutil
import json

root = Path(__file__).resolve().parents[1]
files = list((root / 'public/assets').rglob('*.webp'))
before = sum(p.stat().st_size for p in files)
catalog = json.loads((root / 'public/data/catalog.json').read_text())
manifest = json.loads((root / 'public/data/image-manifest.json').read_text())['byUrl']
primary = {Path(manifest.get(p['images'][0]['url'], {}).get('url') or '').name for p in catalog if p.get('images')}
primary.add('3602db36231bb7b8bc62c9cd.webp')
def optimize(p):
    backup = root / 'image-audit/original-published' / p.relative_to(root / 'public')
    backup.parent.mkdir(parents=True, exist_ok=True)
    if not backup.exists(): shutil.copy2(p, backup)
    with Image.open(backup) as im:
        maximum = 800 if p.name in primary else 640
        with Image.open(p) as current: preserve_primary = p.name in primary and max(current.size) < maximum
        im.thumbnail((maximum, maximum), Image.Resampling.LANCZOS)
        tmp = p.with_suffix('.optimized.webp')
        im.save(tmp, 'WEBP', quality=64, method=5, exact=True)
    if preserve_primary or tmp.stat().st_size < p.stat().st_size: tmp.replace(p)
    else: tmp.unlink()
with ThreadPoolExecutor(max_workers=6) as pool: list(pool.map(optimize, files))
after = sum(p.stat().st_size for p in files)
print(f'{len(files)} images: {before / 1048576:.1f} MiB -> {after / 1048576:.1f} MiB; originals retained privately')
