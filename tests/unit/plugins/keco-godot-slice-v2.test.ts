import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const repositoryRoot = process.cwd();
const skillRoot = path.join(repositoryRoot, 'plugins', 'keco-codex', 'skills', 'keco-develop-godot-slice-v2');

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

describe('Keco Godot Slice V2 skill contract', () => {
  it('requires checklist-based authoritative Keco roadmap and Slice plans', () => {
    const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const orchestration = readFileSync(
      path.join(skillRoot, 'references', 'multi-slice-orchestration.md'),
      'utf8',
    );

    expect(orchestration).toContain('Slice Checklist');
    expect(orchestration).toContain('- [ ]');
    expect(orchestration).toContain('- [x]');
    expect(orchestration).toContain('Task Checklist');
    expect(orchestration).toMatch(/- \[ \] task-001:/);
    expect(orchestration).toMatch(/Keco(?:'s|’s) read-back plan is authoritative/i);
    expect(skill).toMatch(/roadmap[\s\S]{0,180}checklist/i);
    expect(skill).toMatch(/Slice[\s\S]{0,180}plan[\s\S]{0,180}checklist/i);
  });

  it('keeps V2 as the canonical workflow for document-driven Godot creation', () => {
    const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    expect(skill).toMatch(/V2 is the canonical creation workflow for Keco-driven Godot development/i);
    expect(skill).toMatch(/do not route document-driven Godot creation to V1/i);
  });

  it('supports document-driven implicit invocation and exposes a self-contained reviewed ledger', () => {
    const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const metadata = readFileSync(path.join(skillRoot, 'agents', 'openai.yaml'), 'utf8');
    expect(skill).toMatch(/^---\nname: keco-develop-godot-slice-v2\n/);
    expect(skill).toMatch(/document-driven[\s\S]*implicit/i);
    expect(skill).not.toContain('explicitly selects `$keco-develop-godot-slice-v2`');
    expect(skill).toMatch(/INTAKE[\s\S]*WRITE_PLAN[\s\S]*TASK_REVIEW[\s\S]*FINAL_VERIFY/);
    expect(skill).toMatch(/write token/i);
    expect(skill).toMatch(/blocked_before_write/);
    expect(skill).toMatch(/independent review/i);
    expect(skill).not.toMatch(/superpowers/i);
    expect(skill).toMatch(/bundled|self-contained/i);
    expect(skill).toMatch(/already consistent[\s\S]*without asking|without asking[\s\S]*already consistent/i);
    expect(skill).toMatch(/unresolved ambiguity[\s\S]*zero writes|zero writes[\s\S]*unresolved ambiguity/i);
    expect(skill).toMatch(/multiple independent[\s\S]*not[\s\S]*ambiguity/i);
    expect(skill).toMatch(/planning-document preflight[\s\S]*execution preflight/i);
    expect(skill).toMatch(/spec\.md[\s\S]*plan\.md[\s\S]*status\.json[\s\S]*eval-report\.json/i);
    expect(skill).toMatch(/matching Keco Project[\s\S]*create_document\(projectId, folderId/i);
    expect(skill).toMatch(/local mirror[\s\S]*never as the only copy|never as the only copy[\s\S]*local mirror/i);
    expect(skill).toMatch(/validate_slice_documents\.py/);
    expect(metadata).toMatch(/allow_implicit_invocation: true/);
  });

  it('ships all contracts and deterministic validators', () => {
    const files = [
      'references/orchestration-contract.md',
      'references/keco-pixellab-contract.md',
      'references/godot-mcp-contract.md',
      'references/ab-matrix.md',
      'references/source-data-contract.md',
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
      'scripts/export_keco_snapshot.py',
      'scripts/validate_snapshot.py',
      'scripts/build_spriteframes_resource.py',
      'scripts/validate_generated_asset_package.py',
      'scripts/validate_slice_documents.py',
    ];
    for (const file of files) expect(existsSync(path.join(skillRoot, file))).toBe(true);
    const assets = readFileSync(path.join(skillRoot, 'references', 'keco-pixellab-contract.md'), 'utf8');
    expect(assets).toMatch(/planned row[\s\S]*read-back[\s\S]*create_image_upload[\s\S]*complete_image_upload/i);
    expect(assets).toMatch(/API key[\s\S]*(?:environment|MCP configuration)/i);
    expect(assets).toMatch(/Generated Assets/);
    expect(assets).toMatch(/assetKind[\s\S]*providerCapability[\s\S]*transportTool[\s\S]*compatibility/i);
    expect(assets).not.toMatch(/create_s_xl_image_pro` is a legacy/i);
    const capabilityRegistry = readFileSync(path.join(skillRoot, 'references', 'pixellab-capability-registry.md'), 'utf8');
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
    const godot = readFileSync(path.join(skillRoot, 'references', 'godot-mcp-contract.md'), 'utf8');
    expect(godot).toMatch(/run_project -> get_debug_output -> stop_project/);
    expect(godot).toMatch(/KECO_EVAL/);
    const sourceData = readFileSync(path.join(skillRoot, 'references', 'source-data-contract.md'), 'utf8');
    expect(sourceData).toMatch(/semantic field labels[\s\S]*stable scalar match keys/i);
    expect(sourceData).toMatch(/semantic[\s\S]*clearly dominant[\s\S]*awaiting_user_confirmation/i);
    expect(sourceData).toMatch(/arbitrary[\s\S]*source document names/i);
    expect(sourceData).toMatch(/(?:no|not)[\s\S]*(?:fixed[\s\S]*Feedback|Feedback[\s\S]*fixed)/i);
    expect(sourceData).toMatch(/(?:no|not)[\s\S]*(?:recency|latest)[\s\S]*(?:alone|only)/i);
    expect(sourceData).toMatch(/exactly one[\s\S]*clearly dominant[\s\S]*(?:auto-select|automatically select)/i);
    expect(sourceData).toMatch(/tied candidates[\s\S]*one focused question[\s\S]*zero writes/i);
    expect(sourceData).toMatch(/never automatically delete/i);
    expect(sourceData).toMatch(/canonical Keco Project[\s\S]*kecoFolderId[\s\S]*pre-write blocker/i);
    const evalContract = readFileSync(path.join(skillRoot, 'references', 'eval-contract.md'), 'utf8');
    expect(evalContract).toMatch(/Create EvalSpec before any Keco, PixelLab, or Godot write/i);
    const reviewWorkflow = readFileSync(path.join(skillRoot, 'references', 'review-workflow.md'), 'utf8');
    expect(reviewWorkflow).toMatch(/Plan validation[\s\S]*Task RED\/GREEN[\s\S]*Independent completion review/i);
    expect(reviewWorkflow).not.toMatch(/superpowers/i);
    const generatedAssets = readFileSync(path.join(skillRoot, 'references', 'generated-asset-contract.md'), 'utf8');
    expect(generatedAssets).toMatch(/canonical asset/i);
    expect(generatedAssets).toMatch(/upload[\s\S]*import[\s\S]*animation/i);
    expect(generatedAssets).toMatch(/credit[\s\S]*job/i);
    expect(generatedAssets).toMatch(/style[\s\S]*reference[\s\S]*edit/i);
    const evolution = readFileSync(path.join(skillRoot, 'references', 'existing-resource-evolution.md'), 'utf8');
    expect(evolution).toMatch(/reuse[\s\S]*extend[\s\S]*create/i);
    expect(evolution).toMatch(/stable key[\s\S]*existing resource/i);
    const animation = readFileSync(path.join(skillRoot, 'references', 'godot-animation-contract.md'), 'utf8');
    expect(animation).toMatch(/SpriteFrames[\s\S]*AtlasTexture[\s\S]*AnimatedSprite2D/i);
    expect(animation).toMatch(/frameCount[\s\S]*frameWidth[\s\S]*fps[\s\S]*loop/i);
    expect(animation).toMatch(/packaged export[\s\S]*materialize/i);
    const tileset = readFileSync(path.join(skillRoot, 'references', 'godot-tileset-contract.md'), 'utf8');
    expect(tileset).toMatch(/TileSet[\s\S]*TileMapLayer[\s\S]*terrain/i);
    expect(tileset).toMatch(/topdown-15[\s\S]*platformer-16[\s\S]*isometric-atlas/i);
    expect(tileset).toMatch(/do not infer|never infer/i);
    const sliceDocuments = readFileSync(path.join(skillRoot, 'references', 'slice-document-contract.md'), 'utf8');
    expect(sliceDocuments).toMatch(/docs\/keco-godot-slices[\s\S]*spec\.md[\s\S]*plan\.md[\s\S]*status\.json/i);
    expect(sliceDocuments).toMatch(/latest[\s\S]*superseded[\s\S]*completed/i);
    expect(sliceDocuments).toMatch(/Keco documents are authoritative[\s\S]*create_document\(projectId, folderId[\s\S]*read_document/i);
    expect(sliceDocuments).toMatch(/no compatible folder[\s\S]*blocked_before_write/i);
    const sliceDecision = readFileSync(path.join(skillRoot, 'references', 'slice-decision.md'), 'utf8');
    expect(sliceDecision).toMatch(/consistent[\s\S]*without[\s\S]*confirmation/i);
    expect(sliceDecision).toMatch(/awaiting_user_confirmation[\s\S]*zero-write/i);
    const orchestration = readFileSync(path.join(skillRoot, 'references', 'orchestration-contract.md'), 'utf8');
    expect(orchestration).toMatch(/specPath[\s\S]*planPath[\s\S]*statusPath/i);
    expect(orchestration).toMatch(/kecoFolderId[\s\S]*kecoDocumentIds[\s\S]*localMirrorRoot/i);
    expect(orchestration).toMatch(/evolution[\s\S]*reuse_exact[\s\S]*create_new/i);
    expect(orchestration).toMatch(/SlicePlan[\s\S]{0,200}approved static scope/i);
    expect(orchestration).toMatch(/task completion[\s\S]{0,160}status\.json/i);
    expect(orchestration).toMatch(/interaction:[\s\S]{0,480}blockedAt[\s\S]{0,240}resumeFrom/i);
    expect(orchestration).toMatch(/legacy[\s\S]{0,240}without[\s\S]{0,160}interaction/i);
    expect(sliceDocuments).toMatch(/plan\.md[\s\S]{0,200}does not own task progress/i);
    expect(sliceDocuments).toMatch(/TaskResult[\s\S]{0,160}EvalReport[\s\S]{0,160}evidence/i);
  });

  it('ships the multi-Slice roadmap and recovery contract', () => {
    const multiSlicePath = path.join(skillRoot, 'references', 'multi-slice-orchestration.md');
    expect(existsSync(multiSlicePath)).toBe(true);
    if (!existsSync(multiSlicePath)) return;

    const multiSlice = readFileSync(multiSlicePath, 'utf8');
    expect(multiSlice).toMatch(/roadmap[\s\S]*dependencies[\s\S]*priority/i);
    expect(multiSlice).toMatch(/NEXT_SLICE[\s\S]*completed/i);
    expect(multiSlice).toMatch(/three|3[\s\S]*paused[\s\S]*user/i);
    expect(multiSlice).toMatch(/all planned[\s\S]*Slices[\s\S]*sequentially[\s\S]*dependencies[\s\S]*complete/i);
    expect(multiSlice).toMatch(/priority[\s\S]*tie-breaker/i);
    expect(multiSlice).toMatch(/third failed repair iteration[\s\S]*persist[\s\S]*evidence[\s\S]*status[\s\S]*eval-report/i);
    expect(multiSlice).toMatch(/third failed repair iteration[\s\S]*roadmap[\s\S]*paused[\s\S]*NEXT_SLICE[\s\S]*clear[\s\S]*ask[\s\S]*user/i);
    expect(multiSlice).toMatch(/status: planned\|in_progress\|completed\|failed\|blocked[\s\S]*evalResult: passed\|partial\|failed\|blocked_before_write/i);
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
      const builder = path.join(skillRoot, 'scripts', 'build_spriteframes_resource.py');
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
      const validator = path.join(skillRoot, 'scripts', 'validate_generated_asset_package.py');
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

  it('validates dated slice documents and completion state', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-v2-slice-docs-'));
    try {
      const sliceDir = path.join(tempRoot, 'docs', 'keco-godot-slices', 'hero-animation');
      mkdirSync(sliceDir, { recursive: true });
      const frontmatter = (documentType: string) => `---\nsliceId: hero-animation\ndocumentType: ${documentType}\ncreatedDate: 2026-08-06\nupdatedDate: 2026-08-06\nstatus: in_progress\nlatest: true\n---\n`;
      writeFileSync(path.join(sliceDir, 'spec.md'), frontmatter('spec') + '\n# Hero animation\n');
      writeFileSync(path.join(sliceDir, 'plan.md'), frontmatter('plan') + '\n# Plan\n');
      writeFileSync(path.join(sliceDir, 'status.json'), JSON.stringify({
        version: 1,
        sliceId: 'hero-animation',
        createdDate: '2026-08-06',
        updatedDate: '2026-08-06',
        status: 'in_progress',
        latest: true,
        completed: false,
        supersedes: [],
        tasks: [{ id: 'task-01', status: 'pending' }],
      }));
      const validator = path.join(skillRoot, 'scripts', 'validate_slice_documents.py');
      const valid = spawnSync('python3', [validator, '--slice-dir', sliceDir], { encoding: 'utf8' });
      expect(valid.status).toBe(0);
      expect(valid.stdout).toMatch(/"ok": true/);

      writeFileSync(path.join(sliceDir, 'status.json'), JSON.stringify({
        version: 1,
        sliceId: 'hero-animation',
        createdDate: '2026-08-06',
        updatedDate: '2026-08-06',
        status: 'completed',
        latest: true,
        completed: true,
        supersedes: [],
        tasks: [{ id: 'task-01', status: 'completed' }],
      }));
      writeFileSync(path.join(sliceDir, 'spec.md'), frontmatter('spec').replace(/status: in_progress/, 'status: completed') + '# Hero animation\n');
      writeFileSync(path.join(sliceDir, 'plan.md'), frontmatter('plan').replace(/status: in_progress/, 'status: completed') + '# Plan\n');
      const invalid = spawnSync('python3', [validator, '--slice-dir', sliceDir], { encoding: 'utf8' });
      expect(invalid.status).not.toBe(0);
      expect(invalid.stderr).toMatch(/eval-report/i);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps the pressure scenarios as reviewable fixtures', () => {
    const fixture = JSON.parse(readFileSync(path.join(repositoryRoot, 'tests', 'fixtures', 'plugins', 'keco-godot-skill-v2-evals.json'), 'utf8')) as { cases: unknown[]; invocation: string };
    expect(fixture.invocation).toBe('$keco-develop-godot-slice-v2');
    expect(fixture.cases).toHaveLength(7);
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
      expect(() => execFileSync('python3', [path.join(skillRoot, 'scripts', 'validate_run_context.py'), unsafeRun])).toThrow();

      const incompletePlan = path.join(tempRoot, 'plan.json');
      writeFileSync(incompletePlan, JSON.stringify({ tasks: [{ id: 'task-01', files: [], dependsOn: [], servesEvaluations: [] }] }));
      expect(() => execFileSync('python3', [path.join(skillRoot, 'scripts', 'validate_plan.py'), incompletePlan])).toThrow();
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
        [path.join(skillRoot, 'scripts', 'validate_plan.py'), runtimePlan],
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
    const validator = path.join(skillRoot, 'scripts', 'validate_interaction_checkpoint.py');
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
    const validator = path.join(skillRoot, 'scripts', 'validate_run_context.py');
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
        [path.join(skillRoot, 'scripts', 'validate_run_context.py'), runPath],
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
        [path.join(skillRoot, 'scripts', 'validate_run_context.py'), runPath],
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
        [path.join(skillRoot, 'scripts', 'validate_plan.py'), planPath],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/"ok": true/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps snapshot export and validation runnable inside v2', () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-v2-snapshot-'));
    const input = path.join(repositoryRoot, 'tests', 'fixtures', 'plugins', 'keco-godot-snapshot-input.json');
    const output = path.join(tempRoot, 'snapshot');
    try {
      const exporter = spawnSync('python3', [path.join(skillRoot, 'scripts', 'export_keco_snapshot.py'), '--input', input, '--output-dir', output], { encoding: 'utf8' });
      expect(exporter.status).toBe(0);
      const validator = spawnSync('python3', [path.join(skillRoot, 'scripts', 'validate_snapshot.py'), '--snapshot-dir', output, '--source-input', input], { encoding: 'utf8' });
      expect(validator.status).toBe(0);
      expect(validator.stdout).toMatch(/"ok": true/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
