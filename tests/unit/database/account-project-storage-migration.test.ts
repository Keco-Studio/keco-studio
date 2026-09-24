import { readFileSync } from 'node:fs';
import path from 'node:path';

const sql = readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260917010000_account_project_storage_usage.sql',
), 'utf8');
const documentSql = readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260918020000_account_document_content_storage.sql',
), 'utf8');
const logicalSql = readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260918030000_project_logical_storage_accounting.sql',
), 'utf8');
const aggregationSql = readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260918040000_account_storage_logical_file_aggregation.sql',
), 'utf8');
const entityAggregationSql = readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260922120000_project_storage_entity_aggregation.sql',
), 'utf8');
const hierarchySql = readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260922180000_account_storage_hierarchy_and_historical_assets.sql',
), 'utf8');
const v3CompatibilitySql = readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260922220000_account_storage_v3_compatibility.sql',
), 'utf8');
const v4CompatibilitySql = readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260922230000_account_storage_v4_compatibility.sql',
), 'utf8');
const adminStorageSql = readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260924110000_grant_keco_admin_storage_read.sql',
), 'utf8');
const adminLogicalStorageSql = readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260924120000_grant_keco_admin_logical_storage_read.sql',
), 'utf8');
const visibleStorageSql = readFileSync(path.join(
  process.cwd(),
  'supabase/migrations/20260924100000_user_visible_storage_accounting.sql',
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

  it('permits the service role to read private quota totals for Keco Admin', () => {
    expect(adminStorageSql).toMatch(
      /grant select \(owner_id, used_bytes\)\s+on table public\.account_storage_quotas\s+to service_role/i,
    );
  });

  it('permits the service role to read logical storage totals for Keco Admin', () => {
    expect(adminLogicalStorageSql).toMatch(
      /grant select \(logical_used_bytes\)\s+on table public\.account_storage_quotas\s+to service_role/i,
    );
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
      /'plotPlan', library\.plot_plan/i,
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
    expect(logicalSql).toMatch(
      /after insert or delete or update of project_id, name, description, plot_plan on public\.libraries/i,
    );
    expect(logicalSql).toMatch(/referencing new table as new_rows for each statement/i);
    expect(logicalSql).toMatch(/old\.name is distinct from new\.name[\s\S]*new\.id = any\(coalesce\(field\.reference_libraries/i);
  });

  it('backfills logical rows and converts the old document counter safely', () => {
    expect(documentSql).toMatch(
      /if v_owner_id is null then[\s\S]*delete from public\.project_storage_document_content[\s\S]*return new/i,
    );
    expect(documentSql).toMatch(
      /from public\.documents d[\s\S]*where project\.owner_id is not null/i,
    );
    expect(documentSql).not.toMatch(
      /display_name text not null check \(char_length\(btrim\(display_name\)\) between 1 and 255\)/i,
    );
    expect(logicalSql).not.toMatch(
      /display_name text not null check \(char_length\(btrim\(display_name\)\) between 1 and 255\)/i,
    );
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

  it('presents document content and owned images as one logical file', () => {
    expect(aggregationSql).toMatch(
      /image\.source_kind = 'document_image'[\s\S]*image\.source_entity_id = logical\.source_entity_id/i,
    );
    expect(aggregationSql).toMatch(
      /logical\.size_bytes \+ coalesce\(sum\(image\.size_bytes\), 0\) as size_bytes/i,
    );
    expect(aggregationSql).toMatch(
      /not \(file\.source_kind = 'document_image' and exists \([\s\S]*logical\.source_kind = 'document_content'/i,
    );
    expect(aggregationSql).toMatch(/'application\/x-keco-document'/i);
    expect(aggregationSql).toMatch(
      /revoke all on function public\.account_storage_project_files[\s\S]*grant execute[\s\S]*to authenticated/i,
    );
  });

  it('binds every physical project file to one aggregate entity', () => {
    expect(entityAggregationSql).toMatch(/create table public\.project_storage_entity_bindings/i);
    expect(entityAggregationSql).toMatch(/file_id uuid primary key references public\.project_storage_files\(id\) on delete cascade/i);
    expect(entityAggregationSql).toMatch(/entity_kind text not null check \(entity_kind in \('document', 'table', 'assets'\)\)/i);
    expect(entityAggregationSql).toMatch(/function private\.storage_refresh_file_entity_binding\(p_file_id uuid\)/i);
    expect(entityAggregationSql).toMatch(/v_file\.source_kind = 'document_image'[\s\S]*v_entity_kind := 'document'/i);
    expect(entityAggregationSql).toMatch(/private\.storage_json_media_paths\(value\.value_json\)[\s\S]*order by library\.id, asset\.id/i);
    expect(entityAggregationSql).toMatch(/v_entity_kind := 'assets'[\s\S]*v_entity_id := v_file\.project_id/i);
    expect(entityAggregationSql).toMatch(/on conflict \(file_id\) do update/i);
    expect(entityAggregationSql).toMatch(/select private\.storage_refresh_file_entity_binding\(file\.id\)[\s\S]*where file\.project_id is not null/i);
  });

  it('refreshes entity ownership when files, table cells, libraries, or documents change', () => {
    for (const trigger of [
      /trg_refresh_storage_file_entity_binding[\s\S]*on public\.project_storage_files/i,
      /trg_refresh_media_value_storage_bindings[\s\S]*on public\.library_asset_values/i,
      /trg_refresh_library_storage_bindings[\s\S]*on public\.libraries/i,
      /trg_refresh_asset_storage_bindings[\s\S]*on public\.library_assets/i,
      /trg_refresh_document_storage_bindings[\s\S]*on public\.documents/i,
    ]) expect(entityAggregationSql).toMatch(trigger);
  });

  it('exposes service-role binding drift detection and repair', () => {
    expect(entityAggregationSql).toMatch(/function public\.service_account_storage_entity_binding_drift\(\)/i);
    expect(entityAggregationSql).toMatch(/'missingBindings'/i);
    expect(entityAggregationSql).toMatch(/'staleBindings'/i);
    expect(entityAggregationSql).toMatch(/'conflictingBindings'/i);
    expect(entityAggregationSql).toMatch(/function public\.service_refresh_account_storage_entity_bindings\(\)/i);
    expect(entityAggregationSql).toMatch(
      /grant execute on function public\.service_account_storage_entity_binding_drift\(\) to service_role/i,
    );
    expect(entityAggregationSql).toMatch(
      /grant execute on function public\.service_refresh_account_storage_entity_bindings\(\) to service_role/i,
    );
    expect(entityAggregationSql).toMatch(/expected_bindings[\s\S]*binding\.entity_kind is distinct from expected\.entity_kind/i);
    expect(entityAggregationSql).toMatch(/binding\.entity_id is distinct from expected\.entity_id/i);
  });

  it('keeps private aggregation and mutation functions inaccessible to API roles', () => {
    expect(entityAggregationSql).toMatch(
      /revoke all on table public\.project_storage_entity_bindings from public, anon, authenticated, service_role/i,
    );
    for (const privateFunction of [
      'storage_json_media_paths',
      'storage_refresh_file_entity_binding',
      'storage_refresh_project_entity_bindings',
      'storage_project_entity_physical_files',
      'storage_project_entities',
    ]) {
      expect(entityAggregationSql).toMatch(new RegExp(
        `revoke all on function private\\.${privateFunction}\\(`
          + `[\\s\\S]*from public, anon, authenticated, service_role`,
        'i',
      ));
    }
  });

  it('returns one-level entities and exact read-only details', () => {
    expect(entityAggregationSql).toMatch(/function private\.storage_project_entity_physical_files\(p_project_id uuid\)/i);
    expect(entityAggregationSql).toMatch(/left join public\.project_storage_entity_bindings binding/i);
    expect(entityAggregationSql).toMatch(/else 'assets'[\s\S]*else file\.project_id/i);
    expect(entityAggregationSql).toMatch(/function private\.storage_project_entities\(p_project_id uuid\)/i);
    expect(entityAggregationSql).toMatch(/logical\.size_bytes \+ coalesce\(physical_totals\.size_bytes, 0\) as size_bytes/i);
    expect(entityAggregationSql).toMatch(/'Assets'[\s\S]*'application\/x-keco-assets'/i);
    expect(entityAggregationSql).toMatch(/function public\.account_storage_project_entities\(/i);
    expect(entityAggregationSql).toMatch(/function public\.account_storage_entity_details\(/i);
    expect(entityAggregationSql).toMatch(/perform public\.storage_require_reader\(p_project_id, v_actor\)/i);
    expect(entityAggregationSql).toMatch(/grant execute on function public\.account_storage_project_entities[\s\S]*to authenticated/i);
    expect(entityAggregationSql).toMatch(/grant execute on function public\.account_storage_entity_details[\s\S]*to authenticated/i);
  });

  it('uses aggregate rows for project file counts and totals without changing quota counters', () => {
    expect(entityAggregationSql).toMatch(/'fileCount', \(select count\(\*\) from private\.storage_project_entities\(project\.id\)\)/i);
    expect(entityAggregationSql).toMatch(/'usedBytes', \(select coalesce\(sum\(entity\.size_bytes\), 0\) from private\.storage_project_entities\(project\.id\) entity\)/i);
    expect(entityAggregationSql).toMatch(/v_display_used := v_physical_used \+ v_logical_used/i);
    expect(entityAggregationSql).not.toMatch(/set used_bytes/i);
    expect(entityAggregationSql).not.toMatch(/set logical_used_bytes/i);
  });

  it('imports attributable historical storage objects using authoritative metadata', () => {
    expect(hierarchySql).toMatch(/set statement_timeout = '10min'/i);
    expect(hierarchySql).toMatch(/reset statement_timeout/i);
    expect(hierarchySql).toMatch(/function public\.service_repair_historical_project_storage\(\)/i);
    expect(hierarchySql).toMatch(/from storage\.objects object/i);
    expect(hierarchySql).toMatch(/object\.metadata ->> 'size'/i);
    expect(hierarchySql).toMatch(/left join public\.project_storage_files registered/i);
    expect(hierarchySql).toMatch(/registered\.id is null/i);
    expect(hierarchySql).toMatch(/from public\.project_game_assets asset/i);
    expect(hierarchySql).toMatch(/from public\.map_reference_images reference/i);
    expect(hierarchySql).toMatch(/from public\.character_generation_attempts attempt/i);
    expect(hierarchySql).toMatch(/document_media as materialized/i);
    expect(hierarchySql).toMatch(/regexp_matches\([\s\S]*storage\/v1\/object/i);
    expect(hierarchySql).toMatch(/media\.bucket_id = inventory\.bucket_id[\s\S]*media\.object_path = inventory\.object_path/i);
    expect(hierarchySql).not.toMatch(/strpos\(coalesce\(document\.content/i);
    expect(hierarchySql).toMatch(
      /private\.storage_json_media_paths\(value\.value_json\)[\s\S]*inventory\.object_path = media_path\.object_path/i,
    );
    expect(hierarchySql).toMatch(/insert into public\.project_storage_files/i);
    expect(hierarchySql).toMatch(/'document_image', media\.document_id, 1/i);
    expect(hierarchySql).toMatch(/'library_media', asset\.id, 2/i);
    expect(hierarchySql).toMatch(/path\.source_kind, null::uuid, 4/i);
    expect(hierarchySql).toMatch(/on conflict \(bucket_id, object_path\) do nothing/i);
    expect(hierarchySql).toMatch(/insert into public\.project_storage_file_locations/i);
    expect(hierarchySql).toMatch(/current_setting\('keco\.storage_skip_entity_binding', true\) = 'on'/i);
    expect(hierarchySql).toMatch(/set_config\('keco\.storage_skip_entity_binding', 'on', true\)/i);
    expect(hierarchySql).toMatch(/with media_locations as materialized/i);
    expect(hierarchySql).toMatch(/'project_asset'::text as source_kind, asset\.id as source_entity_id,\s*3 as priority/i);
    expect(hierarchySql).toMatch(/'document_image', media\.document_id, 1/i);
    expect(hierarchySql).toMatch(/insert into public\.project_storage_entity_bindings[\s\S]*on conflict \(file_id\) do nothing/i);
    expect(hierarchySql).toMatch(/file\.id = any\(v_imported_ids\)/i);
    expect(hierarchySql).not.toMatch(/v_repair_started_at/i);
    expect(hierarchySql).not.toMatch(
      /perform private\.storage_refresh_file_entity_binding\(file\.id\)[\s\S]*from public\.project_storage_files file/i,
    );
    expect(hierarchySql).toMatch(/service_rebuild_account_storage_quota_totals\(\)/i);
    expect(hierarchySql).toMatch(/'importedFiles', v_imported/i);
    expect(hierarchySql).toMatch(
      /grant execute on function public\.service_repair_historical_project_storage\(\)[\s\S]*to service_role/i,
    );
    const schemaOnlySql = hierarchySql.replace(
      /create or replace function public\.service_repair_historical_project_storage\(\)[\s\S]*?\n\$\$;/i,
      '',
    );
    expect(schemaOnlySql).not.toMatch(
      /\b(?:select(?:\s+\*)?\s+(?:from\s+)?|perform\s+)public\.service_repair_historical_project_storage\s*\(\s*\)\s*;/i,
    );
  });

  it('returns direct directory entries with recursive folder totals and breadcrumbs', () => {
    expect(hierarchySql).toMatch(/create function private\.storage_project_hierarchy_entities_v5\(p_project_id uuid\)/i);
    expect(hierarchySql).toMatch(/create function private\.storage_project_directory_entries_v5\(/i);
    expect(hierarchySql).toMatch(/with recursive entities as/i);
    expect(hierarchySql).toMatch(/folder_tree as[\s\S]*child\.parent_folder_id = tree\.descendant_id/i);
    expect(hierarchySql).toMatch(/entity\.folder_id = tree\.descendant_id/i);
    expect(hierarchySql).toMatch(/folder\.parent_folder_id is not distinct from p_parent_folder_id/i);
    expect(hierarchySql).toMatch(/entity\.entity_kind = 'assets' and p_parent_folder_id is null/i);
    expect(hierarchySql).toMatch(/p_parent_folder_id uuid default null/i);
    expect(hierarchySql).toMatch(/detail = 'STORAGE_FOLDER_NOT_FOUND'/i);
    expect(hierarchySql).toMatch(/with recursive ancestors as/i);
    expect(hierarchySql).toMatch(/'breadcrumb', v_breadcrumb/i);
    expect(hierarchySql).toMatch(/'parentFolderId', page\.parent_folder_id/i);
  });

  it('uses workspace existence for one root Assets row and counts created entries', () => {
    expect(hierarchySql).toMatch(/project\.assets_workspace_enabled/i);
    expect(hierarchySql).toMatch(/coalesce\(physical_totals\.size_bytes, 0\)::bigint/i);
    expect(hierarchySql).toMatch(/project\.assets_workspace_enabled[\s\S]*or physical_totals\.entity_id is not null/i);
    expect(hierarchySql).toMatch(/update public\.projects project[\s\S]*set assets_workspace_enabled = true/i);
    expect(hierarchySql).toMatch(/function private\.storage_activate_assets_workspace_from_file\(\)/i);
    expect(hierarchySql).toMatch(/trg_activate_assets_workspace_from_storage_file/i);
    expect(hierarchySql).toMatch(
      /drop trigger if exists trg_activate_assets_workspace_from_storage_file[\s\S]*create trigger trg_activate_assets_workspace_from_storage_file/i,
    );
    expect(hierarchySql).toMatch(/source_kind in \('project_asset', 'map_reference', 'map_asset', 'character_asset'\)/i);
    expect(hierarchySql).toMatch(
      /'fileCount',[\s\S]*count\(\*\) from public\.folders folder[\s\S]*count\(\*\) from private\.storage_project_hierarchy_entities_v5/i,
    );
    expect(hierarchySql).toMatch(
      /revoke all on function private\.storage_project_hierarchy_entities_v5\(uuid\)[\s\S]*from public, anon, authenticated, service_role/i,
    );
    expect(hierarchySql).toMatch(
      /revoke all on function private\.storage_project_directory_entries_v5\(uuid, uuid\)[\s\S]*from public, anon, authenticated, service_role/i,
    );
    expect(hierarchySql).toMatch(
      /grant execute on function public\.account_storage_project_entities_v5\(uuid, text, text, integer, integer, uuid\)[\s\S]*to authenticated/i,
    );
    expect(hierarchySql).toMatch(
      /grant execute on function public\.account_storage_summary_v5\(\)[\s\S]*to authenticated/i,
    );
    expect(hierarchySql).not.toMatch(/create or replace function private\.storage_project_hierarchy_entities\(/i);
    expect(hierarchySql).not.toMatch(/create or replace function private\.storage_project_directory_entries\(/i);
    expect(hierarchySql).not.toMatch(/create or replace function public\.account_storage_project_entities_v2\(/i);
    expect(hierarchySql).not.toMatch(/create or replace function public\.account_storage_summary_v2\(/i);
    expect(hierarchySql).not.toMatch(/create or replace function private\.storage_project_hierarchy_entities_v2\(/i);
    expect(hierarchySql).not.toMatch(/create or replace function private\.storage_project_directory_entries_v2\(/i);
    expect(hierarchySql).not.toMatch(/create or replace function public\.account_storage_project_entities_v3\(/i);
    expect(hierarchySql).not.toMatch(/create or replace function public\.account_storage_summary_v3\(\)/i);
    expect(hierarchySql).not.toMatch(/function private\.storage_project_hierarchy_entities_v3\(/i);
    expect(hierarchySql).not.toMatch(/function private\.storage_project_directory_entries_v3\(/i);
    expect(hierarchySql).not.toMatch(/function public\.account_storage_project_entities_v4\(/i);
    expect(hierarchySql).not.toMatch(/function public\.account_storage_summary_v4\(\)/i);
    expect(hierarchySql).not.toMatch(/drop function if exists public\.account_storage_project_entities/i);
    expect(hierarchySql).not.toMatch(/create or replace function private\.storage_project_entities\(/i);
    expect(hierarchySql).not.toMatch(/create or replace function public\.account_storage_summary\(\)/i);
  });

  it('adds v3 compatibility wrappers for fresh-v5 and all older implementations', () => {
    expect(v3CompatibilitySql).toMatch(
      /to_regprocedure\([\s\S]*account_storage_project_entities_v3\(uuid,text,text,integer,integer,uuid\)[\s\S]*\) is null/i,
    );
    expect(v3CompatibilitySql).toMatch(
      /to_regprocedure\([\s\S]*account_storage_summary_v3\(\)[\s\S]*\) is null/i,
    );
    expect(v3CompatibilitySql).toMatch(
      /create function public\.account_storage_project_entities_v3\([\s\S]*select public\.account_storage_project_entities_v2\(/i,
    );
    expect(v3CompatibilitySql).toMatch(
      /to_regprocedure\([\s\S]*account_storage_project_entities\(uuid,text,text,integer,integer,uuid\)[\s\S]*\) is not null/i,
    );
    expect(v3CompatibilitySql).toMatch(
      /create function public\.account_storage_project_entities_v3\([\s\S]*select public\.account_storage_project_entities\(/i,
    );
    expect(v3CompatibilitySql).toMatch(
      /create function public\.account_storage_project_entities_v3\([\s\S]*select public\.account_storage_project_entities_v5\(/i,
    );
    expect(v3CompatibilitySql).toMatch(
      /create function public\.account_storage_project_entities_v3\([\s\S]*select public\.account_storage_project_entities_v4\(/i,
    );
    expect(v3CompatibilitySql).toMatch(
      /create function public\.account_storage_summary_v3\(\)[\s\S]*select public\.account_storage_summary_v2\(\)/i,
    );
    expect(v3CompatibilitySql).toMatch(
      /to_regprocedure\([\s\S]*account_storage_summary\(\)[\s\S]*\) is not null/i,
    );
    expect(v3CompatibilitySql).toMatch(
      /create function public\.account_storage_summary_v3\(\)[\s\S]*select public\.account_storage_summary\(\)/i,
    );
    expect(v3CompatibilitySql).toMatch(
      /create function public\.account_storage_summary_v3\(\)[\s\S]*select public\.account_storage_summary_v5\(\)/i,
    );
    expect(v3CompatibilitySql).toMatch(
      /create function public\.account_storage_summary_v3\(\)[\s\S]*select public\.account_storage_summary_v4\(\)/i,
    );
    expect(v3CompatibilitySql).not.toMatch(/create or replace function/i);
    expect(v3CompatibilitySql.trimEnd()).toMatch(/end;\s*\$migration\$;$/i);
    expect(v3CompatibilitySql).toMatch(
      /revoke all on function public\.account_storage_project_entities_v3\([\s\S]*from public, anon, authenticated, service_role/i,
    );
    expect(v3CompatibilitySql).toMatch(
      /grant execute on function public\.account_storage_project_entities_v3\([\s\S]*to authenticated/i,
    );
    expect(v3CompatibilitySql).toMatch(
      /revoke all on function public\.account_storage_summary_v3\(\)[\s\S]*from public, anon, authenticated, service_role/i,
    );
    expect(v3CompatibilitySql).toMatch(
      /grant execute on function public\.account_storage_summary_v3\(\)[\s\S]*to authenticated/i,
    );
  });

  it('adds v4 compatibility wrappers for fresh-v5 and older-v3 databases', () => {
    expect(v4CompatibilitySql).toMatch(
      /to_regprocedure\([\s\S]*account_storage_project_entities_v4\(uuid,text,text,integer,integer,uuid\)[\s\S]*\) is null/i,
    );
    expect(v4CompatibilitySql).toMatch(
      /to_regprocedure\([\s\S]*account_storage_summary_v4\(\)[\s\S]*\) is null/i,
    );
    expect(v4CompatibilitySql).toMatch(
      /create function public\.account_storage_project_entities_v4\([\s\S]*select public\.account_storage_project_entities_v5\(/i,
    );
    expect(v4CompatibilitySql).toMatch(
      /create function public\.account_storage_project_entities_v4\([\s\S]*select public\.account_storage_project_entities_v3\(/i,
    );
    expect(v4CompatibilitySql).toMatch(
      /create function public\.account_storage_summary_v4\(\)[\s\S]*select public\.account_storage_summary_v5\(\)/i,
    );
    expect(v4CompatibilitySql).toMatch(
      /create function public\.account_storage_summary_v4\(\)[\s\S]*select public\.account_storage_summary_v3\(\)/i,
    );
    expect(v4CompatibilitySql).not.toMatch(/create or replace function/i);
    expect(v4CompatibilitySql.trimEnd()).toMatch(/end;\s*\$migration\$;$/i);
    expect(v4CompatibilitySql).toMatch(
      /revoke all on function public\.account_storage_project_entities_v4\([\s\S]*from public, anon, authenticated, service_role/i,
    );
    expect(v4CompatibilitySql).toMatch(
      /grant execute on function public\.account_storage_project_entities_v4\([\s\S]*to authenticated/i,
    );
    expect(v4CompatibilitySql).toMatch(
      /revoke all on function public\.account_storage_summary_v4\(\)[\s\S]*from public, anon, authenticated, service_role/i,
    );
    expect(v4CompatibilitySql).toMatch(
      /grant execute on function public\.account_storage_summary_v4\(\)[\s\S]*to authenticated/i,
    );
  });

  it('adds lock-safe user-visible storage reads without replacing deployed functions', () => {
    expect(visibleStorageSql).toMatch(
      /function private\.storage_project_visible_physical_files_v6\(p_project_id uuid\)/i,
    );
    expect(visibleStorageSql).toMatch(/physical\.entity_kind in \('table', 'document'\)/i);
    for (const table of [
      'project_game_assets',
      'map_reference_images',
      'map_assets',
      'character_generation_attempts',
    ]) {
      expect(visibleStorageSql).toMatch(new RegExp(`from public\\.${table}`, 'i'));
    }
    expect(visibleStorageSql).toMatch(/asset\.storage_path = file\.object_path/i);
    expect(visibleStorageSql).toMatch(/reference\.storage_path = file\.object_path/i);
    expect(visibleStorageSql).toMatch(/map_asset\.storage_path = file\.object_path/i);
    expect(visibleStorageSql).toMatch(/attempt\.storage_path = file\.object_path/i);
    expect(visibleStorageSql).toMatch(/function private\.storage_project_hierarchy_entities_v6/i);
    expect(visibleStorageSql).toMatch(/function private\.storage_project_directory_entries_v6/i);
    expect(visibleStorageSql).toMatch(/function public\.account_storage_project_entities_v6/i);
    expect(visibleStorageSql).toMatch(/function public\.account_storage_entity_details_v6/i);
    expect(visibleStorageSql).toMatch(/function public\.account_storage_summary_v6/i);
    expect(visibleStorageSql).toMatch(
      /v_physical_used := private\.storage_owner_visible_physical_bytes_v6\(v_actor\)/i,
    );
    expect(visibleStorageSql).not.toMatch(/create or replace function/i);
  });

  it('uses visible bytes for versioned quota checks and restores the raw ledger', () => {
    expect(visibleStorageSql).toMatch(
      /function private\.storage_set_quota_check_bytes_v2\([\s\S]*p_user_visible boolean/i,
    );
    expect(visibleStorageSql).toMatch(
      /if p_user_visible then[\s\S]*storage_owner_visible_physical_bytes_v6\(p_owner_id\)[\s\S]*else[\s\S]*storage_owner_raw_physical_bytes_v6\(p_owner_id\)/i,
    );
    expect(visibleStorageSql).toMatch(
      /function public\.storage_reserve_project_storage_upload_v2\([\s\S]*pg_advisory_xact_lock_shared\([\s\S]*storage_set_quota_check_bytes_v2\(v_owner_id, true\)[\s\S]*storage_reserve_project_storage_upload\([\s\S]*storage_set_quota_check_bytes_v2\(v_owner_id, false\)/i,
    );
    expect(visibleStorageSql).toMatch(
      /function public\.storage_finalize_project_storage_upload_v2\([\s\S]*pg_advisory_xact_lock_shared\([\s\S]*storage_set_quota_check_bytes_v2\(v_owner_id, true\)[\s\S]*storage_finalize_project_storage_upload\([\s\S]*storage_set_quota_check_bytes_v2\(v_owner_id, false\)/i,
    );
    expect(visibleStorageSql).toMatch(
      /function public\.complete_project_game_asset_storage_upload_v2\([\s\S]*pg_advisory_xact_lock_shared\([\s\S]*storage_set_quota_check_bytes_v2\(v_owner_id, true\)[\s\S]*complete_project_game_asset_storage_upload\([\s\S]*storage_set_quota_check_bytes_v2\(v_owner_id, false\)/i,
    );
    expect(visibleStorageSql).toMatch(
      /grant execute on function public\.reserve_project_storage_upload_v2[\s\S]*to authenticated/i,
    );
    expect(visibleStorageSql).toMatch(
      /grant execute on function public\.service_reserve_project_storage_upload_v2[\s\S]*to service_role/i,
    );
  });
});
