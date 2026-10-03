"""Build 100 GOS//SIMS achievement emblems in the product's own visual identity.

Principles:
- compact square collectible icons, compatible with the current achievement list;
- palette and geometry come from GOS//SIMS: civic blue, navy, pink, white,
  plus the product's semantic green/amber/red/purple;
- 12 composition families instead of one repeated badge template;
- semantic glyphs chosen from the actual achievement title/condition;
- every achievement gets a distinct unlocked and locked SVG.
"""
from pathlib import Path
import hashlib
import json
import re

ROOT=Path(__file__).resolve().parents[1]
rows=[s.split('|') for s in (ROOT/'content/achievements.tsv').read_text().splitlines() if s.strip()]
assert len(rows)==100 and len({x[0] for x in rows})==100
assert len({json.dumps(json.loads(x[2]),sort_keys=True) for x in rows})==100

INK='#172447'
BLUE='#2453E6'
BLUE_DARK='#183FAE'
PINK='#F3A8CF'
PINK_INK='#91275E'
PURPLE='#6D4AC5'
GREEN='#16734F'
AMBER='#885511'
RED='#B62C45'
WHITE='#FFFFFF'
PAPER='#F7F8FD'
SOFT='#EDF1FF'
LINE='#DCE3F0'
MUTED='#65738D'

GLYPHS={
 'signature':'<path d="M55 169c35-40 47-3 72-24 20-17 21 23 52 0"/><path d="m142 73 33 33-66 66-39 10 10-39Z"/><path d="m148 79 21 21"/>',
 'document':'<path d="M70 45h86l34 36v132H70Z"/><path d="M156 45v40h34M94 117h72M94 144h72M94 171h49"/>',
 'law':'<path d="M128 45v137M80 79h96M80 79l-32 58h64ZM176 79l-32 58h64ZM87 202h82"/><circle cx="128" cy="45" r="10"/>',
 'budget':'<rect x="54" y="73" width="148" height="115" rx="10"/><path d="M69 98h118M101 123v45m-17-31h34m-34 14h30"/><path d="M149 122h54v40h-54"/><circle cx="169" cy="143" r="5"/>',
 'vote':'<path d="M55 125h146v78H55Z"/><path d="M73 145h110M94 52h68v78H94Z"/><path d="m108 93 13 13 30-35"/>',
 'tax':'<circle cx="99" cy="98" r="34"/><circle cx="163" cy="160" r="34"/><path d="m69 191 117-125M88 88h22M99 77v22M152 160h22"/>',
 'region':'<path d="m47 82 53-25 53 22 56-24v126l-56 23-53-22-53 25Z"/><path d="M100 57v125M153 79v125"/><circle cx="157" cy="122" r="14"/>',
 'media':'<rect x="50" y="62" width="156" height="137" rx="10"/><path d="M67 85h122M70 112h46v59H70ZM132 114h49M132 138h49M132 163h36"/>',
 'image':'<rect x="46" y="58" width="164" height="143" rx="13"/><circle cx="96" cy="106" r="16"/><path d="m61 178 48-49 32 32 24-24 31 41"/>',
 'audio':'<path d="M59 111h39l44-36v107l-44-36H59Z"/><path d="M164 101q28 29 0 58M184 84q48 49 0 96"/>',
 'video':'<rect x="47" y="69" width="162" height="124" rx="13"/><path d="m110 101 58 31-58 32Z"/>',
 'chat':'<path d="M47 66h162v111h-84l-49 34v-34H47Z"/><path d="M75 105h108M75 136h78"/>',
 'party':'<circle cx="101" cy="91" r="29"/><circle cx="166" cy="101" r="24"/><path d="M57 197v-25q0-40 44-40t44 40v25ZM148 141q53 0 53 46v10h-40"/>',
 'team':'<circle cx="74" cy="107" r="24"/><circle cx="128" cy="87" r="31"/><circle cx="182" cy="107" r="24"/><path d="M35 198v-20q0-35 39-35M83 198v-29q0-47 45-47t45 47v29M182 143q39 0 39 35v20"/>',
 'time':'<circle cx="128" cy="132" r="72"/><path d="M128 80v52l38 23M115 48h26M128 48v12"/>',
 'archive':'<path d="M53 78h150v114H53Z"/><path d="M66 54h124v24M80 109h96M94 138h68"/><path d="M104 192v15h48v-15"/>',
 'link':'<path d="M100 102 77 125q-28 28 0 56t56 0l23-23"/><path d="m156 154 23-23q28-28 0-56t-56 0l-23 23"/><path d="m94 163 68-68"/>',
 'edit':'<path d="M50 203h154"/><path d="m75 167 83-83 34 34-83 83-45 10Z"/><path d="m158 84 34 34"/>',
 'eye':'<path d="M38 128q90-88 180 0-90 88-180 0Z"/><circle cx="128" cy="128" r="35"/><circle cx="128" cy="128" r="10"/>',
 'stage':'<path d="M50 199h156M67 199v-83l61-43 61 43v83"/><path d="M91 199v-53h74v53M74 105h108"/>',
 'globe':'<circle cx="128" cy="128" r="77"/><path d="M51 128h154M128 51q39 36 39 77t-39 77M128 51q-39 36-39 77t39 77"/><path d="M72 82q56 27 112 0M72 174q56-27 112 0"/>',
 'shield':'<path d="M128 44 201 71v54q0 65-73 102-73-37-73-102V71Z"/><path d="m90 129 27 27 52-60"/>',
 'handshake':'<path d="m44 118 43-42 42 20 40-19 43 40-61 70-31-21-25 12-51-60Z"/><path d="m89 119 32 26m-15-41 40 34m-26-49 44 38"/>',
 'graph':'<path d="M53 198h154M64 187V65"/><path d="m75 162 38-41 30 18 47-58"/><circle cx="75" cy="162" r="7"/><circle cx="113" cy="121" r="7"/><circle cx="143" cy="139" r="7"/><circle cx="190" cy="81" r="7"/>',
 'building':'<path d="M48 201h160M65 196v-89l63-37 63 37v89"/><path d="M89 196v-63h24v63M143 196v-63h24v63"/><path d="M64 108h128M51 105l77-47 77 47"/>',
 'star':'<path d="m128 45 24 51 56 8-40 39 9 57-49-28-49 28 9-57-40-39 56-8Z"/>'
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
 ('globe',r'три регион|федератив|разных орган|несколько институт'),
 ('graph',r'рейтинг|динамик|прогресс|критер'),
 ('building',r'правительств|государственн.*дум|совет федерац|министерств|палат'),
 ('law',r'прав|закон|кодекс|конституц|юрист|норм'),
 ('stage',r'этап|глава'),
 ('eye',r'просмотр|читател'),
 ('document',r'документ|акт|указ|приказ|постанов|протокол|заключен|программ')
]

