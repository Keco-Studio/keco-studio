import { readFileSync } from 'node:fs';
import path from 'node:path';

const sql = readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260917010000_account_project_storage_usage.sql',
), 'utf8');

describe('account project storage migration', () => {
  it('defines private quota, file, location, and reservation tables', () => {
    for (const table of [
      'account_storage_quotas',
      'project_storage_files',
      'project_storage_file_locations',
      'storage_upload_reservations',
    ]) {
      expect(sql).toMatch(new RegExp(`create table public\\.${table}`, 'i'));
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
    }
    expect(sql).toMatch(/default 1099511627776/i);
    expect(sql).toMatch(/unique\s*\(bucket_id,\s*object_path\)/i);
    expect(sql).toMatch(/revoke all on table public\.account_storage_quotas from public, anon, authenticated/i);
  });

  it('defines atomic authenticated and service-role quota functions', () => {
    expect(sql).toMatch(/function public\.reserve_project_storage_upload\(/i);
    expect(sql).toMatch(/function public\.finalize_project_storage_upload\(/i);
    expect(sql).toMatch(/function public\.release_project_storage_upload\(/i);
    expect(sql).toMatch(/function public\.service_reserve_project_storage_upload\(/i);
    expect(sql).toMatch(/for update/i);
    expect(sql).toMatch(/used_bytes\s*\+\s*reserved_bytes\s*\+\s*p_expected_bytes\s*>\s*quota_bytes/i);
    expect(sql).toMatch(/STORAGE_QUOTA_EXCEEDED/i);
  });
});
