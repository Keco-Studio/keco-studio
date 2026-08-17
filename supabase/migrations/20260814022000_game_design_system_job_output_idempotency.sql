alter table public.game_design_systems
  add column generation_job_id uuid unique
  references public.game_design_system_generation_jobs(id) on delete set null;

create index game_design_systems_generation_job_idx
  on public.game_design_systems(generation_job_id)
  where generation_job_id is not null;

notify pgrst, 'reload schema';
