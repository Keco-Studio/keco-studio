-- Add description column to library_field_definitions for column descriptions
alter table public.library_field_definitions
  add column if not exists description text;

