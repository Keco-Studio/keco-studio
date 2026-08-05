import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const repositoryRoot = process.cwd();
const skillRoot = path.join(repositoryRoot, 'plugins', 'keco', 'skills', 'keco-develop-godot-slice-v2');

describe('Keco Godot Slice V2 skill contract', () => {
  it('is manual-only and exposes the reviewed Superpowers-style ledger', () => {
    const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const metadata = readFileSync(path.join(skillRoot, 'agents', 'openai.yaml'), 'utf8');
    expect(skill).toMatch(/^---\nname: keco-develop-godot-slice-v2\n/);
    expect(skill).toContain('explicitly selects `$keco-develop-godot-slice-v2`');
    expect(skill).toMatch(/INTAKE[\s\S]*WRITE_PLAN[\s\S]*TASK_REVIEW[\s\S]*FINAL_VERIFY/);
    expect(skill).toMatch(/write token/i);
    expect(skill).toMatch(/blocked_before_write/);
    expect(skill).toMatch(/independent review/i);
    expect(skill).not.toMatch(/superpowers:[a-z-]+/i);
    expect(skill).toMatch(/already consistent[\s\S]*without asking|without asking[\s\S]*already consistent/i);
    expect(skill).toMatch(/unresolved ambiguity[\s\S]*zero writes|zero writes[\s\S]*unresolved ambiguity/i);
    expect(metadata).toMatch(/allow_implicit_invocation: false/);
  });

  it('ships all contracts and deterministic validators', () => {
    const files = [
      'references/orchestration-contract.md',
      'references/keco-pixellab-contract.md',
      'references/godot-mcp-contract.md',
      'references/ab-matrix.md',
      'references/source-data-contract.md',
      'references/eval-contract.md',
      'references/superpowers-adapted.md',
      'references/slice-decision.md',
      'references/pixellab-capability-registry.md',
      'scripts/validate_run_context.py',
      'scripts/validate_plan.py',
      'scripts/validate_eval_report.py',
      'scripts/export_keco_snapshot.py',
      'scripts/validate_snapshot.py',
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
    expect(sourceData).toMatch(/never automatically delete/i);
    const evalContract = readFileSync(path.join(skillRoot, 'references', 'eval-contract.md'), 'utf8');
    expect(evalContract).toMatch(/Create EvalSpec before any Keco, PixelLab, or Godot write/i);
    const adapted = readFileSync(path.join(skillRoot, 'references', 'superpowers-adapted.md'), 'utf8');
    expect(adapted).toMatch(/Plan validation[\s\S]*Task RED\/GREEN[\s\S]*Independent completion review/i);
    const sliceDecision = readFileSync(path.join(skillRoot, 'references', 'slice-decision.md'), 'utf8');
    expect(sliceDecision).toMatch(/consistent[\s\S]*without[\s\S]*confirmation/i);
    expect(sliceDecision).toMatch(/awaiting_user_confirmation[\s\S]*zero-write/i);
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
        mode: 'manual-v2',
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
