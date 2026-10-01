"""Acquire primary source data; no fabricated regional observations."""
import requests,json,math,hashlib,re
from pathlib import Path
from shapely.geometry import shape
import fitz
BASE="https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen"
features=[];ledger=[]
for country in ["RUS","UKR"]:
 url=f"{BASE}/{country}/ADM1/geoBoundaries-{country}-ADM1_simplified.geojson"
 r=requests.get(url,timeout=90);r.raise_for_status();d=r.json()
 print("GEOMETRY",country,[(f["properties"].get("shapeName"),f["properties"]) for f in d["features"][:3]])
 for f in d["features"]:
  if country=="UKR" and not re.search(r"crime|sevast|donetsk|luhansk|lugansk|zapori|kherson",f["properties"].get("shapeName",""),re.I):continue
  g=shape(f["geometry"]).simplify(.035,preserve_topology=True)
  features.append({"name":f["properties"]["shapeName"],"country":country,"geometry":g.__geo_interface__})
 ledger.append({"kind":"geometry","country":country,"url":url,"sha256":hashlib.sha256(r.content).hexdigest(),"year":2017,"license":"ODbL 1.0; OpenStreetMap / geoBoundaries"})
Path("data").mkdir(exist_ok=True)
Path("data/region-map.json").write_text(json.dumps({"sources":ledger,"features":features},ensure_ascii=False,separators=(",",":")))
print("MAP_NAMES",json.dumps([f["name"] for f in features],ensure_ascii=False))
pages=[]
for url in ["https://rosstat.gov.ru/storage/mediabank/Region_Pokaz_2025.pdf","https://www.rosstat.gov.ru/storage/mediabank/Region_Pokaz_2025.pdf","https://ssl.rosstat.gov.ru/storage/mediabank/Region_Pokaz_2025.pdf"]:
 try:
  r=requests.get(url,timeout=90);r.raise_for_status();pdf=fitz.open(stream=r.content,filetype="pdf")
  ledger.append({"kind":"statistics","url":url,"sha256":hashlib.sha256(r.content).hexdigest(),"publication_year":2025})
  for i in range(min(260,len(pdf))):
   t=pdf[i].get_text()
   if (re.search(r"ЧИСЛЕННОСТЬ НАСЕЛЕНИЯ|Численность населения|ЧИСЛО ПРЕДПРИЯТИЙ",t) or (i>10 and i<50)):
    pages.append({"pdf_page":i+1,"text":t})
  print("ROSSTAT_PAGES",len(pdf),"EXTRACTS",len(pages))
  for p in pages[:5]:print("SOURCE_EXCERPT",p["pdf_page"],p["text"][:700])
  break
 except Exception as exc:print("SOURCE_UNAVAILABLE",url,type(exc).__name__)
Path("data/regional-source-extract.json").write_text(json.dumps({"sources":ledger,"pages":pages},ensure_ascii=False))
Path("docs/REGIONAL_DATA_SOURCES.md").write_text("# Источники региональных данных\n\n"+json.dumps(ledger,ensure_ascii=False,indent=2)+"\n\nГраницы — справочный набор 2017 года, не карта фактического контроля. Спорные территории обозначаются отдельно. Статистические наблюдения извлекаются с указанием года и единицы; отсутствующие значения остаются пустыми. Игровые коэффициенты не являются статистикой.\n")
