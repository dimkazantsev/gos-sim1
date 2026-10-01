-- Attach only verified fiscal procedures. No reset or historical reapplication.
create or replace function public.apply_fiscal_rate_proposal(p_proposal uuid,p_document uuid default null) returns void language plpgsql security definer set search_path=public,private,pg_temp as $$
declare p fiscal_rate_proposals%rowtype;d formal_documents%rowtype;old_rate numeric;begin
 select * into p from fiscal_rate_proposals where id=p_proposal for update;
 if p.id is null or not private.is_game_teacher(p.game_id) then raise exception 'Подтверждение налоговой меры доступно преподавателю.';end if;
 select * into d from formal_documents where id=coalesce(p_document,p.document_id) and game_id=p.game_id;
 if d.id is null or d.status_code<>'published' then raise exception 'Выберите опубликованный акт, которым введена ставка.';end if;
 if p.status<>'pending' then raise exception 'Мера уже рассмотрена.';end if;
 old_rate:=coalesce((select rate from game_fiscal_rates where game_id=p.game_id and region_code=p.region_code and tax_key=p.tax_key),(select default_rate from fiscal_tax_catalog where tax_key=p.tax_key));
 insert into game_fiscal_rates(game_id,region_code,tax_key,rate) values(p.game_id,p.region_code,p.tax_key,p.new_rate) on conflict(game_id,region_code,tax_key) do update set rate=excluded.rate,updated_at=now();
 update fiscal_rate_proposals set status='applied',document_id=d.id where id=p.id;
 insert into fiscal_change_ledger(game_id,region_code,source_type,source_id,note,before_values,after_values,actor_id) values(p.game_id,p.region_code,'act',d.id::text||':'||p.tax_key,'Вступила в силу налоговая мера по '||d.registry_no,jsonb_build_object('rate',old_rate),jsonb_build_object('rate',p.new_rate),auth.uid());
end $$;

create or replace function private.fiscal_ledger_metrics_trigger() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$begin perform private.apply_fiscal_metrics(new.id);return new;end$$;
create or replace function private.fiscal_published_act_trigger() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$begin if new.status_code='published' and old.status_code is distinct from new.status_code then perform private.apply_published_fiscal_act(new.id);end if;return new;end$$;
create or replace function private.fiscal_closed_stage_trigger() returns trigger language plpgsql security definer set search_path=public,private,pg_temp as $$begin if new.status='completed' and old.status is distinct from new.status then perform private.advance_fiscal_period(new.game_id,new.stage_no);end if;return new;end$$;
create trigger fiscal_metrics_from_ledger after insert on public.fiscal_change_ledger for each row execute function private.fiscal_ledger_metrics_trigger();
create trigger fiscal_rate_after_publication after update of status_code on public.formal_documents for each row execute function private.fiscal_published_act_trigger();
create trigger fiscal_period_after_completed_stage after update of status on public.game_stages for each row execute function private.fiscal_closed_stage_trigger();
revoke all on function private.fiscal_ledger_metrics_trigger(),private.fiscal_published_act_trigger(),private.fiscal_closed_stage_trigger() from public,anon,authenticated;
