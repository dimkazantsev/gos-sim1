"""Export generated artwork for the website; retain the original and record its size."""
import argparse,json,hashlib,fcntl
from pathlib import Path
from PIL import Image,ImageOps
p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('number',type=int);p.add_argument('--kind',choices=['event','comic'],default='event');a=p.parse_args()
root=Path(__file__).resolve().parent.parent
if not 1<=a.number<=(200 if a.kind=='event' else 36):p.error('Artwork number is outside the catalogue')
scene=(f'scene-{a.number:03d}' if a.kind=='event' else f'prologue-{a.number:02d}' if a.number<=4 else f'completed-{a.number-4:02d}' if a.number<=20 else f'preview-{a.number-20:02d}')
source=Path(a.source);art=Image.open(source).convert('RGB')
folder='event-art' if a.kind=='event' else 'republic-art'
target=root/'public'/folder;target.mkdir(exist_ok=True)
# Exact 16:9 export and responsive encodings; no collage or substituted scene.
sizes=[(1920,1080),(960,540),(480,270)]
for w,h in sizes:
 temporary=target/f'.{scene}-{w}.tmp'
 ImageOps.fit(art,(w,h),method=Image.Resampling.LANCZOS).save(temporary,'WEBP',quality=90 if w==1920 else 85,method=6)
 temporary.replace(target/f'{scene}-{w}.webp')
(root/'.design-review').mkdir(exist_ok=True)
with (root/'.design-review'/'asset-export.lock').open('w') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 meta=root/'content'/'cinematic-artwork-provenance.json'
 records=json.loads(meta.read_text()) if meta.exists() else {}
 records[scene]={'generated_size':list(art.size),'export_size':[1920,1080],'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'source_file':source.name,'method':'Image generation; 16:9 web export and responsive compression'}
 temporary=meta.with_suffix('.json.tmp');temporary.write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n');temporary.replace(meta)
 manifest=root/'data'/('event-illustrations.json' if a.kind=='event' else 'republic-illustrations.json')
 m=json.loads(manifest.read_text()) if manifest.exists() else {}
 key=(f'bank-curated-v2-{a.number:02d}' if a.number<=50 else f'bank-legal-2026-{a.number-50:03d}') if a.kind=='event' else scene
 m[key]={'src':f'/{folder}/{scene}-1920.webp','width':1920,'height':1080,'srcSet':', '.join(f'/{folder}/{scene}-{w}.webp {w}w' for w,h in reversed(sizes))}
 temporary=manifest.with_suffix('.json.tmp');temporary.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n');temporary.replace(manifest)
print(json.dumps({'scene':scene,'native':art.size,'export':[1920,1080],'bytes':(target/f'{scene}-1920.webp').stat().st_size}))
