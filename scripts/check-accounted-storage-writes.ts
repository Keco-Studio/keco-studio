import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ACCOUNTED_BUCKETS = ['library-media-files', 'project-assets', 'map-assets', 'character-assets', 'tiptap-images'];
const WRITE_OPERATIONS = ['upload', 'update', 'remove', 'move', 'copy'];
const DEFAULT_ALLOWLIST = new Set([
  'src/lib/services/mediaFileUploadService.ts',
  'src/lib/server/createMapReferenceService.ts',
  'src/lib/server/projectDeletion.ts',
  'src/app/api/projects/[projectId]/game-assets/route.ts',
  'supabase/functions/pixellab-character/storage.ts',
  'supabase/functions/pixellab-map/storage.ts',
  'supabase/functions/mcp/write-tools.ts',
  'scripts/accept-mcp-account-connections-production.ts',
  'scripts/accept-python-generated-asset-writeback.ts',
]);
const SKIP_DIRECTORIES = new Set(['.git', '.next', '.worktrees', 'node_modules', 'coverage', 'playwright-report', 'test-results']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export type StorageWriteViolation = { file: string; line: number; bucketId: string; operation: string };
export type StorageWriteCheckResult = { exitCode: number; violations: StorageWriteViolation[] };

function sourceFiles(rootDir: string, directory = rootDir): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith('.next-') ? [] : sourceFiles(rootDir, absolute);
    return entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [absolute] : [];
  });
}
function lineForIndex(source: string, index: number): number { return source.slice(0, index).split('\n').length; }
function escaped(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function findAccountedStorageWrites(rootDir = process.cwd(), allowlist: ReadonlySet<string> = DEFAULT_ALLOWLIST): StorageWriteViolation[] {
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) throw new Error('Storage write scan root is unavailable');
  const violations: StorageWriteViolation[] = [];
  for (const absoluteFile of sourceFiles(rootDir)) {
    const relativeFile = path.relative(rootDir, absoluteFile).split(path.sep).join('/');
    if (allowlist.has(relativeFile) || relativeFile.startsWith('tests/') || /\.test\.[^.]+$/.test(relativeFile)) continue;
    const source = readFileSync(absoluteFile, 'utf8');
    for (const bucketId of ACCOUNTED_BUCKETS) for (const operation of WRITE_OPERATIONS) {
      const chain = new RegExp(`storage\\s*\\.\\s*from\\s*\\(\\s*['\"]${escaped(bucketId)}['\"]\\s*\\)\\s*\\.\\s*${operation}\\s*\\(`, 'g');
      for (let match = chain.exec(source); match; match = chain.exec(source)) violations.push({ file: relativeFile, line: lineForIndex(source, match.index), bucketId, operation });
      const assignment = new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*[^;\\n]*storage\\s*\\.\\s*from\\s*\\(\\s*['\"]${escaped(bucketId)}['\"]\\s*\\)`, 'g');
      for (let assignmentMatch = assignment.exec(source); assignmentMatch; assignmentMatch = assignment.exec(source)) {
        const use = new RegExp(`\\b${escaped(assignmentMatch[1])}\\s*\\.\\s*(${WRITE_OPERATIONS.join('|')})\\s*\\(`, 'g');
        for (let useMatch = use.exec(source); useMatch; useMatch = use.exec(source)) violations.push({ file: relativeFile, line: lineForIndex(source, useMatch.index), bucketId, operation: useMatch[1] });
      }
    }
  }
  return violations.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line || left.operation.localeCompare(right.operation));
}

export function runAccountedStorageWriteCheck(options: { rootDir?: string; allowlist?: ReadonlySet<string>; writeOutput?: (message: string) => void } = {}): StorageWriteCheckResult {
  const violations = findAccountedStorageWrites(options.rootDir ?? process.cwd(), options.allowlist ?? DEFAULT_ALLOWLIST);
  const writeOutput = options.writeOutput ?? console.error;
  for (const violation of violations) writeOutput(`${violation.file}:${violation.line} direct ${violation.operation} to accounted bucket ${violation.bucketId}`);
  return { exitCode: violations.length === 0 ? 0 : 1, violations };
}

if (path.basename(process.argv[1] ?? '') === 'check-accounted-storage-writes.ts') {
  process.exitCode = runAccountedStorageWriteCheck().exitCode;
}
