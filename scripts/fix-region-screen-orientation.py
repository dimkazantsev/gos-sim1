"""Correct north-up SVG coordinates; leave source geographic boundaries unchanged."""
import json,re
from pathlib import Path
p=Path(__file__).resolve().parent.parent/'data/region-paths.json';m=json.loads(p.read_text())
if not m.get('screen_north_up'):
 for feature in m['paths']:
  feature['path']=re.sub(r'([ML])(-?[0-9]+(?:\.[0-9]+)?),(-?[0-9]+(?:\.[0-9]+)?)',lambda q:f'{q[1]}{q[2]},{m["height"]-float(q[3]):.1f}',feature['path'])
 m['screen_north_up']=True
 m['projection']+='; north-up SVG screen coordinates'
 p.write_text(json.dumps(m,ensure_ascii=False,separators=(',',':'))+'\n')
 print('Corrected 89 region paths to north-up orientation')
else:print('Already north-up; no changes')
