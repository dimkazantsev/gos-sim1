"""Export generated artwork for the website; retain the original and record its size."""
import argparse,json,hashlib
from pathlib import Path
from PIL import Image,ImageOps
p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('number',type=int);a=p.parse_args()
root=Path(__file__).resolve().parent.parent
scene=f'scene-{a.number:03d}'
source=Path(a.source);art=Image.open(source).convert('RGB')
target=root/'public'/'event-art';target.mkdir(exist_ok=True)
# Exact 16:9 export and responsive encodings; no collage or substituted scene.
sizes=[(1920,1080),(960,540),(480,270)]
for w,h in sizes:
 temporary=target/f'.{scene}-{w}.tmp'
 ImageOps.fit(art,(w,h),method=Image.Resampling.LANCZOS).save(temporary,'WEBP',quality=90 if w==1920 else 85,method=6)
 temporary.replace(target/f'{scene}-{w}.webp')
meta=root/'content'/'cinematic-artwork-provenance.json'
records=json.loads(meta.read_text()) if meta.exists() else {}
records[scene]={'generated_size':list(art.size),'export_size':[1920,1080],'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'source_file':source.name,'method':'Image generation; 16:9 web export and responsive compression'}
meta.write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
manifest=root/'data'/'event-illustrations.json'
m=json.loads(manifest.read_text()) if manifest.exists() else {}
key=f'bank-curated-v2-{a.number:02d}' if a.number<=50 else f'bank-legal-2026-{a.number-50:03d}'
m[key]={'src':f'/event-art/{scene}-1920.webp','width':1920,'height':1080,'srcSet':', '.join(f'/event-art/{scene}-{w}.webp {w}w' for w,h in reversed(sizes))}
manifest.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'scene':scene,'native':art.size,'export':[1920,1080],'bytes':(target/f'{scene}-1920.webp').stat().st_size}))
