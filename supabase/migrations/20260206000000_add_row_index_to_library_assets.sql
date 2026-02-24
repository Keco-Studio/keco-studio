-- Add explicit row_index for deterministic row ordering in tables

alter table public.library_assets
add column if not exists row_index integer;

-- Backfill existing libraries: assign row_index = 1..N per library based on created_at + id
with ranked as (
  select
    id,
    row_number() over (
      partition by library_id
      order by created_at asc, id asc
    ) as rn
  from public.library_assets
)
update public.library_assets a
set row_index = ranked.rn
from ranked
where a.id = ranked.id
  and (a.row_index is null or a.row_index <= 0);

-- Helpful index for ordering by row_index
create index if not exists idx_library_assets_library_row_index
  on public.library_assets(library_id, row_index asc, id asc);

