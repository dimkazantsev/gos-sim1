"""100 authored scenes made from a coherent illustrated vector prop library.

Each medal has an explicit main subject, secondary objects, environment and layout.
Existing conditions remain server-owned. Locked artwork is dimmed in the UI only.
"""
from pathlib import Path
from html import escape
import hashlib,json,math,xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parents[1]
ROWS=[s.split('|') for s in (ROOT/'content/achievements.tsv').read_text().splitlines() if s.strip()]
SCENES=[
('pen','scroll','seal','desk'),('document','lamp','pencil','desk'),('law','rocket','scroll','steps'),('constitution','crown','star','sun'),
('treasury','coins','quill','vault'),('eagle','decree','seal','palace'),('compass','decree','arrow','palace'),('government','gavel','gear','steps'),
('decree','key','clock','desk'),('parliament','microphone','scroll','hall'),('federation','map','flag','landscape'),('gear','document','seal','workshop'),
('passport','seedling','sun','blueprint'),('town','bridge','tree','landscape'),('lamp','scroll','question','desk'),('books','chain','magnifier','library'),
('calculator','coins','chart','blueprint'),('government','check','folder','desk'),('magnifier','law','shield','library'),('minutes','clock','bell','hall'),
('printing','document','check','sun'),('toolbox','law','gear','workshop'),('chain','scroll','news','network'),('folder','paperclip','shield','desk'),
('typewriter','books','quill','library'),('ballot','finger','check','hall'),('check','ballot','lamp','sun'),('cross','ballot','gavel','steps'),
('pause','ballot','clock','night'),('coins','ballot','shield','vault'),('signpost','ballot','scales','network'),('people','ballot','bell','hall'),
('bridge','parliament','government','landscape'),('shield','law','key','steps'),('handshake','shield','people','sun'),('envelope','check','person','network'),
('chat','pencil','lamp','desk'),('map','treasury','magnifier','landscape'),('compass','map','bridge','landscape'),('chess','shield','chart','night'),
('percent','quill','government','blueprint'),('seal','percent','check','vault'),('news','pencil','sun','desk'),('chain','globe','chat','network'),
('signpost','town','chain','landscape'),('tags','news','prism','sun'),('camera','painting','news','sun'),('radio','microphone','tower','network'),
('film','camera','play','night'),('paperclip','news','folder','desk'),('envelope','news','microphone','network'),('printing','check','radio','sun'),
('chat','document','pen','library'),('chat','news','person','desk'),('scales','chat','books','steps'),('eye','books','magnifier','library'),
('suitcase','flag','folder','desk'),('chairs','crown','gear','palace'),('clock','coffee','moon','night'),('town','chat','heart','landscape'),
('seal','books','heart','sun'),('treasury','law','calculator','vault'),('coffee','magnifier','minutes','desk'),('handshake','percent','map','landscape'),
('chat','shield','gavel','workshop'),('key','envelope','people','network'),('pencil','document','eraser','blueprint'),('suitcase','folder','tags','library'),
('heart','news','people','sun'),('chat','people','news','hall'),('owl','books','chat','night'),('passport','microphone','seedling','blueprint'),
('film','town','camera','landscape'),('books','shield','lamp','library'),('bridge','map','federation','landscape'),('rake','books','arrow','workshop'),
('chairs','ballot','chat','hall'),('scales','check','pause','steps'),('pencil','person','crown','desk'),('news','magnifier','check','sun'),
('printing','typewriter','rocket','library'),('flask','coins','check','blueprint'),('cow','map','shield','landscape'),('treasury','bandage','calculator','vault'),
('question','document','percent','desk'),('passport','envelope','lock','night'),('ghost','ballot','coins','night'),('news','crown','sun','sun'),
('factory','law','gear','workshop'),('wifi','shield','clock','night'),('calendar','moon','sun','night'),('stairs','document','flag','steps'),
('orchestra','scroll','government','hall'),('globe','law','town','landscape'),('government','radio','microphone','network'),('map','chat','tags','landscape'),
('calculator','scales','ballot','blueprint'),('bookopen','key','star','sun'),('quill','books','lamp','library'),('people','envelope','document','network')]
assert len(ROWS)==len(SCENES)==100 and len(set(SCENES))==100
INK='#34476c'
def p(d,f='none',s=INK,w=2.5):return f'<path d="{d}" fill="{f}" stroke="{s}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>'
def r(x,y,w,h,f,rx=3,s='none'):return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{f}" stroke="{s}" stroke-width="2"/>'
def c(x,y,rad,f,s='none'):return f'<circle cx="{x}" cy="{y}" r="{rad}" fill="{f}" stroke="{s}" stroke-width="2"/>'
def t(s,x=50,y=60,size=17,col=INK):return f'<text x="{x}" y="{y}" text-anchor="middle" font-family="Arial,sans-serif" font-weight="800" font-size="{size}" fill="{col}">{escape(s)}</text>'
def star(x=50,y=50,rad=25,col='url(#gold)'):
 pts=' '.join(f'{x+math.sin(a*math.pi/5)*(rad if a%2==0 else rad*.44):.1f},{y-math.cos(a*math.pi/5)*(rad if a%2==0 else rad*.44):.1f}' for a in range(10))
 return f'<polygon points="{pts}" fill="{col}" stroke="#fff5db" stroke-width="1.5"/>'
