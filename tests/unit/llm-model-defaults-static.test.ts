import fs from 'node:fs';
import path from 'node:path';

const repositoryRoot = process.cwd();
const scannedRoots = ['src', 'tests', 'docs', 'specs'];
const ignoredDirectories = new Set(['node_modules', '.next', 'coverage']);
const textFileExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.yml', '.yaml']);

function collectTextFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name) ? [] : collectTextFiles(absolutePath);
    }
    return textFileExtensions.has(path.extname(entry.name)) ? [absolutePath] : [];
  });
}

describe('DeepSeek model defaults', () => {
  it('does not retain the retired V4 Flash model ID', () => {
    const retiredModelId = ['deepseek', 'v4', 'flash'].join('-');
    const matches = scannedRoots
      .flatMap((root) => collectTextFiles(path.join(repositoryRoot, root)))
      .filter((file) => fs.readFileSync(file, 'utf8').includes(retiredModelId))
      .map((file) => path.relative(repositoryRoot, file));

    expect(matches).toEqual([]);
  });
});
