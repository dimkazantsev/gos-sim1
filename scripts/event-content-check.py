"""Validate authored scenarios and create a portable, read-only catalog preview."""
import base64
import hashlib
import html
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1]) if len(sys.argv) > 1 else root.parent / 'deliverables'
out.mkdir(parents=True, exist_ok=True)
cases = json.loads((root / 'content/events-v2.json').read_text())
assert len(cases) == 50
for field in ('case_key', 'title', 'situation'):
    assert len({c[field].strip().casefold() for c in cases}) == 50, field
scenes, geometry, headlines = set(), set(), set()
for c in cases:
    choices, effects = c['decision_options'], c['effect_plan']['options']
    assert 2 <= len(choices) <= 6 and len(choices) == len(effects)
    assert len({x.strip().casefold() for x in choices}) == len(choices)
    assert all(x[0].isupper() for x in [c['title'], c['situation'], *choices])
    assert all(e['key'] == f'option_{i+1}' and e['description'] for i, e in enumerate(effects))
    values = [e['trust'] for e in effects]
    assert any(v > 0 for v in values) and any(v < 0 for v in values) and 0 in values
    scene = c['comic_scene']
    svg = (root / 'public/event-comics' / (scene['scene_id'] + '.svg')).read_bytes()
    doc = ET.fromstring(svg)
    assert doc.attrib['viewBox'] == '0 0 800 450'
    assert b'<script' not in svg and b'foreignObject' not in svg and b'http:' not in svg.replace(b'http://www.w3.org/2000/svg', b'')
    assert b'@keyframes' in svg and b'prefers-reduced-motion' in svg
    scenes.add(hashlib.sha256(svg).hexdigest())
    paths = [e.attrib.get('d', '') for e in doc.iter() if e.tag.endswith('path')]
    geometry.add(hashlib.sha256(json.dumps(paths).encode()).hexdigest())
    assert scene['news_lead'] and scene['media_label'] and scene['alt']
    headlines.add(scene['news_lead'])
    scene['preview'] = 'data:image/svg+xml;base64,' + base64.b64encode(svg).decode()
