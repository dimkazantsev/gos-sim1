"""Build 100 Steam-reference achievement emblems and locked variants.

Visual target: small dark square trophy emblems with a thin metallic frame,
gold unlocked glow and a compact red/white illustration inside.
"""
from pathlib import Path
import hashlib
import json
import re

ROOT=Path(__file__).resolve().parents[1]
rows=[s.split('|') for s in (ROOT/'content/achievements.tsv').read_text().splitlines() if s.strip()]
assert len(rows)==100 and len({x[0] for x in rows})==100
assert len({json.dumps(json.loads(x[2]),sort_keys=True) for x in rows})==100

GLYPHS={
 'signature':'<path d="M60 165c29-34 39-5 60-23 19-17 18 21 47 2"/><path d="m143 82 28 28-60 60-36 9 9-36Z"/><path d="m147 86 20 20"/>',
 'document':'<path d="M77 52h74l29 30v122H77Z"/><path d="M151 52v34h29M98 111h61M98 135h61M98 159h43"/>',
 'law':'<path d="M128 55v120M84 83h88M84 83l-29 50h58ZM172 83l-29 50h58ZM91 188h74"/><circle cx="128" cy="55" r="9"/>',
 'budget':'<rect x="62" y="79" width="132" height="105" rx="6"/><path d="M73 102h110M103 122v43m-14-31h30m-30 14h27"/><path d="M147 121h47v37h-47"/><circle cx="164" cy="140" r="5"/>',
 'vote':'<path d="M67 123h122v70H67Z"/><path d="M82 141h92M98 64h60v64H98Z"/><path d="m110 97 12 12 27-31"/>',
 'tax':'<circle cx="103" cy="102" r="31"/><circle cx="159" cy="157" r="31"/><path d="m78 183 103-109M93 93h20M103 83v20M149 157h20"/>',
 'region':'<path d="m57 89 46-22 47 20 49-20v110l-49 20-47-20-46 22Z"/><path d="M103 67v110M150 87v110"/><circle cx="152" cy="123" r="12"/>',
 'media':'<rect x="59" y="72" width="138" height="119" rx="8"/><path d="M75 92h106M78 117h40v51H78ZM132 120h44M132 141h44M132 162h33"/>',
 'image':'<rect x="57" y="68" width="142" height="124" rx="9"/><circle cx="101" cy="109" r="14"/><path d="m70 172 42-43 28 28 21-21 27 36"/>',
 'audio':'<path d="M66 113h35l39-31v93l-39-31H66Z"/><path d="M158 104q24 25 0 50M176 90q40 40 0 79"/>',
 'video':'<rect x="57" y="75" width="142" height="108" rx="10"/><path d="m112 103 51 26-51 28Z"/>',
 'chat':'<path d="M56 74h144v96h-75l-42 29v-29H56Z"/><path d="M80 106h96M80 132h69"/>',
 'party':'<circle cx="104" cy="96" r="25"/><circle cx="161" cy="104" r="21"/><path d="M65 183v-21q0-33 39-33t39 33v21ZM145 138q45 0 45 38v7h-34"/>',
 'team':'<circle cx="81" cy="105" r="22"/><circle cx="128" cy="88" r="27"/><circle cx="175" cy="105" r="22"/><path d="M49 183v-18q0-30 32-30M88 183v-24q0-39 40-39t40 39v24M175 135q32 0 32 30v18"/>',
 'time':'<circle cx="128" cy="130" r="65"/><path d="M128 83v47l32 21M116 55h24M128 55v11"/>',
 'archive':'<path d="M62 84h132v101H62Z"/><path d="M72 64h112v20M86 109h84M99 133h58"/><path d="M108 185v13h40v-13"/>',
 'link':'<path d="M102 103 81 124q-25 25 0 50t50 0l21-21"/><path d="m154 151 21-21q25-25 0-50t-50 0l-21 21"/><path d="m98 158 60-60"/>',
 'edit':'<path d="M63 188h130"/><path d="m82 158 73-73 29 29-73 73-37 8Z"/><path d="m154 86 28 28"/>',
 'eye':'<path d="M48 128q80-79 160 0-80 79-160 0Z"/><circle cx="128" cy="128" r="30"/><circle cx="128" cy="128" r="9"/>',
 'stage':'<path d="M64 185h128M78 185v-72l50-35 50 35v72"/><path d="M99 185v-46h58v46M83 105h90"/>',
 'globe':'<circle cx="128" cy="128" r="67"/><path d="M61 128h134M128 61q35 32 35 67t-35 67M128 61q-35 32-35 67t35 67"/><path d="M79 87q49 23 98 0M79 169q49-23 98 0"/>',
 'shield':'<path d="M128 52 190 75v45q0 55-62 87-62-32-62-87V75Z"/><path d="m96 127 22 22 43-49"/>',
 'handshake':'<path d="m58 119 36-35 35 17 34-16 35 33-51 59-26-17-21 10-42-51Z"/><path d="m96 119 26 22m-12-34 33 28m-21-39 36 31"/>',
 'star':'<path d="m128 55 21 44 49 7-35 34 8 49-43-24-43 24 8-49-35-34 49-7Z"/>'
}

