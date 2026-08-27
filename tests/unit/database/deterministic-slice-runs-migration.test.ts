import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260827090000_deterministic_slice_runs.sql'), 'utf8');

describe('deterministic Slice run migration', () => {
  it('creates project-owned runs, append-only events, artifacts, and private replay requests', () => {
    for (const table of ['keco_slice_runs', 'keco_slice_run_events', 'keco_slice_run_artifacts', 'keco_slice_run_requests']) {
      expect(sql).toMatch(new RegExp(`create table public\\.${table}`, 'i'));
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} force row level security`, 'i'));
    }
    expect(sql).toMatch(/primary key \(run_id, sequence\)/i);
    expect(sql).toMatch(/unique \(run_id, event_id\)/i);
    expect(sql).toMatch(/repair_count integer not null default 0 check \(repair_count between 0 and 3\)/i);
    expect(sql).not.toMatch(/grant (?:insert|update|delete|all)[^;]+keco_slice_run_events/i);
    expect(sql).not.toMatch(/grant (?:select|insert|update|delete|all)[^;]+keco_slice_run_requests/i);
  });

  it('evaluates observations and derives projection inside the trusted database path', () => {
    expect(sql).toMatch(/function public\.keco_evaluate_slice_observation/i);
    expect(sql).toMatch(/BUILD_HASH_MISMATCH/);
    expect(sql).toMatch(/SNAPSHOT_HASH_MISMATCH/);
    expect(sql).toMatch(/ACTUAL_PATH_MISSING/);
    expect(sql).toMatch(/ROUNDTRIP_MARKER_MISSING/);
    expect(sql).toMatch(/function public\.keco_derive_slice_projection/i);
    expect(sql).toMatch(/implementationStatus/);
    expect(sql).toMatch(/runtimeVerificationStatus/);
    expect(sql).toMatch(/acceptanceStatus/);
    expect(sql).toMatch(/releaseReadiness/);
    expect(sql).toMatch(/distinct on \(event\.payload->>'taskId'\)[\s\S]+order by event\.payload->>'taskId', event\.sequence desc/i);
    expect(sql).toMatch(/distinct on \(event\.payload->'result'->>'evalId'\)[\s\S]+order by event\.payload->'result'->>'evalId', event\.sequence desc/i);
    expect(sql).toMatch(/'status', case when jsonb_array_length\(v_reasons\) > 0 then 'failed' else 'passed' end/i);
    expect(sql).toMatch(/'manualRequired', coalesce\(\(p_spec->>'manualRequired'\)::boolean, false\)/i);
  });

  it('makes lifecycle writes idempotent and compare-and-swap protected', () => {
    for (const operation of ['create_slice_bundle', 'checkpoint_slice', 'finalize_slice']) {
      expect(sql).toMatch(new RegExp(`pg_advisory_xact_lock[\\s\\S]+:${operation}:`, 'i'));
      expect(sql).toMatch(new RegExp(`operation = '${operation}'[\\s\\S]+idempotency_key = p_idempotency_key[\\s\\S]+for update`, 'i'));
    }
    expect(sql.match(/IDEMPOTENCY_CONFLICT/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql).toMatch(/v_run\.state_token <> p_expected_state_token[\s\S]+SLICE_STATE_CONFLICT/i);
    expect(sql).toMatch(/v_run\.repair_count >= 3[\s\S]+SLICE_REPAIR_LIMIT/i);
    expect(sql).toMatch(/previous_event_hash[\s\S]+event_hash/i);
    expect(sql).toMatch(/p_mirror_verification_event_id is null/i);
    expect(sql).toMatch(/payload->>'manifestHash' = p_mirror_manifest_hash/i);
  });

  it('binds accepted task evidence and generated projections to the loaded run', () => {
    expect(sql).toMatch(/v_event->'payload'->>'runId' is distinct from p_run_id::text/i);
    expect(sql).toMatch(/v_event->'payload'->>'sliceId' is distinct from v_run\.slice_id/i);
    expect(sql).toMatch(/v_event->'payload'->>'planRevision' is distinct from v_run\.plan_data->>'planRevision'/i);
    expect(sql).toMatch(/jsonb_array_elements_text\(v_event->'payload'->'taskResultIds'\)/i);
    expect(sql).toMatch(/jsonb_array_elements\(v_event->'payload'->'reviewedFiles'\)/i);
    expect(sql).toMatch(/v_evaluations := v_evaluations \|\| jsonb_build_array\(v_evaluation\)/i);
    expect(sql).toMatch(/'computedEvaluations', v_evaluations/i);
    expect(sql).toMatch(/p_computed_evaluations/i);
    expect(sql).toMatch(/Client evaluator disagrees with trusted Slice evaluator/i);
    expect(sql).toMatch(/coalesce\(changed_file->>'afterHash', changed_file->>'beforeHash'\)/i);
    expect(sql).toMatch(/count\(distinct reviewed_file->>'path'\)/i);
  });

  it('creates document bundles atomically and exports canonical digests', () => {
    expect(sql).toMatch(/function public\.mcp_create_slice_bundle/i);
    expect(sql).toMatch(/assert_document_snapshot_payload/i);
    expect(sql).toMatch(/insert into public\.documents/i);
    expect(sql).toMatch(/insert into public\.keco_slice_runs/i);
    expect(sql).toMatch(/function public\.mcp_export_slice_mirrors/i);
    expect(sql).toMatch(/octet_length\(document\.content\)/i);
    expect(sql).toMatch(/public\.keco_slice_hash\(document\.content\)/i);
    expect(sql).toMatch(/manifestHash'[\s\S]+is distinct from v_manifest_hash/i);
    expect(sql).toMatch(/entry\.value->>'documentId' = v_document->>'documentId'/i);
    expect(sql).toMatch(/function public\.keco_render_slice_projection/i);
    expect(sql).toMatch(/Generated EvalReport is invalid/i);
    expect(sql).toMatch(/update public\.documents set content = v_document->>'markdown'/i);
  });

  it('splits implementation projection generation from mirror-verified delivery', () => {
    expect(sql).toMatch(/p_requested_terminal_intent = 'implementation_complete'/i);
    expect(sql).toMatch(/p_requested_terminal_intent = 'delivery'/i);
    expect(sql).toMatch(/case when p_requested_terminal_intent = 'delivery' then 'finalized' else 'implementation_completed' end/i);
    expect(sql).toMatch(/p_requested_terminal_intent = 'delivery' and jsonb_array_length\(p_documents\) <> 0/i);
    expect(sql).toMatch(/'facts', v_facts/i);
  });

  it('exposes only bounded lifecycle RPCs to authenticated actors', () => {
    for (const signature of [
      'mcp_create_slice_bundle', 'mcp_read_slice_run', 'mcp_checkpoint_slice',
      'mcp_finalize_slice', 'mcp_export_slice_mirrors',
    ]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${signature}`, 'i'));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${signature}`, 'i'));
    }
    expect(sql).toMatch(/security definer set search_path = ''/i);
    expect(sql).not.toMatch(/p_(?:actor|user)_id/i);
  });
});
