-- Add reference_libraries column to library_field_definitions table
-- This column stores an array of library IDs that can be referenced by this field
alter table public.library_field_definitions
  add column if not exists reference_libraries uuid[] default null;

-- Add comment to explain the column
comment on column public.library_field_definitions.reference_libraries is 
  'For reference type fields: array of library IDs that this field can reference';

