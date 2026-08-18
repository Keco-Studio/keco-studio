-- Allow the authenticated latest-job reader to order by creation time without
-- exposing that internal timestamp in its response DTO.
grant select (created_at) on public.gdd_generation_jobs to authenticated;
