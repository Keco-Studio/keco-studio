import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const migration = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261022020000_library_table_operations.sql'),
  'utf8'
);

describe('library table operation journal migration', () => {
  it('keeps a per-actor, 24-hour operation journal', () => {
    expect(migration).toContain('create table if not exists public.library_table_operations');
    expect(migration).toMatch(/created_by uuid not null references auth\.users\(id\)/i);
    expect(migration).toMatch(/expires_at timestamptz not null default \(now\(\) \+ interval '24 hours'\)/i);
    expect(migration).toContain("state text not null default 'active'");
    expect(migration).toContain("check (state in ('active', 'undone', 'expired'))");
  });

  it('provides permission-checked apply, undo, redo, and expiry RPCs', () => {
    expect(migration).toContain('create or replace function public.apply_library_table_operation');
    expect(migration).toContain('create or replace function public.undo_library_table_operation');
    expect(migration).toContain('create or replace function public.redo_library_table_operation');
    expect(migration).toContain('create or replace function public.expire_library_table_operations');
    expect(migration).toContain('create or replace function public.complete_library_table_operation_media_cleanup');
    expect(migration).toContain('created_by = v_actor');
    expect(migration).toContain("raise exception 'Table operation conflict' using errcode = '40001'");
  });

  it('restricts journal access and leaves expiry cleanup to the service role', () => {
    expect(migration).toContain('alter table public.library_table_operations enable row level security');
    expect(migration).toContain('library_table_operations_select_own');
    expect(migration).toContain('revoke all on function public.expire_library_table_operations(integer) from public');
    expect(migration).toContain('grant execute on function public.expire_library_table_operations(integer) to service_role');
    expect(migration).toContain('grant execute on function public.complete_library_table_operation_media_cleanup(jsonb) to service_role');
  });
});
