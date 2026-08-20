import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const srcRoot = path.join(repoRoot, 'src');

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      return collectSourceFiles(fullPath);
    }
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

function relativePath(fullPath: string): string {
  return path.relative(repoRoot, fullPath).split(path.sep).join('/');
}

const sourceFiles = collectSourceFiles(srcRoot).map((file) => ({
  file: relativePath(file),
  source: readFileSync(file, 'utf8'),
}));

describe('service role server boundary', () => {
  it('keeps service-role secrets in server-only modules', () => {
    const serviceRoleFiles = sourceFiles.filter(({ source }) =>
      source.includes('SUPABASE_SERVICE_ROLE_KEY')
    );

    expect(serviceRoleFiles.map(({ file }) => file)).toEqual([
      'src/lib/gdd-generation/maps/worker.ts',
      'src/lib/server/agentConfirmationSigning.ts',
      'src/lib/server/supabaseServiceRole.ts',
    ]);

    for (const { source } of serviceRoleFiles) {
      expect(source.startsWith("import 'server-only';")).toBe(true);
      expect(source).not.toContain("'use client'");
      expect(source).not.toContain('"use client"');
    }
  });

  it('prevents client modules from importing server-only service-role code', () => {
    const clientImports = sourceFiles
      .filter(({ source }) => source.includes("'use client'") || source.includes('"use client"'))
      .filter(({ source }) => source.includes('@/lib/server') || source.includes('/lib/server/'))
      .map(({ file }) => file);

    expect(clientImports).toEqual([]);
  });

  it('keeps MCP connection internals in explicit server-only modules', () => {
    for (const file of [
      'src/lib/server/mcpConnectionId.ts',
      'src/lib/server/mcpConnectionsService.ts',
    ]) {
      const source = readFileSync(path.join(repoRoot, file), 'utf8');
      expect(source.startsWith("import 'server-only';")).toBe(true);
      expect(source).not.toContain("'use client'");
    }
  });

  it('keeps project deletion client code on the API boundary', () => {
    const projectService = readFileSync(
      path.join(repoRoot, 'src/lib/services/projectService.ts'),
      'utf8'
    );
    const sidebar = readFileSync(path.join(repoRoot, 'src/components/layout/Sidebar.tsx'), 'utf8');

    expect(projectService).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(projectService).not.toContain('getServiceClient');
    expect(projectService).toContain('/api/projects/${projectId}/delete');
    expect(sidebar).not.toContain('import { Project, deleteProject }');
  });

  it('does not expose a browser-readable service-role environment variable', () => {
    const browserServiceRoleReferences = sourceFiles
      .filter(({ source }) => /NEXT_PUBLIC_[A-Z0-9_]*SERVICE_ROLE/.test(source))
      .map(({ file }) => file);

    expect(browserServiceRoleReferences).toEqual([]);
  });
});
