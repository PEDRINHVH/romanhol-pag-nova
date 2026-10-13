"""Publish original photographs, preserving NORISK per explicit user direction."""
import collections,hashlib,io,json,pathlib,datetime,concurrent.futures,subprocess,sys
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parents[1]
audit=ROOT/'image-audit';dest=ROOT/'public/assets/products';dest.mkdir(parents=True,exist_ok=True)
downloads=json.loads((audit/'all-downloads.json').read_text())
rows_by_url={r['originalUrl']:r for r in downloads}
catalog=json.loads((ROOT/'data/catalog.json').read_text())
accessories=json.loads((ROOT/'data/accessory-image-manifest.json').read_text())
catalog_urls={photo['url'] for p in catalog for photo in p['images']}
sources={};url_keys={}
for row in downloads:
    if row['originalUrl'] not in catalog_urls:continue
    key=('products',row['pixelHash'])
    sources.setdefault(key,row['path']);url_keys[row['originalUrl']]=key
for url,row in accessories['byUrl'].items():
    if url not in catalog_urls:continue
    key=('accessories',row['sha256'])
    sources.setdefault(key,row['localPath']);url_keys[url]=key
missing=catalog_urls-url_keys.keys()
if missing:raise RuntimeError(f'Missing original sources for {len(missing)} catalog URLs')
blank_keys=set()
for key,path in sources.items():
    with Image.open(path) as image:
        if image.convert('RGB').getextrema()==((255,255),(255,255),(255,255)):blank_keys.add(key)
replacements={}
for product in catalog:
    usable=next((photo['url'] for photo in product['images'] if url_keys[photo['url']] not in blank_keys),None)
    for photo in product['images']:
        url=photo['url']
        if url_keys[url] in blank_keys:
            if not usable:raise RuntimeError(f'Product {product["id"]} has only blank sources')
            replacements[url]=usable;url_keys[url]=url_keys[usable]
for key in blank_keys:sources.pop(key)
cutout_dir=ROOT/'processed-images/background-removed';cutout_dir.mkdir(parents=True,exist_ok=True)
override_path=audit/'background-overrides.json'
overrides=json.loads(override_path.read_text()) if override_path.exists() else {}
jobs=[];cutouts={}
for key,path in sources.items():
    output=cutout_dir/f'{key[0]}-{key[1]}.png'
    cutouts[key]=output
    jobs.append({'path':str(path),'output':str(output)})
jobs_path=audit/'background-jobs.json';jobs_path.write_text(json.dumps(jobs))
binary=pathlib.Path('/tmp/norisk-background')
subprocess.run(['swiftc',str(ROOT/'scripts/images_background.swift'),'-o',str(binary)],check=True)
with (audit/'background-batch.log').open('w') as log:
    subprocess.run([str(binary),str(jobs_path)],stdout=log,stderr=subprocess.STDOUT,check=True)
if any(not path.is_file() for path in cutouts.values()):
    subprocess.run([sys.executable,str(ROOT/'scripts/images_background_fallback.py')],check=True)
failed=[str(path) for path in cutouts.values() if not path.is_file()]
if failed:
    (audit/'background-failed.json').write_text(json.dumps(failed,indent=2))
    raise RuntimeError(f'Background removal failed for {len(failed)} images; manifest not published')

def publish(item):
    key,path=item
    override=overrides.get(key[1],{})
    with Image.open(override.get('path',cutouts[key])) as source:
        im=source.convert('RGBA')
        im.thumbnail((800,800),Image.Resampling.LANCZOS)
        alpha=im.getchannel('A')
        if alpha.getextrema()!=(0,255):raise RuntimeError(f'Invalid transparent cutout alpha: {key}, {alpha.getextrema()}')
        buf=io.BytesIO();im.save(buf,format='WEBP',quality=90,method=4)
    data=buf.getvalue();digest=hashlib.sha256(data).hexdigest()[:24]
    relative=f'/assets/{key[0]}/{digest}.webp'
    target=ROOT/'public'/relative.lstrip('/');target.parent.mkdir(parents=True,exist_ok=True)
    target.write_bytes(data)
    detail_ids={'375e4371344b2400e8b65414','264cb8df5e2f783795d4b45a','1f07bf0f26dacf5aac9e0b79','b0f441fc1267d1a2e7360eb8'}
    method='reviewed-white-exterior' if pathlib.Path(path).stem in detail_ids else 'apple-vision-foreground'
    method=override.get('method',method)
    return key,{'url':relative,'status':'original','backgroundRemoved':True,'method':method}

assets={}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    for key,value in pool.map(publish,sources.items()):
        assets[key]=value
        if len(assets)%200==0:print(f'Published {len(assets)}/{len(sources)} original assets',flush=True)
manifest={'byUrl':{url:assets[url_keys[url]] for url in sorted(catalog_urls)}}
for url,replacement in replacements.items():
    manifest['byUrl'][url]={**manifest['byUrl'][url],'sourceWasBlank':True,'replacementSourceUrl':replacement}
published_urls={row['url'] for row in manifest['byUrl'].values()}
assert all((ROOT/'public'/url.lstrip('/')).is_file() for url in published_urls)
coverage={'originalUrls':len(catalog_urls),'allCatalogUrls':len(catalog_urls),
          'helmetUrls':sum(key[0]=='products' for key in url_keys.values()),
          'helmetUniquePixelHashes':sum(key[0]=='products' for key in sources),
          'accessoryUrls':sum(key[0]=='accessories' for key in url_keys.values()),
          'totalPublishedFiles':len(published_urls),'publishedOriginalUrls':len(manifest['byUrl']),'failed':0,
          'backgroundRemovalFailed':0,'alphaAuditedAssets':len(sources),
          'blankSourceUrlsReplaced':len(replacements),'blankSourceUniqueImages':len(blank_keys),
          'urlStatuses':dict(collections.Counter(r['status'] for r in manifest['byUrl'].values()))}
manifest['coverage']=coverage;manifest['generatedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
manifest['imagePolicy']='Original product appearance and NORISK branding preserved; backgrounds removed by explicit user direction.'
target=ROOT/'public/data/image-manifest.json';temporary=target.with_suffix('.tmp')
temporary.write_text(json.dumps(manifest,separators=(',',':')));temporary.replace(target)
(audit/'original-coverage.json').write_text(json.dumps(coverage,indent=2))
print(json.dumps(coverage),flush=True)
