import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260713000000_create_documents_and_drop_shared_documents.sql'
);

describe('documents table + RLS migration (Phase 1)', () => {
  const migration = readFileSync(migrationPath, 'utf8');

  it('creates a documents table with a NOT NULL project_id and Markdown content', () => {
    expect(migration).toContain('create table if not exists public.documents');
    expect(migration).toMatch(/project_id uuid not null references public\.projects\(id\) on delete cascade/i);
    expect(migration).toMatch(/folder_id uuid references public\.folders\(id\) on delete set null/i);
    expect(migration).toMatch(/content text not null default ''/i);
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
  });

  it('drops the dead shared_documents table and never re-adds documents to realtime', () => {
    expect(migration).toContain('drop table if exists public.shared_documents');
    expect(migration).not.toMatch(/alter publication supabase_realtime add table public\.documents/i);
  });
});
