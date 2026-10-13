"""Reviewed per-image polygons for Force II; no automatic clean inference."""
import json,pathlib,hashlib,sys
import cv2,numpy as np
from PIL import Image,ImageDraw
ROOT=pathlib.Path(__file__).resolve().parents[1]
product=sys.argv[1] if len(sys.argv)>1 else '394'
dark=product in ['392','393'] or '--dark' in sys.argv
ANN=ROOT/f'image-audit/force-{product}-annotations.json'
if len(sys.argv)>2 and sys.argv[2].endswith('.json'):
    ANN=pathlib.Path(sys.argv[2]).resolve()
annotations=json.loads(ANN.read_text())
logos={}
for kind,name in [('wordmark','wordmark'),('symbol','simbolo')]:
    color='preto' if dark else 'branco'
    im=Image.open(ROOT.parent/f'output/nolimit/logos/nolimit-{name}-{color}.png').convert('RGBA');logos[kind]=np.array(im.crop(im.getbbox()))
outdir=ROOT/f'image-audit/force-{product}-edits';outdir.mkdir(exist_ok=True)
for image_id,marks in annotations.items():
    src=ROOT/f'source-images/force-ii/{product}/{image_id}.jpg'
    rgb=np.array(Image.open(src).convert('RGB'))
    for mark in marks:
        q=np.float32(mark['quad']);mask=np.zeros(rgb.shape[:2],np.uint8)
        mask_quad=np.array(mark.get('maskQuad',mark['quad']),np.int32)
        cv2.fillPoly(mask,[mask_quad],255)
        for polygon in mark.get('extraMaskPolygons',[]):
            cv2.fillPoly(mask,[np.array(polygon,np.int32)],255)
        if product == '521' or mark.get('maskmode') == 'bright':
            gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
            neutral=np.max(rgb,axis=2).astype(float)-np.min(rgb,axis=2)<75
            mask=((mask>0)&(gray>155)&neutral).astype(np.uint8)*255
            mask=cv2.dilate(mask,np.ones((3,3),np.uint8))
        elif mark.get('maskmode') == 'magenta':
            selected=(rgb[:,:,0]>130)&(rgb[:,:,2]>100)&(rgb[:,:,1]<120)
            mask=((mask>0)&selected).astype(np.uint8)*255
            mask=cv2.dilate(mask,np.ones((3,3),np.uint8))
        elif mark.get('maskmode') == 'red':
            selected=(rgb[:,:,0]>130)&(rgb[:,:,1]<110)&(rgb[:,:,2]<110)
            mask=((mask>0)&selected).astype(np.uint8)*255
            mask=cv2.dilate(mask,np.ones((3,3),np.uint8))
        else:
            mask=cv2.dilate(mask,np.ones((5,5),np.uint8))
        if mark.get('extraDilation'):
            size=mark['extraDilation'];mask=cv2.dilate(mask,np.ones((size,size),np.uint8))
        original=rgb.copy()
        white=(np.min(original,axis=2)>248).astype(np.uint8)
        _,components=cv2.connectedComponents(white)
        background=components==components[0,0]
        silhouette=(~background).astype(np.uint8)*255
        silhouette=cv2.erode(silhouette,np.ones((3,3),np.uint8))
        mask=cv2.bitwise_and(mask,silhouette)
        padded=original.copy();padded[silhouette==0]=0
        restored=cv2.inpaint(padded,mask,5,cv2.INPAINT_NS)
        rgb[mask>0]=restored[mask>0]
        art=logos[mark['kind']];h,w=art.shape[:2]
        if 'slice' in mark:
            left,right=mark['slice'];art=art[:,int(left*w):int(right*w)];h,w=art.shape[:2]
        M=cv2.getPerspectiveTransform(np.float32([[0,0],[w,0],[w,h],[0,h]]),q)
        scale=np.float32([[4,0,0],[0,4,0],[0,0,1]])
        large=cv2.warpPerspective(art,scale@M,(rgb.shape[1]*4,rgb.shape[0]*4),flags=cv2.INTER_LINEAR)
        layer=np.array(Image.fromarray(large).resize((rgb.shape[1],rgb.shape[0]),Image.Resampling.LANCZOS)).copy()
        layer[silhouette==0]=0
        vals=cv2.cvtColor(original,cv2.COLOR_RGB2GRAY)[mask>0]
        if dark:
            target=float(np.percentile(vals,7));bg=float(np.percentile(vals,75))
            opacity=np.clip((bg-target)/max(bg,1),0.08,0.9)
        else:
            target=float(np.percentile(vals,93));bg=float(np.percentile(vals,25))
            opacity=np.clip((target-bg)/max(255-bg,1),0.08,0.9)
        if 'color' in mark:
            layer[:,:,:3]=np.array(mark['color'],np.uint8)
            opacity=1
        alpha=layer[:,:,3:4]/255*opacity
        rgb=np.clip(rgb*(1-alpha)+layer[:,:,:3]*alpha,0,255).astype(np.uint8)
    Image.fromarray(rgb).save(outdir/f'{image_id}.png')
sheet=Image.new('RGB',(1000,225*((len(annotations)+4)//5)),'white');d=ImageDraw.Draw(sheet)
for n,image_id in enumerate(annotations):
    im=Image.open(outdir/f'{image_id}.png');im.thumbnail((198,198))
    x=n%5*200;y=n//5*225;sheet.paste(im,(x,y));d.text((x+3,y+201),image_id,fill='black')
sheet.save(ROOT/f'image-audit/force-{product}-edited-contact.jpg')
print('Generated',len(annotations),'review candidates')
