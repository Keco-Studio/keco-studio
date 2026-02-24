-- Fix library_field_definitions unique constraint
-- Problem: unique(section_id, label) prevents multiple empty fields and duplicate labels
-- Solution: Use unique(section_id, order_index) instead, as position is truly unique

-- Step 1: Drop the old constraint that uses label
alter table public.library_field_definitions 
  drop constraint if exists library_field_definitions_section_id_label_key;

-- Step 2: Add new constraint using section_id + order_index
-- This allows multiple fields with same label (including empty labels)
-- while ensuring each position in a section is unique
alter table public.library_field_definitions 
  add constraint library_field_definitions_section_id_order_key 
  unique(section_id, order_index);

-- Note: This change allows:
-- 1. Multiple empty label fields (user can fill them later)
-- 2. Multiple fields with the same label (if needed)
-- 3. True uniqueness based on position in the section

