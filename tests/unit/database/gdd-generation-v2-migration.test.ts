import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260818120000_gdd_generation_v2.sql'), 'utf8');

describe('GDD v2 migration', () => {
  it('adds mode, contract, and checkpoint artifacts', () => {
    expect(sql).toMatch(/add column if not exists mode text/i);
    expect(sql).toMatch(/add column if not exists contract_version integer/i);
    expect(sql).toMatch(/add column if not exists blueprint jsonb/i);
    expect(sql).toMatch(/add column if not exists section_drafts jsonb/i);
    expect(sql).toMatch(/add column if not exists review_report jsonb/i);
    expect(sql).toMatch(/checkpoint_gdd_generation_job/i);
  });

  it('does not grant private artifacts to authenticated users', () => {
    const grant = sql.match(/grant select \(([\s\S]*?)\) on public\.gdd_generation_jobs to authenticated/i)?.[1] ?? '';
    expect(grant).toContain('mode');
    expect(grant).toContain('contract_version');
    expect(grant).toContain('created_at');
    expect(grant).not.toContain('blueprint');
    expect(grant).not.toContain('section_drafts');
    expect(grant).not.toContain('review_report');
    expect(sql).toMatch(/grant execute on function public\.checkpoint_gdd_generation_job[\s\S]*service_role/i);
  });
});

describe('GDD public ordering migration', () => {
  it('grants only the ordering column to authenticated readers', () => {
    const orderingSql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260818123000_gdd_generation_public_order.sql'), 'utf8');
    expect(orderingSql).toMatch(/grant select \(created_at\) on public\.gdd_generation_jobs to authenticated/i);
    expect(orderingSql).not.toMatch(/grant select on public\.gdd_generation_jobs to authenticated/i);
  });
});
