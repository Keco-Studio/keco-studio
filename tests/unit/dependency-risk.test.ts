import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

const sourceFiles = [
  'src/lib/services/importService.ts',
  'src/app/api/export/route.ts',
  'src/components/libraries/ImportLibraryModal.tsx',
];

describe('dependency risk guardrails', () => {
  it('keeps vulnerable or dev-only packages out of production dependencies', () => {
    expect(pkg.dependencies).not.toHaveProperty('xlsx');
    expect(pkg.dependencies).not.toHaveProperty('node-fetch');
    expect(pkg.dependencies).not.toHaveProperty('@types/echarts');
    expect(pkg.dependencies).not.toHaveProperty('@types/nodemailer');
    expect(pkg.dependencies).not.toHaveProperty('ngrok');
    expect(pkg.devDependencies).toHaveProperty('ngrok');
    expect(pkg.devDependencies).toHaveProperty('@types/nodemailer');
  });

  it('uses React 19 with the installed Ant Design React 19 patch', () => {
    expect(pkg.dependencies.react).toMatch(/^\^?19\./);
    expect(pkg.dependencies['react-dom']).toMatch(/^\^?19\./);
  });

  it('removes application imports of xlsx', () => {
    for (const relPath of sourceFiles) {
      const source = readFileSync(path.join(repoRoot, relPath), 'utf8');
      expect(source).not.toContain("from 'xlsx'");
      expect(source).not.toContain('import * as XLSX');
      expect(source).not.toContain('XLSX.');
    }
  });
});
