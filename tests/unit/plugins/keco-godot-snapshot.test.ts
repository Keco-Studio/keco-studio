import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repositoryRoot = process.cwd();
const skillRoot = path.join(repositoryRoot, 'plugins', 'keco', 'skills', 'keco-develop-godot-slice');
const exporter = path.join(skillRoot, 'scripts', 'export_keco_snapshot.py');
const validator = path.join(skillRoot, 'scripts', 'validate_snapshot.py');
const fixturePath = path.join(repositoryRoot, 'tests', 'fixtures', 'plugins', 'keco-godot-snapshot-input.json');

function runPython(script: string, args: string[]) {
  return spawnSync('python3', [script, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

function writeVariant(root: string, mutate: (value: Record<string, any>) => void): string {
  const value = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, any>;
  mutate(value);
  const output = path.join(root, 'source.json');
  writeFileSync(output, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return output;
}

describe('Keco Godot snapshot scripts', () => {
  let temporaryRoot: string;

  beforeEach(() => {
    temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'keco-godot-snapshot-'));
  });

  afterEach(() => {
    rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it('exports byte-identical snapshots and validates their hashes', () => {
    const first = path.join(temporaryRoot, 'first');
    const second = path.join(temporaryRoot, 'second');

    const firstResult = runPython(exporter, ['--input', fixturePath, '--output-dir', first]);
    const secondResult = runPython(exporter, ['--input', fixturePath, '--output-dir', second]);

    expect(firstResult.stderr).toBe('');
    expect(firstResult.status).toBe(0);
    expect(secondResult.stderr).toBe('');
    expect(secondResult.status).toBe(0);
    expect(readFileSync(path.join(first, 'manifest.json'))).toEqual(
      readFileSync(path.join(second, 'manifest.json')),
    );
    expect(readFileSync(path.join(first, 'tables', 'activities.json'))).toEqual(
      readFileSync(path.join(second, 'tables', 'activities.json')),
    );

    const validation = runPython(validator, [
      '--snapshot-dir',
      first,
      '--source-input',
      fixturePath,
    ]);
    expect(validation.stderr).toBe('');
    expect(validation.status).toBe(0);
    expect(JSON.parse(validation.stdout)).toMatchObject({ ok: true, tableCount: 2 });
  });

  it('rejects a generated table changed after export', () => {
    const snapshot = path.join(temporaryRoot, 'snapshot');
    expect(runPython(exporter, ['--input', fixturePath, '--output-dir', snapshot]).status).toBe(0);
    const tablePath = path.join(snapshot, 'tables', 'activities.json');
    writeFileSync(tablePath, readFileSync(tablePath, 'utf8').replace('-15', '-14'), 'utf8');

    const validation = runPython(validator, ['--snapshot-dir', snapshot]);

    expect(validation.status).toBe(1);
    expect(validation.stderr).toMatch(/hash mismatch/i);
  });

  it('rejects duplicate table and row keys before writing', () => {
    const duplicateTable = writeVariant(temporaryRoot, (value) => {
      value.tables.push(value.tables[0]);
    });
    const duplicateTableResult = runPython(exporter, [
      '--input',
      duplicateTable,
      '--output-dir',
      path.join(temporaryRoot, 'duplicate-table'),
    ]);
    expect(duplicateTableResult.status).toBe(1);
    expect(duplicateTableResult.stderr).toMatch(/duplicate table key/i);

    const duplicateRow = writeVariant(temporaryRoot, (value) => {
      value.tables[0].rows.push(value.tables[0].rows[0]);
    });
    const duplicateRowResult = runPython(exporter, [
      '--input',
      duplicateRow,
      '--output-dir',
      path.join(temporaryRoot, 'duplicate-row'),
    ]);
    expect(duplicateRowResult.status).toBe(1);
    expect(duplicateRowResult.stderr).toMatch(/duplicate row key/i);
  });

  it('rejects invalid keys and unresolved reference targets', () => {
    const invalidKey = writeVariant(temporaryRoot, (value) => {
      value.tables[0].key = '../resources';
    });
    const invalidKeyResult = runPython(exporter, [
      '--input',
      invalidKey,
      '--output-dir',
      path.join(temporaryRoot, 'invalid-key'),
    ]);
    expect(invalidKeyResult.status).toBe(1);
    expect(invalidKeyResult.stderr).toMatch(/invalid table key/i);

    const missingReference = writeVariant(temporaryRoot, (value) => {
      value.tables[1].rows[0].values['reward-resource'].targetRowKeys.push('missing');
    });
    const missingReferenceResult = runPython(exporter, [
      '--input',
      missingReference,
      '--output-dir',
      path.join(temporaryRoot, 'missing-reference'),
    ]);
    expect(missingReferenceResult.status).toBe(1);
    expect(missingReferenceResult.stderr).toMatch(/unknown target row key/i);
  });

  it('rejects a source input that differs from the exported source', () => {
    const snapshot = path.join(temporaryRoot, 'snapshot');
    expect(runPython(exporter, ['--input', fixturePath, '--output-dir', snapshot]).status).toBe(0);
    const changedSource = writeVariant(temporaryRoot, (value) => {
      value.schemaVersion = 2;
    });

    const validation = runPython(validator, [
      '--snapshot-dir',
      snapshot,
      '--source-input',
      changedSource,
    ]);

    expect(validation.status).toBe(1);
    expect(validation.stderr).toMatch(/source input hash mismatch/i);
  });
});
