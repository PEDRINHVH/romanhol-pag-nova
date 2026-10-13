"""SIFT/RANSAC proposal transfer. Outputs candidates requiring visual approval."""
import json,pathlib,sys
import cv2,numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[1]
base=json.loads((ROOT/'image-audit/force-394-annotations.json').read_text())
mapping={
 '392': {'181065':'182724','181066':'182719','181067':'182726','181068':'182728','181069':'182730','181070':'182729','181059':'182722','181060':'182741','181061':'182725','181062':'182723','181063':'182727','181064':'182721','181084':'182729'},
 '393': {'190616':'182724','190617':'182719','190618':'182726','190619':'182728','190620':'182729','190621':'182730','190622':'182723','190623':'182722','190624':'182725','190625':'182727','190626':'182741','190627':'182729'}
}
sift=cv2.SIFT_create(nfeatures=5000);matcher=cv2.BFMatcher()
summary=[]
for product,items in mapping.items():
    annotations={}
    for target_id,source_id in items.items():
        src=cv2.imread(str(ROOT/f'source-images/force-ii/394/{source_id}.jpg'),0)
        dst=cv2.imread(str(ROOT/f'source-images/force-ii/{product}/{target_id}.jpg'),0)
        ka,da=sift.detectAndCompute(src,None);kb,db=sift.detectAndCompute(dst,None)
        good=[m for m,n in matcher.knnMatch(da,db,k=2) if m.distance<0.72*n.distance]
        if len(good)<12: summary.append([target_id,'insufficient matches',len(good)]);continue
        a=np.float32([ka[m.queryIdx].pt for m in good]);b=np.float32([kb[m.trainIdx].pt for m in good])
        H,inliers=cv2.findHomography(a,b,cv2.RANSAC,4)
        if H is None or int(inliers.sum())<12:summary.append([target_id,'insufficient inliers',int(inliers.sum()) if inliers is not None else 0]);continue
        marks=[]
        for m in base[source_id]:
            q=cv2.perspectiveTransform(np.float32([m['quad']]),H)[0]
            marks.append({'kind':m['kind'],'quad':q.round(1).tolist()})
        annotations[target_id]=marks
        summary.append([target_id,'candidate',int(inliers.sum()),len(good)])
    (ROOT/f'image-audit/force-{product}-annotations.json').write_text(json.dumps(annotations,indent=2))
(ROOT/'image-audit/transfer-audit.json').write_text(json.dumps(summary,indent=2))
print(summary)
