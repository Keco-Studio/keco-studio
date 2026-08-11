import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260811030000_project_storage_cleanup_outbox.sql',
);

describe('project storage cleanup outbox migration', () => {
  it('atomically records reference paths before deleting the project', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/create table public\.project_storage_cleanup_jobs/i);
    expect(sql).toMatch(/create function public\.delete_project_and_enqueue_storage_cleanup/i);
    expect(sql).toMatch(/from public\.projects[\s\S]+for update/i);
    expect(sql).toMatch(/array_agg\(reference\.storage_path[\s\S]+from public\.map_reference_images/i);
    expect(sql).toMatch(/from public\.map_assets[\s\S]+join public\.map_revisions[\s\S]+join public\.map_projects/i);
    expect(sql).toMatch(/insert into public\.project_storage_cleanup_jobs[\s\S]+delete from public\.projects/i);
  });

  it('keeps the cleanup queue private and callable only through service role', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/alter table public\.project_storage_cleanup_jobs enable row level security/i);
    expect(sql).toMatch(/revoke all on public\.project_storage_cleanup_jobs from public, anon, authenticated/i);
    expect(sql).toMatch(/grant select, update, delete on public\.project_storage_cleanup_jobs to service_role/i);
    expect(sql).toMatch(/revoke all on function public\.delete_project_and_enqueue_storage_cleanup\(uuid\)[\s\S]+from public, anon, authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.delete_project_and_enqueue_storage_cleanup\(uuid\)[\s\S]+to service_role/i);
  });
});