assert len(scenes) == len(geometry) == len(headlines) == 50
data = json.dumps(cases, ensure_ascii=False).replace('<', '\\u003c')
template = '''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GOS//SIMS · 50 Авторских Событий</title><style>
*{box-sizing:border-box}body{margin:0;background:#f1f4fb;color:#20375b;font:16px system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:30px 24px}header{padding:24px;background:#18346b;color:white;border-radius:20px}header p{line-height:1.65;color:#d9e4fb}h1{font-size:28px;margin:0}h2{margin:10px 0;font-size:26px}input,select,button{font:inherit;padding:12px;border:1px solid #c7d6ed;border-radius:10px;background:white;color:#294d89;min-width:0}button{cursor:pointer}button:disabled{opacity:.4;cursor:default}.tools{display:grid;grid-template-columns:1fr 2fr;gap:12px;margin:24px 0}.navigation{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:20px 0}.scene{background:white;border:1px solid #dbe4f2;border-radius:20px;padding:22px}.scene img{width:100%;border-radius:14px;aspect-ratio:16/9;object-fit:contain;background:#132943}.story{line-height:1.8;white-space:pre-wrap}.tag{display:inline-block;background:#eaf0fb;padding:7px 12px;border-radius:25px;font-size:13px;margin:8px 8px 8px 0}.choice{border:1px solid #dbe3f2;border-radius:12px;padding:17px;margin:12px 0;line-height:1.65}.choice b{display:block}.choice.positive{background:#f0faf5;border-color:#abd4bf}.choice.negative{background:#f4f0f2;border-color:#dcc6ce}.choice.neutral{background:#f6f8fc}.choice p{margin:8px 0 0;color:#536984}small{color:#64758f}.news{padding:18px;border-radius:12px;background:#edf3fd;line-height:1.7}#empty{padding:35px;text-align:center}@media(max-width:650px){main{padding:16px}header,.scene{padding:18px}.tools{grid-template-columns:1fr}h1,h2{font-size:23px}.navigation{flex-wrap:wrap}}
</style></head><body><main><header><h1>GOS//SIMS · 50 Авторских Событий</h1><p>Одна Уникальная Анимированная Сцена Для Каждой Истории. Это Каталог Преподавателя С Разметкой Последствий; Игровые Голосования Проходят В Системе.</p></header><div class="tools"><input id="search" type="search" aria-label="Поиск События" placeholder="Поиск По Названию, Теме Или Истории"><select id="pick" aria-label="Выбрать Событие"></select></div><div class="navigation"><button id="prev">← Предыдущее</button><span id="count"></span><button id="next">Следующее →</button></div><div id="scene"></div></main><script type="application/json" id="catalog">__CATALOG__</script><script>
const cases=JSON.parse(document.getElementById('catalog').textContent),pick=document.getElementById('pick'),scene=document.getElementById('scene');let filtered=cases,index=0;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(){const c=filtered[index];document.getElementById('prev').disabled=index<=0;document.getElementById('next').disabled=index>=filtered.length-1;document.getElementById('count').textContent=filtered.length?(index+1)+' / '+filtered.length:'Совпадений Нет';pick.value=String(index);if(!c){scene.innerHTML='<div id="empty">Событие Не Найдено.</div>';return}scene.innerHTML='<article class="scene"><span class="tag">'+esc(c.category)+'</span><span class="tag">'+({all:'Общее Голосование',group:'Группа Из 2–3 Участников',single:'Индивидуальное Решение'}[c.audience])+'</span><h2>'+esc(c.title)+'</h2><img src="'+c.comic_scene.preview+'" alt="'+esc(c.comic_scene.alt)+'"><p class="story">'+esc(c.situation)+'</p><h3>Варианты Решения</h3>'+c.decision_options.map((label,i)=>{const e=c.effect_plan.options[i];return '<div class="choice '+(e.trust>0?'positive':e.trust<0?'negative':'neutral')+'"><b>'+esc(label)+'</b><span>Доверие: '+(e.trust>0?'+':'')+e.trust+' П.п.</span><p>'+esc(e.description)+'</p></div>'}).join('')+'<h3>СМИ После Голосования</h3><div class="news"><b>'+esc(c.comic_scene.media_label)+'</b><p>'+esc(c.comic_scene.news_lead)+'</p><small>После Принятия Решения Система Добавит Выбранный Исход И Фактическое Изменение Доверия. Иллюстрация Останется Той Же.</small></div></article>'}
function options(){pick.innerHTML=filtered.map((c,i)=>'<option value="'+i+'">'+(i+1)+'. '+esc(c.title)+'</option>').join('');render()}
document.getElementById('search').oninput=e=>{const q=e.target.value.toLocaleLowerCase('ru');filtered=cases.filter(c=>(c.title+' '+c.category+' '+c.situation).toLocaleLowerCase('ru').includes(q));index=0;options()};pick.onchange=()=>{index=Number(pick.value);render()};document.getElementById('prev').onclick=()=>{index--;render()};document.getElementById('next').onclick=()=>{index++;render()};options();
</script></body></html>'''
score_source = (root / 'components/game/ComicSoundButton.tsx').read_text()
score_js = 'function score(ctx){' + score_source.split('function score(ctx:AudioContext){', 1)[1].split('async function start', 1)[0]
audio_js = score_js + '''
let audioContext,audioSource;
document.getElementById('sound').onclick=async()=>{const b=document.getElementById('sound');if(audioSource){audioSource.stop();audioSource.disconnect();audioSource=null;b.textContent='Включить Звук · Цикл 36 Секунд';return}try{audioContext??=new AudioContext();await audioContext.resume();audioSource=audioContext.createBufferSource();audioSource.buffer=score(audioContext);audioSource.loop=true;audioSource.connect(audioContext.destination);audioSource.start();b.textContent='Выключить Звук'}catch{b.textContent='Повторить Включение Звука'}};
'''
template = template.replace('<div id="scene"></div>', '<button id="sound" type="button">Включить Звук · Цикл 36 Секунд</button><div id="scene"></div>')
template = template.replace('options();\n</script>', 'options();\n' + audio_js + '\n</script>')
(out / 'GOS-SIMS-50-events-preview.html').write_text(template.replace('__CATALOG__', data))
evidence = {'cases': 50, 'distinct_titles': 50, 'distinct_stories': 50, 'distinct_scenes': len(scenes),
            'distinct_path_geometry': len(geometry), 'distinct_media_leads': len(headlines),
            'choice_counts': sorted({len(c['decision_options']) for c in cases}),
            'every_case_has_positive_negative_and_neutral_choice': True,
            'svg_scripts_or_external_images': 0}
(out / 'event-content-validation.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2))
print('PASS:', json.dumps(evidence, ensure_ascii=False))
