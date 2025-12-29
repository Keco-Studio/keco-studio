-- Split 'media' data type into 'image' and 'file' types
-- Drop the existing constraint
alter table public.library_field_definitions
  drop constraint if exists library_field_definitions_data_type_check;

-- Add the updated constraint with 'image' and 'file' instead of 'media'
alter table public.library_field_definitions
  add constraint library_field_definitions_data_type_check
  check (data_type in ('string','int','float','boolean','enum','date','image','file','reference'));

-- Optional: Migrate existing 'media' type fields to 'image' (you can change this logic as needed)
-- This assumes existing media fields should become image fields
-- If you need to preserve data or handle differently, adjust this migration
update public.library_field_definitions
  set data_type = 'image'
  where data_type = 'media';

