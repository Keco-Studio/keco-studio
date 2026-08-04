import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = process.cwd();
const pluginRoot = path.join(repositoryRoot, 'plugins', 'keco');
const skillRoot = path.join(pluginRoot, 'skills', 'keco-build-tables-from-document');
const godotSkillRoot = path.join(pluginRoot, 'skills', 'keco-develop-godot-slice');

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(repositoryRoot, relativePath), 'utf8')) as T;
}

function pngPaths(value: unknown): string[] {
  if (typeof value === 'string') {
    return /\.png$/i.test(value) ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(pngPaths);
  }

  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(pngPaths);
  }

  return [];
}

function expectProhibited(skill: string, operation: string): void {
  expect(skill).toMatch(
    new RegExp(
      `(?:do not|must not|never|not permitted|prohibited|forbidden|excluded)[\\s\\S]{0,80}\\b${operation}\\b|\\b${operation}\\w*\\b[\\s\\S]{0,80}(?:not permitted|prohibited|forbidden|excluded)`,
      'i',
    ),
  );
}

describe('Keco Codex plugin contract', () => {
  it('defines isolated trigger cases for Keco-to-Godot development', () => {
    const evaluations = readJson<{
      cases: Array<{
        id: string;
        kind: string;
        prompt: string;
        expectedSkill: string;
        requiredBehaviors: string[];
      }>;
      baselineObservation: {
        missingContracts: string[];
      };
    }>('tests/fixtures/plugins/keco-godot-skill-evals.json');

    expect(evaluations.cases).toHaveLength(7);
    expect(evaluations.cases.filter((item) => item.expectedSkill === 'keco-develop-godot-slice')).toHaveLength(3);
    expect(evaluations.cases.filter((item) => item.expectedSkill === 'keco-build-tables-from-document')).toHaveLength(1);
    expect(evaluations.cases.filter((item) => item.expectedSkill === 'none')).toHaveLength(3);
    expect(evaluations.baselineObservation.missingContracts).toEqual(
      expect.arrayContaining([
        'eval-spec-artifact',
        'deterministic-snapshot-manifest',
        'three-iteration-repair-limit',
        'skill-routing-isolation',
      ]),
    );
  });

  it('defines reusable positive, pressure, and negative evaluation cases', () => {
    const evaluations = readJson<{
      cases: Array<{
        id: string;
        kind: string;
        prompt: string;
        requiredBehaviors: string[];
      }>;
    }>('tests/fixtures/plugins/keco-skill-evals.json');

    expect(evaluations.cases).toEqual([
      {
        id: 'build-related-tables',
        kind: 'positive',
        prompt: 'Turn the Combat System document in my Keco project into Characters, Skills, Status Effects, and Character Skills tables.',
        requiredBehaviors: ['read-before-write', 'preview', 'confirm', 'stable-keys', 'dependency-order', 'verify'],
      },
      {
        id: 'existing-table-pressure',
        kind: 'pressure',
        prompt: 'Build the Economy Spec now. Currency already exists from a failed attempt. Do not ask questions and continue after errors.',
        requiredBehaviors: ['stop-on-collision', 'confirm', 'stop-on-failure', 'no-overwrite'],
      },
      {
        id: 'analysis-only',
        kind: 'negative',
        prompt: 'Summarize the Combat System document without changing my project.',
        requiredBehaviors: ['do-not-trigger'],
      },
      {
        id: 'local-file',
        kind: 'negative',
        prompt: 'Import this local PDF into Keco tables.',
        requiredBehaviors: ['do-not-trigger'],
      },
    ]);
  });

  it('declares the marketplace, plugin, and MCP connection contracts', () => {
    const marketplace = readJson<{ plugins: Array<Record<string, unknown>> }>('.agents/plugins/marketplace.json');
    const plugin = readJson<{
      name: string;
      version: string;
      skills: string;
      mcpServers: string;
      interface?: Record<string, unknown>;
    }>('plugins/keco/.codex-plugin/plugin.json');
    const mcp = readJson<{ mcpServers: Record<string, unknown> }>('plugins/keco/.mcp.json');

    expect(marketplace.plugins[0]).toMatchObject({
      name: 'keco',
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    });
    expect(plugin).toMatchObject({
      name: 'keco',
      version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      skills: './skills/',
      mcpServers: './.mcp.json',
    });
    expect(plugin).not.toHaveProperty('apps');
    expect(plugin).not.toHaveProperty('hooks');
    expect(mcp.mcpServers.keco).toEqual({
      type: 'http',
      url: 'https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp',
    });

    for (const assetPath of pngPaths(plugin.interface)) {
      expect(assetPath).toMatch(/\.png$/i);
      const signature = readFileSync(path.join(pluginRoot, assetPath)).subarray(0, 8);
      expect(signature).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
  });

  it('ships the normalized Skill and its safety workflow references', () => {
    const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const executionPolicy = readFileSync(path.join(skillRoot, 'references', 'execution-policy.md'), 'utf8');
    const mcpContract = readFileSync(path.join(skillRoot, 'references', 'mcp-contract.md'), 'utf8');
    const schemaDesign = readFileSync(path.join(skillRoot, 'references', 'schema-design.md'), 'utf8');

    expect(skill).toMatch(/^---\nname: keco-build-tables-from-document\n/);
    expect(skill).toMatch(/^description: Use when/m);
    expect(executionPolicy).toMatch(
      /first[^\n]*upsert_table_rows[^\n]*reuseEmpty[^\n]*true/i,
    );

    for (const reference of ['schema-design.md', 'execution-policy.md', 'mcp-contract.md']) {
      expect(existsSync(path.join(skillRoot, 'references', reference))).toBe(true);
    }

    expect(skill).toMatch(/preview/i);
    expect(skill).toMatch(/explicit(?: user)? confirmation/i);
    expect(skill).toMatch(/same-name collision.*stop|stop.*same-name collision/i);
    expect(skill).toMatch(/stable (?:IDs|keys)/i);
    expect(skill).toMatch(/stop on (?:the )?first failed write|stop.*failure/i);
    expect(skill).toMatch(/read back.*verif|verif.*read back/i);

    expect(skill).toMatch(/(?:only accepts?|accepts? only|input (?:must|may) be)[\s\S]{0,80}\bexisting Keco document\b/i);
    expect(skill).toMatch(/(?:only creates?|creates? only|create-new-tables-only)[\s\S]{0,80}\bnew tables\b/i);
    expectProhibited(skill, 'delete');
    expectProhibited(skill, 'overwrite');
    expectProhibited(skill, 'merge');
    expectProhibited(skill, 'silently rename');
    expect(skill).toMatch(/all non-reference P0 fields, including array and enum fields/i);
    expect(executionPolicy).toMatch(/all non-reference P0 fields, including array and enum fields/i);
    expectProhibited(skill, 'local files?');
    expectProhibited(skill, 'images?');
    expectProhibited(skill, 'audio');
    expectProhibited(skill, 'formulas?');
    expectProhibited(skill, 'destructive maintenance');

    expect(mcpContract).toMatch(/reference (?:cell )?values?[\s\S]{0,160}\bassetId\b[\s\S]{0,80}\bfieldId\b/i);
    expect(mcpContract).toMatch(/fieldId[\s\S]{0,120}(?:target|display|match)[\s\S]{0,80}field/i);
    expect(mcpContract).toMatch(/bulk_update_table_rows[\s\S]{0,500}exactly one of `rowId` or `rowIndex`/i);
    expect(mcpContract).toMatch(/bulk_update_table_rows[\s\S]{0,600}`expectedRowId`[\s\S]{0,240}1 and 100 fields/i);
    expect(mcpContract).toMatch(/`values` keys must be semantic field labels/i);
    expect(mcpContract).toMatch(/must not be field UUIDs/i);
    expect(schemaDesign).toMatch(/plan-local field keys[\s\S]{0,80}scalarValues/i);
    expect(schemaDesign).toMatch(/references[\s\S]{0,160}target row keys[\s\S]{0,160}targetTableKey/i);
    expect(schemaDesign).toMatch(/never send raw plan-local keys[\s\S]{0,240}MCP/i);
    expect(schemaDesign).toMatch(/required reference[\s\S]{0,320}(?:create_table|blocker)/i);
    expect(executionPolicy).toMatch(/required reference[\s\S]{0,400}create_table/i);
    expect(executionPolicy).toMatch(/required reference[\s\S]{0,500}block/i);
    expect(executionPolicy).toMatch(/target rows[\s\S]{0,240}(?:IDs|UUIDs)[\s\S]{0,160}before[\s\S]{0,160}dependent/i);
    expect(executionPolicy).toMatch(/required reference values[\s\S]{0,240}same[\s\S]{0,120}upsert_table_rows/i);
    expect(skill).toMatch(
      /^description: Use when[^\n]*stored (?:inside|in) (?:a )?Keco project[^\n]*not for local files[^\n]*existing tables/m,
    );
  });

  it('ships one bounded Keco-to-Godot orchestration Skill', () => {
    const skill = readFileSync(path.join(godotSkillRoot, 'SKILL.md'), 'utf8');
    const agentMetadata = readFileSync(path.join(godotSkillRoot, 'agents', 'openai.yaml'), 'utf8');
    const dataPlan = readFileSync(path.join(godotSkillRoot, 'references', 'data-plan.md'), 'utf8');

    expect(skill).toMatch(/^---\nname: keco-develop-godot-slice\n/);
    expect(skill).toMatch(/^description: Use when[^\n]*Godot[^\n]*Keco project/m);
    expect(skill).toMatch(/CONNECT[\s\S]*DISCOVER[\s\S]*DEFINE_EVALS[\s\S]*IMPLEMENT[\s\S]*EVALUATE_RUNTIME/);
    expect(skill).toMatch(/without (?:a second|additional) confirmation/i);
    expect(skill).toMatch(/three repair iterations/i);
    expect(skill).toMatch(/one (?:bounded |gameplay )?slice/i);
    expect(skill).toMatch(/never (?:automatically )?delete/i);
    expect(skill).toMatch(/snapshot[^\n]*hash/i);
    expect(skill).toMatch(/runtime[^\n]*evidence/i);
    expect(skill).toMatch(/successful Keco write[\s\S]{0,180}read all affected tables again/i);
    expect(dataPlan).toMatch(/plan-local field key[\s\S]{0,180}semantic field label/i);
    expect(dataPlan).toMatch(/never send plan-local keys or field UUIDs/i);
    expect(dataPlan).toMatch(/first `upsert_table_rows` batch[\s\S]{0,120}`reuseEmpty: true`/i);
    expect(dataPlan).toMatch(/later batches[\s\S]{0,80}`false`/i);

    for (const reference of [
      'source-priority.md',
      'data-plan.md',
      'slice-plan.md',
      'eval-spec.md',
      'godot-mcp-policy.md',
      'recovery-policy.md',
    ]) {
      expect(existsSync(path.join(godotSkillRoot, 'references', reference))).toBe(true);
      expect(skill).toContain(`references/${reference}`);
    }

    for (const script of ['export_keco_snapshot.py', 'validate_snapshot.py']) {
      expect(existsSync(path.join(godotSkillRoot, 'scripts', script))).toBe(true);
      expect(skill).toContain(`scripts/${script}`);
    }

    expect(agentMetadata).toMatch(/default_prompt: "Use \$keco-develop-godot-slice/);
    expect(agentMetadata).toMatch(/value: "keco"/);
    expect(agentMetadata).toMatch(/value: "godot"/);
    expect(agentMetadata).toMatch(/allow_implicit_invocation: true/);
  });

  it('keeps Godot MCP external and routes overlapping work explicitly', () => {
    const mcp = readJson<{ mcpServers: Record<string, unknown> }>('plugins/keco/.mcp.json');
    const tableSkill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const godotSkill = readFileSync(path.join(godotSkillRoot, 'SKILL.md'), 'utf8');

    expect(mcp.mcpServers).not.toHaveProperty('godot');
    expect(tableSkill).toMatch(/only creates new tables/i);
    expect(tableSkill).toMatch(/direct edits to an existing table/i);
    expect(godotSkill).toMatch(/do not invoke[^\n]*keco-build-tables-from-document/i);
    expect(godotSkill).toMatch(/Keco-only table creation/i);
    expect(godotSkill).toMatch(/Godot work unrelated to Keco/i);
  });

  it('scores only behavior observed by the offline A/B evaluation', () => {
    const report = readFileSync(path.join(repositoryRoot, 'docs', 'qa', '2026-08-03-keco-skill-ab-report.md'), 'utf8');
    const economy = report.slice(report.indexOf('### Scenario 2'), report.indexOf('### Scenario 3'));
    const relationship = report.slice(report.indexOf('### Scenario 3'), report.indexOf('### Aggregate'));

    for (const criterion of ['stable-keys', 'dependency-order', 'read-back-verify']) {
      expect(economy).toMatch(new RegExp(`\\| ${criterion} \\| \\*\\*N/A\\*\\*`, 'i'));
    }

    expect(economy).toMatch(/Score: without Skill \*\*6\/6\*\*; with Skill[^\n]*\*\*6\/6\*\*/i);
    for (const criterion of ['stable-keys', 'dependency-order', 'read-back-verify']) {
      expect(relationship).toMatch(new RegExp(`\\| ${criterion} \\|[^\\n]*\\| \\*\\*N/A\\*\\*`, 'i'));
    }
    expect(relationship).toMatch(/Score: without Skill \*\*5\/9\*\*; with Skill \*\*6\/6\*\*/i);
    expect(report).toMatch(/Without Skill \| 5\/9 \| 6\/6 \| 5\/9 \| \*\*16\/24\*\*/);
    expect(report).toMatch(/With Skill, final \| 9\/9 \| 6\/6 \| 6\/6 \| \*\*21\/21\*\*/);
  });
});
