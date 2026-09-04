import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const codexSkills = path.join(root, 'plugins/keco-codex/skills');
const claudeSkills = path.join(root, 'plugins/keco-claude/skills');
const modules = ['preflight', 'assets', 'implementation', 'verification', 'delivery'];

describe('Slice V2 modular architecture', () => {
  it('ships the public orchestrator and all five phase modules in both hosts', () => {
    expect(existsSync(path.join(codexSkills, 'keco-develop-godot-slice-v2', 'SKILL.md'))).toBe(true);
    for (const phase of modules) {
      const name = `keco-godot-slice-${phase}`;
      expect(existsSync(path.join(codexSkills, name, 'SKILL.md'))).toBe(true);
      expect(existsSync(path.join(claudeSkills, name, 'SKILL.md'))).toBe(true);
      const normalize = (value: Buffer) => value.toString('utf8').replaceAll('../../references/', 'references/');
      expect(normalize(readFileSync(path.join(codexSkills, name, 'SKILL.md')))).toBe(normalize(readFileSync(path.join(claudeSkills, name, 'SKILL.md'))));
    }
  });

  it('has no active V1 skill or validator route', () => {
    expect(existsSync(path.join(codexSkills, 'keco-develop-godot-slice'))).toBe(false);
    expect(existsSync(path.join(claudeSkills, 'keco-develop-godot-slice'))).toBe(false);
    expect(existsSync(path.join(root, 'plugins/keco-claude/scripts/validate_slice_documents.py'))).toBe(false);
    const active = spawnSync('rg', ['-n', 'keco-develop-godot-slice/', 'plugins', 'tests', '--pcre2', '--glob', '!**/keco-godot-slice-v2-end-to-end.json', '--glob', '!**/keco-godot-slice-v2-modules.test.ts', '--glob', '!**/keco-plugin.test.ts'], { encoding: 'utf8' });
    expect(active.stdout).toBe('');
  });

  it('keeps the artifact schema chain explicit', () => {
    const manifest = JSON.parse(readFileSync(path.join(root, 'contracts/keco-slice-v2/contract-manifest.json'), 'utf8')) as { artifactSchemaVersions: Record<string, number> };
    expect(manifest.artifactSchemaVersions).toMatchObject({ sourceProfile: 1, slicePlan: 2, evalSpec: 2, taskResult: 2, taskReview: 2, mirrorManifest: 2, mirrorVerification: 2 });
    const taskValidator = path.join(codexSkills, 'keco-godot-slice-implementation/scripts/validate_task_evidence.py');
    expect(spawnSync('python3', [taskValidator, '--help'], { encoding: 'utf8' }).status).toBe(0);
  });

  it('executes every Codex phase validator from its owning module', () => {
    const scripts = [
      'keco-godot-slice-preflight/scripts/validate_plan.py',
      'keco-godot-slice-assets/scripts/validate_generated_asset_package.py',
      'keco-godot-slice-implementation/scripts/validate_task_evidence.py',
      'keco-godot-slice-verification/scripts/evaluate_runtime_observations.py',
      'keco-godot-slice-verification/scripts/derive_slice_status.py',
      'keco-godot-slice-delivery/scripts/validate_delivery_policy.py',
    ];
    for (const relative of scripts) {
      const script = path.join(codexSkills, relative);
      const result = spawnSync('python3', [script, '--help'], { encoding: 'utf8' });
      expect({ relative, status: result.status, stderr: result.stderr }).toEqual({
        relative,
        status: 0,
        stderr: '',
      });
    }
  });

  it('does not retain the retired schema 1 mirror materialization branch', () => {
    const materializer = readFileSync(path.join(
      codexSkills,
      'keco-godot-slice-delivery/scripts/materialize_slice_mirrors.py',
    ), 'utf8');
    expect(materializer).not.toMatch(/schema_version == 1|legacy mirror manifest|legacyLayout/);
  });
});
