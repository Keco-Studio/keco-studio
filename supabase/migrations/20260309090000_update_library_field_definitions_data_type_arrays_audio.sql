-- Update library_field_definitions.data_type check constraint
-- to support new array and audio/multimedia types.

alter table public.library_field_definitions
  drop constraint if exists library_field_definitions_data_type_check;

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
      'audio'
    )
  );

