import fs from 'node:fs';
import assert from 'node:assert/strict';
import postcss from 'postcss';

const read=p=>fs.readFileSync(p,'utf8');
const styles=['design-tokens','design-shell','design-views','design-responsive','design-readability'];
const css=Object.fromEntries(styles.map(name=>[name,read(`app/${name}.css`)]));
let count=0;
function check(label,test){assert.ok(test,label);console.log(`PASS ${label}`);count++;}
const tokens=Object.fromEntries([...css['design-tokens'].matchAll(/(--gs-[\w-]+):([^;{}]+)/g)].map(m=>[m[1],m[2].trim()]));
function luminance(hex){const rgb=hex.replace('#','');const full=rgb.length===3?[...rgb].map(c=>c+c).join(''):rgb;const channels=[0,2,4].map(i=>{const c=parseInt(full.slice(i,i+2),16)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4});return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];}
function contrast(fg,bg){const a=luminance(fg),b=luminance(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
const pairs=[['Основной текст',tokens['--gs-ink'],'#ffffff'],['Вторичный текст',tokens['--gs-muted'],'#ffffff'],['Подписи на фоне',tokens['--gs-muted'],tokens['--gs-bg']],['Основная кнопка','#ffffff',tokens['--gs-accent']],['Розовые подписи',tokens['--gs-pink-ink'],tokens['--gs-pink-soft']],['Успешный статус',tokens['--gs-green'],tokens['--gs-green-soft']],['Пауза',tokens['--gs-amber'],tokens['--gs-amber-soft']],['Ошибка',tokens['--gs-red'],tokens['--gs-red-soft']],['Текст текущего этапа','#e3eaff',tokens['--gs-accent']]];
for(const [name,fg,bg] of pairs){const ratio=contrast(fg,bg);check(`${name}: ${ratio.toFixed(2)}:1 (AA ≥ 4.5:1)`,ratio>=4.5);}
for(const [name,source] of Object.entries(css)){
 const root=postcss.parse(source,{from:`app/${name}.css`});
 check(`${name}: CSS parsed`,root.nodes.length>0);
 const undersized=[];root.walkDecls('font-size',d=>{if(/^\d+(\.\d+)?px$/.test(d.value)&&parseFloat(d.value)>0&&parseFloat(d.value)<12)undersized.push(d.toString())});
 check(`${name}: no text size below 12px`,undersized.length===0);
 const unknown=[];root.walkDecls(d=>{for(const match of d.value.matchAll(/var\((--gs-[\w-]+)/g))if(!(match[1] in tokens))unknown.push(match[1])});
 check(`${name}: all design tokens resolve`,unknown.length===0);
}
for(const name of ['globals','landing','sim-shell','sim-panels','public-screen']){const root=postcss.parse(read(`app/${name}.css`),{from:`app/${name}.css`});check(`${name}: inherited CSS parsed`,root.nodes.length>0);}
const layout=read('app/layout.tsx');
check('Single ordered entry point for all design sheets',styles.every((name,i)=>layout.indexOf(name+'.css')>=0&&(i===0||layout.indexOf(name+'.css')>layout.indexOf(styles[i-1]+'.css'))));
const font=read('node_modules/@fontsource-variable/manrope/index.css');
check('Self-hosted Cyrillic font is available',font.includes('cyrillic')&&font.includes('font-display: swap'));
check('Legacy rules are isolated from the new design',read('app/globals.css').includes('@layer legacy {'));
check('Reduced motion',css['design-tokens'].includes('prefers-reduced-motion:reduce'));
check('Visible keyboard focus',css['design-tokens'].includes(':focus-visible'));
const readable=css['design-readability'];
check('Every common page header receives a separated accent', ['pageHeader','gradesHero','votesHero','formalHero','teacherFocus','profileHero','wallHero','dashHero'].every(name=>readable.includes('.'+name+'::before')&&readable.includes('.'+name+',')));
check('Accent and text have separate insets on phones',readable.includes('padding:20px 18px 22px 42px')&&readable.includes('left:16px')&&readable.includes('padding:18px 14px 20px 36px')&&readable.includes('left:13px'));
check('Phone layout and touch targets',css['design-responsive'].includes('@media(max-width:390px)')&&css['design-responsive'].includes('@media(pointer:coarse)'));
const stageActions=read('components/game/stageActions.ts');
check('Every one of the 16 stages has a next action',Array.from({length:16},(_,i)=>i+1).every(n=>new RegExp(`\\b${n}:\\{title:`).test(stageActions)));
console.log(`\n${count} source and contrast checks passed. This does not certify browser layout, keyboard interaction, or a live classroom session.`);