PATTERNS=[
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
 ('shield',r'законн|без наруш|ответствен'),
 ('handshake',r'дипломат|соглас|переговор|совмест'),
 ('globe',r'три регион|федератив|разных орган'),
 ('law',r'прав|закон|кодекс|конституц|юрист|норм'),
 ('stage',r'этап|глава'),
 ('eye',r'просмотр|читател'),
 ('document',r'документ|акт|указ|приказ|постанов|протокол|заключен|программ'),
]

def classify(text):
    for key,pattern in PATTERNS:
        if re.search(pattern,text):
            return key
    return 'star'

def red_motif(i):
    variant=i%10
    if variant==0:
        return '<circle cx="128" cy="128" r="71" fill="#8d2028" opacity=".76"/><circle cx="128" cy="128" r="55" fill="#090b0d"/>'
    if variant==1:
        return '<path d="M21 187 187 21h48L69 235H21Z" fill="#8a2028" opacity=".74"/>'
    if variant==2:
        return '<path d="m128 21 41 54 67 19-43 51 5 69-70-26-70 26 5-69-43-51 67-19Z" fill="#6f1820" opacity=".7"/>'
    if variant==3:
        return '<circle cx="184" cy="72" r="64" fill="#8c1f27" opacity=".7"/><circle cx="69" cy="190" r="43" fill="#6a151b" opacity=".7"/>'
    if variant==4:
        return '<path d="M22 42h75l137 173v19h-62L22 63Z" fill="#8b2028" opacity=".72"/>'
    if variant==5:
        return '<path d="M35 199 128 28l93 171-42-12-51-90-51 90Z" fill="#7b1c23" opacity=".72"/>'
    if variant==6:
        return '<path d="M27 104h202v48H27Z" fill="#8d2028" opacity=".72" transform="rotate(-17 128 128)"/>'
    if variant==7:
        return '<path d="M128 20 239 128 128 236 17 128Z" fill="#7e1b22" opacity=".68"/><path d="M128 62 195 128 128 194 61 128Z" fill="#080a0c"/>'
    if variant==8:
        return '<path d="M30 211 84 32h42L72 211Zm99 0L184 32h42l-55 179Z" fill="#842029" opacity=".69"/>'
    return '<circle cx="128" cy="128" r="84" fill="none" stroke="#8b2028" stroke-width="25" opacity=".7"/><path d="M57 183 197 72" stroke="#8b2028" stroke-width="22" opacity=".72"/>'

def micro_marks(i, locked):
    tone='#454b50' if locked else '#d8dde0'
    red='#44484b' if locked else '#a3242e'
    parts=[]
    for n in range(5):
        x=31+((i*29+n*47)%190)
        y=34+((i*43+n*31)%184)
        r=1+((i+n)%3)
        parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{tone}" opacity=".24"/>')
    if i%3==0:
        parts.append(f'<path d="M34 {198-(i%27)}h54" stroke="{red}" stroke-width="3" opacity=".55"/>')
    if i%4==0:
        parts.append(f'<path d="M169 39h39v39" fill="none" stroke="{tone}" stroke-width="3" opacity=".35"/>')
    return ''.join(parts)

