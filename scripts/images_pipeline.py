"""Download resized helmet photographs, deduplicate pixels and keep honest audit statuses."""
import concurrent.futures, hashlib, io, json, pathlib, re, subprocess, sys, time
import urllib.request
import urllib.parse
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / 'processed-images'
AUDIT = ROOT / 'image-audit'
for directory in [CACHE, AUDIT]:
    directory.mkdir(exist_ok=True)

def download(url):
    key = hashlib.sha256(url.encode()).hexdigest()[:20]
    cached = CACHE / (key + '.jpg')
    if not cached.exists():
        sized = re.sub(r'/ids/(\d+)(?:-\d+-\d+)?/', r'/ids/\1-800-800/', url)
        sized = urllib.parse.quote(sized, safe=':/?=&%')
        request = urllib.request.Request(sized, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(request, timeout=45) as response:
            picture = Image.open(io.BytesIO(response.read())).convert('RGB')
            picture.thumbnail((800, 800))
            picture.save(cached, quality=94)
    picture = Image.open(cached).convert('RGB')
    digest = hashlib.sha256(picture.tobytes()).hexdigest()
    return {'originalUrl': url, 'path': str(cached), 'pixelHash': digest, 'status': 'pending'}

def main():
    catalog = json.loads((ROOT/'data/catalog.json').read_text())
    helmets = [p for p in catalog if p['category'] == 'capacetes']
    if '--pilot' in sys.argv:
        models = ['SOUL II','RAZOR','ROUTE','CARBON R','FLOW','NEO','ORION SV','STRADA II','FORCE II','V8']
        products = [next(p for p in helmets if p['model'] == m) for m in models]
        urls = list(dict.fromkeys(i['url'] for p in products for i in p['images'][:1]))
        prefix = 'pilot'
    else:
        urls = list(dict.fromkeys(i['url'] for p in helmets for i in p['images']))
        prefix = 'all'
    rows = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        jobs = {pool.submit(download, url): url for url in urls}
        for job in concurrent.futures.as_completed(jobs):
            try: rows.append(job.result())
            except Exception as error: rows.append({'originalUrl':jobs[job], 'status':'failed','error':str(error)})
            if len(rows)%100 == 0: print('downloaded',len(rows),'/',len(urls),flush=True)
    (AUDIT/(prefix+'-downloads.json')).write_text(json.dumps(rows,indent=2))
    valid = [r for r in rows if r['status'] != 'failed']
    if prefix == 'pilot':
        sheet=Image.new('RGB',(1000, 400*((len(valid)+4)//5)), 'white')
        draw=ImageDraw.Draw(sheet)
        for n,row in enumerate(valid):
            im=Image.open(row['path']);im.thumbnail((198,360))
            x=(n%5)*200;y=(n//5)*400;sheet.paste(im,(x,y));draw.text((x+4,y+365),str(n)+' '+pathlib.Path(row['path']).name[:10],fill='black')
        sheet.save(AUDIT/'pilot-contact.jpg')
    print(json.dumps({'urls':len(rows),'downloaded':len(valid),'uniquePixels':len({r['pixelHash'] for r in valid}),'failed':len(rows)-len(valid)}))

if __name__ == '__main__': main()
