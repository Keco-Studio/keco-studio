import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260915120000_add_project_assets_workspace.sql',
);

describe('project Assets workspace migration', () => {
  it('adds a non-null disabled-by-default flag and backfills every existing asset source', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/alter\s+table\s+public\.projects[\s\S]*add\s+column[\s\S]*assets_workspace_enabled\s+boolean\s+not\s+null\s+default\s+false/i);
    expect(sql).toMatch(/update\s+public\.projects[\s\S]*set\s+assets_workspace_enabled\s+=\s+true/i);
    expect(sql).toMatch(/from\s+public\.project_game_assets/i);
    expect(sql).toMatch(/from\s+public\.character_assets/i);
    expect(sql).toMatch(/from\s+public\.map_projects[\s\S]*join\s+public\.map_revisions[\s\S]*join\s+public\.map_assets/i);
  });
});
