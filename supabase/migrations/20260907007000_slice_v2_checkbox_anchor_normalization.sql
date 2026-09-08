-- Block anchors are codec metadata and are regenerated on every encode. Ignore
-- them while proving that a progress update changes checkbox state only.

create or replace function public.keco_slice_v2_normalize_checkboxes(
  p_markdown text
) returns text
language sql immutable
set search_path = ''
as $$
  select regexp_replace(
    regexp_replace(
      coalesce(p_markdown, ''),
      '<BlockAnchor id="[^"]+" />',
      '',
      'g'
    ),
    '\[[xX ]\]',
    '[ ]',
    'g'
  )
$$;

revoke all on function public.keco_slice_v2_normalize_checkboxes(text)
  from public, anon, authenticated;
