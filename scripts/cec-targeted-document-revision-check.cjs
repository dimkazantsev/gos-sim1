const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261019233000_resubmit_only_returned_cec_documents.sql','utf8');
const ui=fs.readFileSync('components/game/PresidentialElectionLab.tsx','utf8');
const css=fs.readFileSync('app/stage6-cec-workspace-polish.css','utf8');
for(const s of ["const canReplace=!c.cec_submitted_at||Boolean(doc&&(doc.status==='revision'||!doc.is_submitted))","disabled={busy||!canReplace","Передать исправленный документ в ЦИК","повторная загрузка не требуется","Отправить исправленные документы в ЦИК"])assert(ui.includes(s),'Missing selective replacement UI: '+s);
assert(css.includes('.cecDocumentLocked')&&css.includes('.cecResubmitOne'),'Missing responsive targeted actions');
const uid=n=>'10000000-0000-0000-0000-'+String(n).padStart(12,'0');
const setup=[
"CREATE SCHEMA private;CREATE SCHEMA auth;",
"CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $f$;",
"CREATE TABLE presidential_candidates(id uuid PRIMARY KEY,game_id uuid,user_id uuid,created_by uuid,registration_status text,cec_submitted_at timestamptz,cec_submission_version int,registration_attempts int,archived_at timestamptz,photo_path text,updated_at timestamptz);",
"CREATE TABLE presidential_candidate_documents(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,game_id uuid,candidate_id uuid,doc_kind text,title text,storage_path text,file_name text,mime_type text,file_size bigint,uploaded_by uuid,status text,note text,reviewed_by uuid,is_submitted boolean,submitted_at timestamptz,archived_at timestamptz,updated_at timestamptz,extracted_text text,extraction_status text,auto_check jsonb,UNIQUE(candidate_id,doc_kind));",
"CREATE TABLE game_members(game_id uuid,user_id uuid);",
"CREATE FUNCTION private.can_manage_presidential_candidate(p_candidate uuid,p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT EXISTS(SELECT 1 FROM presidential_candidates WHERE id=p_candidate AND user_id=p_user) $f$;",
"CREATE FUNCTION private.can_upload_presidential_candidate_document(p_candidate uuid,p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT p_user=auth.uid() AND EXISTS(SELECT 1 FROM presidential_candidates c JOIN game_members gm ON gm.game_id=c.game_id WHERE c.id=p_candidate AND gm.user_id=p_user) $f$;",
"CREATE FUNCTION private.is_game_teacher(p_game uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$;",
"CREATE FUNCTION private.presidential_submission_review_json(p_candidate uuid) RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT '{\"items\":[],\"program_points\":10}'::jsonb $f$;",
"CREATE OR REPLACE FUNCTION public.add_presidential_candidate_document(p_candidate_id uuid,p_doc_kind text,p_title text,p_storage_path text,p_file_name text,p_mime_type text DEFAULT NULL,p_file_size bigint DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,private,pg_temp AS $f$",
"declare c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());v_id uuid;",
"begin select * into c from public.presidential_candidates where id=p_candidate_id and archived_at is null;",
"if c.id is null then raise exception 'Candidate not found';end if;",
"if not private.can_upload_presidential_candidate_document(c.id,v_uid) then raise exception 'Candidate dossier access required';end if;",
"insert into public.presidential_candidate_documents(game_id,candidate_id,doc_kind,title,storage_path,file_name,mime_type,file_size,uploaded_by,status,note,reviewed_by,is_submitted,submitted_at,extracted_text,extraction_status,auto_check,archived_at)",
"values(c.game_id,c.id,p_doc_kind,p_title,p_storage_path,p_file_name,p_mime_type,p_file_size,v_uid,'submitted',null,null,false,null,null,'pending','{}'::jsonb,null)",
"on conflict(candidate_id,doc_kind) do update set title=excluded.title,storage_path=excluded.storage_path,file_name=excluded.file_name,mime_type=excluded.mime_type,file_size=excluded.file_size,uploaded_by=v_uid,status='submitted',note=null,reviewed_by=null,is_submitted=false,submitted_at=null,extracted_text=null,extraction_status='pending',auto_check='{}'::jsonb,archived_at=null,updated_at=now() returning id into v_id; return v_id;end;$f$;",
"CREATE OR REPLACE FUNCTION public.submit_presidential_candidate_to_cec(p_candidate_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,private,pg_temp AS $f$",
"declare c public.presidential_candidates%rowtype;v_uid uuid:=(select auth.uid());v_review jsonb;v_was_submitted boolean;",
"begin select * into c from public.presidential_candidates where id=p_candidate_id and archived_at is null for update;",
"if c.id is null then raise exception 'Candidate not found';end if;",
"if not private.can_manage_presidential_candidate(c.id,v_uid) or private.is_game_teacher(c.game_id) and c.created_by<>v_uid then raise exception 'Candidate dossier owner access required';end if;",
"if c.registration_status in ('registered','withdrawn') then raise exception 'Candidate dossier is locked';end if;",
"if c.photo_path is null or length(trim(c.photo_path))<3 then raise exception 'Upload candidate photo before submission';end if;",
"v_review:=private.presidential_submission_review_json(c.id);",
"v_was_submitted:=c.cec_submitted_at is not null;",
"update public.presidential_candidate_documents set is_submitted=true,submitted_at=now(),status='submitted',updated_at=now()",
"where candidate_id=c.id and archived_at is null;",
"update public.presidential_candidates set cec_submitted_at=now(),cec_submission_version=cec_submission_version+1,registration_status='submitted',registration_attempts=registration_attempts+case when v_was_submitted then 1 else 0 end,updated_at=now() where id=c.id;",
"return private.presidential_submission_review_json(c.id);end;$f$;"
].join('\n');
(async()=>{
 const db=new PGlite();
 try{
  await db.exec(setup);
  await db.exec(migration);
  const candidate=uid(1),game=uid(2),owner=uid(3),outsider=uid(800);
  await db.query("INSERT INTO presidential_candidates(id,game_id,user_id,created_by,registration_status,cec_submitted_at,cec_submission_version,registration_attempts,photo_path) VALUES($1,$2,$3,$3,'submitted',now(),1,1,'photo.jpg')",[candidate,game,owner]);
  const members=Array.from({length:40},(_,i)=>uid(100+i));
  for(const person of [owner,...members])await db.query('INSERT INTO game_members VALUES($1,$2)',[game,person]);
  for(const [kind,status,note] of [['consent','accepted','Принят ранее'],['passport','revision','Исправить дату'],['income','submitted','Без замечаний']]){
   await db.query("INSERT INTO presidential_candidate_documents(game_id,candidate_id,doc_kind,title,storage_path,file_name,uploaded_by,status,note,reviewed_by,is_submitted,submitted_at,auto_check) VALUES($1,$2,$3,$3,$4,$4,$5,$6,$7,$5,true,now(),'{}')",[game,candidate,kind,kind+'.pdf',owner,status,note]);
  }
  const login=id=>db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]);
  const upload=async(person,kind,name)=>{await login(person);return db.query("SELECT public.add_presidential_candidate_document($1,$2,$2,$3,$3,NULL,NULL)",[candidate,kind,name])};
  await assert.rejects(()=>upload(outsider,'passport','outside.pdf'),/Candidate dossier access required/);
  for(const member of members){
   await assert.rejects(()=>upload(member,'consent','must-not-overwrite.pdf'),/Можно заменить только документ/);
   await upload(member,'passport','corrected-'+member.slice(-4)+'.pdf');
  }
  await login(members[39]);await db.query('SELECT public.submit_presidential_candidate_to_cec($1)',[candidate]);
  const d=(await db.query('SELECT doc_kind,status,note,is_submitted,file_name FROM presidential_candidate_documents')).rows;
  const accepted=d.find(x=>x.doc_kind==='consent'),other=d.find(x=>x.doc_kind==='income'),fixed=d.find(x=>x.doc_kind==='passport');
  assert.equal(accepted.status,'accepted');assert.equal(accepted.note,'Принят ранее');assert.equal(accepted.file_name,'consent.pdf');
  assert.equal(other.status,'submitted');assert.equal(other.note,'Без замечаний');assert.equal(other.file_name,'income.pdf');
  assert.equal(fixed.status,'submitted');assert.equal(fixed.is_submitted,true);assert(fixed.file_name.startsWith('corrected-'));
  await assert.rejects(()=>db.query('SELECT public.submit_presidential_candidate_to_cec($1)',[candidate]),/Нет исправленных документов/);
  const version=(await db.query('SELECT cec_submission_version FROM presidential_candidates WHERE id=$1',[candidate])).rows[0].cec_submission_version;
  assert.equal(version,2);
  console.log('PASS: 40 party members may correct only returned document; accepted and other submitted documents untouched; outsider denied; duplicate resubmission denied.');
 }finally{await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});