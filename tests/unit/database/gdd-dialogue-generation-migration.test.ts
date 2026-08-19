import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260819160000_gdd_dialogue_generation_jobs.sql',
);

describe('GDD dialogue generation migration', () => {
  it('defines durable dialogue jobs and transactional completion inputs', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/create table public.dialogue_generation_jobs/i);
    expect(sql).toMatch(/unique\s*\(\s*gdd_generation_job_id\s*,\s*chapter_key\s*\)/i);
    expect(sql).toMatch(/status.*queued.*running.*completed.*failed/is);
    expect(sql).toMatch(/p_dialogue_resources\s+jsonb/i);
    expect(sql).toMatch(/document_id/i);
    expect(sql).toMatch(/script_library_id/i);
    expect(sql).toMatch(/claim_dialogue_generation_job/i);
    expect(sql).toMatch(/fail_dialogue_generation_job/i);
    expect(sql).toMatch(/retry_dialogue_generation_job/i);
    expect(sql).toMatch(/folder_id/i);
    expect(sql).toMatch(/source_content/i);
  });

  it('makes permanent failures terminal and gives manual retries a fresh budget', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/case\s+when\s+p_delay_seconds\s*<=\s*0\s+or\s+attempt_count\s*>=\s*max_attempts\s+then\s+'failed'/i);
    expect(sql).toMatch(/set\s+status\s*=\s*'queued'\s*,\s*attempt_count\s*=\s*0/i);
    expect(sql).toMatch(/completed_at\s*=\s*null/i);
  });

  it('only completes a job with its own project-scoped generated Script', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/library\.id\s*=\s*p_script_library_id/i);
    expect(sql).toMatch(/library\.project_id\s*=\s*job\.project_id/i);
    expect(sql).toMatch(/library\.dialogue_generation_job_id\s*=\s*job\.id/i);
    expect(sql).toMatch(/library\.dialogue_generation_ready\s*=\s*true/i);
    expect(sql).toMatch(/library\.source_document_id\s*=\s*job\.document_id/i);
    expect(sql).toMatch(/library\.document_export_type\s*=\s*'script'/i);
    expect(sql).toMatch(/source_document\.collab_epoch\s*=\s*library\.dialogue_generation_source_epoch/i);
    expect(sql).toMatch(/source_document\.collab_revision\s*=\s*library\.dialogue_generation_source_revision/i);
  });

  it('keeps private job rows service-role-only', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).not.toMatch(/grant\s+select\s+on\s+public\.dialogue_generation_jobs\s+to\s+authenticated/i);
    expect(sql).not.toMatch(/create\s+policy\s+dialogue_generation_jobs_select_policy/i);
  });

  it('bounds claims and leaves exhausted jobs terminal', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/attempt_count\s*<\s*job\.max_attempts/i);
    expect(sql).toMatch(/status\s*=\s*'failed'.*attempt_count\s*>=\s*job\.max_attempts/is);
    expect(sql).toMatch(/btrim\(p_worker_id\)\s*=\s*''/i);
    expect(sql).toMatch(/p_lease_seconds\s*<\s*30\s+or\s+p_lease_seconds\s*>\s*300/i);
  });

  it('hides staging libraries and protects service-owned provenance', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/create\s+policy\s+libraries_dialogue_ready_select_policy[\s\S]*as\s+restrictive[\s\S]*dialogue_generation_ready\s*=\s*true/i);
    expect(sql).toMatch(/create\s+trigger\s+protect_dialogue_library_provenance/i);
    expect(sql).toMatch(/coalesce\(auth\.role\(\),\s*''\)\s*<>\s*'service_role'/i);
  });

  it('atomically finalizes the Script and job against the lease and exact Document state', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/finalize_dialogue_script_import/i);
    expect(sql).toMatch(/job\.lease_owner\s*=\s*p_worker_id/i);
    expect(sql).toMatch(/job\.lease_expires_at\s*>=\s*now\(\)/i);
    expect(sql).toMatch(/v_document\.collab_epoch\s*<>\s*p_source_epoch/i);
    expect(sql).toMatch(/v_document\.collab_revision\s*<>\s*p_source_revision/i);
    expect(sql).toMatch(/document_yjs_updates/i);
    expect(sql).toMatch(/set\s+dialogue_generation_ready\s*=\s*true/i);
    expect(sql).toMatch(/set\s+status\s*=\s*'completed'/i);
  });
});
