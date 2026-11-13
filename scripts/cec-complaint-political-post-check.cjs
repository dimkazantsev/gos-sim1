/* Isolated CEC wall publication contract: no Supabase connection, real users or assets. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261113114829_cec_complaint_political_process_post.sql','utf8');
const wall=fs.readFileSync('components/game/PoliticalWallView.tsx','utf8');
const component=fs.readFileSync('components/game/CecComplaintPost.tsx','utf8');
const css=fs.readFileSync('app/2026-political-process.css','utf8');
const avatar=fs.readFileSync('components/game/PublisherAvatar.tsx','utf8');
const emblem=fs.readFileSync('components/game/institutionEmblems.ts','utf8');
assert(wall.includes("p.actor_key==='cec'&&p.context?.cec_complaint_reply===true"),'Only CEC reply uses new presentation');
assert(wall.includes('<CecComplaintPost post={displayPost}'),'Response is nested in the existing post card');
assert(wall.includes("PublisherAvatar actorKey={stageLifecycleNotice?'system':p.actor_key}"),'Existing institutional avatar is preserved');
assert(avatar.includes('institutionEmblem(actorKey,label)')&&emblem.includes("key==='president'"),'Existing CEC emblem is reused');
assert(component.includes('Суть жалобы')&&component.includes('Показать полный ответ ЦИК'));
assert(component.includes('<RichPostText text={post.body}'),'Decision is never shortened or rewritten');
assert(css.includes('.processPortal .cecComplaintPost')&&css.includes('.processPortal .cecComplaintDecision'),'Styles are scoped to Political Process');
assert(!wall.includes("from('presidential_cec_complaints')"),'No per-post complaint read or subscription');
assert(!migration.includes('p_item.allegation')&&!migration.includes('p_item.submitted_by'),'Complainant identity and original allegations remain private');
assert(migration.includes('ON CONFLICT (game_id,source_key) WHERE source_key IS NOT NULL DO NOTHING'));
const uid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
async function checkResponsive(){
 const {chromium}=require('playwright-core');
 const candidates=[process.env.CHROME_BIN,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'];
 const executablePath=candidates.find(x=>x&&fs.existsSync(x));
 assert(executablePath,'Chrome is required for local responsive CEC post verification');
 const browser=await chromium.launch({executablePath,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const longText='Результаты рассмотрения жалобы. '.repeat(150);
  const html='<html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'
   +'*{box-sizing:border-box}body{margin:0;background:#fff;font-family:Arial,sans-serif}'
   +'.processPortal{margin:auto;width:min(100%,1120px);padding:16px}'
   +'.processPortal .wallPost{border:1px solid #dce5f0;border-radius:16px;overflow:hidden}'
   +css+'</style><div class="processPortal"><article class="wallPost"><header>'
   +'<div class="wallPostWho"><b>Избирательная комиссия</b></div></header>'
   +'<div class="wallPostBody"><div class="cecComplaintPost">'
   +'<section class="cecComplaintSubject"><h3>Суть жалобы</h3><p>О возможном нарушении сроков предвыборной агитации.</p></section>'
   +'<section class="cecComplaintDecision"><h3>Ответ Центральной избирательной комиссии</h3>'
   +'<strong>В удовлетворении жалобы отказано.</strong><details><summary>Показать полный ответ ЦИК</summary>'
   +'<div class="cecComplaintFullResponse"><div class="postRichText">'+longText+'</div></div></details></section>'
   +'</div></div></article></div></html>';
  await page.setContent(html);
  for(const width of [390,768,1280]){
   await page.setViewportSize({width,height:900});
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
   assert.equal(overflow,false,'No horizontal overflow at '+width+'px');
   const details=page.locator('.cecComplaintDecision details');
   assert.equal(await details.evaluate(node=>node.open),false,'Long response initially collapsed');
   await page.locator('.cecComplaintDecision summary').click();
   assert.equal(await details.evaluate(node=>node.open),true,'Full decision opens at '+width+'px');
   assert(await page.locator('.cecComplaintFullResponse').isVisible(),'Full response visible');
   await page.locator('.cecComplaintDecision summary').click();
  }
  await page.close();
 }finally{await browser.close()}
}

(async()=>{
 const db=new PGlite();
 try{
  await db.exec([
   'CREATE SCHEMA private',
   'CREATE ROLE anon',
   'CREATE ROLE authenticated',
   'CREATE TABLE public.presidential_candidates(id uuid PRIMARY KEY,game_id uuid NOT NULL,display_name text NOT NULL)',
   'CREATE TABLE public.presidential_cec_complaints(id uuid PRIMARY KEY,game_id uuid NOT NULL,candidate_id uuid NOT NULL,submitted_by uuid,subject text,allegation text,status text,resolution text,resolved_by uuid,resolved_at timestamptz)',
   "CREATE TABLE public.political_posts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),game_id uuid NOT NULL,author_id uuid NOT NULL,process_type text NOT NULL,actor_key text NOT NULL,actor_label text NOT NULL,title text NOT NULL,body text NOT NULL,tags text[] DEFAULT '{}',source_key text,context jsonb NOT NULL DEFAULT '{}'::jsonb,status text NOT NULL DEFAULT 'published')",
   'CREATE UNIQUE INDEX political_posts_source_unique ON public.political_posts(game_id,source_key) WHERE source_key IS NOT NULL'
  ].join(';\n')+';');
  const game=uid(1),candidate=uid(2),teacher=uid(3),applicant=uid(4),past=uid(5),future=uid(6);
  await db.query('INSERT INTO public.presidential_candidates VALUES($1,$2,$3)',[candidate,game,'Разумовский Александр Всеволодович']);
  await db.query('INSERT INTO public.presidential_cec_complaints VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())',
   [past,game,candidate,applicant,'О возможном нарушении агитации','PRIVATE CLAIM - NOT FOR PUBLICATION','dismissed','По результатам проверки в удовлетворении обращения отказано.',teacher]);
  await db.exec(migration);
  let rows=(await db.query('SELECT * FROM public.political_posts')).rows;
  assert.equal(rows.length,1,'Existing finalized reply is published exactly once');
  assert.equal(rows[0].actor_key,'cec');
  assert.equal(rows[0].actor_label,'Избирательная комиссия');
  assert.equal(rows[0].author_id,teacher);
  assert.equal(rows[0].status,'published');
  assert.equal(rows[0].body,'По результатам проверки в удовлетворении обращения отказано.');
  assert.equal(rows[0].context.cec_complaint_subject,'О возможном нарушении агитации');
  assert.equal(rows[0].context.cec_complaint_status,'dismissed');
  assert.equal(rows[0].context.cec_complaint_reply,true);
  assert(!JSON.stringify(rows[0]).includes('PRIVATE CLAIM - NOT FOR PUBLICATION'));
  assert(!JSON.stringify(rows[0]).includes(applicant));
  await db.query('INSERT INTO public.presidential_cec_complaints(id,game_id,candidate_id,submitted_by,subject,allegation,status) VALUES($1,$2,$3,$4,$5,$6,$7)',
   [future,game,candidate,applicant,'О сроках агитации','PRIVATE SECOND CLAIM','pending']);
  assert.equal((await db.query('SELECT count(*) AS n FROM public.political_posts')).rows[0].n,1,'No publication before CEC resolution');
  await db.query('UPDATE public.presidential_cec_complaints SET resolution=$2,resolved_by=$3,resolved_at=now() WHERE id=$1',
   [future,'Направлено в Верховный Суд для рассмотрения по существу.',teacher]);
  assert.equal((await db.query('SELECT count(*) AS n FROM public.political_posts')).rows[0].n,1,'Editing a pending record does not publish');
  await db.query("UPDATE public.presidential_cec_complaints SET status='referred_court' WHERE id=$1",[future]);
  rows=(await db.query('SELECT * FROM public.political_posts ORDER BY source_key')).rows;
  assert.equal(rows.length,2,'One finalized reply produces one post');
  assert(rows.some(r=>r.context.cec_complaint_status==='referred_court'),'Court referral published without changing candidate status');
  await db.query("UPDATE public.presidential_cec_complaints SET status='maintained' WHERE id=$1",[future]);
  assert.equal((await db.query('SELECT count(*) AS n FROM public.political_posts')).rows[0].n,2,'Changing an already decided status cannot duplicate a post');
  await db.query('SELECT private.publish_presidential_cec_complaint(c) FROM public.presidential_cec_complaints c WHERE c.id=$1',[future]);
  assert.equal((await db.query('SELECT count(*) AS n FROM public.political_posts')).rows[0].n,2,'Idempotent publication even after repeated call');
  await checkResponsive();
  console.log('PASS CEC wall: idempotent resolution publication, privacy, existing emblem and desktop/tablet/phone layout and untouched standard cards');
 }finally{await db.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
