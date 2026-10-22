-- Map brief compilation represents an omitted Art Style as JSON null. Accept
-- that durable form alongside style-contract objects in every write path.

alter table public.gdd_map_artifacts
  drop constraint if exists gdd_map_artifacts_style_contract_check;

alter table public.gdd_map_artifacts
  add constraint gdd_map_artifacts_style_contract_check check (
    style_contract is null
    or (
      jsonb_typeof(style_contract) in ('object', 'null')
      and pg_catalog.octet_length(style_contract::text) <= 16000
    )
  );
