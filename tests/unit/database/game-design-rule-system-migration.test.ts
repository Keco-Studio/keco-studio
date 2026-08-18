import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260814020000_game_design_rule_system.sql'), 'utf8');
const inheritanceSql = readFileSync(join(process.cwd(), 'supabase/migrations/20260814023000_game_design_system_cross_inheritance.sql'), 'utf8');
const hardeningPath = join(process.cwd(), 'supabase/migrations/20260814024000_game_design_system_security_hardening.sql');
const hardeningSql = existsSync(hardeningPath) ? readFileSync(hardeningPath, 'utf8') : '';
const legacyRepairPath = join(process.cwd(), 'supabase/migrations/20260814025000_game_design_system_legacy_repair.sql');
const legacyRepairSql = existsSync(legacyRepairPath) ? readFileSync(legacyRepairPath, 'utf8') : '';
const recoveryPath = join(process.cwd(), 'supabase/migrations/20260814026000_game_design_system_exhausted_job_recovery.sql');
const recoverySql = existsSync(recoveryPath) ? readFileSync(recoveryPath, 'utf8') : '';
const snapshotRepairPath = join(process.cwd(), 'supabase/migrations/20260814027000_game_design_system_legacy_snapshot_repair.sql');
const snapshotRepairSql = existsSync(snapshotRepairPath) ? readFileSync(snapshotRepairPath, 'utf8') : '';
const snapshotSecurityPath = join(process.cwd(), 'supabase/migrations/20260814028000_game_design_system_snapshot_security.sql');
const snapshotSecuritySql = existsSync(snapshotSecurityPath) ? readFileSync(snapshotSecurityPath, 'utf8') : '';
const atomicVersionPath = join(process.cwd(), 'supabase/migrations/20260814029000_game_design_system_atomic_version_output.sql');
const atomicVersionSql = existsSync(atomicVersionPath) ? readFileSync(atomicVersionPath, 'utf8') : '';
const atomicRepairPath = join(process.cwd(), 'supabase/migrations/20260814030000_game_design_system_atomic_version_repairs.sql');
const atomicRepairSql = existsSync(atomicRepairPath) ? readFileSync(atomicRepairPath, 'utf8') : '';
const artStylePath = join(process.cwd(), 'supabase/migrations/20260817140000_game_design_system_art_style.sql');
const artStyleSql = existsSync(artStylePath) ? readFileSync(artStylePath, 'utf8') : '';
const versionCasPath = join(process.cwd(), 'supabase/migrations/20260818190000_game_design_system_version_cas.sql');
const versionCasSql = existsSync(versionCasPath) ? readFileSync(versionCasPath, 'utf8') : '';

