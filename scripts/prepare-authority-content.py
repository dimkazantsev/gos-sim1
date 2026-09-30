import json
from pathlib import Path
x=json.loads(Path('content/events-v2.json').read_text())
roles={1:['глава','министр транспорта','министр здравоохранения'],2:['министр здравоохранения'],3:['глава','министр труда'],4:['депутат','глава'],5:['глава','министр энергетики'],6:['министр цифров','министр труда','глава'],7:['министр иностранных','глава'],8:['глава','министр строительства'],9:['глава','депутат'],10:['глава','министр внутренних','министр чрезвычай'],11:['глава','министр культуры'],12:['глава','министр транспорта'],13:['глава','министр природ','министр экологии'],14:['депутат','глава'],15:['глава','депутат'],16:['глава','министр чрезвычай'],17:['глава','министр цифров','министр природ'],18:['глава','депутат'],19:['глава','министр цифров'],20:['глава','министр иностранных'],21:['министр внутренних','глава'],22:['министр образования','министр науки'],23:['глава'],24:['глава','министр культуры'],25:['глава','министр цифров'],26:['глава','министр труда'],27:['депутат','глава'],28:['глава'],29:['глава','министр культуры'],30:['глава','министр науки']}
for i,e in enumerate(x,1):
 r=roles.get(i,['глава','министр культуры']);e['allowed_roles']=r
 for o in e['effect_plan']['options']:
  o['authorized_roles']=r
  o['lawful']=o['trust']>=0 or (i,o['key']) in {(31,'option_2'),(33,'option_2'),(38,'option_1'),(13,'option_2')}
  o['protects_role_interest']=o['trust']>0
  o['legal_basis']='Учебная разметка конкретной ситуации: компетенция '+', '.join(r)+'. Конституция РФ, статьи 15, 71–73, 114, 130–132. Последствия и границы компетенции проверяет преподаватель.'
Path('content/events-v3-authority.json').write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
sql="\n".join("update public.event_cases set allowed_roles="+"ARRAY["+','.join("'"+v.replace("'","''")+"'" for v in e['allowed_roles'])+"]::text[],effect_plan='"+json.dumps(e['effect_plan'],ensure_ascii=False).replace("'","''")+"'::jsonb where case_key='"+e['case_key']+"' and not exists(select 1 from public.event_case_outcomes where case_id=event_cases.id);" for e in x)
Path('supabase/changes/event_authority_content.sql').write_text(sql+'\n')
print('50 cases annotated; '+str(sum(len(e['effect_plan']['options']) for e in x))+' options')
