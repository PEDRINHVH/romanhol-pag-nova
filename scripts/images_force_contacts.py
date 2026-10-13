import json,pathlib
from PIL import Image,ImageDraw
ROOT=pathlib.Path(__file__).resolve().parents[1]
rows=json.loads((ROOT/'data/force-ii-source-images.json').read_text())
seen={}; groups={}
for row in rows:
    if row['sha256'] in seen: continue
    seen[row['sha256']]=True
    groups.setdefault(row['productId'],[]).append(row)
for product,items in groups.items():
    sheet=Image.new('RGB',(1000,225*((len(items)+4)//5)),'white');d=ImageDraw.Draw(sheet)
    for n,r in enumerate(items):
        im=Image.open(r['path']).convert('RGB');im.thumbnail((198,198))
        x=(n%5)*200;y=(n//5)*225;sheet.paste(im,(x,y));d.text((x+3,y+201),r['imageId'],fill='black')
    sheet.save(ROOT/'image-audit'/f'force-{product}-contact.jpg')
print(json.dumps({p:len(a) for p,a in groups.items()}))
