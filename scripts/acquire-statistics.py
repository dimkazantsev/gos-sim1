"""Download primary regional statistics with a scoped, verified certificate bundle."""
from pathlib import Path
import json, hashlib, re, io, zipfile, ssl
import requests, certifi
from cryptography import x509
from cryptography.hazmat.primitives.serialization import Encoding

root=Path(__file__).resolve().parents[1]
bundle=Path('/tmp/civic-statistics-ca.pem')
certificates=[Path(certifi.where()).read_bytes()]
for name in ['root','sub']:
    url=f'https://gu-st.ru/content/Other/doc/russian_trusted_{name}_ca.cer'
    try:
        r=requests.get(url,timeout=20);r.raise_for_status()
        b=r.content
        if b'BEGIN CERTIFICATE' not in b:b=x509.load_der_x509_certificate(b).public_bytes(Encoding.PEM)
        certificates.append(b)
    except Exception as exc:print('CERTIFICATE_UNAVAILABLE',name,str(exc)[:180])
bundle.write_bytes(b'\n'.join(certificates))
session=requests.Session()
session.headers.update({'User-Agent':'Mozilla/5.0 Civic education statistics research','Referer':'https://www.nalog.gov.ru/'})
sources=[
 ('population','https://rosstat.gov.ru/storage/mediabank/OkPopul_Comp2025_Site.xlsx'),
 ('tax_receipts','https://www.nalog.gov.ru/html/sites/www.new.nalog.ru/files/related_activities/statistics_and_analytics/forms/1nm/1nm010126reg.zip'),
 ('regional_budget','https://54.rosstat.gov.ru/storage/mediabank/%D0%98%D1%81%D0%BF%D0%BE%D0%BB%D0%BD%D0%B5%D0%BD%D0%B8%D0%B5%20%D0%BA%D0%BE%D0%BD%D1%81%D0%BE%D0%BB%D0%B8%D0%B4%D0%B8%D1%80%D0%BE%D0%B2%D0%B0%D0%BD%D0%BD%D1%8B%D1%85%20%D0%B1%D1%8E%D0%B4%D0%B6%D0%B5%D1%82%D0%BE%D0%B2.pdf')]
extract=[];ledger=[]
for kind,url in sources:
    try:
        r=session.get(url,timeout=60,verify=str(bundle));r.raise_for_status()
        ledger.append({'kind':kind,'url':url,'sha256':hashlib.sha256(r.content).hexdigest()})
        raw=[(url.rsplit('/',1)[-1],r.content)]
        if r.content.startswith(b'PK') and url.endswith('.zip'):
            archive=zipfile.ZipFile(io.BytesIO(r.content));raw=[(n,archive.read(n)) for n in archive.namelist() if n.lower().endswith(('.xls','.xlsx','.csv'))]
        for name,data in raw:
            rows=[]
            if name.lower().endswith('.xlsx'):
                import openpyxl
                book=openpyxl.load_workbook(io.BytesIO(data),read_only=True,data_only=True)
                for sheet in book:
                    rows.append({'sheet':sheet.title,'rows':[list(row) for row in sheet.iter_rows(values_only=True)]})
            elif name.lower().endswith('.xls'):
                import xlrd
                book=xlrd.open_workbook(file_contents=data)
                for sheet in book.sheets():rows.append({'sheet':sheet.name,'rows':[sheet.row_values(i) for i in range(sheet.nrows)]})
            elif name.lower().endswith('.pdf'):
                import fitz
                book=fitz.open(stream=data,filetype='pdf')
                rows=[{'page':i+1,'text':page.get_text()} for i,page in enumerate(book)]
            extract.append({'kind':kind,'file':name,'tables':rows})
            print('SOURCE',kind,name,'SHEETS',len(rows),'ROWS',[len(s.get('rows',[])) for s in rows[:3]])
            for row in rows[:1]:print('PREVIEW',json.dumps(row,ensure_ascii=False,default=str)[:4000])
    except Exception as exc:print('SOURCE_UNAVAILABLE',kind,str(exc)[:260])
out={'sources':ledger,'extract':extract}
(root/'data/statistics-source-extract.json').write_text(json.dumps(out,ensure_ascii=False,default=str))
assert ledger,'No primary statistics could be downloaded; leave observations empty.'
