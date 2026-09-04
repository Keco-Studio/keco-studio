import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const repositoryRoot = process.cwd();
const skillRoot = path.join(repositoryRoot, 'plugins', 'keco-codex', 'skills', 'keco-develop-godot-slice-v2');
const phaseRoots = {
  preflight: path.join(repositoryRoot, 'plugins', 'keco-codex', 'skills', 'keco-godot-slice-preflight'),
  assets: path.join(repositoryRoot, 'plugins', 'keco-codex', 'skills', 'keco-godot-slice-assets'),
  implementation: path.join(repositoryRoot, 'plugins', 'keco-codex', 'skills', 'keco-godot-slice-implementation'),
  verification: path.join(repositoryRoot, 'plugins', 'keco-codex', 'skills', 'keco-godot-slice-verification'),
  delivery: path.join(repositoryRoot, 'plugins', 'keco-codex', 'skills', 'keco-godot-slice-delivery'),
};

function moduleFile(relativePath: string): string {
  const owners: Record<string, keyof typeof phaseRoots> = {
    'scripts/export_keco_snapshot.py': 'preflight',
    'scripts/slice_contract.py': 'preflight',
    'scripts/validate_contract_case.py': 'preflight',
    'scripts/validate_gdd_coverage.py': 'preflight',
    'scripts/validate_plan.py': 'preflight',
    'scripts/validate_run_context.py': 'preflight',
    'scripts/validate_slice_decomposition.py': 'preflight',
    'scripts/validate_snapshot.py': 'preflight',
    'scripts/build_spriteframes_resource.py': 'assets',
    'scripts/validate_generated_asset_package.py': 'assets',
    'scripts/validate_interaction_checkpoint.py': 'implementation',
    'scripts/validate_task_evidence.py': 'implementation',
    'scripts/derive_slice_status.py': 'verification',
    'scripts/evaluate_runtime_observations.py': 'verification',
    'scripts/validate_eval_report.py': 'verification',
    'scripts/materialize_slice_mirrors.py': 'delivery',
    'scripts/validate_delivery_policy.py': 'delivery',
    'references/source-data-contract.md': 'preflight',
    'references/slice-decision.md': 'preflight',
    'references/slice-document-contract.md': 'preflight',
    'references/multi-slice-orchestration.md': 'preflight',
    'references/gdd-coverage-contract.md': 'preflight',
    'references/gdd-change-contract.md': 'preflight',
    'references/contract-manifest.json': 'preflight',
    'references/generated-asset-contract.md': 'assets',
    'references/existing-resource-evolution.md': 'assets',
    'references/godot-animation-contract.md': 'assets',
    'references/godot-tileset-contract.md': 'assets',
    'references/keco-pixellab-contract.md': 'assets',
    'references/pixellab-capability-registry.md': 'assets',
    'references/review-workflow.md': 'implementation',
    'references/eval-contract.md': 'verification',
    'references/godot-mcp-contract.md': 'verification',
    'references/default-delivery-policy.json': 'delivery',
  };
  const owner = owners[relativePath];
  if (!owner) throw new Error(`Unmapped module file: ${relativePath}`);
  return path.join(phaseRoots[owner], relativePath);
}

function claudeModuleFile(relativePath: string): string {
  const owners: Record<string, keyof typeof phaseRoots> = {
    'references/source-data-contract.md': 'preflight',
    'references/slice-decision.md': 'preflight',
    'references/slice-document-contract.md': 'preflight',
    'references/multi-slice-orchestration.md': 'preflight',
    'references/gdd-coverage-contract.md': 'preflight',
    'references/gdd-change-contract.md': 'preflight',
    'references/contract-manifest.json': 'preflight',
    'references/generated-asset-contract.md': 'assets',
    'references/existing-resource-evolution.md': 'assets',
    'references/godot-animation-contract.md': 'assets',
    'references/godot-tileset-contract.md': 'assets',
    'references/keco-pixellab-contract.md': 'assets',
    'references/pixellab-capability-registry.md': 'assets',
    'references/review-workflow.md': 'implementation',
    'references/eval-contract.md': 'verification',
    'references/godot-mcp-contract.md': 'verification',
    'references/default-delivery-policy.json': 'delivery',
  };
  const owner = owners[relativePath];
  if (!owner) throw new Error(`Unmapped Claude module file: ${relativePath}`);
  return path.join(repositoryRoot, 'plugins', 'keco-claude', 'skills', `keco-godot-slice-${owner}`, relativePath);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
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

function treeDigest(root: string): string {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue;
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else files.push(path.relative(root, filePath).replaceAll(path.sep, '/') + '\0' + sha256(filePath));
    }
  };
  visit(root);
  return createHash('sha256').update(files.sort().join('\n')).digest('hex');
}

function markdownFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(root, entry.name);
    return entry.isDirectory() ? markdownFiles(entryPath) : entry.name.endsWith('.md') ? [entryPath] : [];
  });
}

function normalizedPlatformSkill(value: string): string {
  return value
    .replace(/^description:.*$/m, 'description: <platform trigger>')
    .replaceAll('${CLAUDE_PLUGIN_ROOT}/scripts/', 'scripts/')
    .replaceAll('../../references/pixellab-capability-registry.md', 'references/pixellab-capability-registry.md');
}

const mirrorScript = moduleFile('scripts/materialize_slice_mirrors.py');
const mirrorJournal = '.keco-slice-mirror-journal.json';

function mirrorFixture(tempRoot: string) {
  const root = path.join(tempRoot, 'repository');
  mkdirSync(root);
  const paths = [
    'docs/superpowers/roadmap.md',
    'docs/superpowers/specs/slice-1-design.md',
    'docs/superpowers/plans/slice-1.md',
  ];
  const kinds = ['roadmap', 'spec', 'plan'];
  const originals = paths.map((relative, index) => {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    const content = `original-${index}\n`;
    writeFileSync(target, content);
    return content;
  });
  const files = paths.map((repositoryPath, index) => {
    const content = `replacement-${index}\n`;
    return {
      kind: kinds[index],
      repositoryPath,
      documentId: `${index + 1}1111111-1111-4111-8111-111111111111`,
      folderId: `${index + 4}1111111-1111-4111-8111-111111111111`,
      epoch: 1,
      revision: 2,
      byteCount: Buffer.byteLength(content),
      sha256: `sha256:${createHash('sha256').update(content).digest('hex')}`,
      content,
    };
  });
  const manifest = {
    ok: true,
    schemaVersion: 2,
    canonicalizationVersion: 1,
    contractVersion: 2,
    runId: '71111111-1111-4111-8111-111111111111',
    stateToken: '81111111-1111-4111-8111-111111111111',
    currentSequence: 8,
    preparedSequence: 7,
    files,
    manifestHash: `sha256:${createHash('sha256').update(canonicalJson(files)).digest('hex')}`,
  };
  const manifestPath = path.join(tempRoot, 'manifest.json');
  const allowedPath = path.join(tempRoot, 'allowed.json');
  const output = path.join(tempRoot, 'mirror-verification.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(allowedPath, JSON.stringify({ allowedFiles: paths }));
  return { root, paths, originals, files, manifestPath, allowedPath, output };
}

function runMirror(
  fixture: ReturnType<typeof mirrorFixture>,
  fault?: string,
  restoreFault = false,
) {
  return spawnSync('python3', [
    mirrorScript,
    '--manifest', fixture.manifestPath,
    '--repository-root', fixture.root,
    '--allowed-files', fixture.allowedPath,
    '--output', fixture.output,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(fault ? { KECO_MIRROR_TEST_FAULT: fault } : {}),
      ...(restoreFault ? { KECO_MIRROR_TEST_RESTORE_FAULT: '1' } : {}),
    },
  });
}

