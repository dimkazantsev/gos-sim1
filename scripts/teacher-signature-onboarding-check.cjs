/* Execute the real profile-completion functions against isolated in-memory
 * Postgres. No production identities, sessions, storage, or game rows are modified. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const migration=fs.readFileSync('supabase/migrations/20261024234000_teacher_account_signature_onboarding.sql','utf8');
const uTeacher='00000000-0000-4000-8000-0000000000a1';
const uStudent='00000000-0000-4000-8000-0000000000a2';
const game='00000000-0000-4000-8000-0000000000b1';
const sig='12345678-1234-4123-8123-1234567890ab';
const teacherName=uTeacher+'/signature-'+sig+'.png';
const teacherPath='teacher-assets/'+teacherName;
const studentPath=game+'/profiles/'+uStudent+'/signature-'+sig+'.png';
async function main(){
 const db=new PGlite();
 try{
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
   CREATE SCHEMA auth; CREATE SCHEMA private; CREATE SCHEMA storage;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
     $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,
     encrypted_password text,is_anonymous boolean DEFAULT false);
   CREATE TABLE public.game_members(game_id uuid,user_id uuid,kind text,full_name text,
     PRIMARY KEY(game_id,user_id));
   CREATE TABLE public.game_profiles(game_id uuid,user_id uuid,bio text,gender text,
     signature_path text,intro_seen_at timestamptz,onboarding_completed_at timestamptz,
     profile_setup_prompt_seen_at timestamptz,PRIMARY KEY(game_id,user_id));
   CREATE TABLE public.teacher_profiles(user_id uuid PRIMARY KEY,signature_path text);
   CREATE TABLE storage.objects(bucket_id text,name text,PRIMARY KEY(bucket_id,name));
   CREATE FUNCTION private.is_game_member(g uuid) RETURNS boolean LANGUAGE sql STABLE AS
   $$select exists(select 1 from public.game_members where game_id=g and user_id=auth.uid())$$;`);
  await db.query(`INSERT INTO auth.users(id,email,email_confirmed_at,encrypted_password)
      VALUES ($1,'teacher@example.invalid',now(),'test-hash'),
             ($2,'student@example.invalid',now(),'test-hash')`,[uTeacher,uStudent]);
  await db.query(`INSERT INTO public.game_members VALUES
   ($1,$2,'teacher','Учитель Тестовый Правильный'),
   ($1,$3,'student','Участник Тестовый Правильный')`,[game,uTeacher,uStudent]);
  await db.query(`INSERT INTO public.game_profiles(game_id,user_id,bio,gender,signature_path,
     intro_seen_at,profile_setup_prompt_seen_at) VALUES
     ($1,$2,'Проверочная полная биография преподавателя','male',$4,now(),now()),
     ($1,$3,'Проверочная полная биография участника','male',$5,now(),now())`,
     [game,uTeacher,uStudent,teacherPath,teacherPath]);
  await db.query('INSERT INTO public.teacher_profiles VALUES ($1,$2)',[uTeacher,teacherPath]);
  await db.query('INSERT INTO storage.objects VALUES ($1,$2)', ['teacher-assets',teacherName]);
  await db.exec(migration);
  const setup=async uid=>{
   await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[uid]);
   const out=(await db.query('SELECT public.get_my_game_profile_setup($1) AS data',[game])).rows[0].data;
   return typeof out==='string'?JSON.parse(out):out;
  };
  const finish=async()=>db.query('SELECT public.complete_my_game_profile($1)',[game]);
  let r=await setup(uTeacher);
  assert.deepEqual(r.missing,[],'Teacher account signature stored outside a game meets the checklist');
  assert.equal(r.completed,false);
  await finish();
  assert.equal((await setup(uTeacher)).completed,true,'Permanent teacher signature permits final onboarding');
  assert.equal((await db.query('SELECT count(*)::int c FROM storage.objects')).rows[0].c,1,
   'Profile completion never deletes or duplicates teacher media');
  r=await setup(uStudent);
  assert(r.missing.includes('signature'),'Student must never inherit teacher account signature');
  await assert.rejects(finish(),/Загрузите собственную игровую подпись/);
  await db.query('UPDATE public.game_profiles SET signature_path=$1 WHERE game_id=$2 AND user_id=$3',
   [studentPath,game,uStudent]);
  r=await setup(uStudent);
  assert(r.missing.includes('signature'),'Missing legacy file cannot pass a nonempty-path check');
  await db.query('INSERT INTO storage.objects VALUES ($1,$2)', ['game-assets',studentPath]);
  r=await setup(uStudent);
  assert.deepEqual(r.missing,[],'Actual student game signature remains valid');
  await finish();
  assert.equal((await setup(uStudent)).completed,true);
  // Revoke and remove the physical object: new incomplete profiles must be blocked.
  await db.query('DELETE FROM storage.objects WHERE bucket_id=$1 AND name=$2',
   ['teacher-assets',teacherName]);
  await db.query('UPDATE public.game_profiles SET onboarding_completed_at=NULL WHERE game_id=$1 AND user_id=$2',
   [game,uTeacher]);
  r=await setup(uTeacher);
  assert(r.missing.includes('signature'),'Deleted teacher media is never treated as a saved signature');
  await assert.rejects(finish(),/Загрузите собственную игровую подпись/);
  // The signature validator is internal, not an exposed RPC.
  assert(!migration.includes('GRANT EXECUTE ON FUNCTION private.profile_signature_exists'));
  console.log('PASS: permanent teacher signature, no inherited student files, legacy student signature, missing-object guard and unchanged account data.');
 }finally{await db.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
