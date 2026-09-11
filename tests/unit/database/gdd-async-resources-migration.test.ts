import fs from 'node:fs';
import path from 'node:path';

const sqlPath = path.join(process.cwd(), 'supabase/migrations/20260911100000_gdd_async_resources.sql');
const sql = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, 'utf8') : '';

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
});
