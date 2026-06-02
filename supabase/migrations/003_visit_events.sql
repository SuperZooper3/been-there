-- visit_events: idempotency ledger for offline/mobile GPS replay.
-- A client event can be retried until acknowledged without incrementing visit_count twice.
create table if not exists visit_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  client_event_id text not null,
  h3_index        text not null,
  visited_at      timestamptz not null,
  created_at      timestamptz not null default now(),
  constraint visit_events_user_client_event_unique unique (user_id, client_event_id)
);

create index if not exists visit_events_user_id_idx on visit_events(user_id);
create index if not exists visit_events_user_visited_at_idx on visit_events(user_id, visited_at);
create index if not exists visit_events_h3_index_idx on visit_events(h3_index);

alter table visit_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'visit_events'
      and policyname = 'Users can manage own visit_events'
  ) then
    create policy "Users can manage own visit_events"
      on visit_events for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

grant select, insert, update, delete on table visit_events to authenticated;

create or replace function public.apply_visit_events_batch(events jsonb)
returns jsonb
language plpgsql
security invoker
as $$
declare
  uid uuid := auth.uid();
  event_record record;
  recent_cell text;
  inserted_event_id uuid;
  applied_count integer := 0;
  duplicate_count integer := 0;
begin
  if uid is null then
    raise exception 'Unauthorized';
  end if;

  select vc.h3_index
    into recent_cell
  from public.visit_cells vc
  where vc.user_id = uid
  order by vc.last_visited_at desc
  limit 1;

  for event_record in
    select
      item.value->>'client_event_id' as client_event_id,
      item.value->>'h3_index' as h3_index,
      (item.value->>'visited_at')::timestamptz as visited_at
    from jsonb_array_elements(events) with ordinality as item(value, position)
    where item.value ? 'client_event_id'
      and item.value ? 'h3_index'
      and item.value ? 'visited_at'
    order by item.position
  loop
    inserted_event_id := null;

    insert into public.visit_events (user_id, client_event_id, h3_index, visited_at)
    values (uid, event_record.client_event_id, event_record.h3_index, event_record.visited_at)
    on conflict (user_id, client_event_id) do nothing
    returning id into inserted_event_id;

    if inserted_event_id is null then
      duplicate_count := duplicate_count + 1;
      continue;
    end if;

    if recent_cell is not null and event_record.h3_index = recent_cell then
      update public.visit_cells
      set last_visited_at = greatest(last_visited_at, event_record.visited_at)
      where user_id = uid
        and h3_index = event_record.h3_index;

      if not found then
        insert into public.visit_cells (
          user_id,
          h3_index,
          first_visited_at,
          last_visited_at,
          visit_count
        )
        values (
          uid,
          event_record.h3_index,
          event_record.visited_at,
          event_record.visited_at,
          1
        )
        on conflict (user_id, h3_index) do update
        set first_visited_at = least(visit_cells.first_visited_at, excluded.first_visited_at),
            last_visited_at = greatest(visit_cells.last_visited_at, excluded.last_visited_at);
      end if;
    else
      insert into public.visit_cells (
        user_id,
        h3_index,
        first_visited_at,
        last_visited_at,
        visit_count
      )
      values (
        uid,
        event_record.h3_index,
        event_record.visited_at,
        event_record.visited_at,
        1
      )
      on conflict (user_id, h3_index) do update
      set first_visited_at = least(visit_cells.first_visited_at, excluded.first_visited_at),
          last_visited_at = greatest(visit_cells.last_visited_at, excluded.last_visited_at),
          visit_count = visit_cells.visit_count + 1;
    end if;

    recent_cell := event_record.h3_index;
    applied_count := applied_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'applied', applied_count,
    'duplicates', duplicate_count
  );
end;
$$;

grant execute on function public.apply_visit_events_batch(jsonb) to authenticated;