describe('Keco Godot Slice V2 skill contract', () => {
  it('matches the installed Codex cache for the released Slice V2 tree', () => {
    const manifest = JSON.parse(readFileSync(path.join(repositoryRoot, 'plugins/keco-codex/.codex-plugin/plugin.json'), 'utf8')) as { version: string };
    const installedRoot = path.join(process.env.CODEX_HOME || '/home/hetu/.codex', 'plugins/cache/keco-studio/keco', manifest.version);
    const repositorySkill = path.join(repositoryRoot, 'plugins/keco-codex/skills/keco-develop-godot-slice-v2');
    const installedSkill = path.join(installedRoot, 'skills/keco-develop-godot-slice-v2');
    // CI runners do not necessarily have the locally installed plugin cache.
    // When present, enforce exact repository/cache parity.
    if (!existsSync(installedSkill)) return;
    expect(treeDigest(installedSkill)).toBe(treeDigest(repositorySkill));
  });
  it('keeps the main Skill as a concise V2 router with conditional references', () => {
    const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    expect(skill.split('\n').length).toBeLessThanOrEqual(110);
    expect(skill).not.toContain('```yaml');
    expect(skill).toMatch(/contractVersion\s*:\s*2/i);
    expect(skill).toMatch(/SourceProfile[\s\S]*gdd[\s\S]*feedback[\s\S]*document[\s\S]*table[\s\S]*user_idea/i);
    expect(skill).toMatch(/kind[^a-z0-9]+gdd[\s\S]{0,320}gdd-coverage-contract\.md/i);
    expect(skill).toMatch(/asset[\s\S]{0,320}generated-asset-contract\.md/i);
    expect(skill).toMatch(/animation[\s\S]{0,320}godot-animation-contract\.md/i);
    expect(skill).toMatch(/tileset[\s\S]{0,320}godot-tileset-contract\.md/i);
  });

  it('documents the immutable V2 delivery sequence and verified review levels', () => {
    const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    expect(skill).toMatch(/implementation_complete[\s\S]{0,180}prepare_delivery[\s\S]{0,180}export_slice_mirrors[\s\S]{0,180}materialize[\s\S]{0,180}MirrorVerification[\s\S]{0,180}(?:delivery|finalize_slice)/i);
    expect(skill).toMatch(/same.actor[\s\S]{0,180}(?:never|cannot)[\s\S]{0,120}independent_actor/i);
    expect(skill).toMatch(/separate_context[\s\S]{0,180}trusted/i);
    expect(skill).toMatch(/exactly three[\s\S]{0,180}roadmap[\s\S]{0,180}spec[\s\S]{0,180}plan/i);
    expect(skill).not.toMatch(/independent TaskReview|independent review/i);
  });

  it('contains no project identity and rejects retired runtime prefixes', () => {
    const roots = [
      skillRoot,
      path.join(repositoryRoot, 'plugins', 'keco-claude', 'skills', 'keco-develop-godot-slice-v2'),
    ];
    for (const root of roots) {
      const sources = markdownFiles(root).map(file => readFileSync(file, 'utf8'));
      expect(sources.join('\n')).not.toMatch(/test8-24|game-gdd/i);
      expect(sources.join('\n')).not.toContain('KECO_EVAL');
    }
  });

  it('keeps Codex and Claude Skill behavior identical after platform normalization', () => {
    const codex = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const claude = readFileSync(
      path.join(repositoryRoot, 'plugins', 'keco-claude', 'skills', 'keco-develop-godot-slice-v2', 'SKILL.md'),
      'utf8',
    );
    expect(normalizedPlatformSkill(claude)).toBe(normalizedPlatformSkill(codex));
    for (const reference of [
      'orchestration-contract.md', 'review-workflow.md', 'default-delivery-policy.json',
      'multi-slice-orchestration.md', 'slice-document-contract.md', 'source-data-contract.md',
      'eval-contract.md', 'godot-mcp-contract.md', 'gdd-coverage-contract.md', 'gdd-change-contract.md',
      'godot-animation-contract.md', 'godot-tileset-contract.md', 'generated-asset-contract.md',
      'keco-pixellab-contract.md', 'ab-matrix.md',
    ]) {
      const codexReference = reference === 'orchestration-contract.md' || reference === 'ab-matrix.md'
        ? path.join(skillRoot, 'references', reference)
        : moduleFile(`references/${reference}`);
      const claudeReference = reference === 'orchestration-contract.md' || reference === 'ab-matrix.md'
        ? path.join(repositoryRoot, 'plugins', 'keco-claude', 'skills', 'keco-develop-godot-slice-v2', 'references', reference)
        : claudeModuleFile(`references/${reference}`);
      expect(readFileSync(codexReference)).toEqual(readFileSync(claudeReference));
    }
    expect(readFileSync(moduleFile('references/pixellab-capability-registry.md'))).toEqual(readFileSync(path.join(
      repositoryRoot, 'plugins', 'keco-claude', 'references', 'pixellab-capability-registry.md',
    )));
    const sharedScripts: Array<[string, string]> = [
      ['plugins/keco-codex/skills/keco-godot-slice-assets/scripts/build_spriteframes_resource.py', 'plugins/keco-claude/scripts/build_spriteframes_resource.py'],
      ['plugins/keco-codex/skills/keco-godot-slice-preflight/scripts/export_keco_snapshot.py', 'plugins/keco-claude/scripts/export_keco_snapshot.py'],
      ['plugins/keco-codex/skills/keco-godot-slice-assets/scripts/validate_generated_asset_package.py', 'plugins/keco-claude/scripts/validate_generated_asset_package.py'],
      ['plugins/keco-codex/skills/keco-godot-slice-preflight/scripts/slice_contract.py', 'plugins/keco-claude/scripts/slice_contract.py'],
      ['plugins/keco-codex/skills/keco-godot-slice-verification/scripts/evaluate_runtime_observations.py', 'plugins/keco-claude/scripts/evaluate_runtime_observations.py'],
    ];
    for (const [codexPath, claudePath] of sharedScripts) {
      expect(readFileSync(path.join(repositoryRoot, codexPath))).toEqual(readFileSync(path.join(repositoryRoot, claudePath)));
    }
  });

  it('keeps canonical Spec and Plan templates byte-identical in both preflight modules', () => {
    const canonicalRoot = path.join(repositoryRoot, 'contracts', 'keco-slice-v2');
    const codexRoot = path.join(repositoryRoot, 'plugins', 'keco-codex', 'skills', 'keco-godot-slice-preflight', 'references');
    const claudeRoot = path.join(repositoryRoot, 'plugins', 'keco-claude', 'skills', 'keco-godot-slice-preflight', 'references');
    const requiredHeadings: Record<string, string[]> = {
      'spec-template.md': [
        'Slice Identity', 'Objective', 'Scope', 'Technical Contract', 'Inputs', 'Outputs',
        'Parameters & Boundaries', 'Module Interfaces', 'Error & Exception Scenarios',
        'State & Invariants', 'Acceptance Mapping', 'Out of Scope',
      ],
      'plan-template.md': [
        'Implementation Strategy', 'Dependency Graph', 'Risk Register', 'Execution Constraints',
        'Task Checklist', 'Delivery Checklist',
      ],
    };
    for (const [relative, headings] of Object.entries(requiredHeadings)) {
      const canonical = readFileSync(path.join(canonicalRoot, relative));
      expect(readFileSync(path.join(codexRoot, relative))).toEqual(canonical);
      expect(readFileSync(path.join(claudeRoot, relative))).toEqual(canonical);
      const text = canonical.toString();
      const positions = headings.map(heading => {
        const match = text.match(new RegExp(`^#{2,3} ${heading}$`, 'm'));
        expect(match).not.toBeNull();
        return match ? text.indexOf(match[0]) : -1;
      });
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      if (relative === 'spec-template.md') {
        expect(text).toMatch(/\| inputId \| name \| source \| type \| required \| constraints \| default \|/);
        expect(text).toMatch(/\| outputId \| name \| type \| shape \| guarantees \|/);
        expect(text).toMatch(/\| parameterId \| name \| type \| allowed range or enum \| boundary behavior \|/);
        expect(text).toMatch(/\| interfaceId \| provider \| consumer \| operation\/signature \| protocol or data contract \|/);
        expect(text).toMatch(/\| errorId \| condition \| detection \| response \| observable result \|/);
        expect(text).toMatch(/\| invariantId \| state or transition \| invariant \|/);
        expect(text).toMatch(/\| acceptanceId \| behavior \| sourceMapping \| evalId \|/);
      } else {
        for (const label of ['Files', 'Consumes', 'Produces', 'Depends on', 'Source mappings', 'Serves evaluations', 'RED:', 'GREEN:', 'Verification:', 'Review:']) {
          expect(text).toContain(label);
        }
        expect(text).toMatch(/````text\n```text[\s\S]*```\n````/);
      }
      for (const moduleRoot of [codexRoot, claudeRoot]) {
        const skill = readFileSync(path.join(moduleRoot, '..', 'SKILL.md'), 'utf8');
        expect(skill).toContain(`- [${relative}](references/${relative})`);
      }
    }
  });

  it('uses the complete V2 release order in the bundled default policy', () => {
    const policy = JSON.parse(readFileSync(moduleFile('references/default-delivery-policy.json'), 'utf8'));
    expect(policy.releaseOrder).toEqual([
      'implementation', 'runtime_verification', 'acceptance', 'manual_review',
      'package', 'roadmap_completion', 'mirrors', 'seal',
    ]);
  });
  it.each(['before_staging', 'after_first_replacement', 'during_readback'])(
    'restores every mirror target after handled %s failure',
    fault => {
      const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-slice-v2-mirror-'));
      try {
        const fixture = mirrorFixture(tempRoot);
        const result = runMirror(fixture, fault);
        expect(result.status).toBe(1);
        fixture.paths.forEach((relative, index) => {
          expect(readFileSync(path.join(fixture.root, relative), 'utf8')).toBe(fixture.originals[index]);
        });
        expect(existsSync(fixture.output)).toBe(false);
        expect(existsSync(path.join(fixture.root, mirrorJournal))).toBe(false);
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    },
  );

  it('recovers a durable journal before processing the next manifest', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-slice-v2-crash-'));
    try {
      const fixture = mirrorFixture(tempRoot);
      const crashed = runMirror(fixture, 'after_journal_fsync');
      expect(crashed.status).not.toBe(0);
      expect(existsSync(path.join(fixture.root, mirrorJournal))).toBe(true);
      expect(existsSync(fixture.output)).toBe(false);
      const recovered = runMirror(fixture);
      expect(recovered.status).toBe(0);
      fixture.paths.forEach((relative, index) => {
        expect(readFileSync(path.join(fixture.root, relative), 'utf8')).toBe(fixture.files[index].content);
      });
      expect(existsSync(path.join(fixture.root, mirrorJournal))).toBe(false);
      expect(JSON.parse(readFileSync(fixture.output, 'utf8'))).toMatchObject({
        artifactType: 'MirrorVerification',
        manifestHash: JSON.parse(readFileSync(fixture.manifestPath, 'utf8')).manifestHash,
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('reports recoverable partial state without MirrorVerification when restore fails', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-slice-v2-partial-'));
    try {
      const fixture = mirrorFixture(tempRoot);
      const partial = runMirror(fixture, 'after_first_replacement', true);
      expect(partial.status).toBe(2);
      expect(JSON.parse(partial.stdout)).toMatchObject({
        ok: false,
        status: 'partial',
        reasonCode: 'SLICE_MIRROR_RECOVERY_REQUIRED',
        affectedPaths: expect.arrayContaining([fixture.paths[0]]),
      });
      expect(existsSync(fixture.output)).toBe(false);
      expect(existsSync(path.join(fixture.root, mirrorJournal))).toBe(true);
      expect(runMirror(fixture).status).toBe(0);
      expect(existsSync(path.join(fixture.root, mirrorJournal))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('preflights the complete batch and rejects symlinked parents before replacement', () => {
    for (const mode of ['disallowed', 'symlink'] as const) {
      const tempRoot = mkdtempSync(path.join(os.tmpdir(), `keco-slice-v2-${mode}-`));
      try {
        const fixture = mirrorFixture(tempRoot);
        if (mode === 'disallowed') {
          writeFileSync(fixture.allowedPath, JSON.stringify({ allowedFiles: fixture.paths.slice(0, 2) }));
        } else {
          const outside = path.join(tempRoot, 'outside');
          mkdirSync(outside);
          rmSync(path.join(fixture.root, 'docs'), { recursive: true });
          symlinkSync(outside, path.join(fixture.root, 'docs'), 'dir');
        }
        const result = runMirror(fixture);
        expect(result.status).toBe(1);
        expect(existsSync(fixture.output)).toBe(false);
        expect(existsSync(path.join(fixture.root, mirrorJournal))).toBe(false);
        if (mode === 'disallowed') {
          fixture.paths.forEach((relative, index) => {
            expect(readFileSync(path.join(fixture.root, relative), 'utf8')).toBe(fixture.originals[index]);
          });
        }
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  it('matches the canonical V2 conformance corpus in both Python runtimes', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-slice-v2-contract-'));
    const canonicalManifest = readFileSync(path.join(repositoryRoot, 'contracts', 'keco-slice-v2', 'contract-manifest.json'));
    const corpus = JSON.parse(
      readFileSync(path.join(repositoryRoot, 'contracts', 'keco-slice-v2', 'conformance-cases.json'), 'utf8'),
    ) as { cases: Array<{ id: string; boundary: string; input: unknown; expected: unknown }> };
    const runtimes = [
      { references: path.join(phaseRoots.preflight, 'references'), scripts: path.join(phaseRoots.preflight, 'scripts') },
      {
        references: path.join(repositoryRoot, 'plugins', 'keco-claude', 'skills', 'keco-godot-slice-preflight', 'references'),
        scripts: path.join(repositoryRoot, 'plugins', 'keco-claude', 'scripts'),
      },
    ];
    try {
      for (const runtime of runtimes) {
        expect(readFileSync(path.join(runtime.references, 'contract-manifest.json'))).toEqual(canonicalManifest);
        const validator = path.join(runtime.scripts, 'validate_contract_case.py');
        for (const testCase of corpus.cases) {
          const input = path.join(tempRoot, `${testCase.id}.json`);
          writeFileSync(input, JSON.stringify(testCase.input));
          const result = spawnSync('python3', [validator, testCase.boundary, input], { encoding: 'utf8' });
          expect({ id: testCase.id, status: result.status, stderr: result.stderr }).toEqual({
            id: testCase.id,
            status: 0,
            stderr: '',
          });
          expect(JSON.parse(result.stdout)).toEqual(testCase.expected);
        }
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('validates reciprocal V2 Plan and EvalSpec for every non-GDD source profile', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-slice-v2-preflight-'));
    const hash = (character: string) => `sha256:${character.repeat(64)}`;
    const common = {
      schemaVersion: 1,
      contractVersion: 2,
      kecoProjectId: '11111111-1111-4111-8111-111111111111',
      capturedAt: '2026-09-03T00:00:00Z',
      sourceHash: hash('a'),
      selectionEvidence: [],
    };
    const profiles = [
      { ...common, kind: 'feedback', documentId: '22222222-2222-4222-8222-222222222222', epoch: 0, revision: 1, contentHash: hash('b') },
      { ...common, kind: 'document', documentId: '22222222-2222-4222-8222-222222222222', epoch: 0, revision: 1, contentHash: hash('b') },
      { ...common, kind: 'table', tableId: '22222222-2222-4222-8222-222222222222', schemaHash: hash('b'), rowIds: [], rowHashes: {}, contentHash: hash('c') },
      { ...common, kind: 'user_idea', requestHash: hash('b'), requestExcerpt: 'Add a bounded shelter interaction.' },
    ];
    const validator = moduleFile('scripts/validate_plan.py');
    try {
      for (const profile of profiles) {
        const sourceProfileHash = `sha256:${createHash('sha256').update(canonicalJson(profile)).digest('hex')}`;
        const plan = {
          schemaVersion: 2,
          coverageMode: 'non_gdd',
          sourceProfileHash,
          nonGddRationale: 'The selected source directly authorizes this Slice.',
          planRevision: hash('d'),
          allowedFiles: ['game/main.gd'],
          tasks: [{
            id: 'task-1', files: ['game/main.gd'], dependsOn: [], servesEvaluations: ['eval-1'],
            red: { command: 'test red', expected: 'fails' }, green: { command: 'test green', expected: 'passes' },
            review: { minimumLevel: 'self' }, sourceMappings: ['source-1'],
          }],
        };
        const evalSpec = {
          schemaVersion: 2,
          coverageMode: 'non_gdd',
          sourceProfileHash,
          evaluations: [{
            evalId: 'eval-1', servedByTasks: ['task-1'], buildHash: hash('e'), snapshotHash: hash('f'),
            assertions: [{ assertionId: 'ready', kind: 'equals', path: '/ready', expected: true }],
          }],
        };
        const profilePath = path.join(tempRoot, `${profile.kind}-profile.json`);
        const planPath = path.join(tempRoot, `${profile.kind}-plan.json`);
        const evalPath = path.join(tempRoot, `${profile.kind}-eval.json`);
        writeFileSync(profilePath, JSON.stringify(profile));
        writeFileSync(planPath, JSON.stringify(plan));
        writeFileSync(evalPath, JSON.stringify(evalSpec));
        const valid = spawnSync('python3', [validator, planPath, '--eval-spec', evalPath, '--source-profile', profilePath], { encoding: 'utf8' });
        expect({ kind: profile.kind, status: valid.status, stderr: valid.stderr }).toEqual({ kind: profile.kind, status: 0, stderr: '' });

        writeFileSync(evalPath, JSON.stringify({
          ...evalSpec,
          evaluations: [{ ...evalSpec.evaluations[0], servedByTasks: ['task-other'] }],
        }));
        const invalid = spawnSync('python3', [validator, planPath, '--eval-spec', evalPath, '--source-profile', profilePath], { encoding: 'utf8' });
        expect(invalid.status).toBe(1);
        expect(invalid.stderr).toMatch(/SLICE_EVAL_BINDING_INVALID/);
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('produces the shared contract fixture outcomes through the Python CLI', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-slice-fixtures-'));
    const evaluator = moduleFile('scripts/evaluate_runtime_observations.py');
    const fixture = JSON.parse(readFileSync(path.join(repositoryRoot, 'tests', 'fixtures', 'plugins', 'keco-slice-contract-cases.json'), 'utf8')) as {
      buildHash: string;
      snapshotHash: string;
      cases: Array<Record<string, unknown>>;
    };
    try {
      for (const item of fixture.cases) {
        const id = item.id as string;
        const spec = path.join(tempRoot, `${id}-spec.json`);
        const debug = path.join(tempRoot, `${id}-debug.txt`);
        const output = path.join(tempRoot, `${id}-result.json`);
        writeFileSync(spec, JSON.stringify({ schemaVersion: 2, coverageMode: 'non_gdd', sourceProfileHash: fixture.buildHash, evaluations: [{
          evalId: id,
          buildHash: fixture.buildHash,
          snapshotHash: fixture.snapshotHash,
          servedByTasks: ['task-1'], assertions: [item.assertion],
        }] }));
        if (item.legacy) return;
        const runtime = {
          schemaVersion: 1,
          runId: 'run-1',
          sliceId: 'slice-1',
          evalId: id,
          buildHash: item.observationBuildHash ?? fixture.buildHash,
          snapshotHash: fixture.snapshotHash,
          actual: item.actual,
          errors: [],
        };
        writeFileSync(debug, `KECO_OBSERVATION ${JSON.stringify(runtime)}\n`);
        const result = spawnSync('python3', [
          evaluator,
          '--eval-spec', spec,
          '--debug-output', debug,
          '--output', output,
        ], { encoding: 'utf8' });
        expect({ id, exitCode: result.status, stderr: result.stderr }).toEqual({ id, exitCode: 0, stderr: '' });
        const evaluated = JSON.parse(readFileSync(output, 'utf8')).evaluations[0];
        expect({ id, status: evaluated.status, reasonCode: evaluated.reasonCodes[0] }).toEqual({
          id,
          status: item.expectedStatus,
          reasonCode: item.reasonCode,
        });
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects retired runtime evidence prefixes', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-slice-evidence-'));
    const evaluator = moduleFile('scripts/evaluate_runtime_observations.py');
    const hash = (character: string) => `sha256:${character.repeat(64)}`;
    try {
      const spec = path.join(tempRoot, 'eval-spec.json');
      const debug = path.join(tempRoot, 'debug.txt');
      const output = path.join(tempRoot, 'result.json');
      writeFileSync(spec, JSON.stringify({ schemaVersion: 2, coverageMode: 'non_gdd', sourceProfileHash: hash('c'), evaluations: [{
        evalId: 'eval-1', buildHash: hash('a'), snapshotHash: hash('b'),
        assertions: [{ assertionId: 'guardian', kind: 'equals', path: '/guardianRoundtrip', expected: true }],
      }] }));
      writeFileSync(debug, `KECO_EVAL ${JSON.stringify({
        runId: 'run-1', sliceId: 'slice-1', evalId: 'eval-1',
        buildHash: hash('a'), snapshotHash: hash('b'),
        status: 'passed', expected: { guardianRoundtrip: true },
        actual: { catType: 'sickly' }, errors: [],
      })}\n`);
      const rejected = spawnSync('python3', [evaluator, '--eval-spec', spec, '--debug-output', debug, '--output', output], { encoding: 'utf8' });
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toMatch(/KECO_EVAL|schemaVersion|not accepted|servedByTasks/i);
      const result = spawnSync('python3', [evaluator, '--eval-spec', spec, '--debug-output', debug, '--output', output], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(existsSync(output)).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('evaluates a V2 EvalSpec only from KECO_OBSERVATION evidence', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-slice-v2-runtime-'));
    const evaluator = moduleFile('scripts/evaluate_runtime_observations.py');
    const hash = (character: string) => `sha256:${character.repeat(64)}`;
    try {
      const spec = path.join(tempRoot, 'eval-spec.json');
      const debug = path.join(tempRoot, 'debug.txt');
      const output = path.join(tempRoot, 'result.json');
      writeFileSync(spec, JSON.stringify({
        schemaVersion: 2,
        coverageMode: 'non_gdd',
        sourceProfileHash: hash('a'),
        evaluations: [{
          evalId: 'eval-1',
          servedByTasks: ['task-1'],
          buildHash: hash('b'),
          snapshotHash: hash('c'),
          assertions: [{ assertionId: 'ready', kind: 'equals', path: '/ready', expected: true }],
        }],
      }));
      writeFileSync(debug, `KECO_OBSERVATION ${JSON.stringify({
        schemaVersion: 1,
        runId: 'run-1',
        sliceId: 'slice-1',
        evalId: 'eval-1',
        buildHash: hash('b'),
        snapshotHash: hash('c'),
        actual: { ready: true },
        errors: [],
      })}\n`);
      const result = spawnSync('python3', [evaluator, '--eval-spec', spec, '--debug-output', debug, '--output', output], { encoding: 'utf8' });
      expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
      expect(JSON.parse(readFileSync(output, 'utf8'))).toMatchObject({ status: 'passed' });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('derives implementation completion separately from manual acceptance', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-slice-status-'));
    try {
      const input = path.join(tempRoot, 'input.json');
      const output = path.join(tempRoot, 'output.json');
      writeFileSync(input, JSON.stringify({
        tasks: [{ status: 'completed', resultAccepted: true, reviewAccepted: true }],
        evaluations: [{ status: 'passed' }], manualRequired: true,
        mirrorsVerified: true,
      }));
      const result = spawnSync('python3', [moduleFile('scripts/derive_slice_status.py'), input, '--output', output], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(JSON.parse(readFileSync(output, 'utf8'))).toMatchObject({
        implementationStatus: 'completed', runtimeVerificationStatus: 'passed',
        acceptanceStatus: 'manual_required', releaseReadiness: 'blocked_by_manual_review',
      });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('requires checklist-based authoritative Keco roadmap and Slice plans', () => {
    const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const orchestration = readFileSync(
      moduleFile('references/multi-slice-orchestration.md'),
      'utf8',
    );

    expect(orchestration).toContain('User-Facing Layout');
    expect(orchestration).toContain('- [ ]');
    expect(orchestration).toContain('- [x]');
    expect(orchestration).toContain('Checklist Task Contract');
    expect(orchestration).toMatch(/- \[ \] task-001:/);
    expect(orchestration).toMatch(/checkbox in `plan\.md` is the user-facing mark/i);
    expect(skill).toMatch(/roadmap[\s\S]{0,180}checklist/i);
    expect(skill).toMatch(/Slice[\s\S]{0,180}plan[\s\S]{0,180}checklist/i);
  });

  it('uses the repository Superpowers specs/plans layout as the user-facing Slice source of truth', () => {
    const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const orchestration = readFileSync(
      moduleFile('references/multi-slice-orchestration.md'),
      'utf8',
    );
    const documents = readFileSync(
      moduleFile('references/slice-document-contract.md'),
      'utf8',
    );

    expect(skill).toMatch(/docs\/superpowers\/specs[\s\S]*docs\/superpowers\/plans/i);
    expect(orchestration).toMatch(/specs\/<slice-id>-design\.md[\s\S]*plans\/<slice-id>\.md/i);
    expect(orchestration).toMatch(/checkbox[\s\S]*plan\.md|plan\.md[\s\S]*checkbox/i);
    expect(documents).toMatch(/user-facing[\s\S]*spec[\s\S]*plan/i);
    expect(documents).toMatch(/status\.json[\s\S]*internal|internal[\s\S]*status\.json/i);
    expect(documents).not.toMatch(/docs\/keco-godot-slices\/<slice-id>\/\s*spec\.md/i);
  });

  it('keeps V2 as the canonical workflow for document-driven Godot creation', () => {
    const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    expect(skill).toMatch(/V2 is the canonical creation workflow/i);
    expect(skill).toMatch(/no new run routes to a legacy workflow/i);
  });

  it('supports document-driven implicit invocation and exposes a self-contained reviewed ledger', () => {
    const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const metadata = readFileSync(path.join(skillRoot, 'agents', 'openai.yaml'), 'utf8');
    expect(skill).toMatch(/^---\nname: keco-develop-godot-slice-v2\n/);
    expect(skill).toMatch(/implicit[\s\S]*document-driven|document-driven[\s\S]*implicit/i);
    expect(skill).not.toContain('explicitly selects `$keco-develop-godot-slice-v2`');
    expect(skill).toMatch(/Preflight[\s\S]*Implementation[\s\S]*Verification[\s\S]*Delivery/);
    expect(skill).toMatch(/write token/i);
    expect(skill).toMatch(/blocked_before_write/);
    expect(skill).toMatch(/effective review level/i);
    expect(skill).toMatch(/Superpowers layout/i);
    expect(skill).toMatch(/bundled|self-contained/i);
    expect(skill).toMatch(/already consistent[\s\S]*without asking|without asking[\s\S]*already consistent/i);
    expect(skill).toMatch(/unresolved ambiguity[\s\S]*zero writes|zero writes[\s\S]*unresolved ambiguity/i);
    expect(skill).toMatch(/multiple independent[\s\S]*not[\s\S]*ambiguity/i);
    expect(skill).toMatch(/planning-document preflight[\s\S]*execution preflight/i);
    expect(skill).toMatch(/docs\/superpowers\/specs[\s\S]*docs\/superpowers\/plans/i);
    expect(skill).toMatch(/status\.json[\s\S]*internal|internal[\s\S]*status\.json/i);
    expect(skill).not.toMatch(/validate_slice_documents\.py/);
    expect(metadata).toMatch(/allow_implicit_invocation: true/);
  });

  it('ships all contracts and deterministic validators', () => {
    const files = [
      'references/orchestration-contract.md',
      'references/keco-pixellab-contract.md',
      'references/godot-mcp-contract.md',
      'references/ab-matrix.md',
      'references/source-data-contract.md',
      'references/gdd-coverage-contract.md',
      'references/gdd-change-contract.md',
      'references/eval-contract.md',
      'references/review-workflow.md',
      'references/slice-decision.md',
      'references/pixellab-capability-registry.md',
      'references/generated-asset-contract.md',
      'references/existing-resource-evolution.md',
      'references/godot-animation-contract.md',
      'references/godot-tileset-contract.md',
      'references/slice-document-contract.md',
      'scripts/validate_run_context.py',
      'scripts/validate_plan.py',
      'scripts/validate_eval_report.py',
      'scripts/validate_gdd_coverage.py',
      'scripts/validate_delivery_policy.py',
      'scripts/export_keco_snapshot.py',
      'scripts/validate_snapshot.py',
      'scripts/build_spriteframes_resource.py',
      'scripts/validate_generated_asset_package.py',
      'scripts/validate_task_evidence.py',
      'scripts/materialize_slice_mirrors.py',
      'scripts/validate_slice_decomposition.py',
      'scripts/validate_contract_case.py',
      'references/contract-manifest.json',
    ];
    for (const file of files) {
      if (file === 'references/orchestration-contract.md' || file === 'references/ab-matrix.md') {
        expect(existsSync(path.join(skillRoot, file))).toBe(true);
      } else {
        expect(existsSync(moduleFile(file))).toBe(true);
      }
    }
    const assets = readFileSync(moduleFile('references/keco-pixellab-contract.md'), 'utf8');
    expect(assets).toMatch(/planned row[\s\S]*read-back[\s\S]*create_image_upload[\s\S]*complete_image_upload/i);
    expect(assets).toMatch(/API key[\s\S]*(?:environment|MCP configuration)/i);
    expect(assets).toMatch(/Generated Assets/);
    expect(assets).toMatch(/assetKind[\s\S]*providerCapability[\s\S]*transportTool[\s\S]*compatibility/i);
    expect(assets).not.toMatch(/create_s_xl_image_pro` is a legacy/i);
    const capabilityRegistry = readFileSync(moduleFile('references/pixellab-capability-registry.md'), 'utf8');
    expect(capabilityRegistry).toMatch(/generate_image_pixflux[\s\S]*generate_image_bitforge/i);
    for (const endpoint of [
      '/v2/generate-image-v2',
      '/v2/generate-with-style-v2',
      '/v2/generate-ui-v2',
      '/v2/create-image-pixflux',
      '/v2/create-image-bitforge',
      '/v2/create-character-pro',
      '/v2/generate-8-rotations-v2',
      '/v2/animate-with-text-v2',
      '/v2/animate-with-skeleton',
      '/v2/inpaint-v3',
      '/v2/edit-images-v2',
      '/v2/create-tiles-pro',
      '/v2/create-tileset',
      '/v2/create-isometric-tile',
      '/v2/create-tileset-sidescroller',
    ]) expect(capabilityRegistry).toContain(endpoint);
    expect(capabilityRegistry).toMatch(/exact\|fallback\|unavailable/i);
    const godot = readFileSync(moduleFile('references/godot-mcp-contract.md'), 'utf8');
    expect(godot).toMatch(/run_project -> get_debug_output -> stop_project/);
    expect(godot).toMatch(/KECO_OBSERVATION/);
    expect(godot).toMatch(/must not include `expected`, `status`, `passed`/i);
    expect(godot).toMatch(/aggregate[\s\S]{0,240}evaluations[\s\S]{0,240}one runtime sequence/i);
    expect(godot).toMatch(/stable executable[\s\S]{0,160}command prefix[\s\S]{0,240}persistent prefix approval/i);
    expect(godot).toMatch(/cannot suppress or pre-approve the host prompt/i);
    const sourceData = readFileSync(moduleFile('references/source-data-contract.md'), 'utf8');
    expect(sourceData).toMatch(/semantic field labels[\s\S]*stable scalar match keys/i);
    expect(sourceData).toMatch(/semantic[\s\S]*clearly dominant[\s\S]*awaiting_user_confirmation/i);
    expect(sourceData).toMatch(/arbitrary[\s\S]*source document names/i);
    expect(sourceData).toMatch(/(?:no|not)[\s\S]*(?:fixed[\s\S]*Feedback|Feedback[\s\S]*fixed)/i);
    expect(sourceData).toMatch(/(?:no|not)[\s\S]*(?:recency|latest)[\s\S]*(?:alone|only)/i);
    expect(sourceData).toMatch(/exactly one[\s\S]*clearly dominant[\s\S]*(?:auto-select|automatically select)/i);
    expect(sourceData).toMatch(/tied candidates[\s\S]*one focused question[\s\S]*zero writes/i);
    expect(sourceData).toMatch(/never automatically delete/i);
    expect(sourceData).toMatch(/canonical Keco Project[\s\S]*kecoFolderId[\s\S]*pre-write blocker/i);
    const evalContract = readFileSync(moduleFile('references/eval-contract.md'), 'utf8');
    expect(evalContract).toMatch(/Create EvalSpec before any Keco, PixelLab, or Godot development write/i);
    const reviewWorkflow = readFileSync(moduleFile('references/review-workflow.md'), 'utf8');
    expect(reviewWorkflow).toMatch(/Plan validation[\s\S]*Task RED\/GREEN[\s\S]*Verified completion review/i);
    expect(reviewWorkflow).not.toMatch(/superpowers/i);
    const generatedAssets = readFileSync(moduleFile('references/generated-asset-contract.md'), 'utf8');
    expect(generatedAssets).toMatch(/canonical asset/i);
    expect(generatedAssets).toMatch(/upload[\s\S]*import[\s\S]*animation/i);
    expect(generatedAssets).toMatch(/credit[\s\S]*job/i);
    expect(generatedAssets).toMatch(/style[\s\S]*reference[\s\S]*edit/i);
    const evolution = readFileSync(moduleFile('references/existing-resource-evolution.md'), 'utf8');
    expect(evolution).toMatch(/reuse[\s\S]*extend[\s\S]*create/i);
    expect(evolution).toMatch(/stable key[\s\S]*existing resource/i);
    const animation = readFileSync(moduleFile('references/godot-animation-contract.md'), 'utf8');
    expect(animation).toMatch(/SpriteFrames[\s\S]*AtlasTexture[\s\S]*AnimatedSprite2D/i);
    expect(animation).toMatch(/frameCount[\s\S]*frameWidth[\s\S]*fps[\s\S]*loop/i);
    expect(animation).toMatch(/packaged export[\s\S]*materialize/i);
    const tileset = readFileSync(moduleFile('references/godot-tileset-contract.md'), 'utf8');
    expect(tileset).toMatch(/TileSet[\s\S]*TileMapLayer[\s\S]*terrain/i);
    expect(tileset).toMatch(/topdown-15[\s\S]*platformer-16[\s\S]*isometric-atlas/i);
    expect(tileset).toMatch(/do not infer|never infer/i);
    const sliceDocuments = readFileSync(moduleFile('references/slice-document-contract.md'), 'utf8');
    expect(sliceDocuments).toMatch(/docs\/superpowers\/specs[\s\S]*docs\/superpowers\/plans/i);
    expect(sliceDocuments).toMatch(/only user-facing progress record/i);
    expect(sliceDocuments).toMatch(/internal machine evidence/i);
    expect(sliceDocuments).toMatch(/status\.json[\s\S]*internal|internal[\s\S]*status\.json/i);
    const sliceDecision = readFileSync(moduleFile('references/slice-decision.md'), 'utf8');
    expect(sliceDecision).toMatch(/consistent[\s\S]*without[\s\S]*confirmation/i);
    expect(sliceDecision).toMatch(/awaiting_user_confirmation[\s\S]*zero-write/i);
    const orchestration = readFileSync(path.join(skillRoot, 'references', 'orchestration-contract.md'), 'utf8');
    expect(orchestration).toMatch(/specPath[\s\S]*docs\/superpowers\/specs[\s\S]*planPath[\s\S]*docs\/superpowers\/plans/i);
    expect(orchestration).toMatch(/statusPath[\s\S]*internal[\s\S]*status\.json/i);
    expect(orchestration).toMatch(/kecoFolderId[\s\S]*kecoDocumentIds[\s\S]*localMirrorRoot/i);
    expect(orchestration).toMatch(/evolution[\s\S]*reuse_exact[\s\S]*create_new/i);
    expect(orchestration).toMatch(/SlicePlan[\s\S]{0,200}approved static scope/i);
    expect(orchestration).toMatch(/task completion[\s\S]{0,220}Markdown checkboxes/i);
    expect(orchestration).toMatch(/interaction:[\s\S]{0,480}blockedAt[\s\S]{0,240}resumeFrom/i);
    expect(orchestration).toMatch(/interaction block is required for every run/i);
    expect(orchestration).toMatch(/topological|dependency order/i);
    expect(orchestration).toMatch(/pausedTaskId[\s\S]{0,240}temporaryTaskIds[\s\S]{0,240}returnToTaskId/i);
    expect(orchestration).toMatch(/internal RED\/GREEN step of the current task/i);
    expect(orchestration).toMatch(/Revise, revalidate, and topologically reorder the plan/i);
    expect(orchestration).toMatch(/Use `taskTransition` only when[\s\S]{0,400}every dependency[\s\S]{0,120}already complete/i);
    expect(orchestration).toMatch(/discoveredDuring[\s\S]{0,120}canInline[\s\S]{0,160}planImpact/i);
    expect(sliceDocuments).toMatch(/only user-facing progress record/i);
    expect(sliceDocuments).toMatch(/TaskResult[\s\S]{0,160}EvalReport[\s\S]{0,160}internal/i);
  });

  it('rejects template-only multi-Slice decomposition and accepts substantive pairs', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-v2-decomposition-'));
    const validator = moduleFile('scripts/validate_slice_decomposition.py');
    const source = {
      project: 'test8-24', document: 'game-gdd', revision: 10,
      contentHash: 'sha256:' + 'a'.repeat(64),
    };
    const templateSpec = (sliceId: string, requirementId: string) => `# ${sliceId}\n\n` +
      `sliceId: ${sliceId}\nrequirementIds: ${requirementId}\n\n` +
      '## Scope\nImplement the bounded slice from the accepted GDD.\n\n' +
      '## Acceptance\nThe planned slice is ready for implementation.\n';
    const templatePlan = (sliceId: string, taskId: string, evalId: string) => `# ${sliceId}\n\n` +
      `sliceId: ${sliceId}\ntaskIds: ${taskId}\nevalIds: ${evalId}\n\n` +
      '- [ ] Read and validate requirements\n' +
      '- [ ] Implement tasks (deferred; planning-only test)\n' +
      '- [ ] Run mapped evaluations (planned)\n' +
      '- [ ] Independent review of reciprocal GDD coverage\n';
    const substantiveSpec = (sliceId: string, requirementId: string, objective: string, scope: string, acceptance: string) => `# ${sliceId}\n\n` +
      `sliceId: ${sliceId}\nrequirementIds: ${requirementId}\n\n` +
      `## Objective\n${objective}\n\n## Scope\n${scope}\n\n## Acceptance\n${acceptance}\n\n` +
      '## Exclusions\nWeather effects remain in a later slice.\n';
    const substantivePlan = (sliceId: string, requirementId: string, taskId: string, evalId: string, file: string, red: string, green: string, task: string) => `# ${sliceId}\n\n` +
      `sliceId: ${sliceId}\nrequirementIds: ${requirementId}\nevalIds: ${evalId}\n\n` +
      `- [ ] ${taskId}: ${task}\n  - Files: ${file}\n  - RED: ${red}\n  - GREEN: ${green}\n  - Serves requirements: ${requirementId}\n  - Evaluation: ${evalId}\n`;
    const writePair = (name: string, spec: string, plan: string) => {
      const specPath = path.join(tempRoot, `${name}.spec.md`);
      const planPath = path.join(tempRoot, `${name}.plan.md`);
      writeFileSync(specPath, spec);
      writeFileSync(planPath, plan);
      return { specPath, planPath };
    };
    try {
      const templateA = writePair('slice-a', templateSpec('slice-a', 'gdd-a'), templatePlan('slice-a', 'task-a', 'eval-a'));
      const templateB = writePair('slice-b', templateSpec('slice-b', 'gdd-b'), templatePlan('slice-b', 'task-b', 'eval-b'));
      const invalidPath = path.join(tempRoot, 'invalid.json');
      writeFileSync(invalidPath, JSON.stringify({ version: 1, source, slices: [
        { sliceId: 'slice-a', requirementIds: ['gdd-a'], taskIds: ['task-a'], evalIds: ['eval-a'], ...templateA },
        { sliceId: 'slice-b', requirementIds: ['gdd-b'], taskIds: ['task-b'], evalIds: ['eval-b'], ...templateB },
      ] }));
      const invalid = spawnSync('python3', [validator, invalidPath], { encoding: 'utf8' });
      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toMatch(/objective|template|substantive|task/i);

      const pairA = writePair('real-a', substantiveSpec('slice-a', 'gdd-a', 'Persist gathered materials for shelter construction.', 'Add the material inventory state and the shelter construction action.', 'With zero materials construction is rejected; after collecting one bundle, construction succeeds and consumes it.'), substantivePlan('slice-a', 'gdd-a', 'task-a', 'eval-a', 'scripts/materials.gd', 'pytest tests/materials_red.py', 'pytest tests/materials_green.py', 'Track material collection and consumption'));
      const pairB = writePair('real-b', substantiveSpec('slice-b', 'gdd-b', 'Allow a cat to take up long-term residence in a built shelter.', 'Add residency eligibility and the return-home transition.', 'A weak or high-bond cat remains after return; an ineligible cat does not become resident.'), substantivePlan('slice-b', 'gdd-b', 'task-b', 'eval-b', 'scripts/residency.gd', 'pytest tests/residency_red.py', 'pytest tests/residency_green.py', 'Apply residency eligibility on return'));
      const validPath = path.join(tempRoot, 'valid.json');
      writeFileSync(validPath, JSON.stringify({ version: 1, source, slices: [
        { sliceId: 'slice-a', requirementIds: ['gdd-a'], taskIds: ['task-a'], evalIds: ['eval-a'], ...pairA },
        { sliceId: 'slice-b', requirementIds: ['gdd-b'], taskIds: ['task-b'], evalIds: ['eval-b'], ...pairB },
      ] }));
      const valid = spawnSync('python3', [validator, validPath], { encoding: 'utf8' });
      expect(valid.status).toBe(0);
      expect(valid.stdout).toMatch(/"ok": true/);

      const singlePath = path.join(tempRoot, 'single.json');
      writeFileSync(singlePath, JSON.stringify({ version: 1, source, slices: [
        { sliceId: 'slice-a', requirementIds: ['gdd-a'], taskIds: ['task-a'], evalIds: ['eval-a'], ...pairA },
      ] }));
      const single = spawnSync('python3', [validator, singlePath], { encoding: 'utf8' });
      expect(single.status).toBe(1);
      expect(single.stderr).toMatch(/at least two|multiple slices/i);

      const missingGreenPath = path.join(tempRoot, 'missing-green.json');
      writeFileSync(missingGreenPath, JSON.stringify({ version: 1, source, slices: [
        { sliceId: 'slice-a', requirementIds: ['gdd-a'], taskIds: ['task-a'], evalIds: ['eval-a'], ...pairA },
        { sliceId: 'slice-b', requirementIds: ['gdd-b'], taskIds: ['task-b'], evalIds: ['eval-b'], ...{
          ...pairB,
          planPath: path.join(tempRoot, 'missing-green.plan.md'),
        } },
      ] }));
      writeFileSync(path.join(tempRoot, 'missing-green.plan.md'), readFileSync(pairB.planPath, 'utf8').replace(/\n\s*-\s*GREEN:.*$/m, ''));
      const missingGreen = spawnSync('python3', [validator, missingGreenPath], { encoding: 'utf8' });
      expect(missingGreen.status).toBe(1);
      expect(missingGreen.stderr).toMatch(/each task|RED.*GREEN|GREEN.*RED/i);

      const duplicatePath = path.join(tempRoot, 'semantic-duplicate.json');
      const duplicateSpec = substantiveSpec('slice-b', 'gdd-b', 'Persist collected materials for shelter building.', 'Add material inventory state and the shelter building action.', 'With zero materials building is rejected; after collecting one bundle, building succeeds and consumes it.');
      const duplicatePlan = substantivePlan('slice-b', 'gdd-b', 'task-b', 'eval-b', 'scripts/materials_alt.gd', 'pytest tests/materials_red_alt.py', 'pytest tests/materials_green_alt.py', 'Track gathered materials and consume them during building');
      const duplicatePair = writePair('semantic-duplicate', duplicateSpec, duplicatePlan);
      writeFileSync(duplicatePath, JSON.stringify({ version: 1, source, slices: [
        { sliceId: 'slice-a', requirementIds: ['gdd-a'], taskIds: ['task-a'], evalIds: ['eval-a'], ...pairA },
        { sliceId: 'slice-b', requirementIds: ['gdd-b'], taskIds: ['task-b'], evalIds: ['eval-b'], ...duplicatePair },
      ] }));
      const duplicate = spawnSync('python3', [validator, duplicatePath], { encoding: 'utf8' });
      expect(duplicate.status).toBe(1);
      expect(duplicate.stderr).toMatch(/duplicate|similar|substant/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('ships the multi-Slice roadmap and recovery contract', () => {
    const multiSlicePath = moduleFile('references/multi-slice-orchestration.md');
    expect(existsSync(multiSlicePath)).toBe(true);
    if (!existsSync(multiSlicePath)) return;

    const multiSlice = readFileSync(multiSlicePath, 'utf8');
    expect(multiSlice).toMatch(/roadmap[\s\S]*dependencies[\s\S]*priority/i);
    expect(multiSlice).toMatch(/IMPLEMENTATION_COMPLETE[\s\S]*PREPARE_DELIVERY[\s\S]*DELIVERY_SEAL[\s\S]*NEXT_SLICE/i);
    expect(multiSlice).toMatch(/three|3[\s\S]*paused[\s\S]*user/i);
    expect(multiSlice).toMatch(/multiple Slices[\s\S]*dependency order/i);
    expect(multiSlice).toMatch(/priority[\s\S]*tie-breaker/i);
    expect(multiSlice).toMatch(/third failure[\s\S]*internal evidence[\s\S]*paused[\s\S]*ask the user/i);
    expect(multiSlice).toMatch(/internal roadmap projection[\s\S]*status[\s\S]*evalResult/i);
  });

  it('builds deterministic Godot SpriteFrames resources and rejects bad frame geometry', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-v2-animation-'));
    try {
      const idle = path.join(tempRoot, 'hero_idle.png');
      const attack = path.join(tempRoot, 'hero_attack.png');
      writePngHeader(idle, 128, 32);
      writePngHeader(attack, 96, 32);
      const manifest = path.join(tempRoot, 'animations.json');
      const output = path.join(tempRoot, 'hero_frames.tres');
      writeFileSync(manifest, JSON.stringify({
        version: 1,
        resourcePath: 'res://generated/hero_frames.tres',
        animations: [
          { name: 'idle', sheetPath: 'res://generated/hero_idle.png', sheetFile: idle, frameWidth: 32, frameHeight: 32, frameCount: 4, fps: 8, loop: true },
          { name: 'attack', sheetPath: 'res://generated/hero_attack.png', sheetFile: attack, frameWidth: 32, frameHeight: 32, frameCount: 3, fps: 12, loop: false },
        ],
      }));
      const builder = moduleFile('scripts/build_spriteframes_resource.py');
      const valid = spawnSync('python3', [builder, '--manifest', manifest, '--output', output], { encoding: 'utf8' });
      expect(valid.status).toBe(0);
      const resource = readFileSync(output, 'utf8');
      expect(resource).toContain('[gd_resource type="SpriteFrames"');
      expect(resource.match(/type="AtlasTexture"/g)).toHaveLength(7);
      expect(resource).toContain('"name": &"idle"');
      expect(resource).toContain('"name": &"attack"');
      expect(resource).toContain('"loop": false');
      expect(resource).toContain('region = Rect2(64, 0, 32, 32)');

      writeFileSync(manifest, JSON.stringify({
        version: 1,
        resourcePath: 'res://generated/hero_frames.tres',
        animations: [{ name: 'idle', sheetPath: 'res://generated/hero_idle.png', sheetFile: idle, frameWidth: 32, frameHeight: 32, frameCount: 5, fps: 8, loop: true }],
      }));
      const invalid = spawnSync('python3', [builder, '--manifest', manifest, '--output', output], { encoding: 'utf8' });
      expect(invalid.status).not.toBe(0);
      expect(invalid.stderr).toMatch(/frame geometry/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('validates generated asset packages before Godot materialization', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-v2-assets-'));
    try {
      const assetDir = path.join(tempRoot, 'assets');
      mkdirSync(assetDir, { recursive: true });
      const idle = path.join(assetDir, 'hero_idle.png');
      const terrain = path.join(assetDir, 'terrain.png');
      writePngHeader(idle, 128, 32);
      writePngHeader(terrain, 64, 64);
      const packagePath = path.join(tempRoot, 'package.json');
      const packageData = {
        version: 1,
        runId: 'asset-run',
        sliceId: 'asset-slice',
        projectRoot: tempRoot,
        assets: [
          {
            assetKey: 'hero-idle',
            assetKind: 'animation',
            provider: { capability: 'animate-text-pro', transportTool: 'animate_with_text', assetId: 'provider-idle' },
            status: 'ready',
            files: [{
              fileKey: 'hero-idle-sheet', sourceFile: 'assets/hero_idle.png', targetPath: 'res://generated/hero_idle.png',
              sha256: sha256(idle), width: 128, height: 32,
              animation: { name: 'idle', frameWidth: 32, frameHeight: 32, frameCount: 4, fps: 8, loop: true },
            }],
          },
          {
            assetKey: 'terrain-grass',
            assetKind: 'tileset',
            provider: { capability: 'top-down-tileset', transportTool: 'generate_tileset', assetId: 'provider-terrain' },
            status: 'ready',
            files: [{
              fileKey: 'terrain-grass-atlas', sourceFile: 'assets/terrain.png', targetPath: 'res://generated/terrain.png',
              sha256: sha256(terrain), width: 64, height: 64,
              tileset: { layout: 'topdown-15', tileSize: 16, columns: 4, rows: 4, terrainMapping: 'provider-metadata' },
            }],
          },
        ],
      };
      writeFileSync(packagePath, JSON.stringify(packageData));
      const validator = moduleFile('scripts/validate_generated_asset_package.py');
      const valid = spawnSync('python3', [validator, packagePath], { encoding: 'utf8' });
      expect(valid.status).toBe(0);
      expect(valid.stdout).toMatch(/"ok": true/);

      packageData.assets[1].files[0].targetPath = 'res://generated/hero_idle.png';
      writeFileSync(packagePath, JSON.stringify(packageData));
      const invalid = spawnSync('python3', [validator, packagePath], { encoding: 'utf8' });
      expect(invalid.status).not.toBe(0);
      expect(invalid.stderr).toMatch(/duplicate targetPath/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('plans executable pressure evaluations without treating fixture counts as evidence', () => {
    const harness = path.join(repositoryRoot, 'scripts', 'evaluate-keco-slice-v2-skill.mjs');
    const definitionPath = path.join(repositoryRoot, 'tests', 'fixtures', 'plugins', 'keco-godot-skill-v2-evals.json');
    const rubricPath = path.join(repositoryRoot, 'tests', 'fixtures', 'plugins', 'keco-godot-skill-v2-eval-rubric.json');
    expect({ harness: existsSync(harness), rubric: existsSync(rubricPath) }).toEqual({ harness: true, rubric: true });
    const fixture = JSON.parse(readFileSync(definitionPath, 'utf8')) as {
      schemaVersion: number;
      skill: string;
      providers: string[];
      minimumSamplesPerVariant: number;
      variants: Array<{ id: string; guidance: string }>;
      cases: Array<{ id: string; scenarioClass: string; assertions: unknown[] }>;
    };
    const rubric = JSON.parse(readFileSync(rubricPath, 'utf8')) as Record<string, unknown>;
    expect(fixture).toMatchObject({
      schemaVersion: 2,
      skill: 'keco-develop-godot-slice-v2',
      providers: ['codex', 'claude'],
      minimumSamplesPerVariant: 5,
    });
    expect(new Set(fixture.cases.map(item => item.scenarioClass))).toEqual(new Set([
      'simple_non_gdd', 'gdd_coverage', 'multi_slice_resume', 'ambiguous_decomposition',
      'capability_unavailable', 'out_of_scope_file', 'missing_runtime_observation',
      'legacy_self_report', 'forged_review_level', 'stale_state', 'fourth_repair',
      'mirror_partial_failure',
    ]));
    expect(fixture.cases.every(item => item.assertions.length > 0)).toBe(true);
    expect(fixture.variants).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'control', guidance: 'none' }),
      expect.objectContaining({ id: 'current_skill', guidance: 'repository_skill' }),
    ]));
    expect(rubric).toMatchObject({
      schemaVersion: 1,
      manualReviewStates: expect.arrayContaining(['not_required', 'pending', 'reviewed']),
      rawEvidenceRequired: true,
    });

    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-skill-eval-'));
    try {
      const output = path.join(tempRoot, 'dry-run.json');
      const dry = spawnSync(process.execPath, [
        harness, '--provider', 'codex', '--samples', '5', '--output', output, '--dry-run',
      ], { cwd: repositoryRoot, encoding: 'utf8' });
      expect({ status: dry.status, stderr: dry.stderr }).toEqual({ status: 0, stderr: '' });
      const result = JSON.parse(readFileSync(output, 'utf8')) as {
        status: string;
        passed: boolean;
        plannedInvocations: Array<{ contextId: string; rawOutputPath: string; provider: string; runtime: string; model: string }>;
        evidenceSummary: { realResponses: number };
      };
      expect(result).toMatchObject({ status: 'dry_run', passed: false, evidenceSummary: { realResponses: 0 } });
      expect(result.plannedInvocations).toHaveLength(fixture.cases.length * fixture.variants.length * 5);
      expect(new Set(result.plannedInvocations.map(item => item.contextId)).size).toBe(result.plannedInvocations.length);
      expect(result.plannedInvocations.every(item => item.rawOutputPath && item.provider === 'codex' && item.runtime && item.model)).toBe(true);
      expect(spawnSync(process.execPath, [
        harness, '--provider', 'codex', '--samples', '4', '--output', output, '--dry-run',
      ], { cwd: repositoryRoot, encoding: 'utf8' }).status).toBe(1);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects unsafe run contexts and incomplete plans', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-v2-'));
    try {
      const unsafeRun = path.join(tempRoot, 'run.json');
      writeFileSync(unsafeRun, JSON.stringify({
        version: 2,
        runId: 'run',
        mode: 'implicit-v2',
        kecoProjectId: 'project',
        godotProjectPath: '/game',
        sliceId: 'slice',
        allowedFiles: ['../outside.gd'],
        iteration: 0,
      }));
      expect(() => execFileSync('python3', [moduleFile('scripts/validate_run_context.py'), unsafeRun])).toThrow();

      const incompletePlan = path.join(tempRoot, 'plan.json');
      writeFileSync(incompletePlan, JSON.stringify({ tasks: [{ id: 'task-01', files: [], dependsOn: [], servesEvaluations: [] }] }));
      expect(() => execFileSync('python3', [moduleFile('scripts/validate_plan.py'), incompletePlan])).toThrow();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects runtime and evidence state in a reviewed plan', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-v2-plan-boundary-'));
    try {
      const runtimePlan = path.join(tempRoot, 'runtime-plan.json');
      writeFileSync(runtimePlan, JSON.stringify({
        runId: 'run-01',
        writeToken: 'must-not-live-in-plan',
        tasks: [{
          id: 'task-01',
          files: ['scripts/game.gd'],
          dependsOn: [],
          servesEvaluations: ['eval-01'],
          red: { command: 'pytest tests/red.py', expected: 'fails' },
          green: { command: 'pytest tests/green.py', expected: 'passes' },
          review: { spec: true, quality: true },
          status: 'in_progress',
          commandOutput: 'runtime output',
        }],
      }));

      const result = spawnSync(
        'python3',
        [moduleFile('scripts/validate_plan.py'), runtimePlan],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/plan contains runtime or evidence state/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('validates resumable checkpoints and rejects unsafe variants', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-v2-checkpoint-'));
    const fixture = JSON.parse(
      readFileSync(
        path.join(repositoryRoot, 'tests', 'fixtures', 'plugins', 'keco-interaction-contract.json'),
        'utf8',
      ),
    ) as {
      validCheckpoint: Record<string, unknown>;
      invalidCheckpoints: Array<{
        id: string;
        remove?: string;
        overrides?: Record<string, unknown>;
        error: string;
      }>;
    };
    const validator = moduleFile('scripts/validate_interaction_checkpoint.py');
    try {
      const validPath = path.join(tempRoot, 'checkpoint.json');
      writeFileSync(validPath, JSON.stringify(fixture.validCheckpoint));
      const valid = spawnSync('python3', [validator, validPath], { encoding: 'utf8' });
      expect(valid.status).toBe(0);
      expect(valid.stdout).toMatch(/checkpoint valid/i);

      for (const invalid of fixture.invalidCheckpoints) {
        const value = { ...fixture.validCheckpoint, ...invalid.overrides };
        if (invalid.remove) delete value[invalid.remove];
        const invalidPath = path.join(tempRoot, `${invalid.id}.json`);
        writeFileSync(invalidPath, JSON.stringify(value));
        const result = spawnSync('python3', [validator, invalidPath], { encoding: 'utf8' });
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(new RegExp(invalid.error, 'i'));
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('binds an optional interaction checkpoint to the active run context', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-v2-run-checkpoint-'));
    const validator = moduleFile('scripts/validate_run_context.py');
    const checkpointFixture = JSON.parse(
      readFileSync(
        path.join(repositoryRoot, 'tests', 'fixtures', 'plugins', 'keco-interaction-contract.json'),
        'utf8',
      ),
    ).validCheckpoint as Record<string, unknown>;
    const baseRun = {
      version: 2,
      runId: 'run-01',
      mode: 'implicit-v2',
      kecoProjectId: 'project',
      godotProjectPath: '/game',
      sliceId: 'slice',
      allowedFiles: ['scripts/game.gd'],
      iteration: 0,
    };
    try {
      const validPath = path.join(tempRoot, 'valid.json');
      writeFileSync(validPath, JSON.stringify({ ...baseRun, interaction: checkpointFixture }));
      expect(spawnSync('python3', [validator, validPath], { encoding: 'utf8' }).status).toBe(0);

      const invalidPath = path.join(tempRoot, 'invalid.json');
      writeFileSync(invalidPath, JSON.stringify({
        ...baseRun,
        interaction: {
          ...checkpointFixture,
          checkpoint: {
            ...(checkpointFixture.checkpoint as Record<string, unknown>),
            runId: 'another-run',
          },
        },
      }));
      const invalid = spawnSync('python3', [validator, invalidPath], { encoding: 'utf8' });
      expect(invalid.status).toBe(1);
      expect(invalid.stderr).toMatch(/runId/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it.each(['implicit-v2', 'explicit-v2'])('accepts the documented Codex run mode %s', (mode) => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-v2-mode-'));
    try {
      const runPath = path.join(tempRoot, 'run.json');
      writeFileSync(runPath, JSON.stringify({
        version: 2,
        runId: 'run-01',
        mode,
        kecoProjectId: 'project',
        godotProjectPath: '/game',
        sliceId: 'slice',
        allowedFiles: ['scripts/game.gd'],
        iteration: 0,
      }));
      const result = spawnSync(
        'python3',
        [moduleFile('scripts/validate_run_context.py'), runPath],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects the undocumented manual-v2 Codex run mode', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-v2-mode-invalid-'));
    try {
      const runPath = path.join(tempRoot, 'run.json');
      writeFileSync(runPath, JSON.stringify({
        version: 2,
        runId: 'run-01',
        mode: 'manual-v2',
        kecoProjectId: 'project',
        godotProjectPath: '/game',
        sliceId: 'slice',
        allowedFiles: ['scripts/game.gd'],
        iteration: 0,
      }));
      const result = spawnSync(
        'python3',
        [moduleFile('scripts/validate_run_context.py'), runPath],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/mode must be one of/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('accepts documented required and optional Codex plan reviews', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-v2-review-'));
    try {
      const planPath = path.join(tempRoot, 'plan.json');
      writeFileSync(planPath, JSON.stringify({
        tasks: [
          {
            id: 'task-01',
            files: ['scripts/game.gd'],
            dependsOn: [],
            servesEvaluations: ['eval-01'],
            red: { command: 'pytest tests/red.py', expected: 'fails' },
            green: { command: 'pytest tests/green.py', expected: 'passes' },
            review: { spec: 'required', quality: 'required' },
          },
          {
            id: 'task-02',
            files: ['scenes/game.tscn'],
            dependsOn: ['task-01'],
            servesEvaluations: ['eval-02'],
            red: { command: 'pytest tests/scene_red.py', expected: 'fails' },
            green: { command: 'pytest tests/scene_green.py', expected: 'passes' },
            review: { spec: 'required', quality: 'optional' },
          },
        ],
      }));
      const result = spawnSync(
        'python3',
        [moduleFile('scripts/validate_plan.py'), planPath],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/"ok": true/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('validates GDD coverage mappings and authorized additions', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-v2-gdd-coverage-'));
    const validator = moduleFile('scripts/validate_gdd_coverage.py');
    const base = {
      version: 1,
      source: { project: 'test8-24', document: 'game-gdd', revision: 10, contentHash: 'sha256:' + 'a'.repeat(64) },
      completeness: { sourceSnapshot: 'read-back-20260902', reviewMethod: 'full-document manual cross-check', reviewedSections: ['1', '2', '3', '4', '5', '6', '7'] },
      slices: [
        { sliceId: 'slice-current', status: 'planned' },
        { sliceId: 'slice-followup', status: 'planned' },
      ],
      tasks: [{ taskId: 'task-current', sliceId: 'slice-current', requirementIds: ['gdd-1'] }],
      evaluations: [{ evalId: 'eval-current', sliceId: 'slice-current', requirementIds: ['gdd-1'] }],
      requirements: [{
        requirementId: 'gdd-1', classification: 'normative', authorization: 'gdd',
        sourceLocation: 'section-1', sourceQuote: 'normative rule', status: 'evaluated',
        sliceIds: ['slice-current'], taskIds: ['task-current'], evalIds: ['eval-current'],
      }],
    };
    const withHash = (value: Record<string, unknown>) => ({ ...value, inventoryHash: `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}` });
    const baseWithHash = withHash(base);
    try {
      const validPath = path.join(tempRoot, 'valid.json');
      writeFileSync(validPath, JSON.stringify(baseWithHash));
      const valid = spawnSync('python3', [validator, validPath], { encoding: 'utf8' });
      expect(valid.status).toBe(0);
      expect(valid.stdout).toMatch(/"ok": true/);

      const unmappedPath = path.join(tempRoot, 'unmapped.json');
      writeFileSync(unmappedPath, JSON.stringify(withHash({
        ...base,
        requirements: [...base.requirements, {
          requirementId: 'gdd-2', classification: 'normative', authorization: 'gdd',
          sourceLocation: 'section-5', sourceQuote: 'unmapped rule', status: 'planned',
          sliceIds: [], taskIds: [], evalIds: [],
        }],
      })));
      const unmapped = spawnSync('python3', [validator, unmappedPath], { encoding: 'utf8' });
      expect(unmapped.status).toBe(1);
      expect(unmapped.stderr).toMatch(/normative requirement.*mapping/i);

      const deferredPath = path.join(tempRoot, 'deferred.json');
      writeFileSync(deferredPath, JSON.stringify(withHash({
        ...base,
        requirements: [...base.requirements, {
          requirementId: 'gdd-3', classification: 'normative', authorization: 'gdd',
          sourceLocation: 'section-7', sourceQuote: 'deferred rule', status: 'deferred',
          deferredToSlice: 'slice-followup', sliceIds: [], taskIds: [], evalIds: [],
        }],
      })));
      expect(spawnSync('python3', [validator, deferredPath], { encoding: 'utf8' }).status).toBe(0);

      const unauthorizedPath = path.join(tempRoot, 'unauthorized.json');
      writeFileSync(unauthorizedPath, JSON.stringify(withHash({
        ...base,
        requirements: [...base.requirements, {
          requirementId: 'guardian', classification: 'normative', authorization: 'proposal',
          sourceLocation: 'no GDD citation', sourceQuote: 'AI-added cat type', status: 'planned',
          sliceIds: ['slice-current'], taskIds: ['task-current'], evalIds: ['eval-current'],
        }],
      })));
      const unauthorized = spawnSync('python3', [validator, unauthorizedPath], { encoding: 'utf8' });
      expect(unauthorized.status).toBe(1);
      expect(unauthorized.stderr).toMatch(/authorization|proposal/i);

      const acceptedPatchPath = path.join(tempRoot, 'accepted-patch.json');
      writeFileSync(acceptedPatchPath, JSON.stringify(withHash({
        ...base,
        requirements: [...base.requirements, {
          requirementId: 'approved-extra', classification: 'normative', authorization: 'accepted_patch',
          sourceLocation: 'section-5', sourceQuote: 'extension rule', status: 'planned',
          sliceIds: ['slice-current'], taskIds: ['task-current'], evalIds: ['eval-current'],
        }],
      })));
      const acceptedPatch = spawnSync('python3', [validator, acceptedPatchPath], { encoding: 'utf8' });
      expect(acceptedPatch.status).toBe(1);
      expect(acceptedPatch.stderr).toMatch(/patchReference/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('requires requirement references when a plan opts into GDD coverage', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-v2-plan-gdd-'));
    try {
      const planPath = path.join(tempRoot, 'plan.json');
      writeFileSync(planPath, JSON.stringify({
        gddRequirementIds: ['gdd-1'],
        tasks: [{
          id: 'task-01', files: ['scripts/game.gd'], dependsOn: [], servesEvaluations: ['eval-01'],
          red: { command: 'pytest tests/red.py', expected: 'fails' },
          green: { command: 'pytest tests/green.py', expected: 'passes' },
          review: { spec: 'required', quality: 'required' },
        }],
      }));
      const result = spawnSync('python3', [moduleFile('scripts/validate_plan.py'), planPath], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/servesRequirements/i);
      const requiredMode = spawnSync('python3', [moduleFile('scripts/validate_plan.py'), '--require-gdd', planPath], { encoding: 'utf8' });
      expect(requiredMode.status).toBe(1);
      expect(requiredMode.stderr).toMatch(/coverage mode|GDD/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('requires requirement references when an eval report opts into GDD coverage', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-v2-eval-gdd-'));
    try {
      const reportPath = path.join(tempRoot, 'report.json');
      writeFileSync(reportPath, JSON.stringify({
        version: 2, runId: 'run-01', sliceId: 'slice-01', status: 'partial',
        snapshotHash: null, gddRequirementIds: ['gdd-1'], runtimeBatches: [], changedFiles: [], manualRequirements: [],
        evaluations: [{ evalId: 'eval-01', status: 'manual_required', evidence: [] }],
      }));
      const result = spawnSync('python3', [moduleFile('scripts/validate_eval_report.py'), reportPath], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/requirementIds/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects a plan whose dependency appears after its dependent task', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-v2-plan-order-'));
    try {
      const planPath = path.join(tempRoot, 'plan.json');
      const makeTask = (id: string, dependsOn: string[]) => ({
        id,
        files: [`scripts/${id}.gd`],
        dependsOn,
        servesEvaluations: ['eval-01'],
        red: { command: 'pytest tests/red.py', expected: 'fails' },
        green: { command: 'pytest tests/green.py', expected: 'passes' },
        review: { spec: 'required', quality: 'required' },
      });
      writeFileSync(planPath, JSON.stringify({
        tasks: [makeTask('task-02', ['task-01']), makeTask('task-01', [])],
      }));
      const result = spawnSync(
        'python3',
        [moduleFile('scripts/validate_plan.py'), planPath],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/dependency must appear before dependent task/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps snapshot export and validation runnable inside v2', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-v2-snapshot-'));
    const input = path.join(repositoryRoot, 'tests', 'fixtures', 'plugins', 'keco-godot-snapshot-input.json');
    const output = path.join(tempRoot, 'snapshot');
    try {
      const exporter = spawnSync('python3', [moduleFile('scripts/export_keco_snapshot.py'), '--input', input, '--output-dir', output], { encoding: 'utf8' });
      expect(exporter.status).toBe(0);
      const validator = spawnSync('python3', [moduleFile('scripts/validate_snapshot.py'), '--snapshot-dir', output, '--source-input', input], { encoding: 'utf8' });
      expect(validator.status).toBe(0);
      expect(validator.stdout).toMatch(/"ok": true/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
