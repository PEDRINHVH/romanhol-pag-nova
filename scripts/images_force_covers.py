import json,pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
annotations=json.loads((ROOT/'image-audit/force-covers-annotations.json').read_text())
products={'185511':'519','185591':'520','184798':'505','190616':'393','182217':'406','182161':'405','189497':'648','181065':'392'}
for image_id,marks in annotations.items():
    product=products[image_id]
    for mark in marks:
        if mark.get('partial'):mark['slice']=[0.72,1]
        if product in ['519','520','406','405']:
            mark['maskmode']='bright';mark['color']=[238,238,238]
        if product=='520':
            mark['maskmode']='red';mark['color']=[218,0,9]
            if not mark.get('partial'):
                mark['extraMaskPolygons']=[[[328,510],[359,510],[359,541],[328,541]]]
        if product in ['405','406']:
            mark['maskQuad']=[p[:] for p in mark['quad']]
            mark['maskQuad'][2][0]-=10;mark['maskQuad'][3][0]-=10
            mark['extraDilation']=3
        if product=='648':
            mark['maskmode']='magenta' if mark['kind']=='symbol' else 'bright'
            mark['color']=[238,0,219] if mark['kind']=='symbol' else [226,230,230]
    path=ROOT/f'image-audit/force-{product}-cover-annotations.json'
    path.write_text(json.dumps({image_id:marks},indent=2))
    subprocess.run([sys.executable,str(ROOT/'scripts/images_force_edit.py'),product,str(path)],check=True)