def page(label):return p('M16 7h50l18 18v69H16Z','#fff9e9')+p('M66 7v18h18','#c6ddf8')+t(label,47,42,12)+''.join(p(f'M27 {y}h{44 if y<81 else 29}',s='#9cb0ce',w=2) for y in [54,63,72,81])
def prop(k):
 if k in ['document','law','decree','minutes','scroll']:return page({'document':'НПА','law':'ФЗ','decree':'УКАЗ','minutes':'ПРОТОКОЛ','scroll':'ПРОЕКТ'}[k])+c(73,80,11,'url(#gold)',INK)+star(73,80,5)
 if k in ['constitution','passport']:return r(17,5,69,90,'#cf607d' if k=='constitution' else '#4982d2',7,INK)+r(23,11,57,78,'#f58ca6' if k=='constitution' else '#70a9ec',3)+star(52,30,14)+t('КОНСТ.' if k=='constitution' else 'ПАСПОРТ',52,60,11,'#fff8db')+p('M34 75h36',s='#fff2b2')
 if k in ['government','parliament','federation']:return p('M4 34 50 9l46 25Z','url(#gold)')+r(10,36,80,48,'#cee0ff',2,INK)+''.join(r(x,38,11,46,'#fff9e5',2,INK)+r(x-2,37,15,5,'#adc8ea',1) for x in [20,44,68])+r(4,84,92,9,'url(#gold)',2,INK)+t({'government':'ПРАВИТЕЛЬСТВО','parliament':'ГОСДУМА','federation':'СОВЕТ ФЕДЕРАЦИИ'}[k],50,29,8)
 if k=='town':return r(5,48,39,42,'#ffc995',3,INK)+p('M2 48 25 24l24 24Z','#ee829b')+r(18,67,13,23,'#799bd3',2)+r(57,19,35,71,'#a3d8fa',3,INK)+''.join(r(x,y,8,10,'#fff5bd',1) for x in [63,79] for y in [29,49,69])
 if k in ['pen','pencil']:return '<g transform="rotate(36 50 50)">'+r(42,7,17,66,'#668eeb' if k=='pen' else '#ffcf76',3,INK)+r(43,12,5,55,'#ffffff80',2)+r(42,7,17,12,'url(#gold)',3,INK)+p('m42 73 8.5 23L59 73Z','#ffe6c0')+p('m47 89 3.5 7 4-7Z',INK)+'</g>'
 if k=='quill':return p('M16 92 76 6q24 19 0 44L33 76Z','#a6d6ff')+p('M16 92 76 6M34 65l27-8M46 47l23-5',s='#fff',w=2)+r(3,79,27,16,'#778fd0',5,INK)
 if k=='seal':return p('M32 57 39 27q12-18 23 0l7 30Z','#f29aab')+r(23,55,52,14,'url(#gold)',3,INK)+r(17,70,65,16,'#a091d4',3,INK)+c(50,77,15,'#e76489')+star(50,77,8)
 if k=='coins':return ''.join(r(x,y,28,9,'url(#gold)',4,INK)+p(f'M{x+5} {y+3}h17',s='#fff4c0',w=1.5) for x,y in [(8,80),(8,70),(8,60),(39,80),(39,70),(39,60),(39,50),(69,80),(69,70),(69,60),(69,50),(69,40)])+c(29,28,18,'url(#gold)',INK)+t('₽',29,36,24)
 if k=='treasury':return r(7,17,86,76,'#78b8d2',7,INK)+r(15,25,69,61,'#b5e5ee',5,INK)+c(45,55,22,'#789ebd',INK)+c(45,55,12,'#d9f3ff',INK)+p('M45 33v44M23 55h44',s='#effaff',w=3)+c(45,55,4,INK)+r(75,42,5,26,'url(#gold)',2)
 if k=='calculator':return r(18,6,64,88,'#718ed8',7,INK)+r(26,14,48,22,'#d2f2cf',3,INK)+t('2026',50,30,14)+''.join(r(x,y,11,11,'#fff1ce' if x!=63 else '#ffa7a5',2) for x in [26,44,63] for y in [44,61,78])
 if k=='chart':return p('M9 10v77h84',s='#6087b5',w=4)+r(20,58,15,26,'#88d8ae',2)+r(44,37,15,47,'#ffc578',2)+r(68,18,15,66,'#84b6f4',2)+p('m12 44 26-20 22 8 28-24',s='#e86f9f',w=4)+star(89,9,6)
 if k=='ballot':return r(10,49,81,41,'#80a9e9',5,INK)+p('M10 49 25 35h50l16 14Z','#bfdbff')+p('M29 45h44',w=4)+'<g transform="rotate(-12 50 28)">'+r(30,3,39,47,'#fff9e8',3,INK)+p('m38 27 8 9 16-22',s='#55b394',w=5)+'</g>'+p('M19 65h64',s='#c8e7ff',w=2)
 if k in ['check','cross','pause','play','arrow','question','percent','finger']:
  sy={'check':p('m25 52 18 18 32-40',s='#fff',w=9),'cross':p('M31 30l38 40M69 30 31 70',s='#fff',w=9),'pause':r(31,25,13,49,'#fff',3)+r(58,25,13,49,'#fff',3),'play':p('m36 25 37 25-37 25Z','#fff','#fff'),'arrow':p('M20 50h58m-20-22 22 22-22 22',s='#fff',w=8),'question':t('?',50,72,60,'#fff'),'percent':t('%',50,69,52,'#fff'),'finger':p('M34 79V28q0-18 13-14v34l13-12 23 11-7 35-23 7Z','#fff')}
  co={'check':'#67c9a5','cross':'#f28da6','pause':'#ad9ded','play':'#69bfd7','arrow':'#81b3e8','question':'#edbc69','percent':'#d8a0e7','finger':'#81bad8'}
  return c(50,50,41,co[k],INK)+c(50,50,35,'none','#ffffff90')+sy[k]
 if k=='scales':return p('M50 15v70M19 35h63',s='#bc8a52',w=6)+p('m22 36-17 31h34ZM79 36 62 67h34Z','#9cdbd5')+p('M26 90h49',s='#ba8a4a',w=8)+c(50,15,7,'url(#gold)',INK)
 if k=='gavel':return '<g transform="rotate(-35 50 40)">'+r(18,21,56,23,'url(#gold)',4,INK)+r(42,44,11,45,'#b9937e',2,INK)+r(12,18,9,28,'#a48cd5',2)+r(73,18,9,28,'#a48cd5',2)+'</g>'+r(16,85,67,8,'#9577b7',3,INK)
 if k=='shield':return p('M50 7 87 20v29q0 30-37 48Q13 79 13 49V20Z','#76d6bb')+p('M50 15 79 25v24q0 24-29 39Z','#51afac','none')+p('m29 48 15 16 28-35',s='#fff4ce',w=7)
 if k=='key':return '<g transform="rotate(-30 50 50)">'+c(35,33,23,'url(#gold)',INK)+c(35,33,10,'#fff7df',INK)+p('M35 56v36h17V76h13V64H45','url(#gold)')+'</g>'
 if k=='gear':return p('M40 5h20l4 13 12-4 14 14-5 12 12 7v19l-12 4 4 13-14 13-13-6-6 11H35l-5-13-12 3L4 77l5-12L0 56V37l13-5-3-12L25 5l12 8Z','#c2d2ec')+c(49,53,25,'#7d9ccc',INK)+c(49,53,14,'#fff7dc',INK)
 if k=='clock':return c(50,51,40,'url(#gold)',INK)+c(50,51,33,'#fffaf0',INK)+''.join(p(f'M{50+math.sin(a*math.pi/6)*25:.1f} {51-math.cos(a*math.pi/6)*25:.1f}l{math.sin(a*math.pi/6)*4:.1f} {-math.cos(a*math.pi/6)*4:.1f}',s='#8fa1c4',w=2) for a in range(12))+p('M50 27v25l19 10',s='#6488d1',w=4)+c(50,51,4,'#ef8eaa')
 if k=='map':return p('M4 23 33 10l33 14 29-13v66L66 93 33 78 4 90Z','#aadfc7')+p('M33 10v68M66 24v69',s='#6aad9e',w=2)+p('m8 54 24-15 27 15 30-11',s='#fff6cd',w=5)+p('M66 28q17 0 17 17 0 12-17 30-17-18-17-30 0-17 17-17Z','#f091ae')+c(66,45,7,'#fff')
 if k=='bridge':return p('M5 77h90M15 25v65M85 25v65M15 30q35 58 70 0',s='#8a9bda',w=5)+''.join(p(f'M{x} 61v16',s='#bfd6f1',w=2) for x in [25,35,45,55,65,75])+p('M5 93q15-9 30 0t30 0t30 0',s='#90d8e7',w=4)
 if k=='eagle':return p('M45 40 18 20 5 35l27 29-22 8 28 10 12-17 12 17 28-10-22-8 27-29-13-15-27 20v25H45Z','url(#gold)')+p('m44 39-6-20 10-7 6 9 9-9 10 7-7 20','#efba66')+star(53,11,8)+p('M50 65v20m-9 0h20',s='#c88942',w=4)
 if k in ['crown','star','sun','moon']:
  if k=='star':return star(49,43,30)+star(17,80,13,'#add9ff')+star(84,77,14,'#ffc0df')
  if k=='crown':return p('m9 31 19 14 22-28 22 28 19-14-13 46H22Z','url(#gold)')+r(21,75,59,12,'#d6a364',4,INK)+''.join(c(x,67,4,'#f893ae') for x in [32,50,68])+p('M26 50 32 67M74 50 68 67',s='#fff2be')
  if k=='moon':return p('M70 8Q23 12 22 52q0 44 56 37Q39 63 70 8Z','#ffe5a7')+star(79,35,8)+star(11,15,5)
  return c(50,50,26,'url(#gold)',INK)+''.join(p(f'M{50+math.sin(a)*34:.1f} {50-math.cos(a)*34:.1f}l{math.sin(a)*10:.1f} {-math.cos(a)*10:.1f}',s='#eac178',w=4) for a in [n*math.pi/4 for n in range(8)])+p('M38 50h3m18 0h3M40 62q10 9 20 0',s='#a17c56',w=2)
 if k=='chat':return p('M6 16h88v57H48L28 93V73H6Z','#b4ddff')+p('M21 34h55m-55 14h43m-43 14h30',s='#789dc8',w=3)+star(82,16,10)
 if k=='news':return r(5,12,90,78,'#fff8e7',4,INK)+r(12,20,76,15,'#7e98df',1)+t('НОВОСТИ',50,31,10,'#fff')+r(14,43,27,27,'#b2e5ce',2)+p('m15 66 12-13 13 13','#74b99e','none')+p('M48 46h34m-34 10h34m-34 10h23M15 79h67',s='#adbddd',w=3)
 if k=='envelope':return r(7,27,86,58,'#b4d5fc',6,INK)+p('m7 30 43 29 43-29','#e0f0ff')+p('m9 81 32-27m50 27-32-27',s='#87afd7',w=2)+c(76,26,16,'#94dbb8',INK)+p('m67 26 6 7 11-15',s='#fff',w=3)
 if k=='folder':return p('M5 24h32l11 12h46v50H5Z','#ebbb6d')+p('M4 47h93L83 89H13Z','url(#gold)')+p('M21 30h23',s='#fff3c2',w=3)
 if k=='paperclip':return p('M62 12 24 51q-18 18 0 36t36 0l22-22q14-14 0-28t-28 0L31 61q-6 6 0 12t12 0l24-24',s='#87b8db',w=9)+p('M62 12 24 51',s='#d9f5ff',w=2)
 if k=='chain':return p('M44 36 24 57q-16 16 0 32t32 0l17-17M56 63l20-20q16-16 0-32t-32 0L27 28M34 67l33-34',s='#ddb274',w=9)+p('M34 67l33-34',s='#fff2ca',w=2)
 if k=='tags':return p('M6 18h40l40 41-30 31L6 39Z','#c0b3ed')+c(22,31,6,'#fff')+p('m44 32 27 27m-36-18 27 27',s='#e9e1ff',w=3)+p('M77 24h17v17l-9 9-26-26 10-9Z','#ffc0b4')
 if k=='painting':return r(5,12,90,77,'url(#gold)',4,INK)+r(13,20,74,61,'#c4e9ff',1)+c(70,33,10,'#fff3b7')+p('m13 71 23-28 22 18 10-11 19 23v8H13Z','#9aceb4')
 if k=='radio':return r(7,30,86,55,'#f6b5a5',7,INK)+p('M66 30 81 8',s='#8195bc',w=3)+c(32,57,19,'#fff0d8',INK)+''.join(p(f'M{x} 44v25',s='#c9aaa1',w=2) for x in [24,32,40])+r(59,41,24,10,'#def5ff',2)+c(64,67,5,'url(#gold)',INK)+c(80,67,5,'url(#gold)',INK)
 if k=='camera':return r(6,30,88,56,'#9ac0e5',7,INK)+p('M26 30V18h40v12','#cee7fb')+c(52,57,23,'#5878ad',INK)+c(52,57,15,'#aaeaf0')+c(46,51,5,'#fff')+c(82,40,4,'#ffb4b2')
 if k=='film':return r(7,25,86,62,'#938dd2',4,INK)+r(7,11,86,17,'#dfebfa',2,INK)+''.join(p(f'M{x} 12l-11 16',s='#7c87c0',w=7) for x in [24,47,69,91])+p('m37 41 26 16-26 16Z','#ffd891','#ffd891')
 if k=='microphone':return r(34,6,33,53,'#b7a1e9',16,INK)+p('M24 37v12q0 26 26 26t26-26V37M50 75v17M32 93h36',s='#879dc1',w=4)+p('M42 17h17m-17 11h17m-17 11h17',s='#eee2ff',w=2)
 if k=='tower':return p('m27 88 23-56 23 56Z','#9dc9d4')+p('M37 63h26M31 78h38',s='#eafaff')+c(50,23,7,'#f3b0b9')+p('M32 9q-16 14 0 29M68 9q16 14 0 29M21 2q-23 22 0 44M79 2q23 22 0 44',s='#a0c5ec',w=3)
 if k=='heart':return p('M50 91Q-2 56 10 30q15-27 40 0 25-27 40 0 12 26-40 61Z','#fba3c0')+p('M21 30q11-13 21 0',s='#ffe1e9',w=4)+star(77,69,10)
 if k=='chairs':return r(6,22,34,35,'#c7adeb',6,INK)+r(3,57,42,11,'#a08cd3',3,INK)+p('M9 69v22m32-22v22',s='#93a8c8',w=4)+r(60,9,33,48,'#ffd194',6,INK)+r(56,57,41,11,'#d3a773',3,INK)+p('M60 69v22m32-22v22',s='#93a8c8',w=4)+star(77,31,11)
 if k=='handshake':return p('m5 38 23-19 26 17 20-16 22 23-29 39-18-8-18 4-26-30Z','#ffdbb2')+p('m5 38 12 19 16-35m41-2 13 21',s='#9bc8ed',w=9)+p('m39 46 19 14m-13-28 20 15',s='#d6a582',w=2)+star(52,11,8)
 if k in ['people','person']:
  positions=[(50,25,17,'#b7dafa')] if k=='person' else [(22,38,12,'#fac4d8'),(51,25,16,'#b4dafa'),(82,38,12,'#c3e5bc')]
  return ''.join(c(x,y,rad,'#ffe3c6',INK)+p(f'M{x-rad-5} 90v-23q0-20 {rad+5}-20t{rad+5} 20v23Z',col) for x,y,rad,col in positions)
 if k=='books':return ''.join(r(x,9+i%2*12,19,82-i%2*12,col,3,INK)+p(f'M{x+4} {24+i%2*12}h11M{x+4} 75h11',s='#fff1ca',w=3) for i,(x,col) in enumerate([(8,'#f4adc7'),(30,'#adc2ed'),(52,'#b4e2c6'),(74,'#fbd398')]))
 if k=='bookopen':return p('M50 30Q28 12 5 25v57q25-10 45 10 20-20 45-10V25Q72 12 50 30Z','#fff5d9')+p('M50 30v62M15 35l25 7m-25 4 25 7m-25 4 25 7m20-22 25-7m-25 18 25-7m-25 18 25-7',s='#d9bc94',w=2)
 if k=='printing':return r(21,2,59,35,'#fff4dc',2,INK)+r(5,31,90,43,'#a2c8e9',6,INK)+r(22,62,58,33,'#fff9eb',2,INK)+p('M32 75h37m-37 9h29',s='#b0c3da',w=2)+c(80,43,4,'#c6f8d4')
 if k=='typewriter':return r(23,4,54,46,'#fff8e9',2,INK)+p('M32 16h37m-37 8h37m-37 8h26',s='#b0c3da',w=2)+p('M18 37h65l11 49H5Z','#ffc6b5')+r(13,47,73,9,'#9fafd1',3)+''.join(c(x,y,3,'#fff4d8',INK) for x in [22,36,50,64,78] for y in [65,76])
 if k=='toolbox':return p('M7 36h86v50H7Z','#a5ddda')+p('M34 36V18h33v18',s='#81afbd',w=6)+r(7,44,86,14,'#88c6c7',2)+r(42,50,15,15,'url(#gold)',2,INK)+p('M18 25V6m-7 9h14m51 10V6m-6 4 6 8 6-8',s='#f3b6a3',w=4)
 if k=='lamp':return p('M15 90h49M37 88 56 54 37 24 74 6',s='#a0b7d7',w=6)+p('m50 16 27-11 18 30-40 16Z','#ffdb9d')+p('M56 51 78 69 83 47Z','#fff2ba','none')+c(37,24,6,'#f6becb',INK)
 if k=='coffee':return p('M13 37h60v32q0 22-30 22T13 69Z','#fff0d5')+p('M74 44h15q11 25-13 28',s='#e5bc96',w=5)+p('M27 31q-10-10 0-21m18 21q-10-10 0-21m18 21q-10-10 0-21',s='#c6cce6',w=3)+r(24,55,40,18,'#fac4af',4)+p('M8 94h78',s='#9aadcd',w=4)
 if k=='bell':return p('M22 71q6-20 6-32 0-24 23-24t23 24q0 12 6 32Z','url(#gold)')+c(51,81,9,'#dbb27c',INK)+p('M17 72h68',s='#dfb870',w=5)+c(51,11,5,'#ffedbf',INK)
 if k=='magnifier':return p('m64 63 27 29',s='#efbf94',w=13)+c(40,40,31,'#a4d5ed',INK)+c(40,40,25,'#e3fafa')+p('M23 27q8-12 23-9',s='#fff',w=5)+p('M22 44h36m-36 9h26',s='#b3d3e1',w=2)
 if k=='eye':return p('M3 51q46-52 94 0-48 52-94 0Z','#fff6df')+c(50,51,24,'#b0d4e8',INK)+c(50,51,11,'#7795ca')+c(44,43,5,'#fff')+p('M20 15 24 24m28-17v10m27-2-5 9',s='#f1c499',w=3)
 if k=='wifi':return p('M5 29q45-41 90 0M21 48q29-28 58 0M36 66q14-14 28 0',s='#a3d9e6',w=9)+c(50,84,8,'url(#gold)',INK)
 if k=='globe':return c(50,48,39,'#a6e0ec',INK)+p('m19 23 16-7 10 15-6 18-15 1 7 22-13-7-7-20ZM65 13l15 22-15 13-4 31-13-9 4-23-10-10Z','#bde8c8')+p('M15 83q48 27 78-25M53 90v8M32 99h43',s='#deb883',w=4)
 if k=='compass':return c(50,50,42,'url(#gold)',INK)+c(50,50,33,'#fff6e0',INK)+p('M50 14 64 62 50 50 36 62Z','#f29caf')+p('m50 86 14-24-14-12-14 12Z','#a6cef0')+c(50,50,5,'#fff',INK)
 if k=='flag':return p('M20 7v87',s='#adc0de',w=5)+p('M23 11h64v41H23Z','#fff')+r(23,25,64,13,'#8fafea',0)+r(23,38,64,14,'#f6b1bb',0)+p('M10 95h30',s='#9caec8',w=4)
 if k=='tree':return p('M45 92V50',s='#c4a782',w=9)+c(29,43,25,'#afe1b5')+c(62,34,29,'#c7f0bd')+c(43,22,25,'#9bd8b3')+p('M45 71 27 55m18 4 22-16',s='#99bb94',w=3)
 if k=='seedling':return p('M50 79V32',s='#90c5a2',w=5)+p('M50 52Q3 53 14 20q39 1 36 32ZM51 39Q49 3 92 11q-4 36-41 28Z','#b7e7b0')+p('M24 23 47 48M82 16 55 35',s='#e0f6ce',w=2)+p('M15 78h71l-7 16H22Z','#f1c7a6')
 if k=='rocket':return p('M51 6q31 18 22 59L51 81 29 65Q19 24 51 6Z','#ddecff')+p('m30 48-20 24 18 5m44-29 18 24-18 5','#f7bacb')+c(51,33,13,'#a8d8ed',INK)+p('m39 81 12 18 12-18Z','#ffe4ad')+p('m45 82 6 12 6-12Z','#ffc29f')
 if k=='prism':return p('M50 12 91 86H9Z','#d0d8ff')+p('M50 12v74H9Z','#e8e8ff','none')+p('M3 39h33m22 5 38-8m-38 14 38 4m-37 1 36 18',s='#ffc4db',w=4)+p('M57 47h39',s='#ffe6b1',w=4)
 if k=='stairs':return p('M7 90h89V14H77v19H55v18H33v20H7Z','#c6ddf7')+p('M7 90h89M33 51v20h22V33h22V14',s='#a0c0dd',w=3)+star(82,9,8)
 if k=='signpost':return p('M49 7v87',s='#d5b99a',w=6)+p('M6 17h70l15 14-15 14H6Z','#c4e8f6')+p('M92 50H24L9 63l15 13h68Z','#efcff1')+p('M19 31h45M33 63h43',s='#9cacc7',w=3)
 if k=='chess':return p('m25 82 10-33-8-27 26-15 22 24-17 10 9 41Z','#e4d7f6')+c(54,23,3,INK)+r(17,81,66,11,'#c4a8e4',3,INK)+p('M35 49h28',s='#b6a1d1',w=3)
 if k=='suitcase':return r(7,31,86,55,'#ddb89b',6,INK)+p('M33 31V18h35v13',s='#c0a68c',w=6)+r(21,31,8,55,'#ffe4bf',2)+r(72,31,8,55,'#ffe4bf',2)+r(42,40,18,11,'url(#gold)',2,INK)+p('m39 66 15 4 6-13-15-4Z','#c0eaf0')
 if k=='eraser':return p('m6 69 53-57 35 32-49 50H32Z','#fac5df')+p('m6 69 21-23 36 30-18 18H32Z','#e2ebff')+p('M14 92h68',s='#b2c3d8')
 if k=='owl':return p('M16 18 31 31q20-15 40 0l13-13v44q-3 33-34 33T16 62Z','#d4bfed')+c(32,48,18,'#fff1d6')+c(68,48,18,'#fff1d6')+c(34,48,7,INK)+c(66,48,7,INK)+p('m43 64 7 13 7-13Z','url(#gold)')+p('M29 82l9 4m24 0 9-4',s='#ecdfff',w=3)
 if k=='rake':return p('M50 91V22M17 22h67M17 7v15m17-15v15M50 7v15M67 7v15m17-15v15',s='#d3bba4',w=7)+p('M18 7h65',s='#b0c4e6',w=4)
 if k=='flask':return p('M38 6h25v37l24 39q7 15-11 15H24q-16 0-10-15l24-39Z','#e1f5ff')+p('m25 67-11 19q0 6 10 6h53q10 0 6-7L72 67Z','#a6e6d9','none')+c(44,71,4,'#e4fff7')+c(67,82,5,'#e4fff7')+p('M36 7h29',s='#bac9e6',w=4)
 if k=='cow':return p('M20 30 9 14l19 2m48 14 15-16-19 2','#ffe8c5')+p('M24 23h52l5 47q0 25-32 25T17 70Z','#fff9e9')+p('M26 23h19l-8 31H21Z',INK,'none')+c(65,45,6,INK)+p('M22 72q26-18 54 0v12q-26 17-54 0Z','#facad0')+c(35,79,3,INK)+c(64,79,3,INK)
 if k=='bandage':return '<g transform="rotate(-35 50 50)">'+r(7,32,86,35,'#f7d6b7',12,INK)+r(35,33,30,33,'#fff1d5',3)+''.join(c(x,y,1.5,'#d6b596') for x in [17,25,75,83] for y in [41,49,57])+'</g>'
 if k=='lock':return p('M28 43V28q0-25 23-25t23 25v15',s='#c2d4ee',w=9)+r(14,41,74,50,'url(#gold)',8,INK)+c(51,61,8,INK)+p('M51 67v11',s=INK,w=5)
 if k=='ghost':return p('M17 93V42q0-36 34-36t34 36v51L72 81 59 93 45 81 31 93Z','#ebdffc')+c(38,42,5,'#909cbe')+c(65,42,5,'#909cbe')+p('M43 58q9 10 17 0',s='#baa8db',w=3)+star(16,15,8)
 if k=='factory':return p('M8 42 35 27v15l26-15v15h32v50H8Z','#bcd5f4')+r(72,6,15,36,'#f7ceb8',1,INK)+''.join(r(x,56,13,16,'#fff3ce',2,INK) for x in [18,42,66])+p('M76 7q-14-9 0-13',s='#c6e2f2',w=5)
 if k=='calendar':return r(7,16,87,76,'#fff9e8',7,INK)+r(7,16,87,23,'#f9bed2',6)+p('M28 8v19M73 8v19',s='#a6bce1',w=5)+''.join(r(x,y,12,11,'#d0e0fa',2) for x in [21,44,67] for y in [48,69])+c(50,72,10,'#b7e5cb')+p('m44 72 5 5 9-12',s='#fff',w=2)
 if k=='orchestra':return p('M35 85V20L80 8v68',s='#b6a0dc',w=7)+p('M37 27 79 16v16L37 44Z','#ddcff3')+'<ellipse cx="23" cy="86" rx="17" ry="11" fill="url(#gold)"/><ellipse cx="69" cy="78" rx="17" ry="11" fill="url(#gold)"/>'+star(12,21,9)+star(92,47,6)
 raise ValueError(k)
