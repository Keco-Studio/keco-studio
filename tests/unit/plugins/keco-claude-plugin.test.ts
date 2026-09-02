import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const repositoryRoot = process.cwd();
const pluginRoot = path.join(repositoryRoot, 'plugins', 'keco-claude');
const skillsRoot = path.join(pluginRoot, 'skills');
const scriptsRoot = path.join(pluginRoot, 'scripts');
const interactionContractPath = path.join(pluginRoot, 'references', 'interaction-contract.md');
const codexInteractionContractPath = path.join(
  repositoryRoot,
  'plugins',
  'keco-codex',
  'references',
  'interaction-contract.md',
);

const SKILLS = [
  'keco-build-tables-from-document',
  'keco-create-map',
  'keco-create-character-animation',
  'keco-develop-godot-slice',
  'keco-develop-godot-slice-v2',
  'keco-import-local-assets',
  'keco-manage-game-design-system',
  'pixellab-map-assets',
];

const SCRIPTS = [
  'build_spriteframes_resource.py',
  'derive_slice_status.py',
  'evaluate_runtime_observations.py',
  'export_keco_snapshot.py',
  'materialize_slice_mirrors.py',
  'slice_contract.py',
  'validate_delivery_policy.py',
  'validate_eval_report.py',
  'validate_gdd_coverage.py',
  'validate_generated_asset_package.py',
  'validate_interaction_checkpoint.py',
  'validate_plan.py',
  'validate_run_context.py',
  'validate_slice_documents.py',
  'validate_snapshot.py',
  'validate_task_evidence.py',
];

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(repositoryRoot, relativePath), 'utf8')) as T;
}

function markdownFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return markdownFiles(entryPath);
    return entry.name.endsWith('.md') ? [entryPath] : [];
  });
}

function runScript(name: string, args: string[]) {
  return spawnSync('python3', [path.join(scriptsRoot, name), ...args], { encoding: 'utf8' });
}

function writeTempJson(directory: string, name: string, value: unknown): string {
  const filePath = path.join(directory, name);
  writeFileSync(filePath, JSON.stringify(value));
  return filePath;
}

function writePngHeader(filePath: string, width: number, height: number): void {
  const header = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  writeFileSync(filePath, header);
}

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function task(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    files: [`game/scripts/${id}.gd`],
    dependsOn: [],
    servesEvaluations: ['eval-1'],
    red: { command: 'python3 tests/check.py', expected: 'fails' },
    green: { command: 'python3 tests/check.py', expected: 'passes' },
    review: { spec: true, quality: true },
    ...overrides,
  };
}

