'use strict';
// Isolated PostgreSQL regression. No live game updates or sensitive image reads.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261024182000_meeting_facsimile_auto_display.sql','utf8');
const paper=fs.readFileSync('components/game/DocumentPaper.tsx','utf8');
const view=fs.readFileSync('components/game/DocumentsView.tsx','utf8');
assert(paper.includes('Игровая подпись размещена автоматически')&&paper.includes('Подписано лично'));
assert(view.includes('facsimile_path')&&view.includes('signedAsset(item.facsimile_path)'));
assert(migration.includes('ON CONFLICT(document_id,signer_id) DO NOTHING'));
assert(!migration.includes('INSERT INTO public.formal_document_signatures'));
const gid='00000000-0000-0000-0000-000000000001';
const a='00000000-0000-0000-0000-000000000002',b='00000000-0000-0000-0000-000000000003';
const outsider='00000000-0000-0000-0000-000000000004';
const agenda='00000000-0000-0000-0000-000000000005';
const minutes='00000000-0000-0000-0000-000000000006';
const unpublished='00000000-0000-0000-0000-000000000007';
const sig=id=>gid+'/profiles/'+id+'/signature-123456.png';
const run=async()=>{
 const db=new PGlite();
 const q=async(text,params=[]) => (await db.query(text,params)).rows;
 try{
 await db.exec([
  'CREATE ROLE anon','CREATE ROLE authenticated','CREATE SCHEMA auth','CREATE SCHEMA private','CREATE SCHEMA storage',
  'CREATE TABLE auth.users(id uuid PRIMARY KEY)',
  "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$",
  "CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{\"is_anonymous\":false}'::jsonb $$",
  'CREATE TABLE public.games(id uuid PRIMARY KEY)',
  'CREATE TABLE public.game_members(game_id uuid,user_id uuid,kind text,roster_archived_at timestamptz)',
  'CREATE TABLE public.game_parties(game_id uuid,leader_user_id uuid,name text,registration_status text)',
  'CREATE TABLE public.formal_documents(id uuid PRIMARY KEY,game_id uuid,stage_no int,subject_key text,doc_type text,status_code text,metadata jsonb DEFAULT \'{}\'::jsonb)',
  'CREATE TABLE public.formal_document_signatures(document_id uuid,signer_id uuid,signed_at timestamptz)',
  'CREATE TABLE public.game_profiles(game_id uuid,user_id uuid,signature_path text)',
  'CREATE TABLE public.institution_meeting_records(game_id uuid,stage_no int,institution_key text,agenda_document_id uuid,minutes_document_id uuid,agenda_approved_by uuid,minutes_approved_by uuid)',
  'CREATE TABLE public.government_sessions(id uuid,game_id uuid,agenda_document_id uuid,chair_user_id uuid,agenda_approved_by uuid)',
  'CREATE TABLE storage.objects(bucket_id text,name text)',
  "CREATE FUNCTION private.is_game_member(p_game uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT auth.uid() IN ('"+a+"'::uuid,'"+b+"'::uuid)$$",
  "CREATE FUNCTION private.institution_document_signers(p_doc uuid) RETURNS TABLE(user_id uuid,office text) LANGUAGE sql STABLE AS $$SELECT p.leader_user_id,'Председатель фракции «'||p.name||'» (КСРФ)' FROM public.formal_documents d JOIN public.game_parties p ON p.game_id=d.game_id WHERE d.id=p_doc AND d.subject_key='ksrf' AND p.registration_status='registered'$$"
 ].join(';')+';');
 for(const id of [a,b,outsider])await q('INSERT INTO auth.users VALUES ($1)',[id]);
 await q('INSERT INTO games VALUES ($1)',[gid]);
 await q("INSERT INTO game_members VALUES ($1,$2,'student',NULL),($1,$3,'student',NULL)",[gid,a,b]);
 await q("INSERT INTO game_parties VALUES($1,$2,'Первая','registered'),($1,$3,'Вторая','registered')",[gid,a,b]);
 await q('INSERT INTO game_profiles VALUES($1,$2,$4),($1,$3,NULL)',[gid,a,b,sig(a)]);
 await db.exec("SET request.jwt.claim.sub='"+a+"';");
 await db.exec(migration);
 // Published agenda picks up one existing image. No private image of a non-signer.
 await q("INSERT INTO formal_documents(id,game_id,stage_no,subject_key,doc_type,status_code) VALUES($1,$2,2,'ksrf','meeting_agenda','published')",[agenda,gid]);
 let rows=await q('SELECT signer_id,signature_path FROM formal_meeting_facsimiles WHERE document_id=$1',[agenda]);
 assert.equal(rows.length,1);assert.equal(rows[0].signature_path,sig(a));
 // Private draft must never expose a facsimile.
 await q("INSERT INTO formal_documents(id,game_id,stage_no,subject_key,doc_type,status_code) VALUES($1,$2,2,'ksrf','minutes','draft')",[unpublished,gid]);
 assert.equal((await q('SELECT count(*)::int n FROM formal_meeting_facsimiles WHERE document_id=$1',[unpublished]))[0].n,0);
 // Saving a missing signature automatically decorates published documents.
 await q('UPDATE game_profiles SET signature_path=$3 WHERE game_id=$1 AND user_id=$2',[gid,b,sig(b)]);
 assert.equal((await q('SELECT count(*)::int n FROM formal_meeting_facsimiles WHERE document_id=$1',[agenda]))[0].n,2);
 // A new upload never changes the image that was already displayed.
 await q('UPDATE game_profiles SET signature_path=$3 WHERE game_id=$1 AND user_id=$2',[gid,a,gid+'/profiles/'+a+'/signature-987654.png']);
 assert.equal((await q('SELECT signature_path FROM formal_meeting_facsimiles WHERE document_id=$1 AND signer_id=$2',[agenda,a]))[0].signature_path,sig(a));
 // Publishing minutes links both images and never creates personal signature history.
 await q('UPDATE formal_documents SET status_code=$2 WHERE id=$1',[unpublished,'published']);
 assert.equal((await q('SELECT count(*)::int n FROM formal_meeting_facsimiles WHERE document_id=$1',[unpublished]))[0].n,2);
 assert.equal((await q('SELECT count(*)::int n FROM formal_document_signatures'))[0].n,0);
 // Existing meeting records, approvals and text are not changed by the migration.
 await q("INSERT INTO formal_documents(id,game_id,stage_no,subject_key,doc_type,status_code) VALUES($1,$2,2,'ksrf','minutes','published')",[minutes,gid]);
 assert.equal((await q('SELECT count(*)::int n FROM formal_meeting_facsimiles WHERE document_id=$1',[minutes]))[0].n,2);
 let result=(await q('SELECT public.get_institution_document_signers($1) x',[minutes]))[0].x;
 assert.equal(result.required.length,2);
 assert(result.required.every(x=>x.facsimile_path&&!x.signed),'Facsimile never mislabels a personal signature');
 // An unrelated participant's image must not be attached.
 await q('INSERT INTO game_profiles VALUES($1,$2,$3)',[gid,outsider,sig(outsider)]);
 assert.equal((await q('SELECT count(*)::int n FROM formal_meeting_facsimiles WHERE signer_id=$1',[outsider]))[0].n,0);
 console.log('PASS: published/draft distinction, two authorized signatures, late uploads, immutable image, no impersonation, unrelated user denied');
 }finally{await db.close()}
};
run().catch(e=>{console.error(e);process.exitCode=1});
