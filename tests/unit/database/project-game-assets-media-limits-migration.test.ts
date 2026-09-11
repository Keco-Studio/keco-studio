import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260911110000_project_game_assets_media_limits.sql',
), 'utf8');

const supportedMimeTypes = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'video/mp4',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/json',
  'image/vnd.adobe.photoshop',
];

describe('project game asset media limits migration', () => {
  it('creates a private project-scoped bucket for the expanded contract', () => {
    expect(sql).toMatch(/values \(\s*'project-assets',\s*'project-assets',\s*false,\s*104857600/i);
    expect(sql).toMatch(/create policy project_assets_storage_select[\s\S]+for select to authenticated/i);
    expect(sql).toMatch(/create policy project_assets_storage_insert[\s\S]+for insert to authenticated/i);
    expect(sql.match(/array_length\(storage\.foldername\(storage\.objects\.name\), 1\) = 2/g)).toHaveLength(4);
    // Storage foldername() excludes the leaf filename: user/project/file => [user, project].
    expect(sql).toMatch(/project\.id::text = \(storage\.foldername\(storage\.objects\.name\)\)\[2\]/);
    expect(sql).toMatch(/\(storage\.foldername\(storage\.objects\.name\)\)\[1\] = \(select auth\.uid\(\)\)::text/);
    expect(sql).toMatch(/collaborator\.role in \('admin', 'editor'\)/i);
    expect(sql).toMatch(/add column if not exists storage_bucket text not null default 'library-media-files'/i);
    expect(sql).toMatch(/unique \(storage_bucket, storage_path\)/i);
  });

  it('replaces the registration RPC through a forward migration', () => {
    expect(sql).toMatch(/create or replace function public\.mcp_register_project_game_asset/i);
    expect(sql).toMatch(/#variable_conflict use_column/i);
    expect(sql).toMatch(/from storage\.objects object[\s\S]+object\.bucket_id in \('project-assets', 'library-media-files'\)/i);
    expect(sql).toMatch(/v_storage_bucket = 'library-media-files'[\s\S]+p_file_size > 5242880/i);
    expect(sql).toMatch(/on conflict \(storage_bucket, storage_path\) do nothing/i);
  });

  it('keeps the database MIME contract aligned with project asset uploads', () => {
    for (const mimeType of supportedMimeTypes) {
      expect(sql).toContain(`'${mimeType}'`);
    }
    expect(sql).toMatch(/p_mime_type is null/i);
    expect(sql).toContain("when 'image/jpg' then 'image/jpeg'");
    expect(sql).toContain("when 'audio/x-m4a' then 'audio/mp4'");
  });

  it('enforces validated type-specific size constraints', () => {
    expect(sql).toMatch(/mime_type = 'application\/json' and file_size <= 10485760/i);
    expect(sql).toMatch(/p_mime_type in \([^)]*'application\/json'[^)]*\) and p_file_size > 10485760/i);
    expect(sql).toMatch(/mime_type like 'audio\/%' and file_size <= 52428800/i);
    expect(sql).toMatch(/mime_type = 'video\/mp4' and file_size <= 104857600/i);
    expect(sql).not.toMatch(/not valid/i);
  });
});
