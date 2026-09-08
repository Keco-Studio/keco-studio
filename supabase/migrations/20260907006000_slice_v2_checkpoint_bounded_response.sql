-- Keep the checkpoint response bounded to the strict Edge response schema.
-- The transaction core also returns the Slice identity for internal reads, but
-- mutation responses expose only the run identity and resumable state.

alter function public.mcp_checkpoint_slice_v2(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, text, text, jsonb
) rename to mcp_checkpoint_slice_v2_response_core;

revoke all on function public.mcp_checkpoint_slice_v2_response_core(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, text, text, jsonb
) from public, anon, authenticated;

create function public.mcp_checkpoint_slice_v2(
  p_project_id uuid,
  p_run_id uuid,
  p_expected_state_token uuid,
  p_events jsonb,
  p_artifacts jsonb,
  p_document_progress jsonb,
  p_idempotency_key text,
  p_input_hash text,
  p_computed_evaluations jsonb default '[]'::jsonb
) returns jsonb
language sql security definer set search_path = ''
as $$
  select public.mcp_checkpoint_slice_v2_response_core(
    p_project_id,
    p_run_id,
    p_expected_state_token,
    p_events,
    p_artifacts,
    p_document_progress,
    p_idempotency_key,
    p_input_hash,
    p_computed_evaluations
  ) - 'sliceId'
$$;

revoke all on function public.mcp_checkpoint_slice_v2(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, text, text, jsonb
) from public, anon;

grant execute on function public.mcp_checkpoint_slice_v2(
  uuid, uuid, uuid, jsonb, jsonb, jsonb, text, text, jsonb
) to authenticated;
