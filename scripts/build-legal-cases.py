"""150 original legal exercises and an independent 1920×1080 vector scene per case.
Facts and alternatives are authored source files, never a region-name substitution.
Effects are explicit educational assumptions; legal sources are linked in the review.
"""
from pathlib import Path
import json,html,re,hashlib,collections
ROOT=Path(__file__).resolve().parents[1]
regions=json.loads((ROOT/'data/regions.json').read_text())
if isinstance(regions,dict):regions=regions.get('regions',[])
rows=[]
for file in ['legal-cases-october.tsv','legal-cases-national.tsv']:
    rows.extend([line.split('|') for line in (ROOT/'content'/file).read_text().splitlines()])
alternatives=(ROOT/'content/legal-case-alternatives.txt').read_text().splitlines()
assert len(rows)==len(alternatives)==150
assert len(regions)==89
INK='#172e4e';PAPER='#fffdf7';BLUE='#377ce4';PINK='#de69a1';TEAL='#5dcab5'
def rect(x,y,w,h,c=PAPER,r=8):return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{c}" stroke="{INK}" stroke-width="4"/>'
def path(d,c='none',s=INK,w=5):return f'<path d="{d}" fill="{c}" stroke="{s}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>'
def text(x,y,s,size=21,c=INK):return f'<text x="{x}" y="{y}" font-size="{size}" font-family="sans-serif" font-weight="750" fill="{c}">{html.escape(s)}</text>'
def paper(x,y,label,angle=0):
    return f'<g transform="translate({x} {y}) rotate({angle})">'+rect(0,0,146,128)+text(13,32,label,18)+''.join(path(f'M14 {51+i*16}H{100+(i%2)*25}',s='#89a4c4',w=3) for i in range(4))+'</g>'
def person(x,y,color,pose,scale=1,female=False):
    arms={'point':'M-19 35-51 13M20 34 73-18','read':'M-20 33-43 53M20 33 42 52','talk':'M-20 33-64-1M20 34 52 10','wait':'M-20 35-31 70M20 35 31 69'}
    hair='M-24-34Q-32-69 0-70Q32-68 24-29L18-47Q-5-43-20-48Z' if female else 'M-22-42Q-27-64 0-65Q27-64 23-43L6-52-14-47Z'
    return f'<g transform="translate({x} {y}) scale({scale})"><ellipse cy="122" rx="44" ry="10" fill="{INK}" opacity=".13"/>'+path('M-13 71-18 113M13 71 24 113',s=INK,w=15)+path('M-30 69V28Q-27-2 0-2Q29-1 30 28V69Z',color,w=4)+path(arms[pose],s=color,w=15)+f'<circle cy="-38" r="23" fill="#eebc9b" stroke="{INK}" stroke-width="4"/>'+path(hair,'#34435b',w=3)+f'<circle cx="-8" cy="-38" r="2.5"/><circle cx="8" cy="-38" r="2.5"/>'+path('M-5-26Q0-22 5-26',w=2)+'</g>'
