import fs from 'node:fs';
import path from 'node:path';

const sqlPath = path.join(process.cwd(), 'supabase/migrations/20260911100000_gdd_async_resources.sql');
const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, 'utf8') : '';
const recoverySqlPath = path.join(process.cwd(), 'supabase/migrations/20260916170000_gdd_failed_resource_retry.sql');
const recoverySql = fs.existsSync(recoverySqlPath) ? fs.readFileSync(recoverySqlPath, 'utf8') : '';

describe('GDD async resources migration', () => {
  it('adds async resource mode and durable resource jobs', () => {
    expect(sql).toMatch(/add column if not exists resource_mode/i);
    expect(sql).toMatch(/check \(resource_mode in \('async', 'inline'\)\)/i);
    expect(sql).toMatch(/create table (if not exists )?public\.gdd_resource_jobs/i);
    expect(sql).toMatch(/unique \(gdd_generation_job_id, kind\)/i);
  });

  it('keeps resource worker operations service-role-only and independently retryable', () => {
    expect(sql).toMatch(/create (or replace )?function public\.claim_gdd_resource_job/i);
    expect(sql).toMatch(/create (or replace )?function public\.retry_gdd_resource_job/i);
    expect(sql).toMatch(/create (or replace )?function public\.finish_gdd_resource_job/i);
    expect(sql).toMatch(/grant execute on function public\.claim_gdd_resource_job[\s\S]*service_role/i);
  });

  it('allows service-role recovery of one exhausted resource without weakening worker leases', () => {
    expect(recoverySql).toMatch(/create or replace function public\.retry_failed_gdd_resource_job\(\s*p_job_id uuid/i);
    expect(recoverySql).toMatch(/where resource\.id = p_job_id[\s\S]*for update/i);
    expect(recoverySql).toMatch(/if v_job\.status <> 'failed'/i);
    expect(recoverySql).toMatch(/status = 'queued'[\s\S]*attempt_count = 0[\s\S]*lease_owner = null[\s\S]*lease_expires_at = null/i);
    expect(recoverySql).toMatch(/revoke all on function public\.retry_failed_gdd_resource_job\(uuid\)[\s\S]*authenticated/i);
    expect(recoverySql).toMatch(/grant execute on function public\.retry_failed_gdd_resource_job\(uuid\) to service_role/i);
  });
});
