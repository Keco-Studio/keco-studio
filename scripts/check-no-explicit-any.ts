import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const filesToScan = [
  'src/app/api/search/assets/route.ts',
];

const explicitAnyPatterns: Array<{ label: string; pattern: RegExp }> = [
  { label: 'type annotation', pattern: /:\s*any\b/ },
  { label: 'type assertion', pattern: /\bas\s+any\b/ },
  { label: 'generic argument', pattern: /<\s*any\s*>/ },
  { label: 'array shorthand', pattern: /\bany\s*\[\s*\]/ },
  { label: 'array generic', pattern: /\bArray\s*<\s*any\s*>/ },
  { label: 'record value', pattern: /\bRecord\s*<[^>]*,\s*any\s*>/ },
  { label: 'function parameter', pattern: /\([^)]*:\s*any\b/ },
  { label: 'rest parameter', pattern: /\.\.\.\w+\s*:\s*any\b/ },
];

type Violation = {
  file: string;
  line: number;
  label: string;
  source: string;
};

const violations: Violation[] = [];

for (const file of filesToScan) {
  const absolutePath = path.join(repoRoot, file);
  const lines = readFileSync(absolutePath, 'utf8').split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const { label, pattern } of explicitAnyPatterns) {
      if (pattern.test(line)) {
        violations.push({
          file,
          line: index + 1,
          label,
          source: line.trim(),
        });
      }
    }
  });
}

if (violations.length > 0) {
  console.error('Explicit any guard failed:');
  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line} ${violation.label}: ${violation.source}`
    );
  }
  process.exit(1);
}
