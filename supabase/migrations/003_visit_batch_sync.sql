-- Idempotent GPS tracking batches: replay ordered paint events only.
-- Manual / draw erases keep using DELETE /api/cells (not this RPC).

create table if not exists visit_sync_batches (
  user_id         uuid not null references auth.users(id) on delete cascade,
  client_batch_id uuid not null,
  applied_at      timestamptz not null default now(),
  primary key (user_id, client_batch_id)
);

create index if not exists visit_sync_batches_user_id_idx on visit_sync_batches(user_id);

alter table visit_sync_batches enable row level security;

create policy "Users can read own visit_sync_batches"
  on visit_sync_batches for select
  using (auth.uid() = user_id);

grant select on table visit_sync_batches to authenticated;

-- One row = one applied batch (idempotency). Semantics match lib/visit-cells-batch.ts
-- for a list of cells: compare each cell to the user's most-recent cell *before* this batch only.
create or replace function public.apply_visit_batch(
  p_client_batch_id uuid,
  p_events jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_start_last text;
  v_now timestamptz := clock_timestamp();
  v_h3 text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a JSON array';
  end if;

  if exists (
    select 1 from visit_sync_batches
    where user_id = v_uid and client_batch_id = p_client_batch_id
  ) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  select vc.h3_index into v_start_last
  from visit_cells vc
  where vc.user_id = v_uid
  order by vc.last_visited_at desc
  limit 1;

  for v_h3 in
    select trim(e->>'h3')
    from jsonb_array_elements(p_events) e
    where coalesce(e->>'op', 'paint') = 'paint'
      and nullif(trim(e->>'h3'), '') is not null
  loop
    if v_h3 is not distinct from v_start_last then
      update visit_cells
      set last_visited_at = v_now
      where user_id = v_uid and h3_index = v_h3;
    elsif exists (select 1 from visit_cells where user_id = v_uid and h3_index = v_h3) then
      update visit_cells
      set visit_count = visit_count + 1,
          last_visited_at = v_now
      where user_id = v_uid and h3_index = v_h3;
    else
      insert into visit_cells (user_id, h3_index, first_visited_at, last_visited_at, visit_count)
      values (v_uid, v_h3, v_now, v_now, 1);
    end if;
  end loop;

  insert into visit_sync_batches (user_id, client_batch_id)
  values (v_uid, p_client_batch_id);

  return jsonb_build_object('ok', true, 'duplicate', false);
end;
$$;

grant execute on function public.apply_visit_batch(uuid, jsonb) to authenticated;

comment on function public.apply_visit_batch is
  'Idempotent ordered paint replay for GPS batches. Erases: use DELETE /api/cells.';
