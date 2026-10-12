// Validate the actual public site AFTER deploy-pages, not just the artifact.
// The no-trailing-slash URL is deliberately included: users paste it verbatim.
import assert from 'node:assert/strict';

const origin='https://dimkazantsev.github.io/gos-sim1';
const canonical=origin+'/';
const title='ГОС.ID — Цифровая платформа России';
const description='Моделирование работы органов публичной власти России, подготовка законов и принятие государственных решений.';
const image=canonical+'share/gos-id-preview.jpg?v=20261013-1';
const endpoints=[
 {name:'root without slash',url:origin},
 {name:'root with slash',url:canonical},
 {name:'dashboard deep link',url:canonical+'?section=dashboard'}
];
async function get(url){
 const response=await fetch(url,{redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(20000),headers:{'User-Agent':'GOS-ID-Pages-Live-Check/1.0','Cache-Control':'no-cache'}});
 assert.equal(response.status,200,url+' must return HTTP 200');
 return response;
}
function checkHead(html,source){
 const end=html.indexOf('</head>');
 assert.ok(end>=0,source+' must have an HTML head');
 const head=html.slice(0,end);
 const patterns=[
 '<title>'+title+'</title>',
 'property="og:title" content="'+title+'"',
 'property="og:description" content="'+description+'"',
 'property="og:image" content="'+image+'"',
 'property="og:image:secure_url" content="'+image+'"',
 'name="twitter:image" content="'+image+'"'
 ];
 for(const pattern of patterns)assert.ok(head.includes(pattern),source+': missing '+pattern);
 assert.ok(head.indexOf('property="og:image"')<3500,source+' image metadata not at head start');
 assert.ok(!head.includes('GOS//SIMS'),source+' has legacy branding');
}
async function check(){
 for(const item of endpoints){
  const response=await get(item.url);
  assert.ok((response.headers.get('content-type')||'').includes('text/html'),item.name+' must be HTML');
  checkHead(await response.text(),item.name);
 }
 const route=await get(canonical+'visit/');
 const routeHtml=await route.text();
 assert.ok(routeHtml.includes('property="og:title" content="'+title+'"'),'Shared visit page must show the current title');
 assert.ok(routeHtml.includes('property="og:image"'),'Shared visit page must advertise the image');
 const jpg=await get(image);
 assert.ok((jpg.headers.get('content-type')||'').includes('image/jpeg'),'Image must be served as JPEG');
 const data=new Uint8Array(await jpg.arrayBuffer());
 assert.ok(data.length>20000&&data[0]===0xff&&data[1]===0xd8,'Image bytes must be a real JPEG');
 console.log('PASS live GitHub Pages: canonical/no-slash/dashboard metadata, visit page, public JPEG.');
}
let last;
for(let n=1;n<=12;n++){
 try{await check();process.exit(0)}
 catch(e){last=e;console.error('Live check '+n+'/12: '+e.message);if(n<12)await new Promise(r=>setTimeout(r,10000))}
}
console.error('Live Pages verification failed after deployment:',last);
process.exit(1);
