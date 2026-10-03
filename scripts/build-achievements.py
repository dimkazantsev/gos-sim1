"""Build 100 compact Steam-style achievement icons plus locked variants."""
from pathlib import Path
import colorsys
import hashlib
import json
import re

ROOT=Path(__file__).resolve().parents[1]
rows=[s.split('|') for s in (ROOT/'content/achievements.tsv').read_text().splitlines() if s.strip()]
assert len(rows)==100 and len({x[0] for x in rows})==100
assert len({json.dumps(json.loads(x[2]),sort_keys=True) for x in rows})==100

glyphs={
 'signature':'<path d="M60 162c34-37 44-2 66-22 21-19 18 24 49 1"/><path d="m148 79 27 27-64 64-34 8 8-34Z"/><path d="m151 82 23 23"/>',
 'document':'<path d="M76 53h76l30 31v119H76Z"/><path d="M151 53v35h31M96 113h65M96 137h65M96 161h46"/>',
 'law':'<path d="M128 55v119M84 83h88M84 83l-29 50h58ZM172 83l-29 50h58ZM92 188h72"/><circle cx="128" cy="55" r="9"/>',
 'budget':'<rect x="62" y="80" width="132" height="103" rx="8"/><path d="M73 101h110M103 122v42m-14-30h30m-30 13h26"/><path d="M146 122h49v35h-49"/><circle cx="165" cy="140" r="5"/>',
 'vote':'<path d="M68 122h120v71H68Z"/><path d="M82 139h92M99 64h58v63H99Z"/><path d="m111 96 11 11 26-29"/>',
 'tax':'<circle cx="104" cy="102" r="31"/><circle cx="159" cy="155" r="31"/><path d="m78 181 101-106M94 94h20M104 84v20M149 155h20"/>',
 'region':'<path d="m57 85 46-22 48 20 48-20v112l-48 20-48-20-46 22Z"/><path d="M103 63v112M151 83v112"/><circle cx="153" cy="122" r="12"/>',
 'media':'<rect x="60" y="72" width="136" height="119" rx="8"/><path d="M75 92h105M78 117h39v50H78ZM132 119h44M132 139h44M132 160h33"/>',
 'image':'<rect x="57" y="67" width="142" height="124" rx="10"/><circle cx="101" cy="108" r="14"/><path d="m70 171 42-43 28 28 21-21 27 36"/>',
 'audio':'<path d="M66 113h35l39-31v93l-39-31H66Z"/><path d="M158 105q23 24 0 48M174 91q39 38 0 76"/>',
 'video':'<rect x="57" y="75" width="142" height="108" rx="11"/><path d="m113 103 49 26-49 27Z"/>',
 'chat':'<path d="M56 74h144v96h-75l-42 29v-29H56Z"/><path d="M80 106h96M80 132h69"/>',
 'party':'<path d="M65 181v-21q0-34 39-34t39 34v21Z"/><circle cx="104" cy="92" r="26"/><path d="M143 135q51 0 51 40v6h-39"/><circle cx="162" cy="101" r="22"/>',
 'team':'<circle cx="82" cy="103" r="23"/><circle cx="128" cy="88" r="27"/><circle cx="174" cy="103" r="23"/><path d="M48 182v-18q0-31 34-31m44 49v-24q0-39 42-39t42 39v24M83 182v-24q0-39 45-39"/>',
 'time':'<circle cx="128" cy="130" r="66"/><path d="M128 82v49l33 21M116 52h24M128 52v12"/>',
 'archive':'<path d="M62 84h132v100H62Z"/><path d="M72 64h112v20M86 108h84M99 132h58"/><path d="M108 184v13h40v-13"/>',
 'link':'<path d="M102 103 81 124q-25 25 0 50t50 0l21-21"/><path d="m154 151 21-21q25-25 0-50t-50 0l-21 21"/><path d="m98 158 60-60"/>',
 'edit':'<path d="M63 188h130"/><path d="m82 158 73-73 29 29-73 73-37 8Z"/><path d="m154 86 28 28"/>',
 'eye':'<path d="M48 128q80-79 160 0-80 79-160 0Z"/><circle cx="128" cy="128" r="30"/><circle cx="128" cy="128" r="9"/>',
 'stage':'<path d="M64 185h128M78 185v-72l50-35 50 35v72"/><path d="M99 185v-46h58v46M83 105h90"/>',
 'star':'<path d="m128 55 21 44 49 7-35 34 8 49-43-24-43 24 8-49-35-34 49-7Z"/>'
}

