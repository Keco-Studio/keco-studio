import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260819090000_gdd_map_generation_integration.sql'),
  'utf8',
);
const activeJobGuardSql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260820020000_gdd_active_job_guard.sql'),
  'utf8',
);
const reconciliationSql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260820010000_gdd_map_artifact_reconciliation.sql'),
  'utf8',
);

describe('GDD map generation migration', () => {
  it('adds bounded child artifacts and parent partial-success states', () => {
    expect(sql).toMatch(/create table public\.gdd_map_artifacts/i);
    expect(sql).toMatch(/unique \(gdd_generation_job_id, map_brief_id\)/i);
    expect(sql).toMatch(/completed_with_map_failures/i);
    expect(sql).toMatch(/compiling_maps/i);
    expect(sql).toMatch(/generating_maps/i);
    expect(sql).toMatch(/finalizing_maps/i);
  });

  it('keeps private map inputs and provider fields out of authenticated grants', () => {
    const grant = sql.match(/grant select \(([\s\S]*?)\) on public\.gdd_map_artifacts to authenticated/i)?.[1] ?? '';
    expect(grant).toContain('map_revision_id');
    expect(grant).not.toMatch(/style_contract|input_hash|lease_owner|generation_id|plan_fingerprint/);
    expect(sql).toMatch(/create policy gdd_map_artifacts_select_policy[\s\S]*is_accepted_collaborator/i);
    expect(sql).toMatch(/grant execute on function public\.claim_gdd_map_artifact[\s\S]*service_role/i);
  });

  it('atomically creates map projects and a validated direct-image asset', () => {
    const prepare = sql.match(/create function public\.prepare_gdd_map_artifact[\s\S]*?create function public\.reschedule_gdd_map_artifact/i)?.[0] ?? '';
    expect(prepare).toMatch(/map_validate_v3_payload\(p_plan, p_scene\)/i);
    expect(prepare).toMatch(/insert into public\.map_projects/i);
    expect(prepare).toMatch(/schema_version, plan, scene, status/i);
    expect(prepare).toMatch(/'map-image', 'map_image', 'planned'/i);
    expect(prepare).toMatch(/'direct_map_image'/i);
    expect(prepare).toMatch(/gdd_generation_job_id/i);
  });

  it('creates no child work for an empty brief array and limits generated maps to three', () => {
    const persist = sql.match(/create function public\.persist_gdd_generation_with_maps[\s\S]*?revoke all on function public\.claim_gdd_map_artifact/i)?.[0] ?? '';
    expect(persist).toMatch(/jsonb_array_length\(p_map_artifacts\)/i);
    expect(persist).toMatch(/if v_map_count > 3/i);
    expect(persist).toMatch(/when v_map_count = 0 then 'completed'/i);
    expect(persist).toMatch(/else 'waiting_for_maps'/i);
    expect(persist).toMatch(/insert into public\.gdd_map_artifacts/i);
  });

  it('caps active children at two and isolates terminal child failures', () => {
    expect(sql).toMatch(/select count\(\*\)[\s\S]*sibling\.status = 'running'[\s\S]*\) < 2/i);
    expect(sql).toMatch(/status in \('failed', 'blocked'\)/i);
    expect(sql).toMatch(/completed_with_map_failures/i);
  });

  it('renews active map leases and reconciles assets that finished before the artifact', () => {
    expect(reconciliationSql).toMatch(/create function public\.heartbeat_gdd_map_artifact/i);
    expect(reconciliationSql).toMatch(/lease_expires_at = now\(\) \+ make_interval/i);
    expect(reconciliationSql).toMatch(/create function public\.reconcile_gdd_map_artifact/i);
    expect(reconciliationSql).toMatch(/v_asset_status <> 'ready'/i);
    expect(reconciliationSql).toMatch(/status = 'ready'[\s\S]*phase = 'ready'/i);
    expect(reconciliationSql).toMatch(/grant execute on function public\.reconcile_gdd_map_artifact[\s\S]*service_role/i);
  });

  it('serializes project generation starts and reuses identical active jobs', () => {
    expect(activeJobGuardSql).toMatch(/create or replace function public\.create_gdd_generation_job_guarded/i);
    expect(activeJobGuardSql).toMatch(/pg_advisory_xact_lock[\s\S]*p_project_id::text/i);
    expect(activeJobGuardSql).toMatch(/status in \('queued', 'running', 'waiting_for_maps'\)/i);
    expect(activeJobGuardSql).toMatch(/if v_job\.input_hash = p_input_hash[\s\S]*return next v_job/i);
    expect(activeJobGuardSql).toMatch(/hint = 'gdd_active_job_conflict'/i);
  });

  it('keeps guarded creation service-role-only and cleans stale duplicates', () => {
    expect(activeJobGuardSql).toMatch(/Superseded by a completed duplicate GDD generation request/i);
    expect(activeJobGuardSql).toMatch(/revoke all on function public\.create_gdd_generation_job_guarded[\s\S]*from public, anon, authenticated/i);
    expect(activeJobGuardSql).toMatch(/grant execute on function public\.create_gdd_generation_job_guarded[\s\S]*to service_role/i);
  });
});
