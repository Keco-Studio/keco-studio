import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20261030100000_project_foundation.sql',
);

describe('project Foundation migration', () => {
  it('adds non-null Foundation arrays with a 20-tag database limit', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/add column if not exists genres text\[\] not null default '\{\}'::text\[\]/i);
    expect(sql).toMatch(/add column if not exists design_philosophies text\[\] not null default '\{\}'::text\[\]/i);
    expect(sql).toMatch(/cardinality\(genres\) <= 20/i);
    expect(sql).toMatch(/cardinality\(design_philosophies\) <= 20/i);
  });

  it('creates an admin-only transactional Foundation RPC without replacing legacy RPCs', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/create or replace function public\.create_project_with_foundation/i);
    expect(sql).toMatch(/insert into public\.projects[\s\S]*genres[\s\S]*design_philosophies/i);
    expect(sql).toMatch(/insert into public\.folders[\s\S]*Resources Folder/i);
    expect(sql).toMatch(/insert into public\.project_collaborators[\s\S]*'admin'/i);
    expect(sql).toMatch(/grant execute on function public\.create_project_with_foundation\(text, text, text\[\], text\[\]\) to authenticated/i);
    expect(sql).not.toMatch(/drop function[^;]*create_project_with_default_resource/i);
  });

  it('limits project updates to accepted admins at the RLS boundary', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/create or replace function public\.is_project_admin_collaborator/i);
    expect(sql).toMatch(/role = 'admin'/i);
    expect(sql).toMatch(/accepted_at is not null/i);
    expect(sql).toMatch(/create policy "projects_update_policy"[\s\S]*is_project_admin_collaborator/i);
  });
});
