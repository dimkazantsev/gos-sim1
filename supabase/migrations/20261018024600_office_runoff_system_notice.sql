-- Announce second rounds and repeat-election requirements via the ГОС.ID system
-- (not a media outlet). Exactly one post per state transition.
CREATE OR REPLACE FUNCTION private.announce_office_election_round()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','private','pg_temp'
AS $notice$
declare
 v_author uuid;
 v_title text;
 v_body text;
 v_key text;
 v_candidates integer;
begin
 if new.stage_no<>4 then return new;end if;
 if tg_op='INSERT' then
   if new.round_no<>2 or new.parent_election_id is null then return new;end if;
   v_title:='Назначен второй тур выборов: '||new.office_title;
   v_body:='Первый тур не выявил победителя. Во втором туре участвуют два кандидата, набравшие наибольшее число голосов. '||
     'Избирателям с депутатскими мандатами необходимо проголосовать повторно. '||
     'Для избрания требуется не менее 226 голосов из 450.';
   v_key:='office-runoff:'||new.id::text;
 else
   if new.status<>'closed' or old.status='closed' or new.winner_candidate_id is not null then return new;end if;
   select count(*) into v_candidates from public.office_candidates c where c.election_id=new.id;
   if new.round_no=1 and v_candidates>2 then return new;end if;
   v_title:='Требуются повторные выборы: '||new.office_title;
   v_body:='По результатам голосования ни один кандидат не набрал необходимого большинства. '||
     'Назначение второго тура в этой ситуации не предусмотрено применяемым порядком: '||
     'требуется новая процедура выдвижения и повторных выборов. '||
     'Ранее избранные должностные лица сохраняют свои полномочия.';
   v_key:='office-repeat-required:'||new.id::text;
 end if;
 select coalesce(g.owner_id,auth.uid()) into v_author
 from public.games g where g.id=new.game_id;
 if v_author is null then return new;end if;
 insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,
 title,body,tags,internal_view,internal_ref_id,source_key,context)
 values(new.game_id,v_author,'information','system','ГОС.ID',v_title,v_body,
 ARRAY['гд_gpyasu','выборы_gpyasu','голосование_gpyasu'],
 'stages',new.id::text,v_key,
 jsonb_build_object('automatic',true,'source_table','office_elections',
 'stage_no',new.stage_no,'election_id',new.id,'office_key',new.office_key,
 'round_no',new.round_no,'notice_kind',case when tg_op='INSERT' then 'runoff' else 'repeat_required' end))
 on conflict(game_id,source_key) where source_key is not null do nothing;
 return new;
end;
$notice$;
DROP TRIGGER IF EXISTS trg_announce_office_election_round ON public.office_elections;
CREATE TRIGGER trg_announce_office_election_round AFTER INSERT OR UPDATE OF status
ON public.office_elections FOR EACH ROW
EXECUTE FUNCTION private.announce_office_election_round();
REVOKE ALL ON FUNCTION private.announce_office_election_round() FROM PUBLIC,anon,authenticated;