patterns=[
 ('signature',r'автограф|подпис|подпись'),
 ('budget',r'бюджет|смет|финансов|экономическ'),
 ('tax',r'налог|ставк'),
 ('vote',r'голос|мандат|бюллет|кворум|воздерж'),
 ('region',r'регион|федерат|муницип|местн'),
 ('audio',r'аудио|радио'),
 ('video',r'видео'),
 ('image',r'изображ|иллюстр'),
 ('media',r'сми|новост|публикац|пост|редактор'),
 ('chat',r'комментар|обсуд|разговор|чат|ответ'),
 ('link',r'ссылк'),
 ('archive',r'архив|файл|прилож'),
 ('edit',r'редакц|исправлен|чернов'),
 ('team',r'команд|коллектив|вместе'),
 ('party',r'парт|фракц|приглаш|должност'),
 ('time',r'час|время|долгая|смен'),
 ('law',r'прав|закон|кодекс|конституц|юрист|норм'),
 ('stage',r'этап|глава'),
 ('eye',r'просмотр|читател'),
 ('document',r'документ|акт|указ|приказ|постанов|протокол|заключен|программ'),
]

palette=[
 ('#66c0f4','#1b5b7f','#08141e'),
 ('#a4d007','#52720a','#121908'),
 ('#d6a94a','#7e5719','#1b1409'),
 ('#b889e8','#5f3d8b','#150d20'),
 ('#55c6a9','#246b5b','#0b1b18'),
 ('#de6f83','#813747','#200c11'),
 ('#7da6ff','#365991','#0b1324'),
 ('#e29455','#8a4a1d','#211108'),
]

def classify(text):
    for key,pat in patterns:
        if re.search(pat,text):
            return key
    return 'star'

def motif(i, accent, muted):
    v=i%6
    if v==0:
        return f'<circle cx="210" cy="42" r="54" fill="none" stroke="{muted}" stroke-width="2" opacity=".34"/><circle cx="210" cy="42" r="35" fill="none" stroke="{accent}" stroke-width="2" opacity=".25"/>'
    if v==1:
        return f'<path d="M-10 210 210-10M20 250 250 20" stroke="{muted}" stroke-width="18" opacity=".13"/>'
    if v==2:
        return f'<path d="M32 45h58M32 58h92M166 198h58M134 211h90" stroke="{accent}" stroke-width="3" opacity=".3"/>'
    if v==3:
        dots=[]
        for n in range(10):
            x=34+(n*37)%190;y=34+(n*61)%190
            dots.append(f'<circle cx="{x}" cy="{y}" r="{2+(n%3)}" fill="{muted}" opacity=".26"/>')
        return ''.join(dots)
    if v==4:
        return f'<path d="M38 210 128 28l90 182Z" fill="none" stroke="{muted}" stroke-width="2" opacity=".28"/><path d="m78 210 50-101 50 101" fill="none" stroke="{accent}" stroke-width="2" opacity=".2"/>'
    return f'<rect x="24" y="24" width="208" height="208" rx="42" fill="none" stroke="{muted}" stroke-width="2" opacity=".2" transform="rotate(11 128 128)"/><rect x="45" y="45" width="166" height="166" rx="34" fill="none" stroke="{accent}" stroke-width="2" opacity=".18" transform="rotate(-9 128 128)"/>'

