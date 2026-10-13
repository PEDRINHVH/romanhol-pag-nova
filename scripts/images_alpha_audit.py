"""Audit published transparent WebP files and generate a stratified visual sheet."""
import json
from pathlib import Path
from PIL import Image, ImageDraw

root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'public/data/image-manifest.json').read_text())
catalog=json.loads((root/'data/catalog.json').read_text())
urls=sorted({x['url'] for x in manifest['byUrl'].values()})
rows=[]
for url in urls:
    with Image.open(root/'public'/url.lstrip('/')) as image:
        alpha=image.getchannel('A')
        hist=alpha.histogram();count=image.width*image.height
        rows.append({'url':url,'width':image.width,'height':image.height,
                     'transparentPixels':hist[0],'opaquePixels':hist[255],
                     'foregroundFraction':sum(hist[128:])/count,
                     'bbox':alpha.getbbox()})
failed=[r for r in rows if not r['transparentPixels'] or not r['opaquePixels'] or not r['bbox']]
report={'uniqueAssets':len(rows),'alphaZero':sum(bool(r['transparentPixels']) for r in rows),
        'alpha255':sum(bool(r['opaquePixels']) for r in rows),'invalid':len(failed),
        'failed':failed,'smallest':sorted(rows,key=lambda r:r['foregroundFraction'])[:8],
        'largest':sorted(rows,key=lambda r:r['foregroundFraction'])[-8:]}
(root/'image-audit/alpha-audit.json').write_text(json.dumps(report,indent=2))
chosen=[]
for category,number in [('capacetes',16),('acessorios',10),('vestuario',4),('casual',2)]:
    products=[p for p in catalog if p['category']==category]
    for n in range(min(number,len(products))):
        p=products[round(n*(len(products)-1)/max(1,min(number,len(products))-1))]
        chosen.append((p['name'],manifest['byUrl'][p['images'][0]['url']]['url']))
for r in report['smallest'][:4]+report['largest'][-4:]:
    chosen.append((f"Area {r['foregroundFraction']:.1%}",r['url']))
cell=240;sheet=Image.new('RGB',(cell*8,cell*((len(chosen)+7)//8)), '#818898')
draw=ImageDraw.Draw(sheet)
for i,(label,url) in enumerate(chosen):
    x=(i%8)*cell;y=(i//8)*cell
    im=Image.open(root/'public'/url.lstrip('/')).convert('RGBA');im.thumbnail((cell-14,cell-38))
    sheet.paste(im,(x+(cell-im.width)//2,y+25+(cell-38-im.height)//2),im)
    draw.text((x+5,y+5),f'{i+1} {label[:28]}',fill='white')
sheet.save(root/'image-audit/background-final-contact.jpg',quality=90)
(root/'image-audit/background-final-contact-index.json').write_text(json.dumps(chosen,indent=2))
print(json.dumps({k:v for k,v in report.items() if k not in ['smallest','largest','failed']}))
if failed:raise SystemExit(1)
