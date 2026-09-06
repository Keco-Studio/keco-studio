import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

describe('Slice V2 end-to-end fixture', () => {
  it('connects SourceProfile, plan/eval, observation, report, and delivery artifacts', () => {
    const fixture = JSON.parse(readFileSync(path.join(process.cwd(), 'tests/fixtures/plugins/keco-godot-slice-v2-end-to-end.json'), 'utf8')) as Record<string, any>;
    expect(fixture.contractVersion).toBe(2);
    expect(fixture.sourceProfile.kind).toBe('user_idea');
    expect(fixture.slicePlan.schemaVersion).toBe(2);
    expect(fixture.evalSpec.schemaVersion).toBe(2);
    expect(fixture.taskResult.payload.schemaVersion).toBe(2);
    expect(fixture.taskReview.payload.schemaVersion).toBe(2);
    expect(fixture.runtimeObservation.schemaVersion).toBe(1);
    expect(fixture.evalReport.version).toBe(2);
    expect(fixture.mirrorManifest.schemaVersion).toBe(2);
    expect(fixture.mirrorVerification.verified).toBe(true);

    const dir = os.tmpdir();
    const tempRoot = path.join(dir, `slice-e2e-${process.pid}`);
    mkdirSync(tempRoot, { recursive: true });
    const writeJson = (name: string, value: unknown) => {
      const target = path.join(tempRoot, name);
      writeFileSync(target, JSON.stringify(value));
      return target;
    };
    const run = writeJson('run-context.json', fixture.runContext);
    const plan = writeJson('slice-plan.json', fixture.slicePlan);
    const source = writeJson('source-profile.json', fixture.sourceProfile);
    const evaluation = writeJson('eval-spec.json', fixture.evalSpec);
    const combined = writeJson('plan-eval.json', { plan: fixture.slicePlan, evalSpec: fixture.evalSpec });
    const preflight = path.join(process.cwd(), 'plugins/keco-codex/skills/keco-godot-slice-preflight/scripts');
    const implementation = path.join(process.cwd(), 'plugins/keco-codex/skills/keco-godot-slice-implementation/scripts');
    const verification = path.join(process.cwd(), 'plugins/keco-codex/skills/keco-godot-slice-verification/scripts');
    const delivery = path.join(process.cwd(), 'plugins/keco-codex/skills/keco-godot-slice-delivery/scripts');
    const runPython = (script: string, args: string[]) => {
      const result = spawnSync('python3', [script, ...args], { encoding: 'utf8' });
      expect({ script, status: result.status, stderr: result.stderr }).toEqual({ script, status: 0, stderr: '' });
      return result;
    };
    runPython(path.join(preflight, 'validate_run_context.py'), [run]);
    runPython(path.join(preflight, 'validate_contract_case.py'), ['sourceProfile', source]);
    runPython(path.join(preflight, 'validate_contract_case.py'), ['planEval', combined]);
    const taskEvidence = runPython(path.join(implementation, 'validate_task_evidence.py'), [
      '--run-context', run, '--plan', plan,
      '--task-result', writeJson('task-result.json', fixture.taskResult),
      '--task-review', writeJson('task-review.json', fixture.taskReview),
    ]);
    expect(JSON.parse(taskEvidence.stdout)).toMatchObject({ ok: true, reviewVerdict: 'accepted' });
    const runtimeDebug = path.join(tempRoot, 'debug-output.txt');
    writeFileSync(runtimeDebug, `KECO_OBSERVATION ${JSON.stringify(fixture.runtimeObservation)}\n`);
    const runtimeOutput = path.join(tempRoot, 'runtime-report.json');
    runPython(path.join(verification, 'evaluate_runtime_observations.py'), [
      '--eval-spec', evaluation, '--debug-output', runtimeDebug, '--output', runtimeOutput,
    ]);
    const runtime = JSON.parse(readFileSync(runtimeOutput, 'utf8')) as Record<string, any>;
    expect(runtime.status).toBe('passed');
    const report = {
      ...fixture.evalReport,
      evaluations: runtime.evaluations.map((item: Record<string, any>) => ({
        ...item,
        evidence: ['KECO_OBSERVATION'],
      })),
    };
    const reportPath = writeJson('eval-report.json', report);
    runPython(path.join(verification, 'validate_eval_report.py'), [reportPath]);
    const mirrorRoot = path.join(tempRoot, 'repository');
    mkdirSync(mirrorRoot);
    const manifest = { ...fixture.mirrorManifest, files: (fixture.mirrorManifest.files as Array<Record<string, any>>).map(file => ({
      ...file,
      byteCount: Buffer.byteLength(file.content),
      sha256: `sha256:${createHash('sha256').update(file.content).digest('hex')}`,
    })) };
    const files = manifest.files as Array<Record<string, any>>;
    const canonicalFiles = JSON.stringify(files, Object.keys(files[0]).sort());
    manifest.manifestHash = `sha256:${createHash('sha256').update(canonicalFiles).digest('hex')}`;
    const manifestPath = writeJson('mirror-manifest.json', manifest);
    const mirrorOutput = path.join(tempRoot, 'mirror-verification.json');
    runPython(path.join(delivery, 'materialize_slice_mirrors.py'), [
      '--manifest', manifestPath, '--repository-root', mirrorRoot,
      '--allowed-files', writeJson('mirror-allowed.json', { allowedFiles: files.map(file => file.repositoryPath) }),
      '--output', mirrorOutput,
    ]);
    const mirrorVerification = JSON.parse(readFileSync(mirrorOutput, 'utf8')) as Record<string, any>;
    expect(mirrorVerification).toMatchObject({ schemaVersion: 2, contractVersion: 2, manifestHash: manifest.manifestHash });
    const statusInput = writeJson('status-input.json', {
      tasks: [{ status: 'completed', resultAccepted: true, reviewAccepted: true }],
      evaluations: runtime.evaluations,
      manualRequired: false,
      mirrorsVerified: true,
      packageReady: true,
    });
    const statusOutput = path.join(tempRoot, 'status.json');
    runPython(path.join(verification, 'derive_slice_status.py'), [statusInput, '--output', statusOutput]);
    expect(JSON.parse(readFileSync(statusOutput, 'utf8'))).toMatchObject({ releaseReadiness: 'ready' });
    rmSync(tempRoot, { recursive: true, force: true });
  });
});
