"""Exact region joins; source sheet/column/unit preserved. No missing value imputation."""
import json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
data=json.loads((ROOT/'data/statistics-source-extract.json').read_text())
regions=json.loads((ROOT/'data/regions.json').read_text())
source=next(s for s in data['sources'] if s['kind']=='tax_receipts')
book=next(e for e in data['extract'] if '_11О ' in e['file'])
sheet=next(t for t in book['tables'] if t['sheet']=='1000')
usn=next(t for e in data['extract'] for t in e['tables'] if t['sheet']=='3300')
def name(v):return re.sub(r'[^а-яёa-z0-9]','',v.lower().replace('г. ','').replace('чувашия','').replace('республика северная осетия','республика северная осетия'))
lookup={name(row[0]):row for row in sheet['rows'] if isinstance(row[0],str) and len(row)>4 and isinstance(row[1],(float,int))}
usnlookup={name(row[0]):row for row in usn['rows'] if isinstance(row[0],str) and len(row)>4 and isinstance(row[1],(float,int))}
aliases={'Чувашская Республика':'Чувашская Республика - Чувашия','Ханты-Мансийский автономный округ — Югра':'Ханты-Мансийский автономный округ - Югра','Республика Саха (Якутия)':'Республика Саха (Якутия)'}
out=[]
for r in regions:
    row=lookup.get(name(aliases.get(r['name'],r['name'])))
    u=usnlookup.get(name(aliases.get(r['name'],r['name'])))
    observations={k:round(row[i]/1000,3) if row else None for k,i in [('tax_receipts_total',1),('tax_receipts_federal',2),('tax_receipts_consolidated',3),('tax_receipts_local',4)]}
    observations['usn_receipts']=round(u[2]/1000,3) if u else None
    if row:assert abs(row[1]-row[2]-row[3])<=1,('Budget split fails',r['name'])
    r.update(observations=observations,statistics_source='https://www.nalog.gov.ru/rn77/related_activities/statistics_and_analytics/forms/16031004/',statistics_year=2025)
    out.append({'code':r['code'],'name':r['name'],'observations':observations,'source_url':r['statistics_source'],'source_year':2025,'unit':'млн рублей','source_row':row[0] if row else None})
matched=sum(r['observations']['tax_receipts_total'] is not None for r in out)
assert matched>=85,('Incomplete exact join',matched)
(ROOT/'data/regions.json').write_text(json.dumps(regions,ensure_ascii=False,indent=2)+'\n')
(ROOT/'data/regional-observations.json').write_text(json.dumps({'source':source,'year':2025,'unit':'млн рублей','sheet':'1000','columns':['1000','1000.2','1000.3','1000.4'],'regions':out},ensure_ascii=False,indent=2)+'\n')
sql="-- FNS 1-NM, 2025 receipts as at 01.01.2026. Thousands converted to millions.\nupdate public.fiscal_region_reference d set observations=x.observations,source_url=x.source_url,source_year=x.source_year from jsonb_to_recordset('"+json.dumps(out,ensure_ascii=False,separators=(',',':')).replace("'","''")+"'::jsonb) as x(code text,observations jsonb,source_url text,source_year integer) where d.code=x.code;\n"
(ROOT/'supabase/changes/20261002_regional_observations.sql').write_text(sql)
(ROOT/'docs/REGIONAL_STATISTICS_METHOD.md').write_text('# Региональная статистика\n\nИсточник: ФНС России, форма 1-НМ за 2025 год по состоянию на 01.01.2026. '+source['url']+'\n\nSHA-256: '+source['sha256']+'\n\nЛист 1000: поступления доходов, администрируемых налоговыми органами; графы всего, федеральный бюджет, консолидированный бюджет субъекта, из него местные бюджеты. Лист 3300: поступления по УСН. Исходная единица — тыс. рублей, в приложении — млн рублей (деление на 1000). Это не полные доходы бюджетов, не ВРП и не число предприятий. Местные поступления уже входят в консолидированные — их нельзя повторно складывать.\n\nСопоставлены '+str(matched)+' из 89 регионов по точному нормализованному наименованию; алиасы перечислены в normalize-regional-statistics.py. Отсутствующие значения — null. Проверена тождественность всего = федеральные + консолидированные, с допустимым округлением исходной таблицы. Игровые параметры предприятия/зарплата/расходы отделены от статистических наблюдений.\n')
print('PASS: exact regional joins',matched,'/89; reconciled source units and budget columns.')
