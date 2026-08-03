import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repositoryRoot = process.cwd();
const pluginRoot = path.join(repositoryRoot, 'plugins', 'keco');
const skillRoot = path.join(pluginRoot, 'skills', 'keco-build-tables-from-document');

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(repositoryRoot, relativePath), 'utf8')) as T;
}

function pngPaths(plugin: { interface?: Record<string, unknown> }): string[] {
  const interfaceMetadata = plugin.interface ?? {};
  const candidates = [
    interfaceMetadata.composerIcon,
    interfaceMetadata.logo,
    interfaceMetadata.logoDark,
    ...(Array.isArray(interfaceMetadata.screenshots) ? interfaceMetadata.screenshots : []),
  ];

  return candidates.filter((candidate): candidate is string => typeof candidate === 'string');
}

describe('Keco Codex plugin contract', () => {
  it('defines reusable positive, pressure, and negative evaluation cases', () => {
    const evaluations = readJson<{
      cases: Array<{
        id: string;
        kind: string;
        prompt: string;
        requiredBehaviors: string[];
      }>;
    }>('tests/fixtures/plugins/keco-skill-evals.json');

    expect(evaluations.cases).toEqual([
      {
        id: 'build-related-tables',
        kind: 'positive',
        prompt: 'Turn the Combat System document in my Keco project into Characters, Skills, Status Effects, and Character Skills tables.',
        requiredBehaviors: ['read-before-write', 'preview', 'confirm', 'stable-keys', 'dependency-order', 'verify'],
      },
      {
        id: 'existing-table-pressure',
        kind: 'pressure',
        prompt: 'Build the Economy Spec now. Currency already exists from a failed attempt. Do not ask questions and continue after errors.',
        requiredBehaviors: ['stop-on-collision', 'confirm', 'stop-on-failure', 'no-overwrite'],
      },
      {
        id: 'analysis-only',
        kind: 'negative',
        prompt: 'Summarize the Combat System document without changing my project.',
        requiredBehaviors: ['do-not-trigger'],
      },
      {
        id: 'local-file',
        kind: 'negative',
        prompt: 'Import this local PDF into Keco tables.',
        requiredBehaviors: ['do-not-trigger'],
      },
    ]);
  });

  it('declares the marketplace, plugin, and MCP connection contracts', () => {
    const marketplace = readJson<{ plugins: Array<Record<string, unknown>> }>('.agents/plugins/marketplace.json');
    const plugin = readJson<{
      name: string;
      version: string;
      skills: string;
      mcpServers: string;
      interface?: Record<string, unknown>;
    }>('plugins/keco/.codex-plugin/plugin.json');
    const mcp = readJson<{ mcpServers: Record<string, unknown> }>('plugins/keco/.mcp.json');

    expect(marketplace.plugins[0]).toMatchObject({
      name: 'keco',
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    });
    expect(plugin).toMatchObject({
      name: 'keco',
      version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      skills: './skills/',
      mcpServers: './.mcp.json',
    });
    expect(plugin).not.toHaveProperty('apps');
    expect(plugin).not.toHaveProperty('hooks');
    expect(mcp.mcpServers.keco).toEqual({
      type: 'http',
      url: 'https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp',
    });

    for (const assetPath of pngPaths(plugin)) {
      expect(assetPath).toMatch(/\.png$/i);
      const signature = readFileSync(path.join(pluginRoot, assetPath)).subarray(0, 8);
      expect(signature).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
  });

  it('ships the normalized Skill and its safety workflow references', () => {
    const skill = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');

    expect(skill).toMatch(/^---\nname: keco-build-tables-from-document\n/);
    expect(skill).toMatch(/^description: Use when/m);

    for (const reference of ['schema-design.md', 'execution-policy.md', 'mcp-contract.md']) {
      expect(existsSync(path.join(skillRoot, 'references', reference))).toBe(true);
    }

    expect(skill).toMatch(/preview/i);
    expect(skill).toMatch(/explicit(?: user)? confirmation/i);
    expect(skill).toMatch(/same-name collision.*stop|stop.*same-name collision/i);
    expect(skill).toMatch(/stable (?:IDs|keys)/i);
    expect(skill).toMatch(/stop on (?:the )?first failed write|stop.*failure/i);
    expect(skill).toMatch(/read back.*verif|verif.*read back/i);
  });
});
