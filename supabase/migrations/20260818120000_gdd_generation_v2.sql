-- Structured GDD generation metadata and resumable stage checkpoints.

alter table public.gdd_generation_jobs
  add column if not exists mode text not null default 'quick',
  add column if not exists contract_version integer not null default 1,
  add column if not exists blueprint jsonb,
  add column if not exists section_drafts jsonb not null default '[]'::jsonb,
  add column if not exists review_report jsonb,
  add column if not exists repair_round integer not null default 0;

alter table public.gdd_generation_jobs
  drop constraint if exists gdd_generation_jobs_mode_check,
  drop constraint if exists gdd_generation_jobs_contract_version_check,
  drop constraint if exists gdd_generation_jobs_repair_round_check,
  drop constraint if exists gdd_generation_jobs_phase_check;

alter table public.gdd_generation_jobs
  add constraint gdd_generation_jobs_mode_check check (mode in ('quick', 'professional')),
  add constraint gdd_generation_jobs_contract_version_check check (contract_version in (1, 2)),
  add constraint gdd_generation_jobs_repair_round_check check (repair_round between 0 and 2),
  add constraint gdd_generation_jobs_phase_check check (phase in (
    'collecting', 'planning', 'generating_core', 'generating_systems',
    'generating_content', 'reviewing', 'repairing', 'saving',
    'generating', 'validating', 'completed', 'failed'
  )),
  add constraint gdd_generation_jobs_blueprint_object_check check (blueprint is null or jsonb_typeof(blueprint) = 'object'),
  add constraint gdd_generation_jobs_section_drafts_array_check check (jsonb_typeof(section_drafts) = 'array'),
  add constraint gdd_generation_jobs_review_object_check check (review_report is null or jsonb_typeof(review_report) = 'object');

create or replace function public.checkpoint_gdd_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_next_phase text,
  p_blueprint jsonb,
  p_section_drafts jsonb,
  p_review_report jsonb,
  p_repair_round integer
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update public.gdd_generation_jobs
    set phase = p_next_phase,
        status = 'queued',
        blueprint = p_blueprint,
        section_drafts = coalesce(p_section_drafts, '[]'::jsonb),
        review_report = p_review_report,
        repair_round = greatest(0, coalesce(p_repair_round, 0)),
        attempt_count = 0,
        lease_owner = null,
        lease_expires_at = null,
        heartbeat_at = null,
        error = null,
        available_at = now()
    where id = p_job_id
      and status = 'running'
      and lease_owner = p_worker_id
      and lease_expires_at >= now()
    returning id
  )
  select exists(select 1 from updated);
$$;

alter table public.gdd_generation_jobs enable row level security;
revoke select on public.gdd_generation_jobs from authenticated;
grant select (
  id,
  project_id,
  design_system_id,
  version_id,
  status,
  phase,
  mode,
  contract_version,
  attempt_count,
  max_attempts,
  available_at,
  completed_at,
  output_document_id,
  output_document_name,
  applied_rule_ids,
  omitted_rule_ids,
  error,
  created_at
) on public.gdd_generation_jobs to authenticated;

revoke all on function public.checkpoint_gdd_generation_job(uuid, text, text, jsonb, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.checkpoint_gdd_generation_job(uuid, text, text, jsonb, jsonb, jsonb, integer) to service_role;
