import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261023090000_map_conversation_version_library.sql'),
  'utf8',
);
const rootBoundaryMigrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20261029130000_map_conversation_root_boundaries.sql',
);

describe('map conversation version library migration', () => {
  it('creates append-only Plan/Map conversation records and atomic writer RPCs', () => {
    for (const table of ['map_conversations', 'map_conversation_nodes', 'map_conversation_messages', 'map_conversation_requests']) {
      expect(migration).toContain(`create table public.${table}`);
    }
    for (const rpc of ['create_map_conversation_plan_v1', 'attach_map_conversation_output_v1', 'read_map_conversation_v1', 'resolve_map_conversation_node_v1']) {
      expect(migration).toContain(`function public.${rpc}`);
    }
    expect(migration).toMatch(/map conversation records are immutable/i);
    expect(migration).toMatch(/map_require_writer/i);
    expect(migration).toMatch(/save_map_plan_v3/i);
    expect(migration).not.toMatch(/drop table|truncate|delete from public\.map_/i);
  });

  it('enforces one root Plan whose Map project identifies the conversation', () => {
    expect(fs.existsSync(rootBoundaryMigrationPath)).toBe(true);
    const rootBoundaryMigration = fs.existsSync(rootBoundaryMigrationPath)
      ? fs.readFileSync(rootBoundaryMigrationPath, 'utf8')
      : '';
    expect(rootBoundaryMigration).toContain('map_conversation_one_root_plan_idx');
    expect(rootBoundaryMigration).toContain('map_conversations_root_map_project_idx');
    expect(rootBoundaryMigration).toMatch(/root Plan Map project mismatch/i);
  });
});
