import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260917010000_account_project_storage_usage.sql',
);

describe('project storage cleanup outbox migration', () => {
  it('allows detached storage rows while preserving legacy source invariants', () => {
    const detachMigration = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260918010000_allow_pending_storage_cleanup_detach.sql'),
      'utf8',
    );

    expect(detachMigration).toMatch(/drop constraint if exists project_storage_files_check/i);
    expect(detachMigration).toMatch(/add constraint project_storage_files_check check/i);
    expect(detachMigration).toMatch(/project_id\s+is\s+null/i);
    expect(detachMigration).toMatch(/source_kind\s*<>\s*'legacy_unassigned'/i);
  });

  it('marks registered objects pending and snapshots every accounted bucket before deleting the project', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/create function public\.delete_project_and_enqueue_storage_cleanup/i);
    expect(sql).toMatch(/from public\.projects[\s\S]+for update/i);
    expect(sql).toMatch(/set lifecycle_status = 'pending_cleanup'[\s\S]+project_id = p_project_id/i);
    expect(sql).toMatch(/array_agg\(file\.id order by file\.object_path\) as file_ids/i);
    expect(sql).toMatch(/array_agg\(file\.owner_id order by file\.object_path\) as owner_ids/i);
    expect(sql).toMatch(/array_agg\(file\.size_bytes order by file\.object_path\) as file_bytes/i);
    expect(sql).toMatch(/storage_file_ids uuid\[\]/i);
    expect(sql).toMatch(/storage_file_owner_ids uuid\[\]/i);
    expect(sql).toMatch(/storage_file_bytes bigint\[\]/i);
    expect(sql).toMatch(/insert into public\.project_storage_cleanup_jobs[\s\S]+delete from public\.projects/i);
    for (const bucket of ['library-media-files', 'project-assets', 'map-assets', 'character-assets', 'tiptap-images']) {
      expect(sql).toContain(`'${bucket}'`);
    }
  });

  it('settles active or pending registry rows exactly once under an owner quota lock', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/function private\.storage_settle_project_storage_file_deletion/i);
    expect(sql).toMatch(/function public\.settle_project_storage_file_deletion/i);
    expect(sql).toMatch(/function public\.service_settle_project_storage_file_deletion/i);
    expect(sql).toMatch(/file\.lifecycle_status in \('active', 'pending_cleanup'\)/i);
    expect(sql).toMatch(/perform public\.storage_require_writer\(v_file\.project_id, p_actor_id\)/i);
    expect(sql).toMatch(/from storage\.objects object[\s\S]+object\.name = p_object_path/i);
    expect(sql).toMatch(/raise exception 'Storage object still exists'[\s\S]+STORAGE_OBJECT_MISMATCH/i);
    expect(sql).toMatch(/where quota\.owner_id = v_file\.owner_id[\s\S]+for update/i);
    expect(sql).toMatch(/v_quota\.used_bytes < v_file\.size_bytes/i);
    expect(sql).toMatch(/delete from public\.project_storage_files where id = v_file\.id/i);
    expect(sql).toMatch(/'releasedBytes', v_file\.size_bytes, 'reused', false/i);
    expect(sql).toMatch(/'releasedBytes', 0, 'reused', true/i);
    expect(sql).toMatch(/grant execute on function public\.settle_project_storage_file_deletion\(text, text\) to authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.service_settle_project_storage_file_deletion\(text, text\) to service_role/i);
  });

  it('keeps project-scoped media deletion limited to current writers', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/drop policy if exists "Users can delete their own files" on storage\.objects/i);
    expect(sql).toMatch(/create policy library_media_files_owner_delete/i);
    expect(sql).toMatch(/collaborator\.accepted_at is not null/i);
    expect(sql).toMatch(/collaborator\.role in \('admin', 'editor'\)/i);
    expect(sql).toMatch(/create policy tiptap_images_project_delete/i);
    expect(sql).toMatch(/bucket_id = 'tiptap-images'/i);
  });
});
