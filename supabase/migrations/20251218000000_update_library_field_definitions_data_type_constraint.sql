-- Update data_type check constraint to include 'media' and 'reference' types
-- Drop the existing constraint if it exists
alter table public.library_field_definitions
  drop constraint if exists library_field_definitions_data_type_check;

-- Add the updated constraint with all supported data types
alter table public.library_field_definitions
  add constraint library_field_definitions_data_type_check
  check (data_type in ('string','int','float','boolean','enum','date','media','reference'));

