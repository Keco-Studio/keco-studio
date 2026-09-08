import { assertEquals } from '@std/assert';
import type { McpServer } from '@mcp/server/mcp.js';
import type { AccountMcpRequestContext, ProjectMcpRequestContext } from './context.ts';
import { registerGddContextTools } from './gdd-context-tools.ts';

type Registered = { config: { inputSchema: { safeParse(value: unknown): { success: boolean } } }; handler(input: Record<string, unknown>): Promise<{ structuredContent?: Record<string, unknown> }> };
function server() {
  let tool: Registered | undefined;
  return {
    value: { registerTool(_name: string, config: Registered['config'], handler: Registered['handler']) { tool = { config, handler }; } } as unknown as McpServer,
    get: () => tool!,
  };
}
const account = { mode: 'account', bearerToken: 'secret' } as unknown as AccountMcpRequestContext;
const project = { mode: 'project', projectId: '11111111-1111-4111-8111-111111111111', bearerToken: 'secret' } as unknown as ProjectMcpRequestContext;
const documentId = '22222222-2222-4222-8222-222222222222';

Deno.test('GDD context tool uses mode-specific strict schemas and encoded app routes', async () => {
  for (const context of [account, project]) {
    const recording = server();
    let path = '';
    registerGddContextTools(recording.value, context, { callApp: async (_context, request) => {
      path = request.path;
      return { context: { document: { id: documentId, epoch: 1, revision: 2, contentHash: 'a'.repeat(64), updatedAt: '2026-09-08T00:00:00Z' }, origin: null, artStyle: null, assets: [], warnings: [] } };
    } });
    const input = { documentId, targetProfile: { engine: 'godot-4', assetKind: 'map_image', width: 512 }, ...(context.mode === 'account' ? { projectId: '11111111-1111-4111-8111-111111111111' } : {}) };
    assertEquals(recording.get().config.inputSchema.safeParse(input).success, true);
    assertEquals(recording.get().config.inputSchema.safeParse({ ...input, unknown: true }).success, false);
    const result = await recording.get().handler(input);
    assertEquals(path.includes('/gdd-development-context/' + documentId), true);
    assertEquals(path.includes('targetProfile='), true);
    assertEquals((result.structuredContent?.context as Record<string, unknown>).origin, null);
  }
});

Deno.test('GDD context tool rejects nested upstream field drift instead of forwarding it', async () => {
  const recording = server();
  registerGddContextTools(recording.value, project, { callApp: async () => ({
    context: {
      document: {
        id: documentId,
        epoch: 1,
        revision: 2,
        contentHash: 'a'.repeat(64),
        updatedAt: '2026-09-08T00:00:00Z',
        signedUrl: 'https://secret.test/document',
      },
      origin: null,
      artStyle: null,
      assets: [],
      warnings: [],
    },
  }) });

  const result = await recording.get().handler({ documentId });

  assertEquals(result.structuredContent?.ok, false);
  assertEquals((result.structuredContent?.error as Record<string, unknown>).code, 'UPSTREAM_UNAVAILABLE');
  assertEquals(JSON.stringify(result).includes('secret.test'), false);
});
