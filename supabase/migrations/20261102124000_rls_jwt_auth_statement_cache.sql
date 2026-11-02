-- RLS initplans for current-user JWT predicates: preserve all grants, roles,
-- game membership, teacher identity and non-anonymous checks unchanged.
do $identity_rls$
declare item record;
declare old_qual text;
declare new_qual text;
declare old_check text;
declare new_check text;
begin
 for item in
  select schemaname,tablename,policyname,cmd,qual,with_check
  from pg_policies
  where (schemaname,tablename,policyname) in (
   ('public','teacher_profiles','teacher_profile_own_read'),
   ('public','teacher_profiles','teacher_profile_own_update'),
   ('public','teacher_profiles','teacher_profile_authorized_insert'),
   ('public','formal_meeting_facsimiles','published_meeting_facsimiles_read'),
   ('realtime','messages','gos_game_presence_track')
  )
 loop
  old_qual:=item.qual;
  old_check:=item.with_check;
  new_qual:=replace(replace(old_qual,'auth.jwt()','(select auth.jwt())'),'auth.uid()','(select auth.uid())');
  new_check:=replace(replace(old_check,'auth.jwt()','(select auth.jwt())'),'auth.uid()','(select auth.uid())');
  if old_qual is distinct from new_qual or old_check is distinct from new_check then
   if new_qual is not null and new_check is not null then
    execute format('alter policy %I on %I.%I using (%s) with check (%s)',item.policyname,item.schemaname,item.tablename,new_qual,new_check);
   elsif new_qual is not null then
    execute format('alter policy %I on %I.%I using (%s)',item.policyname,item.schemaname,item.tablename,new_qual);
   elsif new_check is not null then
    execute format('alter policy %I on %I.%I with check (%s)',item.policyname,item.schemaname,item.tablename,new_check);
   end if;
  end if;
 end loop;
end $identity_rls$;
