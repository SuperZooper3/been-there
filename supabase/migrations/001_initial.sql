-- visit_cells: one row per (user, H3 res-9 cell)
create table if not exists visit_cells (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  h3_index         text not null,
  first_visited_at timestamptz not null default now(),
  last_visited_at  timestamptz not null default now(),
  constraint visit_cells_user_h3_unique unique (user_id, h3_index)
);

create index if not exists visit_cells_user_id_idx on visit_cells(user_id);
create index if not exists visit_cells_h3_index_idx on visit_cells(h3_index);

-- place_photos: one row per pinned photo
create table if not exists place_photos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  h3_index    text not null,
  lat         double precision not null,
  lng         double precision not null,
  storage_key text not null,
  caption     text,
  created_at  timestamptz not null default now()
);

create index if not exists place_photos_user_id_idx on place_photos(user_id);
create index if not exists place_photos_h3_index_idx on place_photos(h3_index);

-- Row-level security: users only see their own data
alter table visit_cells enable row level security;
alter table place_photos enable row level security;

create policy "Users can manage own visit_cells"
  on visit_cells for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage own place_photos"
  on place_photos for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Grant base table permissions to authenticated users (RLS then filters to own rows)
grant select, insert, update, delete on table visit_cells to authenticated;
grant select, insert, update, delete on table place_photos to authenticated;

-- Storage policies for the "photos" bucket
-- Files are stored as <user_id>/<timestamp>.<ext> so the first path segment is the uploader's ID.
create policy "Users can upload own photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Public read for photos"
  on storage.objects for select
  using (bucket_id = 'photos');

create policy "Users can delete own photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