def icon_svg(i,title,description,locked=False):
    text=(title+' '+description).lower()
    kind=classify(text)
    accent,muted,deep=palette[(i-1)%len(palette)]
    if locked:
        accent='#7b848b';muted='#4e5961';deep='#161b20'
    hue=((i*137.508)%360)/360
    r,g,b=colorsys.hls_to_rgb(hue,.52,.42)
    tint='#'+''.join(f'{round(x*255):02x}' for x in (r,g,b))
    if locked:tint='#30383e'
    shine='#ffffff' if not locked else '#9ba2a7'
    extra=motif(i,accent,muted)
    notch=(i%4)*7+10
    glyph=glyphs[kind]
    opacity='.96' if not locked else '.66'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<title>{title}</title>
<defs>
 <linearGradient id="bg{i}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="{tint}"/><stop offset=".46" stop-color="{muted}"/><stop offset="1" stop-color="{deep}"/></linearGradient>
 <radialGradient id="glow{i}"><stop stop-color="{accent}" stop-opacity=".55"/><stop offset="1" stop-color="{accent}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="256" height="256" rx="12" fill="#0c1116"/>
<rect x="5" y="5" width="246" height="246" rx="9" fill="url(#bg{i})" stroke="{muted}" stroke-width="3"/>
<path d="M8 {78+notch} 112 8h67L8 130Z" fill="{shine}" opacity=".07"/>
<circle cx="128" cy="128" r="92" fill="url(#glow{i})" opacity=".48"/>
{extra}
<g fill="none" stroke="{shine}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" opacity="{opacity}">{glyph}</g>
<path d="M18 224h92" stroke="{accent}" stroke-width="5" opacity=".76"/>
<path d="M18 235h{46+(i%8)*13}" stroke="{shine}" stroke-width="2" opacity=".34"/>
<path d="M221 19h16v16" fill="none" stroke="{accent}" stroke-width="3" opacity=".7"/>
</svg>'''

catalog=[]
unlocked=[]
locked=[]
out=ROOT/'public/medals'
out.mkdir(parents=True,exist_ok=True)
for i,(title,description,condition) in enumerate(rows,1):
    key=f'medal-{i:03}'
    hidden=i>60
    conditions=json.loads(condition)
    assert conditions and all(isinstance(v,(int,float)) and v>0 for v in conditions.values())
    catalog.append({'id':key,'title':title,'description':description,'hidden':hidden,'conditions':conditions,'sort_order':i})
    u=icon_svg(i,title,description,False)
    l=icon_svg(i,title,description,True)
    unlocked.append(u);locked.append(l)
    (out/f'{key}.svg').write_text(u)
    (out/f'{key}-locked.svg').write_text(l)

assert len({hashlib.sha256(x.encode()).hexdigest() for x in unlocked})==100
assert len({hashlib.sha256(x.encode()).hexdigest() for x in locked})==100

payload=json.dumps(catalog,ensure_ascii=False,separators=(',',':')).replace("'","''")
sql="-- Authored definitions stay in the private server catalog.\ninsert into private.achievement_catalog select v->>'id',v->>'title',v->>'description',(v->>'hidden')::boolean,v->'conditions',(v->>'sort_order')::integer from jsonb_array_elements('"+payload+"'::jsonb) v on conflict(id) do update set title=excluded.title,description=excluded.description,conditions=excluded.conditions;\n"
(ROOT/'supabase/changes/20261002_achievement_catalog.sql').write_text(sql)
(ROOT/'docs/ACHIEVEMENT_METHOD.md').write_text('Награды: 60 открытых, 40 скрытых. Для каждой награды генерируются отдельные квадратные unlocked/locked SVG-иконки 256×256 в компактной системе достижений. Условия серверные, не меняют ВСН. Скрытый каталог не отдаётся клиенту до выполнения условия.\n')
print('PASS 100 unique achievement icons + 100 locked variants; 60 public / 40 hidden')
