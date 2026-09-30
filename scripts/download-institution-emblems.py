"""Fetch verified emblem originals and keep the source/licence alongside them."""
import json
import pathlib
import urllib.parse
import urllib.request
import urllib.error
import time

files = {
    'russia.svg': 'Coat of Arms of the Russian Federation.svg',
    'gd.svg': 'Emblem of the State Duma of the Russian Federation.svg',
    'sf.svg': 'Emblem of the Federation Council of Russia.svg',
    'transport.svg': 'Emblem of the Russian Ministry of Transport.svg',
    'health.svg': 'Emblem of Ministry of Health of Russia.svg',
    'finance.svg': 'Emblem of the Ministry of Finance of Russia.svg',
    'culture.svg': 'Emblem of the Ministry of Culture of Russia.svg',
    'science.svg': 'Emblem of the Ministry of Science and Higher Education.svg',
    'education.svg': 'Emblem of the Ministry of Education.svg',
    'economy.svg': 'Min-econom-develop-russia-emblem.svg',
    'foreign.svg': 'Emblem of Ministry of Foreign Affairs of Russia.svg',
    'ecology.jpg': 'Russian-ministry-natural-resources-ecology.jpg',
}
out = pathlib.Path('public/emblems')
out.mkdir(parents=True, exist_ok=True)
sources = []
def fetch(req):
    for attempt in range(5):
        try:
            return urllib.request.urlopen(req, timeout=45)
        except urllib.error.HTTPError as e:
            if e.code not in (429,503) or attempt == 4:
                raise
            time.sleep(min(45, 5 * 2 ** attempt))
params = urllib.parse.urlencode({'action':'query', 'format':'json', 'titles':'|'.join('File:'+t for t in files.values()),
    'prop':'imageinfo', 'iiprop':'url|extmetadata'})
req = urllib.request.Request('https://commons.wikimedia.org/w/api.php?'+params,
    headers={'User-Agent':'GosSimsEducationalGame/1.0 (document emblem attribution)'})
with fetch(req) as res:
    pages = json.load(res)['query']['pages']
by_title = {p['title']:p['imageinfo'][0] for p in pages.values() if 'imageinfo' in p}
for filename, title in files.items():
    info = by_title['File:'+title]
    req = urllib.request.Request(info['url'], headers={'User-Agent':'GosSimsEducationalGame/1.0'})
    with fetch(req) as res:
        content = res.read()
    if filename.endswith('.svg') and b'<svg' not in content[:4096]:
        raise ValueError('Invalid SVG: '+title)
    (out/filename).write_bytes(content)
    sources.append({'file':filename, 'title':title, 'source':info['descriptionurl'],
        'original':info['url'], 'metadata':{k:v.get('value') for k,v in info.get('extmetadata',{}).items()
            if k in ['Artist','Credit','LicenseShortName','LicenseUrl','AttributionRequired','Copyrighted']}})
    print(filename, len(content))
    time.sleep(2)
(out/'sources.json').write_text(json.dumps(sources,ensure_ascii=False,indent=2))
