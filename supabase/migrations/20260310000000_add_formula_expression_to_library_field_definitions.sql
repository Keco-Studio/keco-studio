-- Add formula_expression column to library_field_definitions
alter table public.library_field_definitions
  add column if not exists formula_expression text;

