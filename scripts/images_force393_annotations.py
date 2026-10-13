import json,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
annotations={}
for line in (ROOT/'image-audit/force-all-ocr.jsonl').read_text().splitlines():
    row=json.loads(line);image_id=pathlib.Path(row['path']).stem
    if '/393/' not in row['path'] or image_id=='190616':continue
    annotations[image_id]=[{'kind':'wordmark','quad':[[round(v*800,1) for v in p] for p in t['quad']]} for t in row['texts'] if t['text']=='NORISK']
manual={
 '190617':[('symbol',[[350,260],[447,270],[449,317],[353,304]])],
 '190618':[('symbol',[[145,216],[200,226],[194,269],[134,258]]),('wordmark',[[610,406],[650,250],[672,258],[637,421]])],
 '190619':[('symbol',[[614,227],[671,237],[682,285],[624,274]])],
 '190620':[('symbol',[[653,278],[703,288],[710,330],[660,319]])],
 '190621':[('symbol',[[159,282],[217,290],[223,331],[156,319]])],
 '190622':[('wordmark',[[52,324],[62,327],[63,349],[54,346]])],
 '190623':[('wordmark',[[707,276],[719,277],[718,303],[706,299]])],
 '190625':[('wordmark',[[702,494],[733,340],[746,344],[719,507]])],
 '190626':[('wordmark',[[65,306],[89,468],[75,478],[53,317]])],
 '190627':[('wordmark',[[236,500],[313,337],[338,348],[261,516]]),('symbol',[[636,324],[694,336],[703,372],[642,360]])]
}
for image_id,marks in manual.items():
    for kind,quad in marks:annotations[image_id].append({'kind':kind,'quad':quad})
annotations['190622'][-1]['slice']=[0.85,1]
annotations['190623'][-1]['slice']=[0,0.18]
(ROOT/'image-audit/force-393-gallery-annotations.json').write_text(json.dumps(annotations,indent=2))
