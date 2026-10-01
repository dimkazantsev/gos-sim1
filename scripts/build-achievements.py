"""100 separate vector medals, 60 public conditions and 40 server-hidden conditions."""
from pathlib import Path
import json,hashlib,html,colorsys,re
ROOT=Path(__file__).resolve().parents[1]
rows=[s.split('|') for s in (ROOT/'content/achievements.tsv').read_text().splitlines() if s.strip()]
assert len(rows)==100 and len({x[0] for x in rows})==100
assert len({json.dumps(json.loads(x[2]),sort_keys=True) for x in rows})==100
glyphs={
 'document':'<path d="M85 65h67l24 27v96H85Z"/><path d="M151 65v30h25M104 118h50M104 137h50M104 156h31"/>',
 'vote':'<path d="M73 127h110v64H73ZM80 141h96M103 77h51v53h-51Z"/><path d="m112 103 9 9 22-23"/>',
 'budget':'<path d="M71 101h113v78H71ZM82 84h89v17M150 124h42v33h-42Z"/><circle cx="166" cy="140" r="5"/><path d="M105 120v39m-11-28h25m-25 12h20"/>',
 'law':'<path d="M128 67v111M88 91h80M88 91l-25 43h50ZM168 91l-25 43h50ZM98 184h60"/><circle cx="128" cy="67" r="10"/>',
 'media':'<rect x="68" y="87" width="119" height="93" rx="9"/><path d="M83 102h89M85 124h35v40H85ZM133 125h36M133 143h36M133 162h29"/>',
 'people':'<circle cx="106" cy="102" r="22"/><circle cx="160" cy="108" r="19"/><path d="M71 177v-21q0-28 35-28t35 28v21ZM144 136q44-1 44 35v6h-35"/>',
 'region':'<path d="m67 98 37-18 41 16 46-15v89l-46 19-41-16-37 15ZM104 80v93M145 96v93"/><circle cx="149" cy="127" r="12"/>',
 'time':'<circle cx="128" cy="130" r="56"/><path d="M128 88v42l27 17M118 63h20M128 63v11"/>',
 'chat':'<path d="M69 86h119v81h-61l-35 24v-24H69Z"/><path d="M89 111h79M89 132h58"/>',
 'star':'<path d="m128 63 20 42 46 7-34 33 8 48-40-23-40 23 8-48-34-33 46-7Z"/>'
}
medals=[];catalog=[]
for i,(title,description,condition) in enumerate(rows,1):
    key=f'medal-{i:03}';hidden=i>60;conditions=json.loads(condition)
    assert conditions and all(isinstance(v,(int,float)) and v>0 for v in conditions.values())
    catalog.append({'id':key,'title':title,'description':description,'hidden':hidden,'conditions':conditions,'sort_order':i})
    t=(title+' '+description).lower()
    kind=next((k for k,p in [('budget','бюджет|налог|смет|ставк|финансов'),('vote','голос|мандат|бюллет|кворум'),('region','регион|федерац|муницип|местн'),('people','парт|команд|приглаш|должност'),('time','час|время|дат|wi-fi|смена'),('media','пост|сми|газет|новост|аудио|видео|публикац'),('chat','комментар|обсуд|разговор'),('law','прав|закон|кодекс|конституц'),('document','документ|протокол|приказ|автограф|редакц')] if re.search(p,t)),'star')
    hue=(i*137.508)%360
    rgb=colorsys.hls_to_rgb(hue/360,.53,.72);color='#'+''.join(f'{round(x*255):02x}' for x in rgb)
    pale='#'+''.join(f'{round(210+x*45):02x}' for x in rgb)
    ring=54+(i%5)*3;points=6+i%7
    stars=''.join(f'<circle cx="128" cy="{128-ring-13}" r="{3+i%3}" transform="rotate({j*360/points} 128 128)" fill="#fff4b4"/>' for j in range(points))
    outline='<circle cx="128" cy="128" r="98"/>' if i%3==0 else '<path d="m128 27 81 39 21 90-56 70H82L26 156l21-90Z"/>' if i%3==1 else '<path d="m128 22 48 20 37 38 19 48-19 48-37 38-48 20-48-20-37-38-19-48 19-48 37-38Z"/>'
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="280" viewBox="0 0 256 280"><title>Медаль республики</title><defs><linearGradient id="g{i}" x2="1" y2="1"><stop stop-color="{pale}"/><stop offset=".5" stop-color="{color}"/><stop offset="1" stop-color="#23466b"/></linearGradient></defs><path d="m65 181-18 90 38-17 22 22 19-87m65-8 18 90-38-17-22 22-19-87" fill="{color}" stroke="#fff" stroke-width="6"/><g fill="url(#g{i})" stroke="#173253" stroke-width="5">{outline}</g><circle cx="128" cy="128" r="{ring}" fill="#fffaf0" stroke="#fff1ae" stroke-width="6"/>{stars}<g fill="none" stroke="{color}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">{glyphs[kind]}</g><path d="M48 72q30-37 65-34" fill="none" stroke="#fff" stroke-width="8" opacity=".55" stroke-linecap="round"/></svg>'
    medals.append(svg);(ROOT/'public/medals').mkdir(parents=True,exist_ok=True);(ROOT/'public/medals'/f'{key}.svg').write_text(svg)
assert len({hashlib.sha256(x.encode()).hexdigest() for x in medals})==100
payload=json.dumps(catalog,ensure_ascii=False,separators=(',',':')).replace("'","''")
sql="-- Authored definitions stay in the private server catalog.\ninsert into private.achievement_catalog select v->>'id',v->>'title',v->>'description',(v->>'hidden')::boolean,v->'conditions',(v->>'sort_order')::integer from jsonb_array_elements('"+payload+"'::jsonb) v on conflict(id) do update set title=excluded.title,description=excluded.description,conditions=excluded.conditions;\n"
(ROOT/'supabase/changes/20261002_achievement_catalog.sql').write_text(sql)
(ROOT/'docs/ACHIEVEMENT_METHOD.md').write_text('Награды: 60 открытых, 40 скрытых. Условия серверные, не меняют ВСН. Время считается по серверным меткам непрерывных пингов не более 90 секунд; перерывы не засчитываются. Медали лидерам допускают равенство результатов. Скрытый каталог не отдаётся клиенту до выполнения условия. Уведомление забирается атомарно один раз.\n')
print('PASS 100 different conditions and medals; 60 public / 40 hidden')
