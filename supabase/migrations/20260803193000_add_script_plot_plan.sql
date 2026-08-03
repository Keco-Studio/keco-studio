alter table public.libraries
  add column if not exists plot_plan jsonb;

alter table public.libraries
  drop constraint if exists libraries_plot_plan_object;

alter table public.libraries
  add constraint libraries_plot_plan_object
  check (plot_plan is null or jsonb_typeof(plot_plan) = 'object');

comment on column public.libraries.plot_plan is
  'Validated plot-node grouping and canonical edges for imported script libraries.';