def emblem_svg(i,title,description,locked=False):
    kind=classify((title+' '+description).lower())
    primary='#777d82' if locked else '#e7e8e8'
    secondary='#454a4e' if locked else '#a4252f'
    outer='#30363b' if locked else '#d0a64f'
    inner='#485057' if locked else '#727a80'
    glow='0' if locked else '.65'
    motif=red_motif(i) if not locked else red_motif(i).replace('#8d2028','#373b3e').replace('#8a2028','#373b3e').replace('#6f1820','#33373a').replace('#8c1f27','#373b3e').replace('#6a151b','#303437').replace('#8b2028','#373b3e').replace('#7b1c23','#33373a').replace('#7e1b22','#34383b').replace('#842029','#35393c')
    glyph=GLYPHS[kind]
    angle=((i%5)-2)*3
    scale=0.88+(i%4)*0.025
    tx=128*(1-scale)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<title>{title}</title>
<defs>
 <filter id="gold{i}" x="-45%" y="-45%" width="190%" height="190%"><feGaussianBlur stdDeviation="6" result="b"/><feColorMatrix in="b" type="matrix" values="1 0 0 0 .77  0 1 0 0 .48  0 0 1 0 .10  0 0 0 {glow} 0"/></filter>
 <linearGradient id="steel{i}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#aeb4b8"/><stop offset=".18" stop-color="#343b40"/><stop offset=".56" stop-color="#777f84"/><stop offset="1" stop-color="#20262a"/></linearGradient>
 <radialGradient id="v{i}"><stop stop-color="#171b1e"/><stop offset=".68" stop-color="#090b0d"/><stop offset="1" stop-color="#040506"/></radialGradient>
</defs>
<rect x="8" y="8" width="240" height="240" rx="5" fill="none" stroke="{outer}" stroke-width="6" filter="url(#gold{i})" opacity="{'.88' if not locked else '0'}"/>
<rect x="7" y="7" width="242" height="242" rx="5" fill="#07090a" stroke="{outer}" stroke-width="5"/>
<rect x="13" y="13" width="230" height="230" rx="3" fill="url(#v{i})" stroke="url(#steel{i})" stroke-width="4"/>
<rect x="18" y="18" width="220" height="220" rx="2" fill="none" stroke="{inner}" stroke-width="2" opacity=".75"/>
<path d="M19 19h70L19 89Z" fill="#ffffff" opacity="{'.06' if not locked else '.025'}"/>
{motif}
{micro_marks(i,locked)}
<g transform="translate({tx:.2f} {tx:.2f}) scale({scale:.3f}) rotate({angle} 128 128)" fill="none" stroke="{primary}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" opacity="{'.98' if not locked else '.74'}">{glyph}</g>
<path d="M26 219h{54+(i%7)*18}" stroke="{secondary}" stroke-width="5" opacity=".8"/>
<path d="M26 229h{34+(i%9)*14}" stroke="{primary}" stroke-width="2" opacity=".28"/>
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
    u=emblem_svg(i,title,description,False)
    l=emblem_svg(i,title,description,True)
    unlocked.append(u);locked.append(l)
    (out/f'{key}.svg').write_text(u)
    (out/f'{key}-locked.svg').write_text(l)

assert len({hashlib.sha256(x.encode()).hexdigest() for x in unlocked})==100
assert len({hashlib.sha256(x.encode()).hexdigest() for x in locked})==100

payload=json.dumps(catalog,ensure_ascii=False,separators=(',',':')).replace("'","''")
sql="-- Authored definitions stay in the private server catalog.\ninsert into private.achievement_catalog select v->>'id',v->>'title',v->>'description',(v->>'hidden')::boolean,v->'conditions',(v->>'sort_order')::integer from jsonb_array_elements('"+payload+"'::jsonb) v on conflict(id) do update set title=excluded.title,description=excluded.description,conditions=excluded.conditions;\n"
(ROOT/'supabase/changes/20261002_achievement_catalog.sql').write_text(sql)
(ROOT/'docs/ACHIEVEMENT_METHOD.md').write_text('Награды: 60 открытых, 40 скрытых. Для каждой награды создаётся самостоятельная квадратная эмблема 256×256 и отдельная locked-версия. Визуальный язык: тёмный фон, металлическая рамка, красно-белая мини-иллюстрация; у открытых достижений золотое свечение рамки. Условия серверные и не меняют ВСН.\n')
print('PASS 100 Steam-reference emblems + 100 locked variants')
