-- Keco Admin displays Account Storage's physical and logical usage total.
grant select (logical_used_bytes)
  on table public.account_storage_quotas
  to service_role;
