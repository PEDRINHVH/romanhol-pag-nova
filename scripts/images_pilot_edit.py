"""Two manually bounded pilot replacements. Not promoted without visual review."""
import pathlib
import cv2
import numpy as np
from PIL import Image

ROOT=pathlib.Path(__file__).resolve().parents[1]
logo=Image.open(ROOT.parent/'output/nolimit/logos/nolimit-wordmark-branco.png').convert('RGBA')
logo=logo.crop(logo.getbbox())
cases=[
 ('ad741a053e7ea4fe3670', [[107,274],[251,291],[230,329],[105,311]], [[110,278],[242,294],[225,319],[108,307]], 165, 1.0),
 ('f8795741b66633c2feea', [[296,344],[496,568],[465,601],[264,381]], [[289,353],[487,574],[464,589],[274,372]], 77, 0.57),
]
for name,region,target,threshold,opacity in cases:
    rgb=np.array(Image.open(ROOT/'processed-images'/f'{name}.jpg').convert('RGB'))
    zone=np.zeros(rgb.shape[:2],np.uint8)
    cv2.fillPoly(zone,[np.array(region,np.int32)],255)
    gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
    if opacity < 1:
        baseline=cv2.morphologyEx(gray,cv2.MORPH_OPEN,np.ones((15,15),np.uint8))
        mask=(((gray.astype(float)-baseline)>9)&(zone>0)).astype(np.uint8)*255
    else:
        mask=((gray>threshold)&(zone>0)).astype(np.uint8)*255
    mask=cv2.dilate(mask,np.ones((5,5),np.uint8))
    restored=cv2.inpaint(rgb,mask,4,cv2.INPAINT_TELEA)
    art=np.array(logo)
    art[:,:,3]=(art[:,:,3]*opacity).astype(np.uint8)
    h,w=art.shape[:2]
    matrix=cv2.getPerspectiveTransform(np.float32([[0,0],[w,0],[w,h],[0,h]]),np.float32(target))
    layer=cv2.warpPerspective(art,matrix,(rgb.shape[1],rgb.shape[0]))
    alpha=layer[:,:,3:4]/255
    out=(restored*(1-alpha)+layer[:,:,:3]*alpha).astype(np.uint8)
    Image.fromarray(out).save(ROOT/'image-audit'/f'{name}-pilot.png')
    Image.fromarray(mask).save(ROOT/'image-audit'/f'{name}-mask.png')
