import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const migration = readFileSync(
  path.join(
    process.cwd(),
    'supabase/migrations/20260907120000_document_chunked_update_upload.sql'
  ),
  'utf8'
);

describe('document chunked update upload migration', () => {
  it('creates private manifest and chunk tables with bounded immutable data', () => {
    expect(migration).toContain('create table public.document_yjs_update_uploads');
    expect(migration).toContain('create table public.document_yjs_update_upload_chunks');
    expect(migration).toMatch(/total_bytes between 262145 and 8388608/i);
    expect(migration).toMatch(/chunk_count between 2 and 64/i);
    expect(migration).toContain("sha256 ~ '^[0-9a-f]{64}$'");
    expect(migration).toMatch(/chunk_count = \(\(total_bytes \+ 131071\) \/ 131072\)/i);
    expect(migration).toMatch(/\(status = 'committed'\) = \(expires_at is null\)/i);
    expect(migration).toMatch(/primary key \(upload_id, chunk_index\)/i);
    expect(migration).toMatch(/on delete cascade/gi);
  });

  it('enables RLS, exposes no policies, and revokes direct authenticated access', () => {
    expect(migration.match(/enable row level security/gi)).toHaveLength(2);
    expect(migration).not.toMatch(/create policy/i);
    expect(migration).toMatch(
      /revoke all on table public\.document_yjs_update_uploads from anon, authenticated/i
    );
    expect(migration).toMatch(
      /revoke all on table public\.document_yjs_update_upload_chunks from anon, authenticated/i
    );
  });

  it('defines fixed-search-path security definer RPCs and least-privilege grants', () => {
    for (const name of [
      'prepare_document_yjs_update_upload',
      'put_document_yjs_update_chunk',
      'get_document_yjs_update_upload_status',
      'finalize_document_yjs_update_upload',
      'cleanup_expired_document_yjs_update_uploads',
    ]) {
      expect(migration).toMatch(
        new RegExp(`function public\\.${name}[\\s\\S]+?security definer[\\s\\S]+?set search_path = ''`, 'i')
      );
    }
    expect(migration).toMatch(/grant execute[^;]+prepare_document_yjs_update_upload[^;]+to authenticated/i);
    expect(migration).toMatch(/grant execute[^;]+cleanup_expired_document_yjs_update_uploads[^;]+to service_role/i);
    expect(migration).not.toMatch(/grant execute[^;]+cleanup_expired_document_yjs_update_uploads[^;]+to authenticated/i);
  });

  it('validates canonical chunk and full payload identities', () => {
    expect(migration).toContain('length(p_chunk_base64) > 174764');
    expect(migration).toContain("pg_catalog.decode(p_chunk_base64, 'base64')");
    expect(migration).toContain("pg_catalog.encode(v_chunk, 'base64')");
    expect(migration).toContain("extensions.digest(v_chunk, 'sha256')");
    expect(migration).toContain("extensions.digest(v_bytes, 'sha256')");
    expect(migration).toMatch(/v_upload\.created_by <> v_user_id/i);
  });

  it('locks state and atomically reconstructs, inserts, commits, and deletes chunks', () => {
    expect(migration.match(/for update/gi)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(migration).toMatch(
      /string_agg\(pg_catalog\.encode\(chunk_data, 'hex'\), '' order by chunk_index\)/i
    );
    expect(migration).toMatch(
      /insert into public\.document_yjs_updates[\s\S]+update public\.document_yjs_update_uploads[\s\S]+status = 'committed'[\s\S]+delete from public\.document_yjs_update_upload_chunks/i
    );
    expect(migration).not.toMatch(/delete from public\.document_yjs_update_uploads[^;]+status = 'committed'/i);
  });

  it('cleans only bounded expired unfinished uploads with skip-locked selection', () => {
    expect(migration).toMatch(/where upload\.status = 'uploading'[\s\S]+upload\.expires_at <= now\(\)/i);
    expect(migration).toMatch(/for update skip locked[\s\S]+limit p_limit/i);
  });
});
