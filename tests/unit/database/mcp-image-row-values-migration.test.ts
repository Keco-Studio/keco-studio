import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.resolve(
  __dirname,
  '../../../supabase/migrations/20260730120000_allow_local_mcp_image_urls.sql'
);

describe('MCP image row value migration', () => {
  it('allows verified project-scoped image metadata while retaining unsupported-type guards', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/p_field\.data_type = 'image'/i);
    expect(sql).toMatch(/jsonb_object_keys\(p_value\)/i);
    expect(sql).toMatch(/url[\s\S]*path[\s\S]*fileName[\s\S]*fileSize[\s\S]*fileType[\s\S]*uploadedAt/i);
    expect(sql).toMatch(/auth\.uid\(\)::text[\s\S]*p_project_id::text/i);
    expect(sql).toMatch(/bucket_id = 'library-media-files'/i);
    expect(sql).toMatch(/metadata ->> 'size'/i);
    expect(sql).toMatch(/metadata ->> 'mimetype'/i);
    expect(sql).toMatch(/http:\/\/\(127\\\.0\\\.0\\\.1\|localhost\)/i);
    expect(sql).toMatch(/'formula'[\s\S]*'file'[\s\S]*'multimedia'[\s\S]*'audio'[\s\S]*'media'/i);
  });
});