PALETTES=[
 (BLUE,INK,PINK,WHITE,SOFT),
 (PURPLE,INK,PINK,WHITE,'#F4F0FF'),
 (PINK_INK,INK,PINK,WHITE,'#FFF0F7'),
 (GREEN,INK,'#8FE0C0',WHITE,'#E8F5EE'),
 (AMBER,INK,'#F0C36C',WHITE,'#FFF3DF'),
 (RED,INK,'#F1A8B5',WHITE,'#FFF0F2'),
 (BLUE_DARK,INK,'#87A7FF',WHITE,'#EDF1FF')
]

def classify(text):
    for key,pattern in PATTERNS:
        if re.search(pattern,text):
            return key
    return 'star'

def decor(i, fg, accent):
    x1=28+(i*17)%72
    x2=151+(i*23)%58
    y1=31+(i*13)%49
    y2=166+(i*19)%46
    return (
      f'<circle cx="{x1}" cy="{y1}" r="{3+i%5}" fill="{accent}" opacity=".85"/>'
      f'<path d="M{x2} {y1}h{22+i%28}" stroke="{fg}" stroke-width="3" opacity=".34"/>'
      f'<path d="M{x1} {y2}h{35+(i%5)*11}" stroke="{accent}" stroke-width="4" opacity=".45"/>'
    )

