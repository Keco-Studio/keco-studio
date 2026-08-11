import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const sql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260808020000_create_map_workbench.sql'),
  'utf8'
);

describe('Create Map workbench migration', () => {
  it('creates normalized project, revision, and asset identities with cascades', () => {
    expect(sql).toMatch(/create table public\.map_projects[\s\S]+id uuid primary key default gen_random_uuid\(\)/i);
    expect(sql).toMatch(/project_id uuid not null references public\.projects\(id\) on delete cascade/i);
    expect(sql).toMatch(/create table public\.map_revisions[\s\S]+map_project_id uuid not null references public\.map_projects\(id\) on delete cascade/i);
    expect(sql).toMatch(/create table public\.map_assets[\s\S]+map_revision_id uuid not null references public\.map_revisions\(id\) on delete cascade/i);
    expect(sql).toMatch(/unique \(map_revision_id, asset_key\)/i);
    expect(sql).toMatch(/foreign key \(current_revision_id, id\)[\s\S]+references public\.map_revisions\(id, map_project_id\)/i);
    expect(sql).toMatch(/source_document_id uuid not null references public\.documents\(id\)[\s\S]+on delete no action deferrable initially deferred/i);
  });

  it('stores source tokens and constrains revision and asset states', () => {
    for (const column of ['source_document_id', 'source_document_updated_at', 'source_epoch', 'source_revision']) {
      expect(sql).toMatch(new RegExp(`${column}\\s+`, 'i'));
    }
    expect(sql).toMatch(/schema_version integer not null default 1 check \(schema_version = 1\)/i);
    expect(sql).toMatch(/status in \('draft', 'generating', 'partial', 'ready', 'failed'\)/i);
    expect(sql).toMatch(/status in \('planned', 'queued', 'generating', 'ready', 'failed', 'blocked'\)/i);
    expect(sql).toMatch(/create trigger map_revisions_immutable_payload[\s\S]+prevent_map_revision_payload_mutation/i);
    expect(sql).toMatch(/old\.status <> 'draft'[\s\S]+new\.plan is distinct from old\.plan/i);
    expect(sql).toMatch(/old\.status <> 'draft' and new\.status = 'draft'[\s\S]+published map revision cannot return to draft/i);
  });

  it('uses compare-and-swap for draft saves', () => {
    expect(sql).toMatch(/save_map_draft[\s\S]+p_expected_save_version bigint/i);
    expect(sql).toMatch(/save_version = revision\.save_version \+ 1/i);
    expect(sql).toMatch(/revision\.save_version = p_expected_save_version/i);
    expect(sql).toMatch(/select 'conflict'::text/i);
  });

  it('defines the six atomic RPC return contracts and immutable asset keys', () => {
    expect(sql).toMatch(/create function public\.create_map_project[\s\S]+returns table \(map_id uuid, draft_revision_id uuid, revision_number bigint, save_version bigint\)/i);
    expect(sql).toMatch(/create function public\.save_map_draft[\s\S]+returns table \(status text, save_version bigint\)/i);
    expect(sql).toMatch(/create function public\.fork_map_draft[\s\S]+returns table \(status text, draft_revision_id uuid, revision_number bigint, save_version bigint\)/i);
    expect(sql).toMatch(/create function public\.publish_map_revision[\s\S]+returns table \(status text, published_revision_id uuid, next_draft_revision_id uuid\)/i);
    expect(sql).toMatch(/create function public\.create_map_asset_plan[\s\S]+returns table \(asset_id uuid, status text\)/i);
    expect(sql).toMatch(/create function public\.transition_map_asset[\s\S]+returns table \(asset_id uuid, status text, attempt_count integer\)/i);
    const transition = sql.slice(sql.indexOf('create function public.transition_map_asset'));
    expect(transition).not.toMatch(/set[\s\S]{0,120}asset_key\s*=/i);
    expect(transition).toMatch(/status = 'failed' and p_next_status in \('queued', 'blocked'\)/i);
    expect(transition).toMatch(/bool_or\(asset\.status in \('failed', 'blocked'\)\)/i);
    expect(transition).toMatch(/last_error_code = case when p_next_status in \('failed', 'blocked'\) then p_last_error_code else null end/i);
    expect(transition).toMatch(/select asset\.\*[\s\S]+into v_asset/i);
    expect(transition).toMatch(/where revision\.id = v_asset\.map_revision_id\s+for update of revision/i);
    expect(sql).toMatch(/v_asset\.requested_capability is distinct from p_requested_capability/i);
    expect(sql).toMatch(/v_asset\.reference_asset_ids <> coalesce\(p_reference_asset_ids, '\{\}'::uuid\[\]\)/i);
    expect(sql).toMatch(/v_asset\.reference_hashes <> coalesce\(p_reference_hashes, '\{\}'::text\[\]\)/i);
    expect(sql).not.toMatch(/v_asset\.metadata <> coalesce\(p_metadata/i);
  });

  it('qualifies the revision status in asset transition settlement', () => {
    const transition = sql.slice(sql.indexOf('create function public.transition_map_asset'));
    expect(transition).toMatch(
      /update public\.map_revisions as revision[\s\S]+where revision\.id = v_revision_id and revision\.status <> 'draft'/i
    );
  });

  it('qualifies draft columns that collide with save RPC output names', () => {
    const start = sql.indexOf('create function public.save_map_draft');
    const end = sql.indexOf('create function public.fork_map_draft');
    const saveDraft = sql.slice(start, end);
    expect(saveDraft).toMatch(/update public\.map_revisions as revision/i);
    expect(saveDraft).toMatch(/revision\.status = 'draft'/i);
    expect(saveDraft).toMatch(/revision\.save_version = p_expected_save_version/i);
  });

  it('makes every mutation RPC a locked-down security definer function', () => {
    const functions = [
      'create_map_project',
      'save_map_draft',
      'fork_map_draft',
      'publish_map_revision',
      'create_map_asset_plan',
      'transition_map_asset',
    ];
    for (const name of functions) {
      const block = sql.slice(sql.indexOf(`create function public.${name}`));
      expect(block).toMatch(/security definer\s+set search_path = ''/i);
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\(`, 'i'));
    }
    expect(sql).toMatch(/revoke all on public\.map_projects, public\.map_revisions, public\.map_assets from public, anon, authenticated/i);
    expect(sql).toMatch(/grant select on public\.map_projects, public\.map_revisions, public\.map_assets to authenticated/i);
  });

  it('uses accepted-member reads and writer-only mutation authorization', () => {
    expect(sql.match(/create policy map_(projects|revisions|assets)_select/g)).toHaveLength(3);
    expect(sql).toMatch(/is_accepted_collaborator\([\s\S]+auth\.uid\(\)/i);
    expect(sql).toMatch(/map_require_writer[\s\S]+is_project_owner[\s\S]+is_editor_or_admin_collaborator/i);
    expect(sql).toMatch(/auth\.role\(\) <> 'service_role'/i);
    expect(sql).toMatch(/grant execute on function public\.transition_map_asset[\s\S]+to service_role/i);
  });

  it('creates a private project-scoped PNG bucket with read-only member access', () => {
    expect(sql).toMatch(/values \('map-assets', 'map-assets', false, 20971520, array\['image\/png'\]\)/i);
    expect(sql).toMatch(/create policy map_assets_storage_select[\s\S]+on storage\.objects for select to authenticated/i);
    expect(sql).toMatch(/map\.project_id::text = \(storage\.foldername\(storage\.objects\.name\)\)\[1\]/i);
    expect(sql).toMatch(/asset\.storage_path = storage\.objects\.name/i);
    expect(sql).not.toMatch(/on storage\.objects for (insert|update|delete)[\s\S]+bucket_id = 'map-assets'/i);
    expect(sql).toMatch(/storage_path ~ '[^']*\\\.png\$'/i);
  });
});