describe('Keco Claude plugin packaging', () => {
  it('ships a byte-identical shared interaction contract in both plugins', () => {
    const contractExists = existsSync(interactionContractPath);
    const codexContractExists = existsSync(codexInteractionContractPath);

    expect({ contractExists, codexContractExists }).toEqual({
      contractExists: true,
      codexContractExists: true,
    });
    if (!contractExists || !codexContractExists) return;

    expect(readFileSync(interactionContractPath)).toEqual(readFileSync(codexInteractionContractPath));
  });

  it('links every entry Skill to the shared interaction contract', () => {
    for (const skill of SKILLS) {
      const source = readFileSync(path.join(skillsRoot, skill, 'SKILL.md'), 'utf8');
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

  it('declares an installable marketplace entry and plugin manifest', () => {
    const marketplace = readJson<{
      name: string;
      owner: { name: string };
      plugins: Array<{ name: string; source: string; version: string }>;
    }>('.claude-plugin/marketplace.json');
    const plugin = readJson<{
      name: string;
      version: string;
      skills: string;
      mcpServers: string;
    }>('plugins/keco-claude/.claude-plugin/plugin.json');

    expect(marketplace.name).toBe('keco-studio');
    expect(marketplace.owner.name).toBeTruthy();
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0]).toMatchObject({ name: 'keco', source: './plugins/keco-claude' });
    // The Claude manifest carries a clean semver, never a build-metadata cachebuster.
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(marketplace.plugins[0].version).toBe(plugin.version);
    expect(plugin).toMatchObject({ name: 'keco', skills: './skills/', mcpServers: './.mcp.json' });
    expect(existsSync(path.join(pluginRoot, plugin.mcpServers))).toBe(true);
    expect(existsSync(path.join(pluginRoot, plugin.skills))).toBe(true);
  });

  it('connects only the remote Keco MCP server', () => {
    const mcp = readJson<{ mcpServers: Record<string, unknown> }>('plugins/keco-claude/.mcp.json');
    expect(Object.keys(mcp.mcpServers)).toEqual(['keco']);
    expect(mcp.mcpServers.keco).toEqual({
      type: 'http',
      url: 'https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp',
    });
  });

  it('ships every skill with valid frontmatter whose name matches its directory', () => {
    expect(readdirSync(skillsRoot).sort()).toEqual([...SKILLS].sort());
    for (const skill of SKILLS) {
      const source = readFileSync(path.join(skillsRoot, skill, 'SKILL.md'), 'utf8');
      const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(source);
      expect(frontmatter).not.toBeNull();
      const fields = Object.fromEntries(
        [...frontmatter![1].matchAll(/^(\w[\w-]*):\s*(.*)$/gm)].map((match) => [match[1], match[2]]),
      );
      expect(fields.name).toBe(skill);
      expect(fields.description.length).toBeGreaterThan(40);
      expect(fields.description.length).toBeLessThanOrEqual(1024);
    }
  });

  it('keeps every shipped text file ASCII-only', () => {
    // The Codex suite only rejected CJK, so curly quotes shipped unnoticed.
    const offenders = markdownFiles(pluginRoot)
      .filter((filePath) => /[^\x00-\x7F]/.test(readFileSync(filePath, 'utf8')))
      .map((filePath) => path.relative(repositoryRoot, filePath));
    expect(offenders).toEqual([]);
  });

  it('stores one shared copy of every script and brand asset', () => {
    expect(readdirSync(scriptsRoot).filter((name) => name.endsWith('.py')).sort()).toEqual(SCRIPTS);
    // No per-skill scripts/ or assets/ directories: duplication is the defect.
    for (const skill of SKILLS) {
      expect(existsSync(path.join(skillsRoot, skill, 'scripts'))).toBe(false);
      expect(existsSync(path.join(skillsRoot, skill, 'assets'))).toBe(false);
    }
    expect(readdirSync(path.join(pluginRoot, 'assets')).sort()).toEqual(['icon.png', 'logo.png']);
  });

  it('resolves every relative Markdown link and plugin-root script reference', () => {
    const broken: string[] = [];
    for (const filePath of markdownFiles(pluginRoot)) {
      const source = readFileSync(filePath, 'utf8');
      for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = match[1];
        if (/^(?:https?:|#|mailto:)/.test(target)) continue;
        if (!existsSync(path.resolve(path.dirname(filePath), target))) {
          broken.push(`${path.relative(repositoryRoot, filePath)} -> ${target}`);
        }
      }
      for (const match of source.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+\.py)/g)) {
        if (!existsSync(path.join(pluginRoot, match[1]))) {
          broken.push(`${path.relative(repositoryRoot, filePath)} -> ${match[0]}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('reaches every bundled reference and script from a SKILL.md', () => {
    // Regression guard: orchestration-contract.md, slice-decision.md,
    // build_spriteframes_resource.py and validate_generated_asset_package.py
    // were all unreachable from any skill entry point.
    const corpus = markdownFiles(pluginRoot)
      .map((filePath) => readFileSync(filePath, 'utf8'))
      .join('\n');
    const orphans: string[] = [];
    for (const skill of SKILLS) {
      const referencesDir = path.join(skillsRoot, skill, 'references');
      if (!existsSync(referencesDir)) continue;
      for (const reference of readdirSync(referencesDir)) {
        const skillSource = readFileSync(path.join(skillsRoot, skill, 'SKILL.md'), 'utf8');
        const linkedFromSkill = skillSource.includes(`references/${reference}`);
        const linkedFromSibling = readdirSync(referencesDir)
          .filter((name) => name !== reference)
          .some((name) => readFileSync(path.join(referencesDir, name), 'utf8').includes(reference));
        if (!linkedFromSkill && !linkedFromSibling) orphans.push(`${skill}/references/${reference}`);
      }
    }
    for (const script of SCRIPTS) {
      if (!corpus.includes(script)) orphans.push(`scripts/${script}`);
    }
    expect(orphans).toEqual([]);
  });
});

describe('Keco Claude plugin skill contracts', () => {
  it('ships the synchronized local image import routing and workflow contract', () => {
    const claudeSkill = readFileSync(path.join(skillsRoot, 'keco-import-local-assets', 'SKILL.md'));
    const codexSkill = readFileSync(
      path.join(repositoryRoot, 'plugins', 'keco-codex', 'skills', 'keco-import-local-assets', 'SKILL.md'),
    );
    const skillText = claudeSkill.toString('utf8');
    const evaluations = readJson<{
      cases: Array<{ id: string; expectedSkill: string }>;
      requiredSequence: string[];
      prohibitedBindings: string[];
    }>('tests/fixtures/plugins/keco-local-image-import-skill-evals.json');

    expect(claudeSkill).toEqual(codexSkill);
    expect(skillText).toMatch(/^---\nname: keco-import-local-assets\n/);
    expect(skillText).toMatch(/Inventory the requested files[\s\S]*Resolve exactly one Keco project[\s\S]*Preview the complete plan[\s\S]*explicit confirmation[\s\S]*Create only a confirmed missing folder[\s\S]*Prepare metadata-only batches[\s\S]*Send the exact local bytes[\s\S]*Complete only successful PUT items[\s\S]*Upsert rows[\s\S]*Paginate authoritative reads[\s\S]*Report each item/i);
    expect(skillText).toMatch(/prepare_image_uploads\.items\[\]\.image\.path[\s\S]{0,200}Never pass a local path[\s\S]{0,120}signed upload URL/i);
    expect(skillText).toMatch(/complete verified `image` object[\s\S]{0,160}never reduce it to a path or URL/i);
    expect(skillText).toMatch(/Row write failed[\s\S]{0,160}do not upload again/i);
    expect(skillText).toMatch(/Never persist or print signed URLs[\s\S]{0,160}authorization headers/i);
    expect(evaluations.requiredSequence).toHaveLength(12);
    expect(evaluations.prohibitedBindings).toContain('signed-credentials-in-checkpoint');
    expect(evaluations.cases.find((item) => item.id === 'apple-and-pear-directory')).toMatchObject({
      expectedSkill: 'keco-import-local-assets',
    });
    expect(evaluations.cases.filter((item) => item.expectedSkill === 'none').map((item) => item.id)).toEqual([
      'unsupported-attachment',
      'analysis-only',
    ]);
  });

  it('routes V2 implicitly and records that routing consistently', () => {
    const skill = readFileSync(path.join(skillsRoot, 'keco-develop-godot-slice-v2', 'SKILL.md'), 'utf8');
    const abMatrix = readFileSync(
      path.join(skillsRoot, 'keco-develop-godot-slice-v2', 'references', 'ab-matrix.md'),
      'utf8',
    );
    expect(skill).toMatch(/The user does not need to name this Skill/i);
    expect(skill).toMatch(/V2 is the canonical creation workflow/i);
    // The A/B matrix used to claim V2 was explicit-invocation only.
    expect(abMatrix).not.toMatch(/explicit `?\$?keco-develop-godot-slice-v2`? only/i);
    expect(abMatrix).toMatch(/implicit, document-driven routing/i);
  });

  it('links the orchestration and slice-decision contracts from the V2 entry point', () => {
    const skill = readFileSync(path.join(skillsRoot, 'keco-develop-godot-slice-v2', 'SKILL.md'), 'utf8');
    const orchestration = readFileSync(
      path.join(skillsRoot, 'keco-develop-godot-slice-v2', 'references', 'orchestration-contract.md'),
      'utf8',
    );
    const sliceDocuments = readFileSync(
      path.join(skillsRoot, 'keco-develop-godot-slice-v2', 'references', 'slice-document-contract.md'),
      'utf8',
    );
    expect(skill).toContain('references/orchestration-contract.md');
    expect(skill).toContain('references/slice-decision.md');
    expect(skill).toMatch(/RunContext[\s\S]{0,200}writeToken[\s\S]{0,200}sliceDecision/i);
    expect(orchestration).toMatch(/SlicePlan[\s\S]{0,200}approved static scope/i);
    expect(orchestration).toMatch(/task completion[\s\S]{0,220}Markdown checkboxes/i);
    expect(orchestration).toMatch(/specPath[\s\S]*docs\/superpowers\/specs[\s\S]*planPath[\s\S]*docs\/superpowers\/plans/i);
    expect(orchestration).toMatch(/statusPath[\s\S]*internal[\s\S]*status\.json/i);
    expect(orchestration).toMatch(/interaction:[\s\S]{0,480}blockedAt[\s\S]{0,240}resumeFrom/i);
    expect(orchestration).toMatch(/legacy[\s\S]{0,240}without[\s\S]{0,160}interaction/i);
    expect(sliceDocuments).toMatch(/only user-facing progress record/i);
    expect(sliceDocuments).toMatch(/TaskResult[\s\S]{0,160}EvalReport[\s\S]{0,160}internal/i);
  });

  it('uses the repository Superpowers specs/plans layout as the user-facing Slice source of truth', () => {
    const skill = readFileSync(path.join(skillsRoot, 'keco-develop-godot-slice-v2', 'SKILL.md'), 'utf8');
    const orchestration = readFileSync(
      path.join(skillsRoot, 'keco-develop-godot-slice-v2', 'references', 'multi-slice-orchestration.md'),
      'utf8',
    );
    const documents = readFileSync(
      path.join(skillsRoot, 'keco-develop-godot-slice-v2', 'references', 'slice-document-contract.md'),
      'utf8',
    );
    expect(skill).toMatch(/docs\/superpowers\/specs[\s\S]*docs\/superpowers\/plans/i);
    expect(orchestration).toMatch(/specs\/<slice-id>-design\.md[\s\S]*plans\/<slice-id>\.md/i);
    expect(orchestration).toMatch(/checkbox[\s\S]*plan\.md|plan\.md[\s\S]*checkbox/i);
    expect(documents).toMatch(/user-facing[\s\S]*spec[\s\S]*plan/i);
    expect(documents).toMatch(/status\.json[\s\S]*internal|internal[\s\S]*status\.json/i);
    expect(documents).not.toMatch(/docs\/keco-godot-slices\/<slice-id>\/\s*spec\.md/i);
  });

  it('never hard-codes a PixelLab tool the registry records as unavailable', () => {
    const registry = readFileSync(path.join(pluginRoot, 'references', 'pixellab-capability-registry.md'), 'utf8');
    const unavailable = [...registry.matchAll(/^\| `([\w-]+)` \|.*\| (none|[`\w]+) \| `unavailable` \|$/gm)]
      .map((match) => match[1]);
    expect(unavailable).toContain('s-xl-image-pro');
    expect(unavailable).toContain('top-down-tileset');

    // Tool names that never existed on the live MCP must not be callable
    // instructions. Only files a model loads as instructions are policed; the
    // plugin README documents these names as defects that were removed.
    const inventedToolNames = [
      'create_s_xl_image_pro',
      'create_topdown_tileset',
      'create_path_tiles',
      'create_building_kit',
      'create_map_object',
    ];
    const instructionFiles = [
      ...markdownFiles(skillsRoot),
      ...markdownFiles(path.join(pluginRoot, 'references')),
    ];
    const offenders: string[] = [];
    for (const filePath of instructionFiles) {
      const source = readFileSync(filePath, 'utf8');
      for (const name of inventedToolNames) {
        if (!source.includes(name)) continue;
        // Allowed only where the text explicitly says not to call it.
        const warned = /not\s+live MCP tool names|are \*\*not\*\* live MCP tool names|never call a remembered tool name/i.test(source);
        if (!warned) offenders.push(`${path.relative(repositoryRoot, filePath)}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('shares one assetKind vocabulary between the registry and the validator', () => {
    const registry = readFileSync(path.join(pluginRoot, 'references', 'pixellab-capability-registry.md'), 'utf8');
    const declared = /```text\n([\s\S]*?)\n```/.exec(registry.slice(registry.indexOf('## Canonical `assetKind` values')));
    const registryKinds = declared![1].split(/[,\s]+/).filter(Boolean).sort();
    const validator = readFileSync(path.join(scriptsRoot, 'validate_generated_asset_package.py'), 'utf8');
    const validatorKinds = [...(/ASSET_KINDS = \{([\s\S]*?)\}/.exec(validator)![1]).matchAll(/"([\w-]+)"/g)]
      .map((match) => match[1])
      .sort();
    expect(validatorKinds).toEqual(registryKinds);
    expect(registryKinds).toContain('character-rotation');
    expect(registryKinds).not.toContain('rotation');
  });

  it('gives pixellab-map-assets a Keco-first, registry-driven contract', () => {
    const skill = readFileSync(path.join(skillsRoot, 'pixellab-map-assets', 'SKILL.md'), 'utf8');
    const operations = readFileSync(
      path.join(skillsRoot, 'pixellab-map-assets', 'references', 'pixellab-operations.md'),
      'utf8',
    );
    expect(skill).toContain('../../references/pixellab-capability-registry.md');
    expect(skill).toMatch(/compatibility: exact\|fallback\|unavailable/);
    expect(skill).toMatch(/planned` (?:asset )?row[\s\S]*read (?:it )?back|write and read back the Keco `planned`/i);
    expect(skill).toMatch(/collision and walkability in Godot-owned files/i);
    expect(operations).toMatch(/Capability key/);
    expect(operations).toMatch(/not\*\* live MCP tool names/i);
  });

  it('keeps V1 bounded and pointed at V2 for newer contracts', () => {
    const skill = readFileSync(path.join(skillsRoot, 'keco-develop-godot-slice', 'SKILL.md'), 'utf8');
    expect(skill).toMatch(/one bounded slice/i);
    expect(skill).toMatch(/keco-develop-godot-slice-v2/);
    expect(skill).not.toMatch(/\$keco-/);
    expect(skill).toMatch(/compatibility: exact\|fallback\|unavailable/);
  });

  it('requires read-plan-confirm-execute-verify for table building', () => {
    const skill = readFileSync(path.join(skillsRoot, 'keco-build-tables-from-document', 'SKILL.md'), 'utf8');
    const schemaDesign = readFileSync(
      path.join(skillsRoot, 'keco-build-tables-from-document', 'references', 'schema-design.md'),
      'utf8',
    );
    const executionPolicy = readFileSync(
      path.join(skillsRoot, 'keco-build-tables-from-document', 'references', 'execution-policy.md'),
      'utf8',
    );
    expect(skill).toMatch(/explicit user confirmation/i);
    expect(skill).toMatch(/Never delete project data/);
    expect(skill).toMatch(/Stop on the first failed write/i);
    expect(skill).not.toMatch(/\$keco-/);
    expect(schemaDesign).toMatch(/BuildPlan[\s\S]{0,160}approved static scope/i);
    expect(schemaDesign).toMatch(/must not contain[\s\S]{0,240}(?:execution status|write tokens|checkpoints)[\s\S]{0,240}(?:evidence|read-back)/i);
    expect(executionPolicy).toMatch(/ExecutionCheckpoint[\s\S]{0,240}VerificationReport/i);
    expect(executionPolicy).toMatch(/Status[\s\S]{0,240}Blocked at[\s\S]{0,240}Resume from[\s\S]{0,240}Revalidation/i);
    expect(executionPolicy).toMatch(/unchanged[\s\S]{0,240}do not repeat[\s\S]{0,160}(?:confirmation|question)/i);
    expect(executionPolicy).toMatch(/semantic section labels[\s\S]{0,240}translate[\s\S]{0,240}user's language/i);
    expect(executionPolicy).toMatch(/default preview[\s\S]{0,240}raw MCP payloads[\s\S]{0,200}UUID maps/i);
  });
});

describe('Keco Claude plugin validators', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-claude-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const runContext = (overrides: Record<string, unknown> = {}) => ({
    version: 2,
    runId: 'run-1',
    mode: 'implicit-v2',
    kecoProjectId: 'project-uuid',
    godotProjectPath: '/games/village',
    sliceId: 'slice-001',
    allowedFiles: ['game/scripts/village.gd'],
    iteration: 0,
    ...overrides,
  });

  const interactionFixture = readJson<{
    validCheckpoint: Record<string, unknown>;
    invalidCheckpoints: Array<{
      id: string;
      remove?: string;
      overrides?: Record<string, unknown>;
      error: string;
    }>;
  }>('tests/fixtures/plugins/keco-interaction-contract.json');

  it('validates resumable checkpoints and rejects unsafe variants', () => {
    const valid = runScript('validate_interaction_checkpoint.py', [
      writeTempJson(tempRoot, 'checkpoint.json', interactionFixture.validCheckpoint),
    ]);
    expect(valid.status).toBe(0);
    expect(valid.stdout).toMatch(/checkpoint valid/i);

    for (const invalid of interactionFixture.invalidCheckpoints) {
      const value = {
        ...interactionFixture.validCheckpoint,
        ...invalid.overrides,
      };
      if (invalid.remove) delete value[invalid.remove];
      const result = runScript('validate_interaction_checkpoint.py', [
        writeTempJson(tempRoot, `${invalid.id}.json`, value),
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(new RegExp(invalid.error, 'i'));
    }
  });

  // The Codex suite only ever asserted a rejection here, which is why the
  // validator could demand a mode no contract defines.
  it.each(['implicit-v2', 'explicit-v2'])('accepts the documented run-context mode %s', (mode) => {
    const result = runScript('validate_run_context.py', [writeTempJson(tempRoot, 'run.json', runContext({ mode }))]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, mode });
  });

  it.each([
    ['an undocumented mode', runContext({ mode: 'manual-v2' }), /mode must be one of/],
    ['a parent-traversal allowed file', runContext({ allowedFiles: ['../outside.gd'] }), /parent traversal/],
    ['an absolute allowed file', runContext({ allowedFiles: ['/etc/passwd'] }), /parent traversal/],
    ['a repair iteration past the limit', runContext({ iteration: 4 }), /iteration must be an integer/],
    ['a non-string write token', runContext({ writeToken: 7 }), /writeToken/],
    ['a non-object interaction checkpoint', runContext({ interaction: [] }), /interaction/],
    [
      'an interaction checkpoint for another run',
      runContext({
        interaction: {
          ...interactionFixture.validCheckpoint,
          checkpoint: {
            ...(interactionFixture.validCheckpoint.checkpoint as Record<string, unknown>),
            runId: 'another-run',
          },
        },
      }),
      /runId/,
    ],
  ])('rejects %s', (_label, value, expected) => {
    const result = runScript('validate_run_context.py', [writeTempJson(tempRoot, 'run.json', value)]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(expected);
  });

  it('accepts an optional interaction checkpoint for the same run', () => {
    const interaction = {
      ...interactionFixture.validCheckpoint,
      checkpoint: {
        ...(interactionFixture.validCheckpoint.checkpoint as Record<string, unknown>),
        runId: 'run-1',
      },
    };
    const result = runScript('validate_run_context.py', [
      writeTempJson(tempRoot, 'run-with-checkpoint.json', runContext({ interaction })),
    ]);
    expect(result.status).toBe(0);
  });

  it('keeps shared deterministic delivery scripts and contracts byte-identical', () => {
    const codexRoot = path.join(repositoryRoot, 'plugins', 'keco-codex', 'skills', 'keco-develop-godot-slice-v2');
    for (const name of ['validate_task_evidence.py', 'validate_delivery_policy.py', 'materialize_slice_mirrors.py', 'validate_eval_report.py', 'validate_gdd_coverage.py', 'validate_run_context.py', 'validate_slice_documents.py']) {
      expect(readFileSync(path.join(scriptsRoot, name))).toEqual(readFileSync(path.join(codexRoot, 'scripts', name)));
    }
    for (const name of ['orchestration-contract.md', 'gdd-coverage-contract.md', 'gdd-change-contract.md', 'eval-contract.md', 'godot-mcp-contract.md', 'slice-document-contract.md', 'review-workflow.md', 'default-delivery-policy.json']) {
      expect(readFileSync(path.join(skillsRoot, 'keco-develop-godot-slice-v2', 'references', name))).toEqual(readFileSync(path.join(codexRoot, 'references', name)));
    }
  });

  it('validates task evidence, policy gates, and atomic mirror provenance', () => {
    const hash = (character: string) => `sha256:${character.repeat(64)}`;
    const planRevision = hash('1');
    const resultId = '11111111-1111-4111-8111-111111111111';
    const run = runContext({ allowedFiles: ['game/scripts/village.gd'] });
    const plan = {
      schemaVersion: 1,
      planRevision,
      allowedFiles: ['game/scripts/village.gd'],
      tasks: [{
        id: 'task-01', files: ['game/scripts/village.gd'], dependsOn: [], servesEvaluations: ['eval-1'],
        red: { command: 'python3 red.py', expected: 'fails' }, green: { command: 'python3 green.py', expected: 'passes' },
      }],
    };
    const taskResult = {
      eventId: resultId, eventType: 'task_result', payload: {
        schemaVersion: 1, runId: 'run-1', sliceId: 'slice-001', taskId: 'task-01', planRevision,
        attemptId: '22222222-2222-4222-8222-222222222222', phase: 'green', operation: { kind: 'command', command: 'python3 green.py' },
        startedAt: '2026-08-27T00:00:00Z', endedAt: '2026-08-27T00:00:01Z', exitCode: 0, timedOut: false, cancelled: false,
        stdoutSummary: 'passed', stdoutHash: hash('a'), stderrSummary: '', stderrHash: hash('b'),
        changedFiles: [{ path: 'game/scripts/village.gd', beforeHash: hash('c'), afterHash: hash('d') }],
        expectedOutcome: 'passes', observedOutcome: 'passed', status: 'completed', concerns: [], artifactIds: [],
      },
    };
    const review = {
      eventId: '33333333-3333-4333-8333-333333333333', eventType: 'task_review', payload: {
        schemaVersion: 1, runId: 'run-1', sliceId: 'slice-001', taskId: 'task-01', planRevision,
        taskResultIds: [resultId], reviewedFiles: [{ path: 'game/scripts/village.gd', hash: hash('d') }],
        reviewerType: 'agent', reviewerId: 'independent-reviewer', verdict: 'accepted', specificationFindings: [], qualityFindings: [], requiredFollowUp: [],
      },
    };
    const valid = runScript('validate_task_evidence.py', [
      '--run-context', writeTempJson(tempRoot, 'run.json', run), '--plan', writeTempJson(tempRoot, 'plan.json', plan),
      '--task-result', writeTempJson(tempRoot, 'result.json', taskResult), '--task-review', writeTempJson(tempRoot, 'review.json', review),
    ]);
    expect(valid.status).toBe(0);
    review.payload.reviewedFiles[0].hash = hash('e');
    const wrongBytes = runScript('validate_task_evidence.py', [
      '--run-context', writeTempJson(tempRoot, 'run-2.json', run), '--plan', writeTempJson(tempRoot, 'plan-2.json', plan),
      '--task-result', writeTempJson(tempRoot, 'result-2.json', taskResult), '--task-review', writeTempJson(tempRoot, 'review-2.json', review),
    ]);
    expect(wrongBytes.status).toBe(1);
    expect(wrongBytes.stderr).toMatch(/different bytes/i);

    const policy = runScript('validate_delivery_policy.py', ['--output', path.join(tempRoot, 'policy.json')]);
    expect(policy.status).toBe(0);
    expect(JSON.parse(policy.stdout)).toMatchObject({ ok: true, source: 'default', policy: { maximumRepairs: 3, manualReviewBlocksRelease: true } });

    const content = 'mirror bytes\n';
    const file = { kind: 'status', repositoryPath: 'game/scripts/village.gd', documentId: 'doc-1', epoch: 0, revision: 1, byteCount: Buffer.byteLength(content), sha256: `sha256:${createHash('sha256').update(content).digest('hex')}`, content };
    const canonical = JSON.stringify([file], Object.keys(file).sort());
    const manifest = { schemaVersion: 1, canonicalizationVersion: 1, runId: 'run-1', stateToken: 'token-1', currentSequence: 1, files: [file], manifestHash: `sha256:${createHash('sha256').update(canonical).digest('hex')}` };
    const root = path.join(tempRoot, 'repository');
    mkdirSync(root);
    const mirror = runScript('materialize_slice_mirrors.py', [
      '--manifest', writeTempJson(tempRoot, 'manifest.json', manifest), '--repository-root', root,
      '--run-context', writeTempJson(tempRoot, 'mirror-run.json', run), '--output', path.join(tempRoot, 'mirror-verification.json'),
    ]);
    expect(mirror.status).toBe(0);
    expect(readFileSync(path.join(root, 'game/scripts/village.gd'), 'utf8')).toBe(content);
  });

  it.each([
    ['the documented required/required strings', 'required', 'required'],
    ['boolean true/true', true, true],
  ])('accepts a plan whose review uses %s', (_label, spec, quality) => {
    const plan = { tasks: [task('task-01', { review: { spec, quality } })] };
    const result = runScript('validate_plan.py', [writeTempJson(tempRoot, 'plan.json', plan)]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, taskCount: 1 });
  });

  it('rejects runtime and evidence state in a plan or task', () => {
    const runtimePlan = {
      runId: 'run-01',
      writeToken: 'must-not-live-in-plan',
      tasks: [task('task-01', { status: 'in_progress', commandOutput: 'runtime output' })],
    };
    const result = runScript('validate_plan.py', [
      writeTempJson(tempRoot, 'runtime-plan.json', runtimePlan),
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/plan contains runtime or evidence state/i);
  });

  it('lets a small task relax the quality review while keeping one in the plan', () => {
    const plan = {
      tasks: [
        task('task-01', { review: { spec: 'required', quality: 'required' } }),
        task('task-02', { dependsOn: ['task-01'], review: { spec: 'required', quality: 'optional' } }),
      ],
    };
    const result = runScript('validate_plan.py', [writeTempJson(tempRoot, 'plan.json', plan)]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ qualityReviews: 1, taskCount: 2 });
  });

  it.each([
    ['no quality review anywhere', [task('task-01', { review: { spec: true, quality: false } })], /at least one task must carry a quality review/],
    ['a dropped spec review', [task('task-01', { review: { spec: false, quality: true } })], /spec review is required/],
    ['an unknown dependency', [task('task-01', { dependsOn: ['task-99'] })], /unknown task/],
    [
      'a dependency listed after its dependent',
      [
        task('task-02', { dependsOn: ['task-01'] }),
        task('task-01'),
      ],
      /dependency must appear before dependent task/,
    ],
    ['a blank command', [task('task-01', { red: { command: '  ' } })], /red\/green commands/],
    ['a placeholder', [task('task-01', { green: { command: 'TODO decide' } })], /placeholder/],
  ])('rejects a plan with %s', (_label, tasks, expected) => {
    const result = runScript('validate_plan.py', [writeTempJson(tempRoot, 'plan.json', { tasks })]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(expected);
  });

  it('does not mistake a path containing a placeholder word for an unfinished plan', () => {
    const plan = { tasks: [task('task-01', { files: ['res://scripts/todo_list.gd'] })] };
    expect(runScript('validate_plan.py', [writeTempJson(tempRoot, 'plan.json', plan)]).status).toBe(0);
  });

  it('rejects silent task jumps and accepts an explicit return checkpoint', () => {
    const sliceRoot = path.join(tempRoot, 'task-order');
    mkdirSync(sliceRoot, { recursive: true });
    const frontmatter = (documentType: string) => `---\nsliceId: task-order\ndocumentType: ${documentType}\ncreatedDate: 2026-08-12\nupdatedDate: 2026-08-12\nstatus: in_progress\nlatest: true\n---\n`;
    writeFileSync(path.join(sliceRoot, 'spec.md'), frontmatter('spec') + '# Task order\n');
    writeFileSync(path.join(sliceRoot, 'plan.md'), frontmatter('plan') + '# Plan\n\n- [x] task-01: First\n- [ ] task-02: Return task\n- [ ] task-03: Temporary prerequisite\n  - Depends on: task-01\n');
    const status = {
      version: 1,
      sliceId: 'task-order',
      createdDate: '2026-08-12',
      updatedDate: '2026-08-12',
      status: 'in_progress',
      latest: true,
      completed: false,
      supersedes: [],
      tasks: [
        { id: 'task-01', status: 'completed' },
        { id: 'task-02', status: 'in_progress' },
        { id: 'task-03', status: 'completed' },
      ],
    };
    const transition = {
      pausedTaskId: 'task-02',
      reason: 'Task 03 is a newly discovered prerequisite for task-02',
      temporaryTaskIds: ['task-03'],
      returnToTaskId: 'task-02',
      discoveredDuring: 'execution',
      canInline: false,
      planImpact: {
        scopeChanged: false,
        acceptanceChanged: false,
        allowedFilesChanged: false,
      },
    };
    writeFileSync(path.join(sliceRoot, 'status.json'), JSON.stringify({
      ...status,
      tasks: status.tasks.map((task) => ({
        ...task,
        status: task.id === 'task-01' ? 'completed' : task.id === 'task-02' ? 'in_progress' : 'pending',
      })),
      taskTransition: transition,
    }));
    expect(runScript('validate_slice_documents.py', ['--slice-dir', sliceRoot]).status).toBe(0);

    writeFileSync(path.join(sliceRoot, 'status.json'), JSON.stringify(status));
    const silentJump = runScript('validate_slice_documents.py', ['--slice-dir', sliceRoot]);
    expect(silentJump.status).toBe(1);
    expect(silentJump.stderr).toMatch(/out-of-order task completion requires an explicit task transition/i);

    writeFileSync(path.join(sliceRoot, 'status.json'), JSON.stringify({
      ...status,
      taskTransition: transition,
    }));
    const explicitJump = runScript('validate_slice_documents.py', ['--slice-dir', sliceRoot]);
    expect(explicitJump.status).toBe(0);

    writeFileSync(path.join(sliceRoot, 'status.json'), JSON.stringify({
      ...status,
      tasks: status.tasks.map((task) => ({ ...task, status: 'completed' })),
      status: 'completed',
      completed: true,
      taskTransition: transition,
    }));
    writeFileSync(path.join(sliceRoot, 'eval-report.json'), JSON.stringify({ sliceId: 'task-order', status: 'passed' }));
    const stale = runScript('validate_slice_documents.py', ['--slice-dir', sliceRoot]);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toMatch(/task transition must be cleared after the return task completes/i);

    writeFileSync(path.join(sliceRoot, 'status.json'), JSON.stringify({
      ...status,
      tasks: status.tasks.map((task) => ({
        ...task,
        status: task.id === 'task-01' ? 'completed' : task.id === 'task-02' ? 'blocked' : 'pending',
      })),
      taskTransition: { ...transition, canInline: true },
    }));
    const inlineable = runScript('validate_slice_documents.py', ['--slice-dir', sliceRoot]);
    expect(inlineable.status).toBe(1);
    expect(inlineable.stderr).toMatch(/keep inlineable prerequisite work inside the paused task/i);
  });

  const report = (overrides: Record<string, unknown> = {}) => ({
    version: 2,
    runId: 'run-1',
    sliceId: 'slice-001',
    status: 'passed',
    snapshotHash: 'sha256:abc',
    evaluations: [{ evalId: 'eval-1', status: 'passed', evidence: ['KECO_OBSERVATION'], assertions: [{ assertionId: 'a-1', status: 'passed' }] }],
    runtimeBatches: [{
      batchId: 'batch-1',
      evaluationIds: ['eval-1'],
      runtimeSequence: ['run_project', 'get_debug_output', 'stop_project'],
      splitReason: null,
    }],
    changedFiles: ['game/scripts/village.gd'],
    manualRequirements: [],
    ...overrides,
  });

  it('accepts a fully evidenced passing evaluation report', () => {
    const result = runScript('validate_eval_report.py', [writeTempJson(tempRoot, 'report.json', report())]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, status: 'passed' });
  });

  it.each([
    ['a passing report without a snapshot hash', report({ snapshotHash: null }), /snapshot hash/],
    ['a passing report with an unproven evaluation', report({ evaluations: [{ evalId: 'e', status: 'passed', evidence: [] }] }), /semantic evidence/],
    ['a passing report with a failed evaluation', report({ evaluations: [{ evalId: 'e', status: 'failed', evidence: ['x'], assertions: [{ assertionId: 'a', status: 'failed' }] }] }), /computed evaluation status/],
    ['a malformed evaluations array', report({ evaluations: 'none' }), /non-empty array/],
    ['an unknown evaluation status', report({ evaluations: [{ evalId: 'e', status: 'ok', evidence: ['x'] }] }), /invalid evaluation status/],
    ['runtime batches that omit an evaluation', report({ runtimeBatches: [] }), /runtime batches must cover every evaluation exactly once/],
    [
      'multiple runtime batches without split reasons',
      report({
        evaluations: [
          { evalId: 'eval-1', status: 'passed', evidence: ['KECO_OBSERVATION'], assertions: [{ assertionId: 'a-1', status: 'passed' }] },
          { evalId: 'eval-2', status: 'passed', evidence: ['KECO_OBSERVATION'], assertions: [{ assertionId: 'a-2', status: 'passed' }] },
        ],
        runtimeBatches: [
          { batchId: 'batch-1', evaluationIds: ['eval-1'], runtimeSequence: ['run_project', 'get_debug_output', 'stop_project'], splitReason: null },
          { batchId: 'batch-2', evaluationIds: ['eval-2'], runtimeSequence: ['run_project', 'get_debug_output', 'stop_project'], splitReason: null },
        ],
      }),
      /splitReason/,
    ],
  ])('rejects %s without crashing', (_label, value, expected) => {
    const result = runScript('validate_eval_report.py', [writeTempJson(tempRoot, 'report.json', value)]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(expected);
    expect(result.stderr).not.toMatch(/Traceback/);
  });

  it('allows a blocked report to omit the snapshot hash', () => {
    const value = report({ status: 'blocked_before_write', snapshotHash: null, evaluations: [{ evalId: 'eval-1', status: 'blocked', evidence: ['MCP unavailable'] }], runtimeBatches: [] });
    expect(runScript('validate_eval_report.py', [writeTempJson(tempRoot, 'report.json', value)]).status).toBe(0);
  });

  it('emits one texture per spritesheet when animations share a sheet', () => {
    const sheet = path.join(tempRoot, 'hero.png');
    writePngHeader(sheet, 256, 32);
    const manifest = writeTempJson(tempRoot, 'animations.json', {
      version: 1,
      resourcePath: 'res://generated/hero_frames.tres',
      animations: [
        { name: 'idle', sheetPath: 'res://generated/hero.png', sheetFile: sheet, frameWidth: 32, frameHeight: 32, frameCount: 8, fps: 8, loop: true },
        { name: 'walk', sheetPath: 'res://generated/hero.png', sheetFile: sheet, frameWidth: 32, frameHeight: 32, frameCount: 8, fps: 12, loop: true },
      ],
    });
    const output = path.join(tempRoot, 'hero_frames.tres');
    const result = runScript('build_spriteframes_resource.py', ['--manifest', manifest, '--output', output]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, animationCount: 2, sheetCount: 1 });

    const resource = readFileSync(output, 'utf8');
    expect(resource.match(/ext_resource/g)).toHaveLength(1);
    expect(resource.match(/type="AtlasTexture"/g)).toHaveLength(16);
    // load_steps counts distinct textures + atlas sub-resources + the resource.
    expect(resource).toContain('load_steps=18');
    expect(resource).toContain('region = Rect2(224, 0, 32, 32)');
  });

  it.each([
    ['frame geometry that contradicts the PNG', { frameCount: 9 }, {}, /frame geometry/],
    ['a non-boolean loop flag', { loop: 'yes' }, {}, /loop must be a boolean/],
  ])('rejects %s', (_label, animationOverrides, manifestOverrides, expected) => {
    const sheet = path.join(tempRoot, 'hero.png');
    writePngHeader(sheet, 256, 32);
    const manifest = writeTempJson(tempRoot, 'animations.json', {
      version: 1,
      resourcePath: 'res://generated/hero_frames.tres',
      animations: [{
        name: 'idle', sheetPath: 'res://generated/hero.png', sheetFile: sheet,
        frameWidth: 32, frameHeight: 32, frameCount: 8, fps: 8, loop: true, ...animationOverrides,
      }],
      ...manifestOverrides,
    });
    const result = runScript('build_spriteframes_resource.py', ['--manifest', manifest, '--output', path.join(tempRoot, 'hero_frames.tres')]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(expected);
  });

  it('binds the built resource name to the manifest resourcePath', () => {
    const sheet = path.join(tempRoot, 'hero.png');
    writePngHeader(sheet, 64, 32);
    const manifest = writeTempJson(tempRoot, 'animations.json', {
      version: 1,
      resourcePath: 'res://generated/hero_frames.tres',
      animations: [{ name: 'idle', sheetPath: 'res://generated/hero.png', sheetFile: sheet, frameWidth: 32, frameHeight: 32, frameCount: 2, fps: 8, loop: true }],
    });
    const result = runScript('build_spriteframes_resource.py', ['--manifest', manifest, '--output', path.join(tempRoot, 'other_name.tres')]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/must be named hero_frames\.tres/);
  });

  it('validates a ui asset package against the shared vocabulary', () => {
    const assetDir = path.join(tempRoot, 'assets');
    mkdirSync(assetDir, { recursive: true });
    const panel = path.join(assetDir, 'panel.png');
    writePngHeader(panel, 64, 64);
    const packagePath = writeTempJson(tempRoot, 'package.json', {
      version: 1,
      projectRoot: tempRoot,
      assets: [{
        assetKey: 'inventory-panel',
        assetKind: 'ui',
        provider: { capability: 'ui-elements-pro', transportTool: null, assetId: 'provider-panel' },
        status: 'ready',
        files: [{ fileKey: 'panel', sourceFile: 'assets/panel.png', targetPath: 'res://ui/panel.png', sha256: sha256(panel), width: 64, height: 64 }],
      }],
    });
    const result = runScript('validate_generated_asset_package.py', [packagePath]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, assetCount: 1, fileCount: 1 });
  });

  it('accepts slice documents whose frontmatter contains blank lines and comments', () => {
    const sliceDir = path.join(tempRoot, 'hero-animation');
    mkdirSync(sliceDir, { recursive: true });
    const frontmatter = (documentType: string) =>
      `---\nsliceId: hero-animation\n\n# authored by the roadmap stage\ndocumentType: ${documentType}\ncreatedDate: 2026-08-06\nupdatedDate: 2026-08-06\nstatus: in_progress\nlatest: true\n---\n`;
    writeFileSync(path.join(sliceDir, 'spec.md'), `${frontmatter('spec')}\n# Hero animation\n`);
    writeFileSync(path.join(sliceDir, 'plan.md'), `${frontmatter('plan')}\n# Plan\n\n- [ ] task-01: Hero animation\n`);
    writeTempJson(sliceDir, 'status.json', {
      version: 1,
      sliceId: 'hero-animation',
      createdDate: '2026-08-06',
      updatedDate: '2026-08-06',
      status: 'in_progress',
      latest: true,
      completed: false,
      supersedes: [],
      tasks: [{ id: 'task-01', status: 'pending' }],
    });
    const result = runScript('validate_slice_documents.py', ['--slice-dir', sliceDir]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, sliceId: 'hero-animation' });
  });

  it('refuses to replace a directory that is not a previous snapshot', () => {
    const victim = path.join(tempRoot, 'not-a-snapshot');
    mkdirSync(victim, { recursive: true });
    writeFileSync(path.join(victim, 'important.txt'), 'user data');
    const input = path.join(repositoryRoot, 'tests', 'fixtures', 'plugins', 'keco-godot-snapshot-input.json');

    const result = runScript('export_keco_snapshot.py', ['--input', input, '--output-dir', victim]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not a snapshot/);
    expect(existsSync(path.join(victim, 'important.txt'))).toBe(true);
  });

  it('exports, re-exports, and validates a deterministic snapshot', () => {
    const input = path.join(repositoryRoot, 'tests', 'fixtures', 'plugins', 'keco-godot-snapshot-input.json');
    const output = path.join(tempRoot, 'snapshot');

    const first = runScript('export_keco_snapshot.py', ['--input', input, '--output-dir', output]);
    expect(first.status).toBe(0);
    const second = runScript('export_keco_snapshot.py', ['--input', input, '--output-dir', output]);
    expect(second.status).toBe(0);
    expect(JSON.parse(second.stdout).aggregateSha256).toBe(JSON.parse(first.stdout).aggregateSha256);

    const validated = runScript('validate_snapshot.py', ['--snapshot-dir', output, '--source-input', input]);
    expect(validated.status).toBe(0);
    expect(JSON.parse(validated.stdout)).toMatchObject({ ok: true });
  });
});