def family_art(family,i,fg,bg,accent,soft):
    if family==0: # civic poster
        return f'''<rect x="18" y="18" width="220" height="220" rx="28" fill="{bg}"/>
        <circle cx="195" cy="59" r="44" fill="{accent}" opacity=".85"/>
        <path d="M18 203 126 67l112 89v82H18Z" fill="{soft}" opacity=".96"/>
        <path d="M18 203 126 67" stroke="{fg}" stroke-width="5" opacity=".16"/>'''
    if family==1: # blueprint
        grid=''.join(f'<path d="M{i2} 20v216M20 {i2}h216" stroke="{fg}" stroke-width="1" opacity=".07"/>' for i2 in range(44,237,32))
        return f'<rect x="14" y="14" width="228" height="228" rx="22" fill="{soft}"/>{grid}<path d="M26 211 207 35" stroke="{accent}" stroke-width="18" opacity=".12"/>'
    if family==2: # seal
        return f'''<rect x="16" y="16" width="224" height="224" rx="112" fill="{soft}"/>
        <circle cx="128" cy="128" r="89" fill="{bg}" stroke="{accent}" stroke-width="9"/>
        <circle cx="128" cy="128" r="73" fill="none" stroke="{fg}" stroke-width="2" opacity=".18"/>'''
    if family==3: # split
        return f'''<rect x="16" y="16" width="224" height="224" rx="25" fill="{bg}"/>
        <path d="M16 16h224L96 240H16Z" fill="{soft}"/>
        <path d="M240 16v224H96Z" fill="{accent}" opacity=".92"/>
        <path d="M92 240 240 12" stroke="{fg}" stroke-width="3" opacity=".15"/>'''
    if family==4: # orbit
        return f'''<rect x="14" y="14" width="228" height="228" rx="31" fill="{bg}"/>
        <circle cx="128" cy="128" r="76" fill="{soft}"/>
        <ellipse cx="128" cy="128" rx="105" ry="43" fill="none" stroke="{accent}" stroke-width="6" opacity=".7" transform="rotate(-24 128 128)"/>
        <circle cx="210" cy="82" r="10" fill="{accent}"/>'''
    if family==5: # editorial panel
        return f'''<rect x="17" y="17" width="222" height="222" rx="20" fill="{soft}"/>
        <rect x="31" y="35" width="76" height="13" rx="6" fill="{accent}"/>
        <rect x="31" y="57" width="134" height="6" rx="3" fill="{fg}" opacity=".18"/>
        <rect x="31" y="72" width="103" height="6" rx="3" fill="{fg}" opacity=".12"/>
        <rect x="159" y="168" width="61" height="49" rx="13" fill="{accent}" opacity=".92"/>'''
    if family==6: # stacked cards
        return f'''<rect x="48" y="29" width="170" height="184" rx="23" fill="{accent}" opacity=".22" transform="rotate(7 133 121)"/>
        <rect x="32" y="37" width="183" height="181" rx="23" fill="{bg}" stroke="{accent}" stroke-width="5"/>
        <rect x="46" y="51" width="155" height="153" rx="16" fill="{soft}"/>'''
    if family==7: # institution
        return f'''<rect x="16" y="16" width="224" height="224" rx="25" fill="{soft}"/>
        <path d="M36 190V96l92-51 92 51v94Z" fill="{bg}"/>
        <path d="M30 198h196" stroke="{accent}" stroke-width="11"/>
        <circle cx="199" cy="55" r="26" fill="{accent}"/>'''
    if family==8: # map / territory
        return f'''<rect x="16" y="16" width="224" height="224" rx="27" fill="{bg}"/>
        <path d="m45 81 57-37 43 27 49-13 24 62-31 51-63-4-48 39-40-64Z" fill="{soft}"/>
        <path d="m61 92 47-29 36 25 39-10" fill="none" stroke="{accent}" stroke-width="7" stroke-linecap="round"/>
        <circle cx="169" cy="154" r="17" fill="{accent}"/>'''
    if family==9: # data / dashboard
        return f'''<rect x="17" y="17" width="222" height="222" rx="22" fill="{soft}"/>
        <rect x="30" y="34" width="196" height="49" rx="14" fill="{bg}"/>
        <rect x="30" y="96" width="91" height="128" rx="15" fill="{bg}"/>
        <rect x="133" y="96" width="93" height="59" rx="15" fill="{accent}" opacity=".88"/>
        <rect x="133" y="167" width="93" height="57" rx="15" fill="{bg}"/>'''
    if family==10: # flag / ribbon
        return f'''<rect x="15" y="15" width="226" height="226" rx="30" fill="{bg}"/>
        <path d="M15 72h226v52H15Z" fill="{soft}"/>
        <path d="M15 136h226v55H15Z" fill="{accent}" opacity=".9"/>
        <path d="M35 26v204" stroke="{fg}" stroke-width="4" opacity=".18"/>'''
    # monument / spotlight
    return f'''<rect x="15" y="15" width="226" height="226" rx="28" fill="{soft}"/>
    <path d="M49 217 112 32h33l63 185Z" fill="{bg}"/>
    <circle cx="128" cy="79" r="33" fill="{accent}"/>
    <path d="M28 217h200" stroke="{fg}" stroke-width="6" opacity=".18"/>'''

