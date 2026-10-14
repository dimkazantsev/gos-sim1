const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
const teacher=read('components/game/TeacherView.tsx');
const ghost=read('components/game/TeacherGhostVotingPanel.tsx');
const events=read('components/game/EventWorkspace.tsx');
const roster=read('components/game/TeacherParticipantRoster.tsx');
const css=read('app/design-shell.css')+'\n'+read('app/teacher-ui-polish.css');
assert(teacher.includes("title:'События'"));
assert(teacher.includes('Случайное теневое голосование'));
assert(!teacher.includes("title:'Event'")&&!teacher.includes('Ghost Voting')&&!teacher.includes('снять GV'));
assert(ghost.includes('Настройка теневого голосования')&&!ghost.includes('Ghost Voting'));
assert(events.includes('aria-label="События — ситуационные решения"'));
assert(!roster.includes('style={{'),'Use reusable responsive layout classes, not inline geometry');
for(const key of ['teacherParticipantRoster','teacherRosterHead','teacherRosterToolbar','teacherRosterList','teacherRosterEntry','teacherRosterActions','teacherRosterDialog','teacherRosterDialogActions']){
 assert(roster.includes(key),'Missing roster markup: '+key);
 assert(css.includes('.'+key),'Missing roster style: '+key);
}
assert(css.includes('@container (max-width:650px)'),'Invitations must stack in narrow containers');
assert(!roster.includes('Auth-аккаунт')&&!roster.includes('учётную запись Auth'));
console.log('PASS: Russian teacher actions and scoped responsive participant/access panels');


// Real browser geometry regression for both new panels at mobile, tablet and desktop widths.
const {chromium}=require('playwright-core');
const executable=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(p=>p&&fs.existsSync(p));
if(!executable)throw Error('Chromium is required for the teacher panels browser check');
const pageMarkup='<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+
 '*{box-sizing:border-box}html,body{margin:0}body{font:14px Arial,sans-serif;color:#273b5e;background:#eef2f8}button,input,select{font:inherit}section{max-width:100%}'+css+
 '</style><body>'+
 '<section class="surface teacherParticipantRoster"><div class="surfaceHead teacherRosterHead"><div><small>ДОСТУП К ИГРЕ</small><h2>Участники и доступ</h2><p>Зарегистрированные пользователи и информация о доступе к игре.</p></div><b class="teacherRosterCount">30</b></div>'+
 '<div class="teacherRosterToolbar"><input aria-label="Поиск" placeholder="ФИО, должность, идентификатор"><select aria-label="Фильтр"><option>Текущий реестр</option></select><button class="secondary">Обновить</button></div>'+
 '<div class="teacherRosterList"><article class="teacherRosterEntry"><div class="teacherRosterIdentity"><b>Александра Михайловна Константинова</b><div><small>Председатель Государственной Думы Российской Федерации</small></div><small>Последняя активность: 14.10.2026, 16:00</small></div>'+
 '<div class="teacherRosterActions"><button>Исключить</button><button>Очистить профиль и доступ</button></div></article></div>'+
 '<div class="teacherRosterDialog"><h3>Подтверждение доступа</h3><p>Для продолжения введите полное имя участника.</p><label class="teacherRosterConfirm">Введите ФИО<input value=""></label><div class="teacherRosterDialogActions"><button>Подтвердить</button><button>Отмена</button></div></div></section>'+
 '<section class="teacherAccessCodes"><div class="teacherAccessHead"><svg width="20" height="20"></svg><div><h3>Доступ к игре</h3><p>Коды игры и приглашения</p></div></div>'+
 '<div class="teacherCodeGrid"><div class="teacherCodeEditor"><h4>Код игры</h4><label>Новый код<input></label><div class="teacherCodeActions"><button>Сгенерировать</button><button>Сохранить</button></div></div>'+
 '<div class="teacherCodeEditor"><h4>Приглашение</h4><label>Код<input></label><div class="teacherCodeActions"><button>Сгенерировать</button><button>Создать приглашение</button></div></div></div>'+
 '<div class="teacherCodeRows"><div class="teacherAccessListHead"><h4>Все приглашения (30)</h4><button>Обновить</button></div>'+
 '<div class="teacherCodeRow"><div><b>Приглашение участника</b><small>Активно · 14.10.2026</small></div><span class="teacherInviteSecret"><code>STD-ABCDEFGHIJKL</code><button>Копировать</button></span><button>Отключить</button></div></div></section></body></html>';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [390,768,1440]){
   const page=await browser.newPage({viewport:{width,height:900}});
   await page.setContent(pageMarkup);
   const layout=await page.evaluate(()=>{
    const names=['.teacherParticipantRoster','.teacherRosterToolbar','.teacherRosterEntry','.teacherRosterDialog',
      '.teacherAccessCodes','.teacherCodeGrid','.teacherCodeRow'];
    const panels=names.map(sel=>{
      const el=document.querySelector(sel),b=el.getBoundingClientRect();
      return {name:sel,left:b.left,right:b.right,scroll:el.scrollWidth,client:el.clientWidth};
    });
    const controls=[...document.querySelectorAll('.teacherRosterToolbar input,.teacherRosterToolbar select,.teacherRosterToolbar button, .teacherRosterActions button,.teacherRosterDialogActions button,.teacherCodeActions button,.teacherCodeRow button')].map(el=>({
     text:el.textContent?.trim()||el.tagName,rect:el.getBoundingClientRect(),h:el.getBoundingClientRect().height
    }));
    return {width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,panels,controls};
   });
   assert(layout.scroll<=layout.width+2,'Horizontal document overflow '+width+': '+JSON.stringify(layout));
   for(const box of layout.panels){
    assert(box.left>=-1&&box.right<=width+2,box.name+' exceeds viewport at '+width);
    assert(box.scroll<=box.client+2,box.name+' has internal overflow at '+width);
   }
   for(const control of layout.controls){
    assert(control.rect.left>=-1&&control.rect.right<=width+2,'Control leaves viewport at '+width+': '+control.text);
    assert(control.h>=43,'Control too short at '+width+': '+control.text);
   }
   await page.close();
   console.log('PASS: teacher roster and invitations without overlap at '+width+'px');
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
