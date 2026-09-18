import { readFileSync } from 'node:fs';
import path from 'node:path';

const sql = readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260917010000_account_project_storage_usage.sql',
), 'utf8');
const logicalSql = readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260918030000_project_logical_storage_accounting.sql',
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

  it('creates a private logical-file registry and independent logical counter', () => {
    expect(logicalSql).toMatch(/add column logical_used_bytes bigint not null default 0/i);
    expect(logicalSql).toMatch(/create table public\.project_storage_logical_files/i);
    expect(logicalSql).toMatch(/source_kind text not null check \(source_kind in \('document_content', 'library_table'\)\)/i);
    expect(logicalSql).toMatch(/unique \(source_kind, source_entity_id\)/i);
    expect(logicalSql).toMatch(/alter table public\.project_storage_logical_files enable row level security/i);
    expect(logicalSql).toMatch(/revoke all on table public\.project_storage_logical_files from public, anon, authenticated/i);
    expect(logicalSql).toMatch(/create trigger trg_settle_project_storage_logical_file/i);
    expect(logicalSql).toMatch(/set logical_used_bytes = logical_used_bytes \+ new\.size_bytes/i);
    expect(logicalSql).toMatch(/STORAGE_USAGE_UNDERFLOW/i);
  });

  it('sizes and synchronizes documents and complete logical library tables', () => {
    expect(logicalSql).toMatch(/function private\.storage_document_logical_size\(p_document_id uuid\)/i);
    expect(logicalSql).toMatch(/pg_catalog\.octet_length\(coalesce\(document\.content, ''\)\)/i);
    expect(logicalSql).toMatch(/function private\.storage_library_logical_payload\(p_library_id uuid\)/i);
    for (const editablePart of [
      /'fields',[\s\S]*public\.library_field_definitions/i,
      /'rows',[\s\S]*public\.library_assets/i,
      /'fieldSection', field\.section,[\s\S]*'fieldLabel', field\.label,[\s\S]*'value', value\.value_json/i,
      /order by asset\.row_index nulls last, asset\.id/i,
    ]) expect(logicalSql).toMatch(editablePart);
    expect(logicalSql).toMatch(/octet_length\(payload::text\)::bigint/i);
    for (const triggerTarget of [
      /trg_sync_document_logical_file[\s\S]*on public\.documents/i,
      /trg_sync_library_logical_file[\s\S]*on public\.libraries/i,
      /trg_sync_library_field_insert[\s\S]*on public\.library_field_definitions/i,
      /trg_sync_library_asset_insert[\s\S]*on public\.library_assets/i,
      /trg_sync_library_value_insert[\s\S]*on public\.library_asset_values/i,
    ]) expect(logicalSql).toMatch(triggerTarget);
    expect(logicalSql).toMatch(/referencing new table as new_rows for each statement/i);
    expect(logicalSql).toMatch(/old\.name is distinct from new\.name[\s\S]*new\.id = any\(coalesce\(field\.reference_libraries/i);
  });

  it('backfills logical rows and converts the old document counter safely', () => {
    expect(logicalSql).toMatch(/drop trigger if exists trg_settle_document_content_storage/i);
    expect(logicalSql).toMatch(/insert into public\.project_storage_logical_files[\s\S]*from public\.documents document/i);
    expect(logicalSql).toMatch(/from public\.documents document[\s\S]*where project\.owner_id is not null/i);
    expect(logicalSql).toMatch(/for v_library_id in[\s\S]*from public\.libraries library[\s\S]*where project\.owner_id is not null/i);
    expect(logicalSql).toMatch(/drop table public\.project_storage_document_content/i);
    expect(logicalSql).toMatch(/service_rebuild_account_storage_quota_totals\(\)[\s\S]*project_storage_files[\s\S]*project_storage_logical_files/i);
    expect(logicalSql).toMatch(/update public\.account_storage_quotas quota[\s\S]*where quota\.owner_id is not null/i);
  });

  it('returns unified totals and logical files while preserving physical-only upload enforcement', () => {
    expect(logicalSql).toMatch(/'usedBytes', v_display_used/i);
    expect(logicalSql).toMatch(/'physicalUsedBytes', v_physical_used/i);
    expect(logicalSql).toMatch(/'logicalUsedBytes', v_logical_used/i);
    expect(logicalSql).toMatch(/'remainingBytes', greatest\([\s\S]*, 0\)/i);
    expect(logicalSql).toMatch(/'overageBytes', greatest\([\s\S]*, 0\)/i);
    expect(logicalSql).toMatch(/union all[\s\S]*from public\.project_storage_logical_files logical/i);
    expect(logicalSql).toMatch(/logical\.source_kind, logical\.source_entity_id, logical\.created_at, true/i);
    expect(sql).toMatch(/used_bytes\s*\+\s*reserved_bytes\s*\+\s*p_expected_bytes\s*>\s*quota_bytes/i);
    expect(logicalSql).not.toMatch(/logical_used_bytes\s*\+\s*reserved_bytes\s*\+\s*p_expected_bytes/i);
  });
});
