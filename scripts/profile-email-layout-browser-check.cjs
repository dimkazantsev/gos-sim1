/* Static layout of the real component after simulated Auth responses. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright-core'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {harness}=require('./profile-email-delivery-check.cjs');
const root=path.resolve(__dirname,'..');
const chrome=[process.env.CHROME_BIN,chromium.executablePath(),'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw new Error('Chrome or Chromium is required');
const css=[...fs.readFileSync(path.join(root,'app/layout.tsx'),'utf8').matchAll(/import '\.\/([^']+\.css)'/g)].map(match=>fs.readFileSync(path.join(root,'app',match[1]),'utf8')).join('\n');
function element(node){
 if(node==null||typeof node==='boolean')return null;
 if(Array.isArray(node))return node.map(element);
 if(typeof node!=='object')return node;
 const {children,...props}=node.props;
 return React.createElement(node.type,props,...[children].flat(Infinity).map(element));
}
(async()=>{
 const h=harness();await h.settle();await h.enter('very.long.test.address@mail.ru');h.result({error:{code:'email_exists',message:'conflict'}});await h.click('Отправить письмо для подтверждения');
 const conflict=renderToStaticMarkup(element(h.tree()));h.result({error:null});await h.click('Отправить письмо для восстановления доступа');const recovery=renderToStaticMarkup(element(h.tree()));h.dispose();
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 const output=process.env.PROFILE_EMAIL_OUTPUT_DIR||path.join(os.tmpdir(),'gos-id-email-layout');fs.mkdirSync(output,{recursive:true});
 try{
  for(const width of [320,390,768,1024,1440]){
   const page=await browser.newPage({viewport:{width,height:1100}});await page.route('**/*',route=>route.abort());
   for(const [state,html] of [['conflict',conflict],['recovery',recovery]]){
    await page.setContent('<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+css+'\nbody{margin:0}main{width:100%;max-width:1100px;margin:auto;padding:12px;box-sizing:border-box}svg{width:17px;height:17px;flex:none}</style><body><main class="profilePage">'+html+'</main></body></html>');
    const layout=await page.evaluate(()=>{
     const panel=document.querySelector('.profileSecurity').getBoundingClientRect();
     return{viewport:innerWidth,width:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('.profileSecurity input,.profileSecurity button')].map(el=>{const rect=el.getBoundingClientRect();return{label:el.textContent,left:rect.left,right:rect.right,height:rect.height,overflow:el.tagName==='BUTTON'&&el.scrollWidth>el.clientWidth+2};}),panel:{left:panel.left,right:panel.right}};
    });
    assert(layout.width<=width+1,'Page overflow at '+width+' '+state);
    for(const control of layout.controls){assert(control.left>=layout.panel.left&&control.right<=layout.panel.right+1,'Control fits '+width+' '+state+': '+control.label);assert(control.height>=36,'Control height '+width+' '+state);assert(!control.overflow,'Control text fits '+width+' '+state+': '+control.label);}
    await page.screenshot({path:path.join(output,state+'-'+width+'.png'),fullPage:true});
   }
   await page.close();console.log('PASS email conflict and recovery layouts at '+width+'px');
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
