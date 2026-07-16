import { describe, expect, it } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260716000000_create_documents.sql'
);

describe('documents table + RLS migration (Phase 1)', () => {
  const migration = readFileSync(migrationPath, 'utf8');

  it('creates a documents table with a NOT NULL project_id and Markdown content', () => {
    expect(migration).toContain('create table if not exists public.documents');
    expect(migration).toMatch(/project_id uuid not null references public\.projects\(id\) on delete cascade/i);
    expect(migration).toMatch(/folder_id uuid references public\.folders\(id\) on delete set null/i);
    expect(migration).toMatch(/content text not null default ''/i);
    expect(migration).toMatch(
      /constraint documents_content_size_check\s+check \(pg_catalog\.octet_length\(content\) <= 2097152\)/i
    );
  });

  it('defines project-membership RLS policies for select/insert/update/delete', () => {
    expect(migration).toContain('alter table public.documents enable row level security');
    expect(migration).toContain('documents_select_policy');
    expect(migration).toContain('documents_insert_policy');
    expect(migration).toContain('documents_update_policy');
    expect(migration).toContain('documents_delete_policy');
  });

  it('uses the initPlan-friendly (select auth.uid()) form and membership helpers', () => {
    expect(migration).toContain('(select auth.uid())');
    expect(migration).toContain('public.is_project_owner(project_id, (select auth.uid()))');
    expect(migration).toContain(
      'public.is_accepted_collaborator(project_id, (select auth.uid()))'
    );
    expect(migration).toContain(
      'public.is_editor_or_admin_collaborator(project_id, (select auth.uid()))'
    );
    expect(migration).toMatch(
      /create policy "documents_insert_policy"[\s\S]+created_by = \(select auth\.uid\(\)\)/i
    );
  });

  it('enforces cross-project integrity between folder_id and project_id', () => {
    expect(migration).toContain('enforce_document_folder_project');
    expect(migration).toContain('trg_documents_folder_project');
    expect(migration).toMatch(/before insert or update of folder_id, project_id/i);
  });

  it('never re-adds documents to the realtime publication', () => {
    expect(migration).not.toMatch(/alter publication supabase_realtime add table public\.documents/i);
  });

  it('does NOT drop shared_documents (that is a separate, guarded migration)', () => {
    expect(migration).not.toMatch(/drop table[^;]*shared_documents/i);
  });

  it('keeps every migration timestamp unique', () => {
    const migrationNames = readdirSync(path.join(repoRoot, 'supabase/migrations'))
      .filter((name) => /^\d{14}_.+\.sql$/.test(name));
    const timestamps = migrationNames.map((name) => name.slice(0, 14));

    expect(new Set(timestamps).size).toBe(timestamps.length);
  });
});
