"""Audit server-rendered review screens. Does not replace browser accessibility testing."""
from pathlib import Path
from html.parser import HTMLParser
from collections import Counter

class Markup(HTMLParser):
    def __init__(self):
        super().__init__()
        self.stack=[];self.fields=[];self.labels=set();self.ids=[];self.images=[];self.main=0
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if a.get('id'):self.ids.append(a['id'])
        if tag=='label' and a.get('for'):self.labels.add(a['for'])
        if tag=='main':self.main+=1
        if tag=='img':self.images.append(a)
        if tag in ('input','textarea','select') and a.get('type')!='hidden' and 'hidden' not in a:
            self.fields.append((tag,a,'label' in self.stack))
        if tag not in ('input','img','br','hr','meta','link','path','circle','rect','line','polyline','use','source','wbr'):self.stack.append(tag)
    def handle_endtag(self,tag):
        if tag in self.stack:self.stack=self.stack[:len(self.stack)-1-self.stack[::-1].index(tag)]

errors=[];total=0;screens=0
for file in sorted(Path('.design-review').glob('*.html')):
    if file.name=='gos-sim-preview.html':continue
    audit=Markup();audit.feed(file.read_text());screens+=1;total+=len(audit.fields)
    for tag,attrs,wrapped in audit.fields:
        if not(wrapped or attrs.get('aria-label') or attrs.get('aria-labelledby') or attrs.get('id') in audit.labels):
            errors.append(f'{file.name}: unlabelled {tag} {attrs.get("placeholder",attrs.get("class",""))}')
    for name,n in Counter(audit.ids).items():
        if n>1:errors.append(f'{file.name}: duplicate id {name}')
    for img in audit.images:
        if 'alt' not in img:errors.append(f'{file.name}: image without alt')
    if audit.main!=1:errors.append(f'{file.name}: {audit.main} main landmarks')
    print(f'{file.name}: {len(audit.fields)} fields, {len(audit.images)} images, {audit.main} main landmark')
if errors:
    print('\n'.join(errors));raise SystemExit(1)
print(f'PASS: {screens} rendered screens; {total} visible fields labelled; IDs, image alternatives and main landmarks checked.')
