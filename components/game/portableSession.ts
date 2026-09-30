type ComicScene={scene_id?:string;portable_image?:string};
type ArchiveRow=Record<string,unknown>&{comic_scene?:ComicScene|null};
export type SessionArchive={format:string;schema:number;game:{id:string;game_code:string;title:string};tables:Record<string,ArchiveRow[]>};
export type PortableBundle={html:string;engine:string;server:string;data:SessionArchive;readme:string};

async function asset(path:string){
 const response=await fetch(path);
 if(!response.ok)throw Error('Не удалось включить локальный проигрыватель: '+path);
 return response.text();
}
/** Inline each scene once so the HTML also works without network access. */
export async function preparePortableSession(archive:SessionArchive):Promise<PortableBundle>{
 if(archive.format!=='GOS-SIMS'||![1,2].includes(archive.schema))throw Error('Неподдерживаемый архив сеанса.');
 const data=structuredClone(archive);
 const [template,engine,server]=await Promise.all([
  asset('/portable/template.html'),asset('/portable/engine.mjs'),asset('/portable/server.mjs')
 ]);
 const scenes=new Map<string,Promise<string>>();
 const rows=[...(data.tables.event_cases||[]),...(data.tables.political_posts||[])];
 await Promise.all(rows.map(async row=>{
  const scene=row.comic_scene;
  if(!scene?.scene_id||!/^scene-\d{2,4}$/.test(scene.scene_id))return;
  let promise=scenes.get(scene.scene_id);
  if(!promise){promise=asset('/event-comics/'+scene.scene_id+'.svg').then(svg=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg));scenes.set(scene.scene_id,promise)}
  scene.portable_image=await promise;
 }));
 const json=JSON.stringify(data).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
 const html=template.replace('__GOS_SESSION_DATA__',()=>json).replace('__GOS_SESSION_ENGINE__',()=>engine.replace('export function applyPortableAction','function applyPortableAction'));
 const readme=`GOS//SIMS · Сеанс ${data.game.game_code}\n\n`+
  '1. Открытие В Одном Браузере\nОткройте Index.html. Прогресс хранится в этом браузере. Файловый режим предназначен для самостоятельного просмотра и учебной репетиции; переключение ролей здесь свободное.\n\n'+
  '2. Общая Игра В Локальной Сети\nУстановите Node.js 20.9 или новее. В папке архива запустите: node server.mjs\nОткройте http://localhost:8080. Другие компьютеры подключаются к http://IP-АДРЕС-СЕРВЕРА:8080. Коды преподавателя и участников показаны в терминале. Участник вводит своё ФИО точно как в исходном сеансе. Гость входит без кода и не может менять данные.\n'+
  'Чтобы сохранить коды после перезапуска, задайте GOS_TEACHER_CODE и GOS_STUDENT_CODE в окружении. Не открывайте этот учебный сервер в интернете. Progress.json содержит общий прогресс. Изменения записываются после каждого действия.\n\n'+
  '3. Возможности Локального Проигрывателя\nПросмотр профилей, этапов, документов и политического процесса; назначение событий; голосование; автоматический итог, изменение доверия и публикация СМИ; корректировка показателей преподавателем; повторный экспорт прогресса.\n'+
  'Полная версия формальных институтов, подписей, чатов и выборов требует исходного Next.js-приложения и его SQL-миграций с Supabase. Данные этих разделов сохранены в Game.json. Локальный проигрыватель не выполняет все процедуры полной версии.\n\n'+
  '4. Восстановление Полной Версии\nИспользуйте отдельный архив исходного кода. Создайте новые аккаунты Auth и сопоставьте прежние User_id с новыми. Восстановите таблицы из Game.json с сохранением связей, затем файлы из Media в соответствующие бакеты. Старые пароли и коды доступа не экспортируются.\n';
 return {html,engine,server,data,readme};
}