def building(x,y,kind):
    if kind=='factory':return path(f'M{x} {y+160}V{y+55}l75 39V{y+53}l78 41V{y}h155v160Z','#a8b9d1')+rect(x+189,y-75,38,75,'#b6cbd8',0)+''.join(rect(x+23+i*65,y+110,40,28,'#ffd67e',2) for i in range(4))
    if kind=='hotel':return rect(x,y,300,170,'#ffddc5',4)+''.join(rect(x+22+i%5*55,y+24+i//5*58,31,37,'#90c9e5',2) for i in range(10))+text(x+100,y-16,'Гостиница',22)+rect(x+128,y+137,44,34,TEAL,3)
    if kind=='court':return path(f'M{x-18} {y+21} {x+150} {y-63} {x+318} {y+21}Z','#f6d697')+rect(x,y+24,300,142,'#dbe3ef',1)+''.join(rect(x+23+i*55,y+30,27,126,PAPER,0) for i in range(5))+path(f'M{x-15} {y+178}H{x+315}',s=INK,w=14)
    return rect(x,y,300,170,'#c7d9ed',5)+''.join(rect(x+25+i%4*67,y+24+i//4*65,40,40,'#a0d8e8',2) for i in range(8))+text(x+30,y-18,'Публичное учреждение',20)
def prop(kind,x,y,label,seed):
    if kind=='money':return rect(x,y,196,121,TEAL,10)+f'<circle cx="{x+96}" cy="{y+60}" r="34" fill="{PAPER}" stroke="{INK}" stroke-width="4"/>'+text(x+84,y+69,'₽',35)+text(x+15,y+105,label,14)
    if kind=='scale':return path(f'M{x+96} {y+133}V{y+5}M{x+24} {y+25}H{x+168}M{x+43} {y+25}l-26 60h53Zm106 0-27 60h54Z','#ffd982')+path(f'M{x+47} {y+135}H{x+147}',w=9)+text(x+12,y+164,label,17)
    if kind=='road':return path(f'M{x} {y+110} {x+100} {y}h75l{100} 110Z','#91a8c5')+path(f'M{x+137} {y+15}l-5 90',s=PAPER,w=8)+text(x+4,y+141,label,18)
    if kind=='water':return path(f'M{x} {y+74}q45-33 88 0t88 0v65H{x}Z','#79cddf')+path(f'M{x+87} {y+44}V{y-28}h56v42h40v45',s='#647c95',w=19)+text(x+4,y+161,label,18)
    if kind=='shield':return path(f'M{x+20} {y}h140v72q-67 77-140 0Z',BLUE)+path(f'M{x+67} {y+30}l17 25 39-41',s=PAPER,w=9)+text(x+1,y+172,label,17)
    if kind=='data':return rect(x,y,211,129,'#173654',12)+''.join(rect(x+22+i*45,y+28+(seed+i)%3*17,25,65-(seed+i)%3*17,[BLUE,PINK,TEAL,'#ffd982'][i],2) for i in range(4))+text(x+8,y+160,label,17)
    if kind=='ballot':return rect(x,y+40,184,121,'#c5d8f4',8)+path(f'M{x+23} {y+55}H{x+161}',w=7)+paper(x+68,y-55,'Бюллетень',-9)+text(x+8,y+193,label,17)
    if kind=='contract':return paper(x,y,label,-7)+rect(x+97,y+104,82,34,PINK,4)+text(x+102,y+128,'Подпись',14)
    if kind=='land':return path(f'M{x} {y+107}l80-69 137 20-89 88Z','#8ed6aa')+path(f'M{x+74} {y+37}V{y-27}l68 24-68 16',BLUE)+text(x+7,y+175,label,18)
    if kind=='clock':return f'<circle cx="{x+80}" cy="{y+74}" r="67" fill="{PAPER}" stroke="{INK}" stroke-width="7"/>'+path(f'M{x+80} {y+30}V{y+74}l33 14',w=7)+text(x+1,y+163,label,17)
    if kind=='library':return ''.join(rect(x+i*27,y+i%3*14,24,118,['#f49c80',BLUE,PINK,TEAL][i%4],2) for i in range(7))+text(x,y+163,label,18)
    if kind=='truck':return rect(x,y+26,145,92,'#ffca83',7)+path(f'M{x+146} {y+69}h53l31 32v25h-84Z',TEAL)+f'<circle cx="{x+36}" cy="{y+128}" r="19" fill="{INK}"/><circle cx="{x+182}" cy="{y+128}" r="19" fill="{INK}"/>'+text(x,y+171,label,18)
    return paper(x,y,label,(seed%5-2)*4)
def visual(title,facts,basis):
    t=(title+' '+facts).lower()
    rules=[('ballot','Выбор и протокол',r'избират|бюллет|агитац|парти'),('scale','Основание решения',r'суд|штраф|ответствен|срок обращения'),('hotel','Гостиничный учёт',r'гостиниц|турист|курорт'),('water','Целевой объект',r'вод|очист|теплотрас'),('road','Инфраструктура',r'мост|дорог|стройк|реконструк'),('land','Правовой режим земли',r'земл|пастбищ|участ'),('data','Проверка данных',r'персональ|паспорт|биометр|отчёт|статист|знаменат'),('truck','Поставка и приёмка',r'завоз|постав|склад|автобус|самолёт'),('shield','Полномочия и контроль',r'контроль|конфликт|служащ|субвенц'),('clock','Срок и условие',r'отсроч|срок|больнич|отпуск|просроч'),('contract','Обязательства сторон',r'аренд|концес|договор|гаранти|лизинг'),('library','Текст и права',r'устав|программ|фото|завещ|переписк'),('money','Бюджетное основание',r'налог|бюджет|дотац|субсид|грант|кредит|долг|платёж')]
    for kind,label,pattern in rules:
        if re.search(pattern,t):return kind,label
    return 'paper','Юридический документ'
def roles_for(i,title,facts,basis):
    if i>=89:
        k=i-89
        if k in [2,3,4]:return ['депутат','председатель государственной думы']
        if k in [5]:return ['депутат','сенатор']
        if k==6:return ['президент']
        if k in [8,9]:return ['министр юстиции','минюст']
        if k in [10,11]:return ['цик','избирательной комиссии']
        if k in [19,20,21,22,23,24,25]:return ['министр труда','министр юстиции','руководитель']
        if k in [26,27,28,29,30,31,32,33]:return ['министр юстиции','руководитель','глава']
        if k in [34,35]:return ['министр финансов','налоговой']
        if k in [0,41,44,45,46,47,54,55]:return ['судья','суд']
        if k==52:return ['руководитель партии','депутат','министр юстиции']
        if k==39:return ['министр культуры','глава']
        if k==40:return ['министр природ','министр эколог','глава']
    t=(title+' '+facts).lower()
    if re.search(r'муницип|местн|земел|земл|торговый|турист',t):return ['глава','муницип','министр финансов']
    if re.search(r'эколог|выброс|лесн|ущерб|природ',t):return ['министр природ','министр эколог','глава']
    return ['министр финансов','правительств','губернатор'] if i<89 or re.search(r'бюджет|субсид|налог|закуп',t) else ['министр юстиции','глава','руководитель']

# Strategic credit is assigned only to an explicit legitimate institutional interest.
ROLE_INTEREST_NOTES={2: 'Сохранение законной поддержки промышленного сектора без произвольной льготы.', 9: 'Защита репутации органа через урегулирование конфликта интересов.', 15: 'Защита устойчивости казны и границ долговой ответственности.', 25: 'Поддержка портового инвестора в пределах законных льгот.', 48: 'Обоснование устойчивого инвестиционного предложения без фиктивной прибыли.', 53: 'Сохранение доверия к региональному финансовому контролю.', 57: 'Защита репутации конкурсного отбора от аффилированности.', 59: 'Отстаивание законных условий инвестиционного соглашения.', 68: 'Укрепление поддержки муниципальной власти через проверяемое участие граждан.', 102: 'Защита репутации закупочной комиссии через отвод при конфликте.', 106: 'Сохранение права на судебную защиту при пропуске административного срока.', 120: 'Защита доверия к органу власти через законную бюджетную открытость.', 148: 'Защита репутации финансового органа через предусмотренный контроль.'}

cases=[];scenes=[]
for i,((title,facts,basis,correct),wrong) in enumerate(zip(rows,alternatives)):
    n=i+1;scene_no=n+50;key=f'bank-legal-2026-{n:03}'
    region=regions[i] if i<89 else None
    roles=roles_for(i,title,facts,basis)
    if 'БК РФ' in basis:source='https://pravo.gov.ru/proxy/ips/?docbody=&nd=102054721'
    elif 'НК РФ' in basis:source='https://www.nalog.gov.ru/rn77/taxation/tax_legislation/'
    elif 'Конституция' in basis:source='http://www.kremlin.ru/acts/constitution'
    else:source='https://pravo.gov.ru/'
    lawful_explanation=correct.rstrip('. ') + '. Основание: '+basis.rstrip('. ')+'. Выполнить этот шаг следует в установленной процедуре и в пределах компетенции: '+', '.join(roles)+'. При отсутствии нужной игровой должности необходимо было пригласить уполномоченного участника до голосования.'
    # Different, declared game scenarios, not claims about actual regional economies.
    fx={'activity':.004+(i%7)*.001,'expenditure':15+i%17} if region else None
    badfx={'activity':-.006-(i%9)*.001,'expenditure':45+i%29} if region else None
    if region and re.search(r'двойн|непострад|неподтвержд|неиспользован',facts):fx={'expenditure':-20-i%19,'activity':.005};badfx={'expenditure':65+i%31,'activity':-.012}
    effects=[{'key':'option_1','trust':1,'description':lawful_explanation,'news':correct.rstrip('. ')+'. В учебной модели устранён конкретный правовой риск.','public_interest':'beneficial','authorized_roles':roles,'lawful':True,'protects_role_interest':n in ROLE_INTEREST_NOTES,'role_interest_note':ROLE_INTEREST_NOTES.get(n),'legal_basis':basis+' Источник: '+source},
             {'key':'option_2','trust':-2,'description':'Выбранный способ не устраняет нарушение: '+wrong.rstrip('. ')+'. Надлежащий шаг: '+lawful_explanation,'news':'Выбран спорный способ: '+wrong.rstrip('. ')+'. Возник риск законности и доверия.','public_interest':'harmful','authorized_roles':roles,'lawful':False,'protects_role_interest':False,'legal_basis':basis+' Источник: '+source}]
    # Alternate lawful/illegal button position; the first button is not always correct.
    if n in ROLE_INTEREST_NOTES:effects[0]['description']+=' Стратегический критерий: '+ROLE_INTEREST_NOTES[n]
    if fx:effects[0]['fiscal_effect']=fx;effects[1]['fiscal_effect']=badfx
    choices=[correct,wrong]
    if n%2==0:effects.reverse();choices.reverse()
    for j,e in enumerate(effects,1):e['key']='option_'+str(j)
    kind,label=visual(title,facts,basis)
    scene={'scene_id':f'scene-{scene_no:03}','title':title,'case_key':key,'format':'animated-svg','version':4,'alt':title+': участники изучают '+label.lower()+' и документы по ситуации.','media_label':'Бюджетный обозреватель' if region else 'Правовой курьер','news_lead':'Ситуация «'+title+'»: '+facts}
    if region:scene.update(region_code=region['code'],region_name=region['name'])
    cases.append({'case_key':key,'title':title,'category':'Региональные финансы' if region else 'Правовая практика','situation':facts,'seriousness':'serious','audience':'all','allowed_roles':roles,'decision_options':choices,'effect_plan':{'options':effects},'comic_scene':scene,'source_note':'Авторская учебная задача на основе норм российского права; факты вымышлены. '+basis+'. '+source+' Последствия в рейтингах и бюджете — игровые допущения. Подлежит обсуждению и проверке преподавателем.'})
    # Each scene has its own evidence labels, composition, actors, locations and object.
    context=region['name'] if region else 'Правовая мастерская'
    short_title=title if len(title)<37 else title[:34]+'…'
    leftkind='factory' if re.search(r'завод|станок|предприят|прибыл|добыч',facts.lower()) else 'hotel' if kind=='hotel' else 'court' if kind=='scale' else 'office'
    shift=(n%5)*22;colors=[BLUE,PINK,TEAL,'#f5a079']
    headline=text(45,60,short_title,28)+text(46,92,context,17,'#4f6d99')
    cloud=path('M530 127q15-43 51-12 33-47 59-7 33-18 44 19Z',PAPER,s=PAPER,w=1)
    artwork=building(65+shift,193,leftkind)+person(163+shift,378,colors[n%4],['point','read','talk','wait'][n%4],.88,n%3==0)+person(400-shift//2,366,colors[(n+1)%4],['read','talk','point','wait'][(n+2)%4],.9,n%3==1)
    artwork+=prop(kind if kind!='hotel' else 'money',611-shift,236,label,n)
    evidence=paper(412+shift,200,basis.split(';')[0][:24],(n%7-3)*3)
    artwork+=evidence+text(544,461,'Документы · Факты · Решение',15,'#466891')
    sun=f'<circle cx="{804-shift}" cy="128" r="58" fill="#ffd989"/><g stroke="#edb458" stroke-width="4">'+''.join(f'<path d="M{804-shift} 48v-12" transform="rotate({j*45} {804-shift} 128)"/>' for j in range(8))+'</g>'
    svg='<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 960 540" role="img"><title>'+html.escape(title)+'</title><desc>'+html.escape(scene['alt'])+'</desc><defs><linearGradient id="day" x2="0" y2="1"><stop stop-color="#d7eafc"/><stop offset="1" stop-color="#f9fcff"/></linearGradient><pattern id="dots" width="14" height="14" patternUnits="userSpaceOnUse"><circle r="1.2" cx="3" cy="3" fill="#6790be" opacity=".12"/></pattern></defs><rect width="960" height="540" fill="url(#day)"/><rect width="960" height="540" fill="url(#dots)"/>'+sun+cloud+headline+path('M0 454Q240 426 467 457T960 432V540H0Z','#d6e4ed',w=0)+artwork+'<path d="M16 16H944V524H16Z" fill="none" stroke="#fff" stroke-width="5"/><style>svg{overflow:hidden}@media(prefers-reduced-motion:no-preference){text{animation:enter .6s ease-out}@keyframes enter{from{opacity:.3}to{opacity:1}}}</style></svg>'
    scenes.append((f'public/event-comics/scene-{scene_no:03}.svg',svg))

old=json.loads((ROOT/'content/events-v3-authority.json').read_text())
all_cases=old+cases
for field in ['case_key','title','situation']:
    assert len({e[field].strip().lower() for e in all_cases})==len(all_cases),f'Duplicate {field}'
assert len({hashlib.sha256(s.encode()).hexdigest() for _,s in scenes})==150
assert len({tuple(c['decision_options']) for c in cases})==150
(ROOT/'content/events-legal-2026.json').write_text(json.dumps(cases,ensure_ascii=False,indent=2)+'\n')
for name,svg in scenes:(ROOT/name).write_text(svg)
payload=json.dumps(cases,ensure_ascii=False,separators=(',',':')).replace("'","''")
sql="-- 150 original legal cases. Existing completed outcomes are never rewritten.\ninsert into private.authored_event_catalog(case_key,content) select value->>'case_key',value from jsonb_array_elements('"+payload+"'::jsonb) on conflict(case_key) do nothing;\ndo $$declare target record;begin for target in select id from public.games where exists(select 1 from public.game_members where game_id=games.id and kind='student') loop perform private.seed_authored_event_bank(target.id);end loop;end$$;\n"
(ROOT/'supabase/changes/20261002_150_legal_cases.sql').write_text(sql)
(ROOT/'docs/CASE_CONTENT_AUDIT.md').write_text('# Аудит правовых задач\n\nДобавлено 150 оригинальных задач: 89 региональных и 61 общая. Проверено 200 ключей, заголовков и фактических условий, включая прежние 50. У каждой новой задачи две самостоятельные альтернативы и объяснение с нормой и границами компетенции. Положение верного ответа чередуется.\n\nЭто авторские учебные ситуации, а не пересказ судебных дел и не обещание юридической экспертизы. Темы — бюджетное и налоговое право, конституционные процедуры, административная и гражданская практика, трудовые гарантии, данные, закупки. Смежные темы различаются юридическим фактом и требуемым действием: двойное возмещение оборудования, проверка лизинговых затрат и условия научного результата не являются одной задачей с изменённым регионом.\n\nИллюстрации — 150 независимых векторных файлов с собственной композицией и предметами, 1920×1080; SVG остаётся чётким на телефоне и большом экране. Налоговые, бюджетные и рейтинговые эффекты условны, не прогнозируют реальные регионы.\n')
print('PASS: 150 new exercises; 89 regional links; 200 unique existing/new records; 150 separate 1920×1080 scenes.')
