-- visit_count: Intelligence "Most been" + POST /api/cells visit semantics (Next.js: lib/visit-cells-batch.ts)
alter table visit_cells
  add column if not exists visit_count integer not null default 0;

-- Backfill: treat every existing row as at least one visit
update visit_cells set visit_count = greatest(visit_count, 1) where visit_count = 0;

comment on column visit_cells.visit_count is 'Increments when POST batch cell differs from user''s most-recent last_visited_at cell; same-cell revisits only bump last_visited_at (enforced in Next.js API).';

-- No-op unless a draft RPC existed; keeps migrations the only SQL you run
drop function if exists public.upsert_visit_cells_batch(text[]);