describe('Game Design Rule System migration contract', () => {
  it('creates immutable versions and pins project bindings', () => {
    expect(sql).toContain('create table public.game_design_system_versions');
    expect(sql).toMatch(/unique\s*\(system_id, version_number\)/i);
    expect(sql).toContain('prevent_game_design_system_version_update');
    expect(sql).toMatch(/add column version_id uuid/i);
    expect(sql).toMatch(/version_id uuid not null|alter column version_id set not null/i);
  });

  it('adds idempotency, leases, attempts, and atomic skip-locked claiming', () => {
    expect(sql).toContain('idempotency_key');
    expect(sql).toContain('input_hash');
    expect(sql).toContain('attempt_count');
    expect(sql).toContain('lease_expires_at');
    expect(sql).toContain('claim_game_design_system_generation_job');
    expect(sql).toMatch(/for update skip locked/i);
    expect(sql).toContain('heartbeat_game_design_system_generation_job');
    expect(sql).toContain('retry_game_design_system_generation_job');
  });

  it('restricts job RPCs to service role and project binding to owner/admin', () => {
    expect(sql).toMatch(/grant execute on function public\.claim_game_design_system_generation_job[\s\S]*to service_role/i);
    expect(sql).toContain('is_project_owner_or_admin');
    expect(sql).not.toMatch(/project_game_design_systems_(?:insert|update|delete)_policy[\s\S]{0,500}is_editor_or_admin_collaborator/i);
  });

  it('allows one readable external parent without allowing arbitrary private inheritance', () => {
    expect(inheritanceSql).toContain("v_parent_system_source <> 'official'");
    expect(inheritanceSql).toContain('v_parent_system_owner_id <> v_actor');
    expect(inheritanceSql).toMatch(/p_parent_version_id[\s\S]*game_design_system_versions[\s\S]*game_design_systems/i);
  });

  it('blocks authenticated direct writes to jobs, versions, and protected system columns', () => {
    expect(hardeningSql).toMatch(/revoke insert on public\.game_design_system_generation_jobs from authenticated/i);
    expect(hardeningSql).toMatch(/drop policy if exists game_design_system_generation_jobs_insert_policy/i);
    expect(hardeningSql).toMatch(/revoke insert on public\.game_design_system_versions from authenticated/i);
    expect(hardeningSql).toMatch(/drop policy if exists game_design_system_versions_insert_policy/i);
    expect(hardeningSql).toMatch(/revoke execute on function public\.create_game_design_system_version[\s\S]*from authenticated/i);
    expect(hardeningSql).toMatch(/revoke insert, update on public\.game_design_systems from authenticated/i);
    expect(hardeningSql).toMatch(/grant update \(title, summary, status\) on public\.game_design_systems to authenticated/i);
  });

  it('requires project binding audit identity to match the authenticated actor', () => {
    expect(hardeningSql).toMatch(/project_game_design_systems_insert_policy[\s\S]*applied_by = \(select auth\.uid\(\)\)/i);
    expect(hardeningSql).toMatch(/project_game_design_systems_update_policy[\s\S]*applied_by = \(select auth\.uid\(\)\)/i);
  });

  it('repairs legacy rows from their principles and anti-pattern sections', () => {
    expect(legacyRepairSql).toContain('regexp_split_to_table');
    expect(legacyRepairSql).toMatch(/Design Principles/i);
    expect(legacyRepairSql).toMatch(/Anti-patterns/i);
    expect(legacyRepairSql).toMatch(/set rules = migrated\.rules/i);
    expect(legacyRepairSql).toMatch(/rendered_markdown = public\.render_legacy_game_design_rule_set/i);
    expect(legacyRepairSql).toMatch(/digest\(convert_to\(migrated\.rules::text/i);
    expect(legacyRepairSql).toMatch(/'excerpt', left\(migrated\.original_markdown, 20000\)/i);
    expect(legacyRepairSql).not.toMatch(/set migration_status =[\s\S]{0,500}\bbody\s*=/i);
  });

  it('marks unconvertible legacy rows and prevents them from being bound', () => {
    expect(legacyRepairSql).toMatch(/migration_status = case[\s\S]*then 'needs_migration'/i);
    expect(legacyRepairSql).toMatch(/system\.migration_status = 'ready'/i);
    expect(legacyRepairSql).toMatch(/Version does not belong to system, has unresolved conflicts, or needs migration/i);
    expect(legacyRepairSql).toMatch(/delete from public\.project_game_design_systems[\s\S]*migration_status = 'needs_migration'/i);
  });

  it('bounds and validates compatibility rules before marking them ready', () => {
    expect(legacyRepairSql).toMatch(/count\(\*\) from identified\) between 1 and 80/i);
    expect(legacyRepairSql).toContain('legacy-\' || replace(prepared.kind, \'_\', \'-\')');
    expect(legacyRepairSql).toMatch(/character_length\(btrim\(item\.value\)\) > 80/i);
    expect(legacyRepairSql).toMatch(/character_length\(btrim\(item\.value\)\) > 120/i);
    expect(legacyRepairSql).toMatch(/octet_length\(built\.rules::text\) <= 65536/i);
  });

  it('fails an expired final-attempt lease before claiming more work', () => {
    expect(recoverySql).toMatch(/update public\.game_design_system_generation_jobs[\s\S]*attempt_count >= max_attempts/i);
    expect(recoverySql).toMatch(/status = 'failed'[\s\S]*phase = 'failed'/i);
    expect(recoverySql).toMatch(/lease_expires_at < now\(\)/i);
    expect(recoverySql.indexOf("status = 'failed'")).toBeLessThan(recoverySql.indexOf('for update skip locked'));
  });

  it('backfills a bounded legacy excerpt when an earlier local migration omitted it', () => {
    expect(snapshotRepairSql).toMatch(/snapshot ->> 'kind' = 'legacy_markdown'/i);
    expect(snapshotRepairSql).toMatch(/snapshot ->> 'excerpt' is null/i);
    expect(snapshotRepairSql).toMatch(/'excerpt', left\(system\.body, 20000\)/i);
    expect(snapshotRepairSql).toMatch(/disable trigger prevent_game_design_system_version_update/i);
  });

  it('denies authenticated direct reads of source snapshot excerpts', () => {
    expect(snapshotSecuritySql).toMatch(/revoke select on public\.game_design_system_versions from authenticated/i);
    expect(snapshotSecuritySql).toMatch(/grant select \([\s\S]*rules[\s\S]*rendered_markdown[\s\S]*\) on public\.game_design_system_versions to authenticated/i);
    expect(snapshotSecuritySql).not.toMatch(/grant select \([\s\S]*source_snapshots[\s\S]*\) on public\.game_design_system_versions to authenticated/i);
  });

  it('atomically assigns projection versions and deduplicates generation output', () => {
    expect(atomicVersionSql).toMatch(/generation_job_id uuid/i);
    expect(atomicVersionSql).toMatch(/unique[\s\S]*generation_job_id|create unique index[\s\S]*generation_job_id/i);
    expect(atomicVersionSql).toContain('__GDS_VERSION__');
    expect(atomicVersionSql).toMatch(/replace\([\s\S]*v_version_number/i);
    expect(atomicVersionSql).toMatch(/where generation_job_id = p_generation_job_id/i);
  });

  it('keeps searchable system metadata aligned with the current rules', () => {
    expect(atomicVersionSql).toMatch(/genres\s*=\s*array/i);
    expect(atomicVersionSql).toMatch(/philosophies\s*=\s*array/i);
    expect(atomicVersionSql).toMatch(/suitable_for\s*=\s*p_rules\s*->>\s*'suitableFor'/i);
  });

  it('qualifies pgcrypto hashing for Supabase extension schemas', () => {
    for (const migration of [sql, legacyRepairSql]) {
      expect(migration).toContain('extensions.digest(');
      expect(migration).not.toMatch(/(?<![.\w])digest\(/i);
    }
  });

  it('repairs version projection without rewriting user content', () => {
    expect(atomicRepairSql).toContain('> Version: __KECO_ATOMIC_VERSION_LINE__');
    expect(atomicRepairSql).toMatch(/regexp_replace\([\s\S]*\^> Version: __KECO_ATOMIC_VERSION_LINE__\$[\s\S]*v_version_number/i);
    expect(atomicRepairSql).not.toMatch(/(?:^|[^\w])replace\([\s\S]*__KECO_ATOMIC_VERSION_LINE__/i);
  });

  it('preserves immutable generation provenance when deleting jobs', () => {
    expect(atomicRepairSql).toMatch(/foreign key \(generation_job_id\)[\s\S]*on delete restrict/i);
    expect(atomicRepairSql).not.toMatch(/foreign key \(generation_job_id\)[\s\S]*on delete set null/i);
  });

  it('stores a bounded nullable art style snapshot through the atomic version RPC', () => {
    expect(artStyleSql).toMatch(/add column (?:if not exists )?art_style jsonb/i);
    expect(artStyleSql).toMatch(/art_style is null or jsonb_typeof\(art_style\) = 'object'/i);
    expect(artStyleSql).toMatch(/octet_length\(art_style::text\) <= 32768/i);
    expect(artStyleSql).toMatch(/p_art_style jsonb/i);
    expect(artStyleSql).toMatch(/generation_job_id = p_generation_job_id/i);
    expect(artStyleSql).toMatch(/regexp_replace\([\s\S]*__KECO_ATOMIC_VERSION_LINE__/i);
    expect(artStyleSql).toMatch(/insert into public\.game_design_system_versions[\s\S]*art_style/i);
    expect(artStyleSql).toMatch(/grant select \([\s\S]*art_style[\s\S]*\) on public\.game_design_system_versions to authenticated/i);
    expect(artStyleSql).not.toMatch(/grant select \([\s\S]*source_snapshots[\s\S]*\) on public\.game_design_system_versions to authenticated/i);
    expect(artStyleSql).toMatch(/revoke all on function public\.create_game_design_system_version[\s\S]*from public, anon, authenticated/i);
  });

  it('serializes version writes with replay before nullable CAS and a closed RPC signature', () => {
    const oldSignature = /uuid\s*,\s*uuid\s*,\s*jsonb\s*,\s*jsonb\s*,\s*jsonb\s*,\s*text\s*,\s*jsonb\s*,\s*jsonb\s*,\s*jsonb\s*,\s*text\s*,\s*uuid\s*,\s*uuid\s*\)/i;
    const functionBody = versionCasSql.match(/create function public\.create_game_design_system_version\([\s\S]*?\n\$\$;/i)?.[0] ?? '';
    const idempotencyReplay = functionBody.match(/if p_idempotency_key is not null then([\s\S]*?)end if;/i)?.[1] ?? '';

    expect(versionCasSql).toMatch(/add column if not exists idempotency_key uuid/i);
    expect(versionCasSql).toMatch(/create unique index[\s\S]*\(system_id, idempotency_key\)[\s\S]*where idempotency_key is not null/i);
    expect(versionCasSql).toMatch(new RegExp(`revoke all on function public\\.create_game_design_system_version\\([\\s\\S]*${oldSignature.source}[\\s\\S]*from public, anon, authenticated`, 'i'));
    expect(versionCasSql).toMatch(new RegExp(`drop function if exists public\\.create_game_design_system_version\\([\\s\\S]*${oldSignature.source}`, 'i'));
    expect(versionCasSql.match(/create function public\.create_game_design_system_version\(/gi)).toHaveLength(1);
    expect(versionCasSql).toMatch(/p_generation_job_id uuid\s*,\s*p_expected_current_version_id uuid\s*,\s*p_idempotency_key uuid/i);

    const lockAt = functionBody.search(/from public\.game_design_systems[\s\S]*?for update/i);
    const keyAt = functionBody.search(/where system_id = p_system_id[\s\S]*?idempotency_key = p_idempotency_key/i);
    const generationAt = functionBody.search(/where generation_job_id = p_generation_job_id/i);
    const casAt = functionBody.search(/current_version_id is not distinct from p_expected_current_version_id/i);
    const generationReplay = generationAt >= 0 && casAt > generationAt
      ? functionBody.slice(generationAt, casAt)
      : '';
    const parentAt = functionBody.search(/join public\.game_design_systems parent_system/i);
    const insertAt = functionBody.search(/insert into public\.game_design_system_versions/i);
    const updateAt = functionBody.search(/update public\.game_design_systems/i);
    expect([lockAt, keyAt, generationAt, casAt, parentAt, insertAt, updateAt].every((index) => index >= 0)).toBe(true);
    expect(lockAt).toBeLessThan(keyAt);
    expect(keyAt).toBeLessThan(generationAt);
    expect(generationAt).toBeLessThan(casAt);
    expect(casAt).toBeLessThan(parentAt);
    expect(parentAt).toBeLessThan(insertAt);
    expect(insertAt).toBeLessThan(updateAt);

    expect(idempotencyReplay).toMatch(/parent_version_id is not distinct from p_parent_version_id/i);
    expect(idempotencyReplay).toMatch(/content_hash = p_content_hash/i);
    expect(idempotencyReplay).toMatch(/created_by = v_actor/i);
    expect(idempotencyReplay).toContain('IDEMPOTENCY_CONFLICT');
    expect(generationReplay).toMatch(/v_version\.system_id <> p_system_id/i);
    expect(generationReplay).toMatch(/v_system\.generation_job_id is distinct from p_generation_job_id/i);
    expect(generationReplay).toMatch(/return v_version/i);
    expect(generationReplay).not.toMatch(/update public\.(?:game_design_systems|game_design_system_generation_jobs)/i);
    expect(functionBody).toMatch(/raise exception 'VERSION_STALE' using errcode = 'P0001'/i);
    expect(functionBody).toMatch(/insert into public\.game_design_system_versions[\s\S]*idempotency_key[\s\S]*p_idempotency_key/i);

    expect(versionCasSql).toMatch(/revoke all on function public\.create_game_design_system_version\([\s\S]*from public, anon, authenticated/i);
    expect(versionCasSql).toMatch(/grant execute on function public\.create_game_design_system_version\([\s\S]*to service_role/i);
    expect(versionCasSql).not.toMatch(/grant execute on function public\.create_game_design_system_version\([\s\S]*to (?:public|anon|authenticated)/i);
    expect(versionCasSql).toMatch(/notify pgrst, 'reload schema'/i);
  });
});