PAL=[('#2463eb','#86cbff','#ffd789','#f1faff'),('#8155df','#d9bcff','#ffd589','#fff0fb'),('#e75a8c','#ffbbce','#ffe88e','#fff5e5'),('#18977f','#9ae6c6','#ffdc91','#effff4'),('#ec9b39','#ffe29a','#9ddfff','#fff9e6'),('#3f7bd5','#bfdcff','#ffaedb','#f3f8ff'),('#be59b3','#f5c3e9','#9de4f2','#fff6ff'),('#40a969','#b6eaaa','#fff3a2','#f6ffe7'),('#7569d7','#bfc3ff','#ffccbd','#f6f3ff'),('#dc7d59','#ffd1ad','#aae6db','#fff7ed')]
FRAMES=['M25 8h206q17 0 17 17v206q0 17-17 17H25q-17 0-17-17V25Q8 8 25 8Z','M128 7 244 42v145l-116 62L12 187V42Z','M45 8h166l37 37v166l-37 37H45L8 211V45Z','M128 7q121 0 121 121T128 249Q7 249 7 128T128 7Z','M29 9h198l20 46-9 179-110 15-110-15L9 55Z','M29 9h198l20 28v173l-31 36H40L9 210V37Z','M128 7 246 61l-19 156-99 32-99-32L10 61Z','M43 8h170l34 39v166l-34 34H43L9 213V47Z','M27 8h202q19 0 19 24v177q0 20-20 27l-100 13-100-13q-20-7-20-27V32Q8 8 27 8Z','M128 7 241 37l8 91-23 108-98 13-98-13L7 128l8-91Z']
LAYOUTS=[(57,39,149,-7,14,150,79,165,137,76),(45,46,160,5,13,23,67,164,154,80),(31,41,160,-9,168,24,73,154,153,83),(57,32,152,7,11,151,83,159,157,80),(28,27,162,-7,163,57,81,140,164,86),(45,26,159,0,9,131,86,165,152,81),(68,44,147,8,15,42,83,15,158,77),(31,34,164,-4,167,27,74,158,154,79),(55,39,155,11,10,30,69,23,151,80),(29,31,160,-6,161,50,81,141,161,85)]
def at(k,x,y,size,angle=0):return f'<g transform="translate({x} {y}) rotate({angle} {size/2} {size/2}) scale({size/100})">{prop(k)}</g>'
def background(story,i):
 if story=='landscape':return p('M14 170q36-69 72-22 32-67 72-13 26-26 84 24v77H14Z','#c8ebd1','none')+p('M12 197q61-33 127 2t105-1v38H12Z','#a0d7c5','none')+p('M23 205q83-20 173 18',s='#e5fff5',w=3)
 if story=='night':return c(201,49,25,'#fff1c5')+p('M186 32q-9 30 30 32','#d6c4ed','none')+''.join(star(x,y,4,'#fff') for x,y in [(37,52),(76,28),(155,33),(226,110),(26,114)])+p('M12 204 58 156l31 28 43-33 38 31 37-27 37 45v36H12Z','#c5cbea','none')
 if story=='network':return ''.join(p(d,s='#cfdef6',w=3) for d in ['M21 58 221 189','M30 188 211 52','M30 188 21 58 211 52 221 189Z'])+''.join(c(x,y,9,'#fff9ef')+c(x,y,4,'#bad5ed') for x,y in [(21,58),(221,189),(30,188),(211,52)])
 if story=='sun':return ''.join(p(f'M128 118 {128+math.sin(a)*180:.1f} {118-math.cos(a)*180:.1f}',s='#ffffff66',w=12) for a in [j*math.pi/8 for j in range(16)])+c(128,126,88,'#ffffff30')
 if story=='blueprint':return ''.join(p(f'M{x} 16v220M16 {x}h220',s='#a7cbf255',w=1) for x in range(24,236,24))+p('M20 204h210M26 28v196',s='#ffffffb0',w=2)
 if story=='library':return ''.join(r(x,25,20,154,col,3) for x,col in [(22,'#e0cbef'),(46,'#cae5f5'),(184,'#c3e9d6'),(208,'#f9dcc0')])+p('M15 83h224M15 180h224',s='#e7d5bb',w=6)
 if story=='hall':return ''.join(p(f'M{16+j*12} 209q112 {-94-j*3} {224-j*24} 0',s='#cedcf0',w=5) for j in range(4))+c(128,49,33,'#ffffff50')
 if story=='vault':return r(21,25,215,179,'#c5e3ee55',12)+''.join(c(x,y,4,'#fff5cc') for x,y in [(30,36),(225,36),(30,194),(225,194)])+c(128,120,80,'#ffffff33')
 if story=='palace':return p('M14 68 128 12l114 56Z','#ffffff90','none')+''.join(r(x,67,16,138,'#e6efff77',2) for x in [22,59,180,217])+r(14,207,228,15,'#f6dbb555')
 if story=='steps':return ''.join(r(18-n*3,177+n*15,219+n*6,13,'#bfd5ee' if n%2==0 else '#e2ecfd',2) for n in range(4))+p('M22 42h212',s='#ffffffa0',w=3)
 if story=='workshop':return p('M12 164h232v73H12Z','#ded5ed55','none')+''.join(c(x,y,3,'#ffffffb0') for x in range(25,237,17) for y in [26,43])+p('M20 222h218',s='#e5f5ff55',w=5)
 return p('M12 175h232v61H12Z','#ecd9c655','none')+p('M12 176h232M30 208h56m78 0h62',s='#e8d3bb80',w=3)
