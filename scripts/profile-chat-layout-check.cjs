/* Browser regression for profile security when opening chat shrinks the content column. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const css=[
 'app/2026-profile-comic.css',
 'app/profile-first-setup.css',
 'app/profile-chat-responsive.css'
].map(f=>fs.readFileSync(f,'utf8')).join('\n');
const layout=fs.readFileSync('app/layout.tsx','utf8');
assert(layout.indexOf("import './profile-chat-responsive.css'")>layout.indexOf("import './party-governance-justice.css'"),'Profile overrides must be last');
const security=fs.readFileSync('components/game/ProfileSecurityPanel.tsx','utf8');
assert(security.includes('data-profile-setup-field="email"'),'Existing email validation and binding must remain');
assert(security.includes('supabase.auth.updateUser({email:requestedEmail}')&&security.includes('supabase.auth.updateUser({password})'),'Do not replace auth routines');
const chrome=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
if(!chrome)throw new Error('Chrome or Chromium is required');
const html=`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0;background:#eff4fc;font-family:Arial,sans-serif}
.profilePage{min-width:0}.profileGrid{display:grid;grid-template-columns:minmax(0,1fr)}
.profileEditor{display:grid;min-width:0;padding:12px;background:white}
${css}
</style><body>
<div class="profilePage"><section class="profileGrid"><article class="surface profileEditor">
<section class="profileSecurity" aria-label="Личный вход и восстановление доступа">
<header><div><small>БЕЗОПАСНОСТЬ УЧЁТНОЙ ЗАПИСИ</small><h2>Личный пароль</h2></div></header>
<p>Для входа с другого устройства подтвердите почту и установите личный пароль.</p>
<p>1. Отправьте письмо. 2. Откройте ссылку. 3. Проверьте подтверждение. 4. Сохраните личный пароль.</p>
<div class="profileSecurityGrid">
<label class="profileSetupInvalid" data-profile-setup-field="email">Ваш адрес электронной почты<input type="email" aria-label="Электронная почта" placeholder="Имя@пример.рф" /></label>
<button type="button"><svg width="17" height="17"></svg>Отправить письмо для подтверждения</button>
<button type="button"><svg width="17" height="17"></svg>Проверить подтверждение</button>
</div>
<div class="profilePasswordFields"><label>Новый личный пароль<input type="password"/></label>
<label>Повторите пароль<input type="password"/></label><button>Сохранить пароль</button></div>
<details class="profileSecurityRecovery" open><summary>Восстановление доступа</summary><div><article><div><b>Тестовый участник</b><small>student@example.org</small></div><button>Отправить восстановление</button></article></div></details>
<p class="profileSecurityNotice">Подтвердите почту. Дальнейшая настройка будет доступна после проверки.</p>
</section>
</article></section></div></body></html>`;
function box(rect){return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width}}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [280,320,390,440,520,600,780]){
   const page=await browser.newPage({viewport:{width:1440,height:900}});
   await page.setContent(html);
   const metrics=await page.evaluate(w=>{
    document.querySelector('.profilePage').style.width=w+'px';
    const sec=document.querySelector('.profileSecurity');
    const label=document.querySelector('.profileSecurityGrid label');
    const input=label.querySelector('input');
    const buttons=Array.from(document.querySelectorAll('.profileSecurityGrid>button'));
    const password=Array.from(document.querySelectorAll('.profilePasswordFields label'));
    const bounds=x=>{const r=x.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width}};
    return {security:bounds(sec),label:bounds(label),email:bounds(input),buttons:buttons.map(bounds),password:password.map(bounds),
      overflow:document.documentElement.scrollWidth>1440,columns:getComputedStyle(document.querySelector('.profileSecurityGrid')).gridTemplateColumns};
   },width);
   assert(!metrics.overflow,'No page overflow at '+width);
   assert(metrics.email.width>=Math.min(180,metrics.security.width-50),'Email field must have usable width at '+width);
   for(const b of metrics.buttons){
    assert(b.width>80,'Button is too narrow at '+width);
    assert(b.left>=metrics.security.left-1&&b.right<=metrics.security.right+1,'Button exits card at '+width);
    assert(b.top>=metrics.label.bottom-1,'Button overlaps email label at '+width);
   }
   assert(metrics.buttons[0].right<=metrics.buttons[1].left+1||metrics.buttons[0].bottom<=metrics.buttons[1].top+1,'Verification buttons overlap at '+width);
   if(width<=520)assert(metrics.buttons[0].bottom<=metrics.buttons[1].top+1,'Narrow panel must stack buttons at '+width);
   if(width>600)assert(metrics.buttons[0].top===metrics.buttons[1].top,'Wide panel can show two buttons side by side');
   await page.close();
   console.log('PASS profile security card width '+width+'px: email and buttons fit, no collisions');
  }
  const phone=await browser.newPage({viewport:{width:390,height:844}});
  await phone.setContent(html);
  const metrics=await phone.evaluate(()=>{document.querySelector('.profilePage').style.width='390px';return {body:document.documentElement.scrollWidth,viewport:innerWidth}});
  assert(metrics.body<=metrics.viewport+1,'Mobile layout must not scroll horizontally');
  await phone.close();
  console.log('PASS: narrow desktop chat and phone responsive security panel');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