def icon_svg(i,title,description,conditions,locked=False):
    text=(title+' '+description).lower()
    kind=classify(text)
    family=(i-1)%12
    p=PALETTES[(i-1)%len(PALETTES)]
    fg,ink,accent,bg,soft=p
    if locked:
        fg='#8994A5';ink='#677286';accent='#BAC1CD';bg='#F2F4F8';soft='#E6EAF1'
    art=family_art(family,i,ink,bg,accent,soft)
    glyph=GLYPHS[kind]
    # Secondary semantic mark from the condition key makes repeated subjects diverge.
    key=next(iter(conditions))
    keyhash=sum((n+1)*ord(c) for n,c in enumerate(key))
    marker=['circle','square','slash','cross'][keyhash%4]
    if marker=='circle':
        second=f'<circle cx="202" cy="202" r="17" fill="none" stroke="{accent}" stroke-width="5"/>'
    elif marker=='square':
        second=f'<rect x="185" y="185" width="34" height="34" rx="8" fill="none" stroke="{accent}" stroke-width="5"/>'
    elif marker=='slash':
        second=f'<path d="M184 217 218 183" stroke="{accent}" stroke-width="7" stroke-linecap="round"/>'
    else:
        second=f'<path d="M185 202h34M202 185v34" stroke="{accent}" stroke-width="6" stroke-linecap="round"/>'
    rot=((i*7)%11)-5
    scale=.74 + ((i%5)*.025)
    shift=128*(1-scale)
    stroke=ink if not locked else '#697487'
    fill_accent=accent if not locked else '#BBC2CD'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<title>{title}</title>
{art}
{decor(i,ink,accent)}
<g transform="translate({shift:.2f} {shift:.2f}) scale({scale:.3f}) rotate({rot} 128 128)"
 fill="none" stroke="{stroke}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">{glyph}</g>
{second}
<path d="M29 229h38" stroke="{fill_accent}" stroke-width="7" stroke-linecap="round"/>
<path d="M75 229h{34+(i%6)*13}" stroke="{ink}" stroke-width="3" opacity=".22" stroke-linecap="round"/>
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
    u=icon_svg(i,title,description,conditions,False)
    l=icon_svg(i,title,description,conditions,True)
    unlocked.append(u);locked.append(l)
    (out/f'{key}.svg').write_text(u)
    (out/f'{key}-locked.svg').write_text(l)

assert len({hashlib.sha256(x.encode()).hexdigest() for x in unlocked})==100
assert len({hashlib.sha256(x.encode()).hexdigest() for x in locked})==100

payload=json.dumps(catalog,ensure_ascii=False,separators=(',',':')).replace("'","''")
sql="-- Authored definitions stay in the private server catalog.\ninsert into private.achievement_catalog select v->>'id',v->>'title',v->>'description',(v->>'hidden')::boolean,v->'conditions',(v->>'sort_order')::integer from jsonb_array_elements('"+payload+"'::jsonb) v on conflict(id) do update set title=excluded.title,description=excluded.description,conditions=excluded.conditions;\n"
(ROOT/'supabase/changes/20261002_achievement_catalog.sql').write_text(sql)
(ROOT/'docs/ACHIEVEMENT_METHOD.md').write_text(
 'Награды: 60 открытых, 40 скрытых. 100 самостоятельных эмблем строятся в 12 композиционных семействах '
 'на палитре и геометрии GOS//SIMS: civic blue, navy, pink, white и семантические green/amber/red/purple. '
 'Для каждой есть отдельная приглушённая locked-версия. Условия серверные, не меняют ВСН.\n'
)
print('PASS 100 diverse GOS//SIMS identity emblems + 100 locked variants')
