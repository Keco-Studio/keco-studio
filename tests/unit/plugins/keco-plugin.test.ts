import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = process.cwd();
const pluginRoot = path.join(repositoryRoot, 'plugins', 'keco-codex');
const skillRoot = path.join(pluginRoot, 'skills', 'keco-build-tables-from-document');
const godotSkillRoot = path.join(pluginRoot, 'skills', 'keco-develop-godot-slice');
const godotV2SkillRoot = path.join(pluginRoot, 'skills', 'keco-develop-godot-slice-v2');
const interactionContractPath = path.join(pluginRoot, 'references', 'interaction-contract.md');
const claudeInteractionContractPath = path.join(
  repositoryRoot,
  'plugins',
  'keco-claude',
  'references',
  'interaction-contract.md',
);

const ENTRY_SKILLS = [
  'keco-build-tables-from-document',
  'keco-develop-godot-slice',
  'keco-develop-godot-slice-v2',
  'pixellab-map-assets',
];

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

function skillTextFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return skillTextFiles(entryPath);
    return /\.(?:md|ya?ml)$/i.test(entry.name) ? [entryPath] : [];
  });
}

describe('Keco Codex plugin contract', () => {
  it('ships a byte-identical shared interaction contract in both plugins', () => {
    const contractExists = existsSync(interactionContractPath);
    const claudeContractExists = existsSync(claudeInteractionContractPath);

    expect({ contractExists, claudeContractExists }).toEqual({
      contractExists: true,
      claudeContractExists: true,
    });
    if (!contractExists || !claudeContractExists) return;

    expect(readFileSync(interactionContractPath)).toEqual(readFileSync(claudeInteractionContractPath));
  });

  it('links every entry Skill to the shared interaction contract', () => {
    for (const skill of ENTRY_SKILLS) {
      const source = readFileSync(path.join(pluginRoot, 'skills', skill, 'SKILL.md'), 'utf8');
      expect(source).toContain(
        '[shared interaction contract](../../references/interaction-contract.md)',
      );
      expect(source).toMatch(/Before expensive or mutating work[\s\S]{0,240}Goal[\s\S]{0,120}Source[\s\S]{0,120}Scope[\s\S]{0,120}Success[\s\S]{0,120}Next/i);
      expect(source).toMatch(/user's language[\s\S]{0,240}Completed[\s\S]{0,120}Current[\s\S]{0,120}Next[\s\S]{0,120}Blocker/i);
      expect(source).toMatch(/IDs[\s\S]{0,120}hashes[\s\S]{0,120}write tokens[\s\S]{0,160}raw MCP arguments[\s\S]{0,160}evidence/i);
    }
  });

  it('defines the shared language, intent, blocker, resume, and host boundaries', () => {
    expect(existsSync(interactionContractPath)).toBe(true);
    if (!existsSync(interactionContractPath)) return;

    const contract = readFileSync(interactionContractPath, 'utf8');
    expect(contract).toMatch(/latest substantive user request/i);
    expect(contract).toMatch(/user-visible headings, summaries, questions, progress, blockers, and final results/i);
    expect(contract).toMatch(/preserve[\s\S]*tool names[\s\S]*field labels[\s\S]*IDs[\s\S]*code[\s\S]*enum values[\s\S]*error codes[\s\S]*verbatim source quotations/i);
    for (const field of ['Goal', 'Source', 'Scope', 'Success', 'Next']) {
      expect(contract).toContain(`- ${field}:`);
    }
    for (const field of [
      'Status',
      'Blocked at',
      'Completed',
      'Writes performed',
      'Why',
      'User action',
      'Resume from',
      'Checkpoint',
      'Revalidation',
    ]) {
      expect(contract).toContain(`- ${field}:`);
    }
    expect(contract).toContain('running -> paused_with_checkpoint -> user_action -> revalidate -> resume');
    expect(contract).toMatch(/blocked_before_write[\s\S]{0,240}zero development writes/i);
    expect(contract).toMatch(/planning-document writes[\s\S]{0,240}explicitly/i);
    expect(contract).toMatch(/development mutation[\s\S]{0,160}partial/i);
    expect(contract).toMatch(/`Calling`, `Called`, `Explored`, and `Updated Plan` are host CLI rendering/i);
    expect(contract).toMatch(/plan order[\s\S]{0,240}execution order/i);
    expect(contract).toMatch(/do not silently skip|never silently skip/i);
    expect(contract).toMatch(/paused task[\s\S]{0,240}reason[\s\S]{0,240}return/i);
    expect(contract).toMatch(/prerequisite work inside the current task/i);
    expect(contract).toMatch(/changes scope[\s\S]{0,120}acceptance[\s\S]{0,120}allowed files[\s\S]{0,160}revise[\s\S]{0,80}revalidate[\s\S]{0,80}reorder/i);
    expect(contract).toMatch(/temporary jump only[\s\S]{0,240}execution-time prerequisite[\s\S]{0,240}exists later[\s\S]{0,240}dependencies complete/i);
  });

  it('keeps all Skill Markdown and YAML files ASCII-only', () => {
    const cjk = /[\u4e00-\u9fff]/u;
    const skillFiles = skillTextFiles(path.join(pluginRoot, 'skills'));
    const violations = skillFiles
      .filter((filePath) => cjk.test(readFileSync(filePath, 'utf8')))
      .map((filePath) => path.relative(repositoryRoot, filePath));

    expect(violations).toEqual([]);
  });

  it('advertises implicit document-driven multi-Slice orchestration while retaining bounded V1', () => {
    const manifest = readJson<{ interface: { defaultPrompt: string[] } }>('plugins/keco-codex/.codex-plugin/plugin.json');
    const v1Skill = readFileSync(path.join(godotSkillRoot, 'SKILL.md'), 'utf8');
    const v2Skill = readFileSync(path.join(godotV2SkillRoot, 'SKILL.md'), 'utf8');
    const v2Metadata = readFileSync(path.join(godotV2SkillRoot, 'agents', 'openai.yaml'), 'utf8');

    expect(manifest.interface.defaultPrompt).toEqual(expect.arrayContaining([
      expect.stringMatching(/Keco project document[\s\S]*ordered Godot slices[\s\S]*execute/i),
    ]));
    expect(v2Skill).toMatch(/implicit[\s\S]*document-driven|document-driven[\s\S]*implicit/i);
    expect(v2Skill).toMatch(/V2 takes precedence[\s\S]*bounded simple Slice/i);
    expect(v2Metadata).toMatch(/allow_implicit_invocation: true/);
    expect(v1Skill).toMatch(/one (?:bounded |gameplay )?slice/i);
  });

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

    expect(evaluations.cases).toHaveLength(8);
    expect(evaluations.cases.filter((item) => item.expectedSkill === 'keco-develop-godot-slice')).toHaveLength(4);
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
    }>('plugins/keco-codex/.codex-plugin/plugin.json');
    const mcp = readJson<{ mcpServers: Record<string, unknown> }>('plugins/keco-codex/.mcp.json');

    expect(marketplace.plugins[0]).toMatchObject({
      name: 'keco',
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    });
    expect(plugin).toMatchObject({
      name: 'keco',
      version: expect.stringMatching(/^\d+\.\d+\.\d+(?:\+codex\.[0-9A-Za-z.-]+)?$/),
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
    expect(schemaDesign).toMatch(/BuildPlan[\s\S]{0,160}approved static scope/i);
    expect(schemaDesign).toMatch(/must not contain[\s\S]{0,240}(?:execution status|write tokens|checkpoints)[\s\S]{0,240}(?:evidence|read-back)/i);
    expect(executionPolicy).toMatch(/ExecutionCheckpoint[\s\S]{0,240}VerificationReport/i);
    expect(executionPolicy).toMatch(/Status[\s\S]{0,240}Blocked at[\s\S]{0,240}Resume from[\s\S]{0,240}Revalidation/i);
    expect(executionPolicy).toMatch(/unchanged[\s\S]{0,240}do not repeat[\s\S]{0,160}(?:confirmation|question)/i);
    expect(executionPolicy).toMatch(/semantic section labels[\s\S]{0,240}translate[\s\S]{0,240}user's language/i);
    expect(executionPolicy).toMatch(/default preview[\s\S]{0,240}raw MCP payloads[\s\S]{0,200}UUID maps/i);
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

  it('limits Godot orchestration to the installed fourteen-tool MCP contract', () => {
    const skill = readFileSync(path.join(godotSkillRoot, 'SKILL.md'), 'utf8');
    const policy = readFileSync(path.join(godotSkillRoot, 'references', 'godot-mcp-policy.md'), 'utf8');
    const evalSpec = readFileSync(path.join(godotSkillRoot, 'references', 'eval-spec.md'), 'utf8');
    const sequence = policy.match(/## Deterministic Evaluation Sequence[\s\S]*?```text\n([\s\S]*?)```/)?.[1];

    expect(sequence).toBeDefined();
    expect(sequence).toMatch(/run_project[\s\S]*get_debug_output[\s\S]*stop_project/);

    for (const tool of [
      'get_godot_version',
      'get_project_info',
      'list_projects',
      'launch_editor',
      'create_scene',
      'add_node',
      'load_sprite',
      'save_scene',
      'run_project',
      'stop_project',
      'get_debug_output',
      'export_mesh_library',
      'get_uid',
      'update_project_uids',
    ]) {
      expect(policy).toContain(tool);
    }

    for (const unavailable of [
      'godot_exec',
      'godot_runtime_state',
      'godot_game_time',
      'godot_editor_edit',
    ]) {
      expect(sequence).not.toContain(unavailable);
      expect(skill).toMatch(new RegExp(`Do not call or assume[\\s\\S]*${unavailable}`));
    }

    expect(policy).toMatch(/repository editing tools for text files/i);
    expect(policy).toMatch(/KECO_EVAL/);
    expect(evalSpec).toMatch(/no input injection, runtime-state query, time-step control, or screenshot tool/i);
    expect(evalSpec).toMatch(/manualRequired: true|manual_required/i);
  });

  it('plans slice-owned UI assets through PixelLab while preserving the existing style', () => {
    const skill = readFileSync(path.join(godotSkillRoot, 'SKILL.md'), 'utf8');
    const assetPlan = readFileSync(path.join(godotSkillRoot, 'references', 'asset-plan.md'), 'utf8');
    const agentMetadata = readFileSync(path.join(godotSkillRoot, 'agents', 'openai.yaml'), 'utf8');

    expect(skill).toMatch(/DESIGN_DATA[\s\S]*DESIGN_ASSETS[\s\S]*EXPORT_SNAPSHOT/);
    expect(skill).toMatch(/GENERATE_ASSETS[\s\S]*PERSIST_ASSETS[\s\S]*EXPORT_SNAPSHOT/);
    expect(skill).toContain('references/asset-plan.md');
    expect(skill).toMatch(/standalone asset generation/i);
    expect(assetPlan).toMatch(/create_s_xl_image_pro/);
    expect(assetPlan).toMatch(/extend-existing-ui[\s\S]*reference/i);
    expect(assetPlan).toMatch(/new-ui[\s\S]*existing UI/i);
    expect(assetPlan).toMatch(/API key[\s\S]*(?:environment|MCP configuration)/i);
    expect(assetPlan).toMatch(/provenance/i);
    expect(assetPlan).toMatch(/UI Assets/);
    expect(assetPlan).toMatch(/create_image_upload[\s\S]*HTTP `PUT`[\s\S]*complete_image_upload[\s\S]*update_table_row/i);
    expect(assetPlan).toMatch(/query_table_rows[\s\S]*before[\s\S]*EXPORT_SNAPSHOT/i);
    expect(assetPlan).toMatch(/verified `image` object/i);
    expect(assetPlan).toMatch(/manualRequired|manual_required/);
    expect(agentMetadata).toMatch(/value: "pixellab"/);
  });

  it('keeps Godot MCP external and routes overlapping work explicitly', () => {
    const mcp = readJson<{ mcpServers: Record<string, unknown> }>('plugins/keco-codex/.mcp.json');
    const tableSkill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const godotSkill = readFileSync(path.join(godotSkillRoot, 'SKILL.md'), 'utf8');

    expect(mcp.mcpServers).not.toHaveProperty('godot');
    expect(mcp.mcpServers).not.toHaveProperty('pixellab');
    expect(tableSkill).toMatch(/only creates new tables/i);
    expect(tableSkill).toMatch(/direct edits to an existing table/i);
    expect(godotSkill).toMatch(/do not invoke[^\n]*keco-build-tables-from-document/i);
    expect(godotSkill).toMatch(/Keco-only table creation/i);
    expect(godotSkill).toMatch(/Godot work unrelated to Keco/i);
    expect(godotSkill).toMatch(/character|animation|tileset/i);
    expect(godotSkill).toMatch(/keco-develop-godot-slice-v2/i);
    expect(tableSkill).toMatch(/existing table|existing tables|Godot slice/i);
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
