"""Reproducible white-matte refinement for the reviewed black Force II hero."""
import hashlib,io,json
from pathlib import Path
import cv2
import numpy as np
from scipy.ndimage import distance_transform_edt
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parents[1]
pixel_hash='b77e8e211fe4631ed582128dcf0250ab7ae1d13b8bca0196c3febd2c4a1d2011'
source=root/'processed-images/f454d61135b0957c467a.jpg'
rgb=np.asarray(Image.open(source).convert('RGB')).astype(np.float32)
white=rgb.min(axis=2)>=245
# A narrow unknown band follows the actual photographic contour, including the visor opening.
interior=(~white).astype(np.uint8)
core=cv2.erode(interior,np.ones((5,5),np.uint8)).astype(bool)
_,nearest=distance_transform_edt(~core,return_indices=True)
foreground=rgb[nearest[0],nearest[1]]
unknown=cv2.dilate(white.astype(np.uint8),np.ones((5,5),np.uint8)).astype(bool)&~white
denominator=255-foreground
alpha=np.ones(white.shape,np.float32)
estimated=np.sum((255-rgb)*denominator,axis=2)/np.maximum(np.sum(denominator**2,axis=2),1)
alpha[unknown]=np.clip(estimated[unknown],0,1)
alpha[white]=0
clean=rgb.copy()
clean[unknown]=np.clip((rgb[unknown]-(1-alpha[unknown,None])*255)/np.maximum(alpha[unknown,None],.001),0,255)
clean[white]=0
result=Image.fromarray(np.dstack([np.rint(clean).astype(np.uint8),np.rint(alpha*255).astype(np.uint8)]))
folder=root/'image-audit/hero-refinement';folder.mkdir(exist_ok=True)
output=folder/'force-394-matte-refined.png';result.save(output)
config=root/'image-audit/background-overrides.json'
overrides=json.loads(config.read_text()) if config.exists() else {}
overrides[pixel_hash]={'path':str(output),'method':'reviewed-white-matte-decontamination'}
config.write_text(json.dumps(overrides,indent=2))
manifest_path=root/'public/data/image-manifest.json';manifest=json.loads(manifest_path.read_text())
downloads=json.loads((root/'image-audit/all-downloads.json').read_text())
urls=[r['originalUrl'] for r in downloads if r['pixelHash']==pixel_hash]
old_url=manifest['byUrl'][urls[0]]['url']
old=Image.open(root/'public'/old_url.lstrip('/')).convert('RGBA')
buf=io.BytesIO();result.save(buf,format='WEBP',quality=90,method=4)
data=buf.getvalue();digest=hashlib.sha256(data).hexdigest()[:24]
new_url=f'/assets/products/{digest}.webp';(root/'public'/new_url.lstrip('/')).write_bytes(data)
for url in urls:
    manifest['byUrl'][url].update(url=new_url,method='reviewed-white-matte-decontamination',backgroundRemoved=True)
temporary=manifest_path.with_suffix('.tmp');temporary.write_text(json.dumps(manifest,separators=(',',':')));temporary.replace(manifest_path)
new=Image.open(io.BytesIO(data)).convert('RGBA')
sheet=Image.new('RGB',(1600,1600));draw=ImageDraw.Draw(sheet)
for row,color in enumerate(['#101820','#0756ce']):
    for column,(title,photo) in enumerate([('ANTES',old),('DEPOIS',new)]):
        panel=Image.new('RGB',(800,800),color);panel.paste(photo,(0,0),photo)
        sheet.paste(panel,(column*800,row*800));draw.text((column*800+12,row*800+12),title,fill='white')
sheet.save(folder/'before-after-graphite-blue.jpg',quality=95)
report={'oldUrl':old_url,'newUrl':new_url,'referencesUpdated':len(urls),'alphaExtrema':new.getchannel('A').getextrema(),'overridePixelHash':pixel_hash}
(folder/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
