-- Allow data_type and label to be nullable to support flexible field definitions
-- This enables users to create fields without selecting a data type (defaults to string-like behavior)
-- or with empty labels

-- First, drop the existing check constraint
alter table public.library_field_definitions
  drop constraint if exists library_field_definitions_data_type_check;

-- Modify data_type column to allow NULL
alter table public.library_field_definitions
  alter column data_type drop not null;

-- Modify label column to allow NULL (optional, based on requirements)
-- Uncomment the following line if labels should also be nullable
-- alter table public.library_field_definitions
--   alter column label drop not null;

-- Add updated check constraint that allows NULL or specific types
alter table public.library_field_definitions
  add constraint library_field_definitions_data_type_check
  check (data_type is null or data_type in ('string','int','float','boolean','enum','date','image','file','reference'));

-- Note: When data_type is NULL, the field can accept any type of value (similar to 'string' behavior)

