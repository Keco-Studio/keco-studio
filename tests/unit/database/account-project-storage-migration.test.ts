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
    expect(sql).toMatch(/function public\.service_import_project_storage_file\(/i);
    expect(sql).toMatch(/function public\.service_rebuild_account_storage_quota_totals\(\)/i);
    expect(sql).toMatch(/function public\.resolve_project_storage_upload_reservation\(/i);
    expect(sql).toMatch(/function public\.complete_project_game_asset_storage_upload\(/i);
    expect(sql).toMatch(/perform public\.storage_finalize_project_storage_upload\([\s\S]*v_asset\.id/i);
    expect(sql).toMatch(/pg_advisory_xact_lock_shared/i);
    expect(sql).toMatch(/pg_advisory_xact_lock\(/i);
    expect(sql).toMatch(/grant execute on function public\.service_import_project_storage_file[\s\S]*to service_role/i);
  });

  it('gates accounted bucket writes and verifies storage metadata before settlement', () => {
    expect(sql).toMatch(/create schema if not exists private/i);
    expect(sql).toMatch(/function private\.storage_has_pending_upload_reservation\(/i);
    expect(sql).toMatch(/reservation\.requested_by\s*=\s*auth\.uid\(\)/i);
    expect(sql).toMatch(/reservation\.status\s*=\s*'pending'/i);
    expect(sql).toMatch(/reservation\.expires_at\s*>\s*clock_timestamp\(\)/i);
    for (const policy of [
      'library_media_files_project_insert',
      'library_media_files_project_update',
      'project_assets_storage_insert',
      'project_assets_storage_update',
      'tiptap_images_project_insert',
      'tiptap_images_project_update',
    ]) {
      expect(sql).toMatch(new RegExp(`create policy ${policy}[\\s\\S]*private\\.storage_has_pending_upload_reservation\\(bucket_id, name\\)`, 'i'));
    }
    expect(sql).toMatch(/create policy tiptap_images_project_delete[\s\S]*collaborator\.role in \('admin', 'editor'\)/i);
    expect(sql).toMatch(/grant usage on schema private to authenticated/i);
    expect(sql).toMatch(/grant execute on function private\.storage_has_pending_upload_reservation\(text, text\) to authenticated/i);
    expect(sql).toMatch(/collaborator\.role in \('admin', 'editor'\)/i);
    expect(sql).toMatch(/from storage\.objects as object/i);
    expect(sql).toMatch(/object\.metadata\s*->>\s*'size'/i);
    expect(sql).toMatch(/p_actual_bytes\s+is distinct from\s+v_verified_bytes/i);
    expect(sql).toMatch(/v_quota\.quota_bytes\s*-\s*v_quota\.used_bytes\s*-\s*v_quota\.reserved_bytes/i);
    expect(sql).toMatch(/'name_asc',\s*'name_desc',\s*'size_asc',\s*'size_desc',\s*'created_asc',\s*'created_desc'/i);
  });
});
