import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pluginRoots = ['keco-claude', 'keco-codex'].map((name) =>
  path.join(root, 'plugins', name)
);
const skillNames = ['keco-manage-game-design-system', 'keco-create-map'];
const gdsTools = [
  'list_game_design_systems',
  'read_game_design_system',
  'read_project_game_design_system',
  'get_game_design_system_generation',
  'create_game_design_system',
  'generate_game_design_system',
  'create_game_design_system_version',
  'set_project_game_design_system',
  'clear_project_game_design_system',
].sort();
const mapTools = [
  'list_maps',
  'read_map',
  'create_map_draft',
  'update_map_draft',
  'prepare_map_generation',
  'start_map_generation',
  'get_map_generation',
  'advance_map_generation',
].sort();

function skillPath(pluginRoot: string, skillName: string): string {
  return path.join(pluginRoot, 'skills', skillName, 'SKILL.md');
}

function read(pathname: string): string {
  return readFileSync(pathname, 'utf8');
}

function mentionedTools(source: string, candidates: string[]): string[] {
  return candidates.filter((name) => source.includes(`\`${name}\``)).sort();
}

describe('Keco GDS and Create Map plugin skills', () => {
  it('ships equivalent GDS and Create Map skills for Claude and Codex', () => {
    for (const pluginRoot of pluginRoots) {
      for (const skillName of skillNames) {
        expect(existsSync(skillPath(pluginRoot, skillName))).toBe(true);
      }
    }

    for (const skillName of skillNames) {
      const [claude, codex] = pluginRoots.map((pluginRoot) => read(skillPath(pluginRoot, skillName)));
      expect(claude).toBe(codex);
    }
  });

  it('keeps both plugin tool sets synchronized with MCP registration', () => {
    const serverSources = [
      'supabase/functions/mcp/gds-tools.ts',
      'supabase/functions/mcp/map-tools.ts',
    ].map((pathname) => read(path.join(root, pathname))).join('\n');
    const registered = new Set(
      [...serverSources.matchAll(/(?:registerTool|register)\(\s*["']([a-z0-9_]+)["']/g)]
        .map((match) => match[1]),
    );

    for (const toolName of [...gdsTools, ...mapTools]) {
      expect(registered.has(toolName)).toBe(true);
    }

    for (const pluginRoot of pluginRoots) {
      expect(mentionedTools(read(skillPath(pluginRoot, skillNames[0])), gdsTools)).toEqual(gdsTools);
      expect(mentionedTools(read(skillPath(pluginRoot, skillNames[1])), mapTools)).toEqual(mapTools);
    }
  });

  it('requires stable GDS mutation, polling, and read-back behavior', () => {
    for (const pluginRoot of pluginRoots) {
      const source = read(skillPath(pluginRoot, skillNames[0]));
      expect(source).toContain('DISCOVER -> READ -> PLAN -> MUTATE -> POLL -> READ_BACK -> REPORT');
      expect(source).toMatch(/stable IDs/i);
      expect(source).toMatch(/idempotency key/i);
      expect(source).toMatch(/stop[\s\S]{0,100}(?:conflict|stale)/i);
      expect(source).toMatch(/never delete/i);
      expect(source).toMatch(/fresh MCP read/i);
    }
  });

  it('requires a separate paid confirmation before map generation', () => {
    for (const pluginRoot of pluginRoots) {
      const source = read(skillPath(pluginRoot, skillNames[1]));
      expect(source).toContain(
        'DISCOVER -> RESOLVE_SOURCE -> CREATE_DRAFT -> REVIEW_PLAN -> PREPARE -> SHOW_FEE_NOTICE -> USER_CONFIRM -> START -> POLL -> READ_BACK -> REPORT',
      );
      expect(source).toMatch(/initial request[\s\S]{0,120}not[\s\S]{0,80}(?:paid )?confirmation/i);
      expect(source).toMatch(/show[\s\S]{0,80}fee notice[\s\S]{0,180}(?:later|subsequent)[\s\S]{0,100}explicit confirmation/i);
      expect(source).toMatch(/confirmation\s+token[\s\S]{0,160}`attemptCount`/i);
      expect(source).toMatch(/never call[\s\S]{0,80}PixelLab directly/i);
      expect(source).toMatch(/tilesets?[\s\S]{0,100}roads?[\s\S]{0,100}buildings?[\s\S]{0,100}props?[\s\S]{0,160}`pixellab-map-assets`/i);
      expect(source).toMatch(/POLL:[\s\S]{0,100}`get_map_generation`/i);
      expect(source).toMatch(/READ_BACK:[\s\S]{0,100}fresh `read_map`/i);
    }
  });

  it('ships a byte-identical, self-contained MCP contract', () => {
    const contracts = pluginRoots.map((pluginRoot) =>
      path.join(pluginRoot, 'references', 'gds-map-mcp-contract.md')
    );
    expect(contracts.every(existsSync)).toBe(true);
    expect(read(contracts[0])).toBe(read(contracts[1]));
    const source = read(contracts[0]);
    expect(mentionedTools(source, gdsTools)).toEqual(gdsTools);
    expect(mentionedTools(source, mapTools)).toEqual(mapTools);
    expect(source).toMatch(/account[\s\S]{0,240}legacy/i);
    expect(source).toMatch(/MAP_CONFIRMATION_REQUIRED/);
    expect(source).toMatch(/confirmation\s+token[\s\S]{0,160}`attemptCount`/i);
    expect(source).toMatch(/ready[\s\S]{0,160}failed[\s\S]{0,160}blocked/i);
  });
});
