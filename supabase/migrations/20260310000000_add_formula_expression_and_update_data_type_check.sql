-- Add formula_expression column and update data_type check constraint

-- 1. Ensure formula_expression column exists
alter table public.library_field_definitions
  add column if not exists formula_expression text;

-- 2. Drop old data_type check constraint (if any)
alter table public.library_field_definitions
  drop constraint if exists library_field_definitions_data_type_check;

-- 3. Recreate data_type check constraint including 'formula'
alter table public.library_field_definitions
  add constraint library_field_definitions_data_type_check
  check (
    data_type is null
    or data_type in (
      'string',
      'int',
      'float',
      'boolean',
      'enum',
      'date',
      'image',
      'file',
      'reference',
      'int_array',
      'float_array',
      'string_array',
      'multimedia',
      'audio',
      'formula'
    )
  );

