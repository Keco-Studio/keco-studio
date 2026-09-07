import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260907100000_resumable_professional_gdd_jobs.sql'),
  'utf8',
);

describe('resumable professional GDD migration', () => {
  it('preserves the stored phase when claiming professional contract-v2 jobs', () => {
    expect(sql).toMatch(/create or replace function public\.claim_gdd_generation_job/i);
    expect(sql).toMatch(/phase\s*=\s*case[\s\S]{0,300}job\.contract_version\s*=\s*2[\s\S]{0,300}job\.phase/i);
    expect(sql).toMatch(/blueprint|section_drafts|review_report|repair_round/i);
  });

  it('keeps a queued retry in its current phase and preserves checkpoints', () => {
    expect(sql).toMatch(/create or replace function public\.retry_gdd_generation_job/i);
    expect(sql).toMatch(/phase\s*=\s*case[\s\S]{0,300}job\.contract_version\s*=\s*2[\s\S]{0,300}job\.phase/i);
    expect(sql).toMatch(/section_drafts|review_report|repair_round/i);
    expect(sql).not.toMatch(/blueprint\s*=\s*null|section_drafts\s*=\s*'\[\]'::jsonb/i);
  });

  it('keeps checkpoint RPC access restricted to service_role', () => {
    expect(sql).toMatch(/revoke all on function public\.checkpoint_gdd_generation_job/i);
    expect(sql).toMatch(/grant execute on function public\.checkpoint_gdd_generation_job[\s\S]*service_role/i);
    expect(sql).toMatch(/notify pgrst,\s*'reload schema'/i);
  });
});
