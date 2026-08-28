import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260828090000_gdd_exhausted_job_recovery.sql',
);
const sql = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';

describe('GDD exhausted job recovery migration', () => {
  it('makes expired final-attempt jobs terminal before guarded creation', () => {
    const guard = sql.match(
      /create or replace function public\.create_gdd_generation_job_guarded[\s\S]*?revoke all on function public\.create_gdd_generation_job_guarded/i,
    )?.[0] ?? '';

    expect(guard).toMatch(/pg_advisory_xact_lock/i);
    expect(guard).toMatch(
      /update public\.gdd_generation_jobs[\s\S]*status = 'failed'[\s\S]*project_id = p_project_id[\s\S]*status = 'running'[\s\S]*attempt_count >= max_attempts/i,
    );
    expect(guard).toMatch(/lease_expires_at is null or[\s\S]*lease_expires_at < now\(\)/i);
  });

  it('makes expired final-attempt jobs terminal before worker claim', () => {
    const claim = sql.match(
      /create or replace function public\.claim_gdd_generation_job[\s\S]*?revoke all on function public\.claim_gdd_generation_job/i,
    )?.[0] ?? '';

    expect(claim).toMatch(
      /update public\.gdd_generation_jobs[\s\S]*status = 'failed'[\s\S]*status = 'running'[\s\S]*attempt_count >= max_attempts/i,
    );
    expect(claim).toMatch(/Generation worker lease expired after final attempt/i);
    expect(sql).toMatch(/grant execute[\s\S]*claim_gdd_generation_job[\s\S]*service_role/i);
  });

  it('backfills existing exhausted jobs when the migration is applied', () => {
    const backfill = sql.split('create or replace function')[0] ?? '';

    expect(backfill).toMatch(
      /update public\.gdd_generation_jobs[\s\S]*status = 'failed'[\s\S]*status = 'running'[\s\S]*attempt_count >= max_attempts/i,
    );
  });
});
