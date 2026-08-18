import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260817200000_gdd_generation_jobs.sql'), 'utf8');

describe('GDD generation migration security and atomic persistence', () => {
  it('limits job visibility to owners and accepted writable collaborators', () => {
    expect(sql).toMatch(/is_project_owner\(project_id,\s*\(select auth\.uid\(\)\)\)/i);
    expect(sql).toMatch(/is_editor_or_admin_collaborator\(project_id,\s*\(select auth\.uid\(\)\)\)/i);
    expect(sql).not.toMatch(/user_has_project_access\(project_id/i);
  });

  it('grants authenticated users only public DTO columns', () => {
    expect(sql).toMatch(/revoke select on public\.gdd_generation_jobs from authenticated/i);
    const grant = sql.match(/grant select \(([\s\S]*?)\) on public\.gdd_generation_jobs to authenticated/i)?.[1] ?? '';
    expect(grant).toContain('output_document_id');
    expect(grant).not.toMatch(/\binput\b|source_snapshots|idempotency_key|input_hash|lease_owner|lease_expires_at|heartbeat_at|owner_id/);
    expect(sql).not.toMatch(/grant select on public\.gdd_generation_jobs to authenticated/i);
  });

  it('stores structured GDD generation metadata on Documents', () => {
    expect(sql).toMatch(/add column if not exists gdd_generation_metadata jsonb/i);
    expect(sql).toMatch(/jsonb_typeof\(gdd_generation_metadata\) = 'object'/i);
  });

  it('atomically and idempotently persists a Yjs Document and completes its leased job', () => {
    expect(sql).toMatch(/create function public\.persist_completed_gdd_generation_job/i);
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/insert into public\.documents[\s\S]*yjs_state/i);
    expect(sql).toMatch(/gdd_generation_job_id/i);
    expect(sql).toMatch(/update public\.gdd_generation_jobs[\s\S]*status = 'completed'/i);
    expect(sql).toMatch(/revoke all on function public\.persist_completed_gdd_generation_job[\s\S]*authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.persist_completed_gdd_generation_job[\s\S]*service_role/i);
    const rpc = sql.match(/create function public\.persist_completed_gdd_generation_job([\s\S]*?)revoke all on function public\.claim_gdd_generation_job/i)?.[1] ?? '';
    expect(rpc).toMatch(/perform 1[\s\S]*from public\.projects[\s\S]*owner_id = v_job\.owner_id[\s\S]*for share;[\s\S]*if not found then[\s\S]*perform 1[\s\S]*from public\.project_collaborators[\s\S]*role in \('admin', 'editor'\)[\s\S]*accepted_at is not null[\s\S]*for share;/i);
    expect(rpc).toMatch(/perform 1[\s\S]*from public\.project_game_design_systems[\s\S]*design_system_id = v_job\.design_system_id[\s\S]*version_id = v_job\.version_id[\s\S]*for share;[\s\S]*if not found then/i);
    expect(rpc.indexOf('for share;')).toBeLessThan(rpc.indexOf('insert into public.documents'));
    expect(rpc.indexOf('project_game_design_systems')).toBeLessThan(rpc.indexOf('insert into public.documents'));
  });
});
