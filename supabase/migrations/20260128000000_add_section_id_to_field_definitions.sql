-- Add section_id column to library_field_definitions
-- This allows sections to have stable IDs independent of their names

-- Step 1: Add the new column (nullable initially for data migration)
alter table public.library_field_definitions 
  add column if not exists section_id text;

-- Step 2: Create an index on section_id for better query performance
create index if not exists idx_library_field_definitions_section_id
  on public.library_field_definitions(section_id);

-- Step 3: Migrate existing data - generate stable IDs based on library_id and section name
-- This ensures existing data gets consistent section_ids
update public.library_field_definitions
set section_id = md5(library_id::text || '::' || section)
where section_id is null;

-- Step 4: Make section_id non-nullable now that all rows have values
alter table public.library_field_definitions 
  alter column section_id set not null;

-- Step 5: Update the unique constraint to use section_id instead of section name for field identification
-- Drop the old constraint
alter table public.library_field_definitions 
  drop constraint if exists library_field_definitions_library_id_section_label_key;

-- Add new constraint using section_id (section name can still change)
alter table public.library_field_definitions 
  add constraint library_field_definitions_section_id_label_key 
  unique(section_id, label);

-- Note: We keep the section column for display purposes and backward compatibility
-- section_id is now the stable identifier, section name can be updated freely


