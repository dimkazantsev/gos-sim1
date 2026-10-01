-- Public media reports consume recorded changes; they never apply new effects.
create or replace function private.publish_rating_change() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare m public.state_metrics%rowtype;party public.game_parties%rowtype;owner uuid;origin uuid;post public.political_posts%rowtype;key text;label text;unit text;previous numeric;current numeric;change jsonb;item jsonb;changes jsonb:='[]';found boolean:=false;news_body text:='';heading text;n integer:=0;
begin
 if coalesce(new.delta,0)=0 then return new;end if;
 if tg_table_name='state_metric_history' then
  select * into m from public.state_metrics where id=new.metric_id and game_id=new.game_id;
  if m.id is null or not m.is_public then return new;end if;
  key:=m.metric_key;label:=m.label;unit:=coalesce(m.unit,'');
 else
  select * into party from public.game_parties where id=new.party_id and game_id=new.game_id;
  if party.id is null then return new;end if;
  key:='party:'||party.id;label:='Поддержка партии «'||party.name||'»';unit:='%';
 end if;
 previous:=coalesce(new.previous_value,new.value-new.delta);current:=new.value;
 change:=jsonb_build_object('key',key,'label',label,'previous',previous,'current',current,'unit',unit,'history_id',new.id::text,'history_table',tg_table_name);
 select owner_id into owner from public.games where id=new.game_id;
 if owner is null then return new;end if;
 select id into origin from public.political_posts where game_id=new.game_id and political_posts.id::text=new.source_id;
 select * into post from public.political_posts where game_id=new.game_id and source_key='rating-batch:'||txid_current()||':'||coalesce(new.source_id,'manual') for update;
 for item in select value from jsonb_array_elements(coalesce(post.context->'rating_changes','[]')) loop
  if item->>'key'=key then change:=change||jsonb_build_object('previous',item->'previous');changes:=changes||jsonb_build_array(change);found:=true;
  else changes:=changes||jsonb_build_array(item);end if;
 end loop;
 if not found then changes:=changes||jsonb_build_array(change);end if;
 select coalesce(jsonb_agg(value),'[]') into changes from jsonb_array_elements(changes) where (value->>'previous')::numeric<>(value->>'current')::numeric;
 if jsonb_array_length(changes)=0 then
  if post.id is not null then delete from public.political_posts where id=post.id;end if;
  return new;
 end if;
 for item in select value from jsonb_array_elements(changes) loop
  n:=n+1;
  news_body:=news_body||case when n>1 then E'\n\n' else '' end||(item->>'label')||': '||round((item->>'previous')::numeric,2)::text||' → '||round((item->>'current')::numeric,2)::text||' '||(item->>'unit')||'. Изменение: '||case when (item->>'current')::numeric>(item->>'previous')::numeric then '+' else '' end||round((item->>'current')::numeric-(item->>'previous')::numeric,2)::text||case when item->>'unit'='%' then ' п.п.' else ' '||(item->>'unit') end||'.';
 end loop;
 heading:=case when n=1 then 'Изменился показатель: '||(changes->0->>'label') else 'Рейтинги и показатели: '||n||' изменений' end;
 if tg_table_name='state_metric_history' and nullif(new.note,'') is not null then news_body:=news_body||E'\n\nОснование: '||new.note;end if;
 if post.id is null then
  insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,source_key,context,internal_view,internal_ref_id)
  values(new.game_id,owner,'news','media','Общественная служба новостей Республики',heading,news_body,array['этап_gpyasu','ходигры_gpyasu'], 'rating-batch:'||txid_current()||':'||coalesce(new.source_id,'manual'),jsonb_build_object('automatic',true,'source_table','rating_history','rating_changes',changes,'origin_post_id',origin),case when origin is not null then 'actions' else 'dashboard' end,origin::text);
 else
  update public.political_posts set title=heading,body=news_body,context=context||jsonb_build_object('rating_changes',changes),updated_at=now() where id=post.id;
 end if;
 return new;
end;$$;
revoke all on function private.publish_rating_change() from public,anon,authenticated;
create trigger publish_public_metric_rating after insert on public.state_metric_history for each row execute function private.publish_rating_change();
create trigger publish_party_support_rating after insert on public.party_support_history for each row execute function private.publish_rating_change();

-- Bring existing public journal entries into the feed once, with their original dates.
insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,source_key,context,internal_view,created_at,updated_at)
select h.game_id,g.owner_id,'news','media','Общественная служба новостей Республики','Изменился показатель: '||m.label,
 m.label||': '||round(h.previous_value,2)||' → '||round(h.value,2)||' '||coalesce(m.unit,'')||E'.\n\nОснование: '||coalesce(h.note,'Изменение зафиксировано в журнале.'),
 array['этап_gpyasu','ходигры_gpyasu'],'rating-history:state:'||h.id,
 jsonb_build_object('automatic',true,'source_table','rating_history','stage_no',null,'stage_title',null,'historical',true,'rating_changes',jsonb_build_array(jsonb_build_object('key',m.metric_key,'label',m.label,'previous',h.previous_value,'current',h.value,'unit',m.unit,'history_id',h.id::text,'history_table','state_metric_history'))),
 'dashboard',h.recorded_at,h.recorded_at
from public.state_metric_history h join public.state_metrics m on m.id=h.metric_id and m.is_public join public.games g on g.id=h.game_id
where h.delta<>0 and h.previous_value is not null
on conflict(game_id,source_key) where source_key is not null do nothing;
insert into public.political_posts(game_id,author_id,process_type,actor_key,actor_label,title,body,tags,source_key,context,internal_view,internal_ref_id,created_at,updated_at)
select h.game_id,g.owner_id,'news','media','Общественная служба новостей Республики','Изменилась поддержка партии «'||p.name||'»',
 'Поддержка партии «'||p.name||'»: '||round(h.previous_value,2)||' → '||round(h.value,2)||'%. Изменение зафиксировано в журнале.',
 array['этап_gpyasu','ходигры_gpyasu','партии_gpyasu'],'rating-history:party:'||h.id,
 jsonb_build_object('automatic',true,'source_table','rating_history','stage_no',null,'stage_title',null,'historical',true,'party_id',p.id,'rating_changes',jsonb_build_array(jsonb_build_object('key','party:'||p.id,'label','Поддержка партии «'||p.name||'»','previous',h.previous_value,'current',h.value,'unit','%','history_id',h.id::text,'history_table','party_support_history'))),
 'parties',p.id::text,h.recorded_at,h.recorded_at
from public.party_support_history h join public.game_parties p on p.id=h.party_id join public.games g on g.id=h.game_id
where h.delta<>0 and h.previous_value is not null
on conflict(game_id,source_key) where source_key is not null do nothing;
