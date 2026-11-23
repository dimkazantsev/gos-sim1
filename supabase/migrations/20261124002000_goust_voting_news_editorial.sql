-- Replace raw JSON and internal actor names in public Goust Voting news.
-- Preserve the JSON result returned to the teacher and the audit log payload.
CREATE OR REPLACE FUNCTION private.format_ghost_voting_news(p_applied jsonb)
RETURNS TABLE(news_title text, news_body text)
LANGUAGE sql STABLE SET search_path=''
AS $news$
WITH allocations AS (
 SELECT item.ordinality AS ordinal, coalesce(nullif(btrim(item.value->>'name'),''),'Фракция') AS party_name,
        greatest(0,(item.value->>'loss')::integer) AS planned_loss,
        greatest(0,(item.value->>'mandates')::integer) AS mandates
 FROM jsonb_array_elements(coalesce(p_applied,'[]'::jsonb)) WITH ORDINALITY AS item(value,ordinality)
), summary AS (
 SELECT coalesce(sum(least(planned_loss,mandates)),0)::integer AS actual_total,
        coalesce(sum(planned_loss),0)::integer AS planned_total,
        coalesce(sum(mandates),0)::integer AS mandates_total,
        coalesce(string_agg(
          CASE WHEN planned_loss=0 THEN
            format('«%s» — ограничений нет; доступно %s мандатов.',party_name,mandates)
          ELSE
            format('«%s» — временно недоступно %s из %s мандатов; доступно %s.',
              party_name,least(planned_loss,mandates),mandates,mandates-least(planned_loss,mandates))
            || CASE WHEN planned_loss>mandates THEN
                 format(' Ещё %s мандатов учтены в плане после их распределения.',planned_loss-mandates)
               ELSE '' END
          END,E'\n' ORDER BY ordinal),'') AS party_lines
 FROM allocations
)
SELECT
 CASE WHEN actual_total>0
      THEN format('Goust Voting: временно ограничено %s мандатов Государственной Думы',actual_total)
      WHEN planned_total>0
      THEN 'Goust Voting: установлены плановые ограничения для фракций'
      ELSE 'Goust Voting: ограничения по мандатам сняты'
 END,
 CASE WHEN actual_total>0
      THEN format('В Государственной Думе применён механизм Goust Voting. По результатам распределения временно ограничено использование %s депутатских мандатов.',actual_total)
      WHEN planned_total>0
      THEN 'В рамках Goust Voting установлены плановые ограничения. Они начнут действовать после распределения депутатских мандатов.'
      ELSE 'По результатам изменения распределения Goust Voting ограничения по указанным фракциям сняты.'
 END || CASE WHEN party_lines<>'' THEN E'\n\n'||party_lines ELSE '' END
   || CASE WHEN actual_total>0 THEN E'\n\n'
      ||format('Для последующих голосований по указанным фракциям доступны %s из %s мандатов. Уже открытые голосования сохраняют состав участников и вес голосов, зафиксированные при их открытии. Ограничения действуют до их отмены.',mandates_total-actual_total,mandates_total)
     WHEN planned_total>0 THEN E'\n\nПосле распределения мандатов установленное ограничение будет учитываться в последующих голосованиях.'
     ELSE '' END
FROM summary;
$news$;
REVOKE ALL ON FUNCTION private.format_ghost_voting_news(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.apply_ghost_voting_batch(p_game_id uuid, p_losses jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
declare item jsonb; target public.game_parties%rowtype; total integer:=0; applied jsonb:='[]'::jsonb; loss integer; v_news_title text; v_news_body text;
begin
 if not private.is_game_teacher(p_game_id) then raise exception 'Teacher access required';end if;
 if jsonb_typeof(p_losses)<>'array' or jsonb_array_length(p_losses)<1 or jsonb_array_length(p_losses)>100
 then raise exception 'Supply an array of party losses';end if;
 if private.has_open_duma_mandate_vote(p_game_id)
 then raise exception 'Close State Duma mandate votes before Ghost Voting';end if;
 if (select count(distinct batch_party.value->>'party_id') from jsonb_array_elements(p_losses) as batch_party(value))
 <>jsonb_array_length(p_losses) then raise exception 'Duplicate party in batch';end if;
 for item in select value from jsonb_array_elements(p_losses) loop
  select * into target from public.game_parties where id=(item->>'party_id')::uuid and game_id=p_game_id for update;
  if not found then raise exception 'Party not found';end if;
  if (item->>'loss') is null or (item->>'loss') !~ '^[0-9]{1,3}$' then raise exception 'Invalid loss';end if;
  loss:=(item->>'loss')::integer;
  if loss<0 or loss>50 then raise exception 'Ghost loss must be 0..50';end if;
  update public.game_parties set ghost_loss_current=loss,ghost_active=loss>0,
    ghost_started_at=case when loss>0 then now() else null end where id=target.id;
  applied:=applied||jsonb_build_array(jsonb_build_object('party_id',target.id,'name',target.name,'loss',loss,'effective_loss',least(loss,target.mandates),'mandates',target.mandates));
  total:=total+least(loss,target.mandates);
 end loop;
 SELECT f.news_title,f.news_body INTO v_news_title,v_news_body
 FROM private.format_ghost_voting_news(applied) f;
 insert into public.game_events(game_id,round_no,category,severity,title,body,created_by)
 values(p_game_id,5,'Ghost voting','warning',v_news_title,v_news_body,auth.uid());
 insert into public.audit_log(game_id,actor_id,action,entity_type,payload)
 values(p_game_id,auth.uid(),'ghost_voting_batch','game_parties',jsonb_build_object('losses',applied));
 return jsonb_build_object('total_loss',total,'result',applied);
end;
$function$;

-- Correct only previously generated technical Goust Voting news;
-- preserve its event ID, actor/audit records, publication time and source_key.
DO $repair$
DECLARE r record; v_pos integer; v_payload jsonb; v_title text; v_body text;
BEGIN
 FOR r IN
   SELECT e.id,e.game_id,e.body
   FROM public.game_events e
   WHERE e.category='Ghost voting' AND e.title='Назначенные потери мандатов'
     AND e.body LIKE 'Преподаватель назначил Ghost Voting:%'
 LOOP
  v_pos:=strpos(r.body,'[{');
  IF v_pos=0 THEN CONTINUE; END IF;
  v_payload:=substring(r.body FROM v_pos)::jsonb;
  SELECT f.news_title,f.news_body INTO v_title,v_body
  FROM private.format_ghost_voting_news(v_payload) f;
  UPDATE public.game_events e SET title=v_title,body=v_body WHERE e.id=r.id AND e.game_id=r.game_id;
  UPDATE public.political_posts p
     SET title=v_title,body=v_body,updated_at=now()
   WHERE p.game_id=r.game_id AND p.source_key='event:'||r.id::text
     AND p.context->>'source_table'='game_events' AND p.deleted_at IS NULL
     AND p.body=r.body;
 END LOOP;
END;
$repair$;
