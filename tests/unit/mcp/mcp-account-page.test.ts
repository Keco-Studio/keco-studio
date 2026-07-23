import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_COMMANDS } from '@/components/mcp/mcpCommands';
import { parseRouteParams, SPECIAL_ROUTE_SEGMENTS } from '@/lib/utils/routeParams';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const topBar = read('src/components/layout/TopBar.tsx');
const page = read('src/app/(dashboard)/mcp/page.tsx');
const commands = read('src/components/mcp/McpConnectionCommands.tsx');
const connections = read('src/components/mcp/McpConnectionsList.tsx');
const css = read('src/app/(dashboard)/mcp/page.module.css');
const dashboardLayout = read('src/components/layout/DashboardLayout.tsx');
const dashboardCss = read('src/components/layout/DashboardLayout.module.css');

describe('MCP account page wiring', () => {
  it('puts MCP immediately above Logout and routes to the account page', () => {
    const menu = topBar.slice(topBar.indexOf('{showUserMenu &&'));
    expect(menu.indexOf('MCP')).toBeGreaterThan(-1);
    expect(menu.indexOf('MCP')).toBeLessThan(menu.indexOf('Logout'));
    expect(topBar).toContain("router.push('/mcp')");
    expect(topBar).toMatch(/handleMcpNavigation[\s\S]+setShowUserMenu\(false\)/);
  });

  it('treats /mcp as an account route rather than a project ID', () => {
    expect(SPECIAL_ROUTE_SEGMENTS).toContain('mcp');
    expect(parseRouteParams('/mcp')).toEqual({
      projectId: null, libraryId: null, folderId: null, assetId: null, documentId: null,
      isPredefinePage: false, isLibraryPage: false,
    });
  });

  it('renders the approved page and exact single-line commands', () => {
    expect(page).toContain('<h1>MCP</h1>');
    expect(page).toContain('Connect Keco to an AI coding client and manage access for this account.');
    expect(commands).toContain('Connect a client');
    expect(commands).toContain('Run these commands in your terminal, then complete sign-in in the browser.');
    expect(MCP_COMMANDS.codex.map((item) => item.command)).toEqual([
      'codex mcp add keco-account --url \"https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp\" --oauth-resource \"https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp\"',
      'codex mcp login keco-account',
    ]);
    expect(MCP_COMMANDS.claude.map((item) => item.command)).toEqual([
      'claude mcp add --transport http keco-account \"https://lulrcirmwwvvnupmwqcq.supabase.co/functions/v1/mcp\"',
    ]);
    expect(commands).toContain('navigator.clipboard.writeText(command)');
    expect(commands).toContain("title={copied ? 'Copied' : 'Copy command'}");
  });

  it('keeps commands wrapping and mobile rows usable without horizontal scrolling', () => {
    expect(css).toMatch(/\.page[\s\S]+overflow-x: hidden/);
    expect(css).toMatch(/\.commandField code[\s\S]+overflow-wrap: anywhere[\s\S]+white-space: normal/);
    expect(css).toMatch(/@media \(max-width: 680px\)[\s\S]+\.connectedColumn \{ display: none; \}/);
    expect(css).not.toMatch(/font-size:\s*(?:clamp|min|max)\(/);
    expect(dashboardLayout).toContain('isMcpAccountPage ? styles.mcpSidebarSlot');
    expect(dashboardCss).toMatch(/@media \(max-width: 680px\)[\s\S]+\.mcpSidebarSlot[\s\S]+display: none/);
  });

  it('implements loading, error, retry, empty, focus refresh, and exact-row disconnect states', () => {
    expect(connections).toContain('[0, 1].map');
    expect(connections).toContain('No MCP clients connected.');
    expect(connections).toContain('Retry');
    expect(connections).toContain("window.addEventListener('focus', handleFocus)");
    expect(connections).not.toMatch(/setInterval|poll/i);
    expect(connections).toContain('disconnectingId === connection.id');
    expect(connections).toContain('Disconnect ${selected.clientName}?');
    expect(connections).toContain('This client will no longer be able to access Keco.');
    expect(connections).toContain('setConnections((current) => current.filter');
  });
});
