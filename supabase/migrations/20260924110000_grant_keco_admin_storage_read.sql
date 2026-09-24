-- Keco Admin reads owner storage totals with the service-role client. Keep the
-- accounting table private to all browser-facing roles.
grant select (owner_id, used_bytes)
  on table public.account_storage_quotas
  to service_role;
