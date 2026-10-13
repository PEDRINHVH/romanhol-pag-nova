"""Remove only connected white exterior on explicitly reviewed detail photographs."""
import json
from pathlib import Path
from PIL import Image,ImageChops,ImageOps,ImageDraw
root=Path(__file__).resolve().parents[1]
approved={'375e4371344b2400e8b65414','264cb8df5e2f783795d4b45a','1f07bf0f26dacf5aac9e0b79','b0f441fc1267d1a2e7360eb8'}
jobs=json.loads((root/'image-audit/background-jobs.json').read_text())
used=[]
for job in jobs:
    if Path(job['path']).stem not in approved:continue
    rgb=Image.open(job['path']).convert('RGB')
    red,green,blue=rgb.split()
    white=ImageChops.darker(ImageChops.darker(red,green),blue).point(lambda v:255 if v>=245 else 0)
    padded=ImageOps.expand(white,border=1,fill=255)
    ImageDraw.floodfill(padded,(0,0),128)
    alpha=padded.crop((1,1,rgb.width+1,rgb.height+1)).point(lambda v:0 if v==128 else 255)
    rgb.putalpha(alpha);rgb.save(job['output'])
    used.append(job)
(root/'image-audit/background-fallback.json').write_text(json.dumps(used,indent=2))
print(f'Reviewed rectangular-detail fallbacks: {len(used)}')
