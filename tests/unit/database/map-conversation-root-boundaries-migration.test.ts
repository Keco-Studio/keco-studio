import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20261029130000_map_conversation_root_boundaries.sql',
);

describe('Map conversation root boundary migration', () => {
  it('defines one root Map project per conversation and splits legacy GDD roots', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';

    expect(migration).toContain('add column if not exists root_map_project_id');
    expect(migration).toContain('drop index if exists public.map_conversations_gdd_generation_job_idx');
    expect(migration).toContain('map_conversations_root_map_project_idx');
    expect(migration).toContain('map_conversation_one_root_plan_idx');
    expect(migration).toContain('root_map_project_id = v_artifact.map_project_id');
    expect(migration).toContain('parent_plan_node_id is null');
    expect(migration).toContain('row_number() over');
    expect(migration).toContain('disable trigger map_conversation_nodes_immutable');
    expect(migration).toContain('enable trigger map_conversation_nodes_immutable');
  });

  it('updates every root creation path and makes the root identity required', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';

    expect(migration).toContain('create or replace function public.create_map_conversation_plan_v1');
    expect(migration).toContain('create or replace function public.ensure_gdd_map_artifact_conversation_v1');
    expect(migration).toContain('create or replace function public.attach_map_conversation_plan_to_agent_v1');
    expect(migration).toMatch(/alter column root_map_project_id set not null/i);
  });

  it('coalesces duplicate legacy root snapshots before enforcing root uniqueness', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, 'utf8') : '';
    const deduplication = migration.indexOf('map_conversation_duplicate_root_targets');
    const uniqueRootIndex = migration.indexOf('create unique index map_conversations_root_map_project_idx');

    expect(deduplication).toBeGreaterThan(-1);
    expect(uniqueRootIndex).toBeGreaterThan(deduplication);
    expect(migration).toMatch(
      /partition by\s+node\.map_project_id,\s*node\.map_plan_version_id/i,
    );
    expect(migration).toContain('duplicate root Plan with Map children cannot be coalesced');
    expect(migration).toContain('map_conversation_staged_message_numbers');
  });
});