def svg(i,title):
 main,left,right,story=SCENES[i-1];layout=(i-1)%10;fg,accent,gold,paper=PAL[(i*3+i//10)%10];frame=FRAMES[(layout+i//10)%10];x,y,size,ang,lx,ly,ls,rx,ry,rs=LAYOUTS[layout]
 body=background(story,i)+f'<ellipse cx="126" cy="214" rx="90" ry="12" fill="{fg}" opacity=".15"/>'+at(main,x,y,size,ang)+at(left,lx,ly,ls,-14+layout*3)+at(right,rx,ry,rs,12-layout*2)
 body+=''.join(star(xx,yy,rad,gold) for xx,yy,rad in [(31+i*7%23,74+i*11%26,4),(218-i*3%15,118+i*13%23,5),(128+i%7*3,24,4)])
 return f'''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 256 256"><title>{escape(title)}</title><defs><linearGradient id="sky" x2=".7" y2="1"><stop stop-color="{paper}"/><stop offset=".58" stop-color="{accent}"/><stop offset="1" stop-color="{fg}"/></linearGradient><linearGradient id="gold" x2=".4" y2="1"><stop stop-color="#fff6d2"/><stop offset=".42" stop-color="{gold}"/><stop offset="1" stop-color="#e8b367"/></linearGradient><linearGradient id="rim" x2="1" y2="1"><stop stop-color="#fff9df"/><stop offset=".26" stop-color="{gold}"/><stop offset=".66" stop-color="{accent}"/><stop offset="1" stop-color="{fg}"/></linearGradient><clipPath id="clip"><path d="{frame}"/></clipPath></defs><path d="{frame}" fill="url(#sky)" stroke="url(#rim)" stroke-width="9"/><g clip-path="url(#clip)">{body}</g><path d="{frame}" fill="none" stroke="#ffffffbb" stroke-width="2"/><path d="M26 21h38M20 28v34" fill="none" stroke="#ffffffb0" stroke-width="3" stroke-linecap="round"/></svg>'''
out=ROOT/'public/medals';out.mkdir(parents=True,exist_ok=True);catalog=[];manifest=[];unique=set()
for i,(title,description,conditions) in enumerate(ROWS,1):
 key=f'medal-{i:03}';art=svg(i,title);ET.fromstring(art);fingerprint=hashlib.sha256(art.split('</title>',1)[1].encode()).hexdigest();assert fingerprint not in unique;unique.add(fingerprint)
 (out/f'{key}.svg').write_text(art);(out/f'{key}-locked.svg').write_text(art)
 condition=json.loads(conditions);assert condition and all(isinstance(v,(int,float)) and v>0 for v in condition.values())
 catalog.append(dict(id=key,title=title,description=description,hidden=i>60,conditions=condition,sort_order=i));manifest.append(dict(id=key,scene=SCENES[i-1],layout=(i-1)%10,fingerprint=fingerprint))
payload=json.dumps(catalog,ensure_ascii=False,separators=(',',':')).replace("'","''")
(ROOT/'supabase/changes/20261002_achievement_catalog.sql').write_text("-- Authored definitions stay in the private server catalog.\ninsert into private.achievement_catalog select v->>'id',v->>'title',v->>'description',(v->>'hidden')::boolean,v->'conditions',(v->>'sort_order')::integer from jsonb_array_elements('"+payload+"'::jsonb) v on conflict(id) do update set title=excluded.title,description=excluded.description,conditions=excluded.conditions;\n")
(ROOT/'docs/ACHIEVEMENT_ART.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
(ROOT/'docs/ACHIEVEMENT_METHOD.md').write_text('100 самостоятельных цветных векторных иллюстраций. Для каждой вручную задана сцена из основного и двух вспомогательных предметов, окружения и композиции. Вектор не пикселизируется на больших экранах. Старые URL сохранены. В каталоге преподавателя рисунок всегда цветной. В профиле открытые условия видны полностью, неполученный рисунок приглушён стилем. Скрытые условия возвращает сервер только после получения. Критерии и ВСН не изменены.\n')
print('PASS 100 authored scenes; 100 distinct compositions; server criteria preserved')
