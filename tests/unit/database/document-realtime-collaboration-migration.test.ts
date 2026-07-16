import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260716030000_document_realtime_collaboration.sql'
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : '';

describe('document realtime collaboration migration', () => {
  it('adds the collaboration token and immutable durable update tail', () => {
    expect(migration).toMatch(/add column if not exists yjs_state text/i);
    expect(migration).toMatch(/add column if not exists collab_epoch bigint not null default 0/i);
    expect(migration).toMatch(/add column if not exists collab_revision bigint not null default 0/i);
    expect(migration).toContain('create table public.document_yjs_updates');
    expect(migration).toMatch(/id uuid primary key/i);
    expect(migration).toMatch(/document_id uuid not null references public\.documents\(id\) on delete cascade/i);
    expect(migration).toMatch(/epoch bigint not null/i);
    expect(migration).toMatch(/update_data text not null/i);
    expect(migration).toMatch(/check \(length\(update_data\) > 0\)/i);
  });

  it('uses one tail scan index and never indexes snapshot payloads', () => {
    expect(migration).toMatch(
      /create index document_yjs_updates_document_epoch_created_idx\s+on public\.document_yjs_updates\s*\(document_id, epoch, created_at, id\)/i
    );
    expect(migration).not.toMatch(/create index[^;]+update_data/is);
    expect(migration).not.toMatch(/create index[^;]+yjs_state/is);
    expect(migration).not.toMatch(/create index[^;]+\bcontent\b/is);
  });

  it('makes durable update rows RPC-only and role-scoped for reads', () => {
    expect(migration).toContain('alter table public.document_yjs_updates enable row level security');
    expect(migration).toContain('document_yjs_updates_select_policy');
    expect(migration).not.toContain('document_yjs_updates_insert_policy');
    expect(migration).toMatch(
      /revoke insert, update, delete on table public\.document_yjs_updates\s+from anon, authenticated/i
    );
    expect(migration).not.toMatch(
      /grant[^;]*insert[^;]*document_yjs_updates/i
    );
    expect(migration).not.toMatch(/create policy[^;]+for update/is);
    expect(migration).not.toMatch(/create policy[^;]+for delete/is);
    expect(migration).toContain('(select auth.uid())');
    expect(migration).toContain('public.is_accepted_collaborator');
  });

  it('initializes and compacts through guarded fixed-search-path functions', () => {
    expect(migration).toMatch(/create or replace function public\.initialize_document_collab_state/i);
    expect(migration).toMatch(/create or replace function public\.append_document_yjs_updates/i);
    expect(migration).toMatch(/create or replace function public\.compact_document_collab_state/i);
    expect(migration.match(/security definer\s+set search_path = ''/gi)).toHaveLength(4);
    expect(migration.match(/for update/gi)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(migration).toMatch(/collab_epoch\s*<>\s*p_expected_epoch/i);
    expect(migration).toMatch(/collab_revision\s*<>\s*p_expected_revision/i);
    expect(migration.match(/errcode = 'PT409'/g)?.length ?? 0).toBe(4);
    expect(migration).not.toContain("errcode = '40001'");
    expect(migration).toMatch(/delete from public\.document_yjs_updates[\s\S]+id = any\(p_included_update_ids\)/i);
    expect(migration).toMatch(/epoch = p_expected_epoch/i);
  });

  it('bounds canonical updates, snapshots, and Markdown before mutation', () => {
    expect(migration).toMatch(/jsonb_array_length\(p_updates\)/i);
    expect(migration).toContain('v_update_count < 1 or v_update_count > 100');
    expect(migration).toContain("count(distinct item->>'id')");
    expect(migration).toContain("length(item->>'updateBase64') > 349528");
    expect(migration).toContain('pg_catalog.octet_length(payload.decoded) > 262144');
    expect(migration).toContain("pg_catalog.decode(item->>'updateBase64', 'base64')");
    expect(migration).toContain("pg_catalog.encode(payload.decoded, 'base64')");
    expect(migration).toContain('length(p_yjs_state) > 11184812');
    expect(migration).toContain('pg_catalog.octet_length(v_decoded) > 8388608');
    expect(migration).toContain('pg_catalog.octet_length(p_markdown) > 2097152');
    expect(migration).toMatch(
      /function public\.initialize_document_collab_state[\s\S]+?begin\s+perform public\.assert_document_snapshot_payload\(p_yjs_state, p_markdown\);[\s\S]+?select d\.\*/i
    );
    expect(migration).toMatch(
      /function public\.compact_document_collab_state[\s\S]+?begin\s+perform public\.assert_document_snapshot_payload\(p_yjs_state, p_markdown\);[\s\S]+?select d\.\*/i
    );
  });

  it('removes direct authenticated body updates while retaining metadata updates', () => {
    expect(migration).toMatch(
      /revoke insert on table public\.documents from anon, authenticated/i
    );
    expect(migration).toMatch(
      /grant insert \(project_id, folder_id, name, content, created_by\)\s+on table public\.documents to authenticated/i
    );
    expect(migration).not.toMatch(
      /grant insert[^;]*(yjs_state|collab_epoch|collab_revision)/i
    );
    expect(migration).toMatch(/revoke update on table public\.documents from authenticated/i);
    expect(migration).toMatch(/grant update \(name, folder_id\) on table public\.documents to authenticated/i);
    expect(migration).not.toMatch(/grant update[^;]*(content|yjs_state|collab_epoch|collab_revision)/i);
  });

  it('authorizes exact private document topics with separate receive and send roles', () => {
    expect(migration).toMatch(/create or replace function public\.document_id_from_collab_topic\(p_topic text\)/i);
    expect(migration).toContain("^doc-collab:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
    expect(migration).toContain('document_collab_messages_select_policy');
    expect(migration).toContain('document_collab_messages_insert_policy');
    expect(migration).toMatch(/on realtime\.messages for select/i);
    expect(migration).toMatch(/on realtime\.messages for insert/i);
    expect(migration).toMatch(/select realtime\.topic\(\)/i);
    expect(migration).toMatch(/\bextension\s+in\s+\('broadcast', 'presence'\)/i);
    expect(migration).not.toMatch(/realtime\.extension\(\)/i);
  });

  it('does not add collaboration tables to the Postgres realtime publication', () => {
    expect(migration).not.toMatch(/alter publication supabase_realtime add table/i);
  });
});
