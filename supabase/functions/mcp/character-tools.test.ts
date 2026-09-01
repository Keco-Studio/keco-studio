import { assertEquals, assertMatch } from "@std/assert";
import type { McpServer } from "@mcp/server/mcp.js";
import type { AccountMcpRequestContext, ProjectMcpRequestContext } from "./context.ts";
import { registerCharacterTools } from "./character-tools.ts";

type Tool = { name: string; config: { description: string; annotations: Record<string, boolean>; inputSchema: { safeParse(value: unknown): { success: boolean } } }; handler: (input: Record<string, unknown>) => Promise<{ structuredContent?: Record<string, unknown> }> };
const IDS = { projectId: "11111111-1111-4111-8111-111111111111", assetId: "22222222-2222-4222-8222-222222222222", attemptId: "33333333-3333-4333-8333-333333333333", generationId: "44444444-4444-4444-8444-444444444444", key: "55555555-5555-4555-8555-555555555555" };
const fingerprint = "a".repeat(64);
const names = ["list_character_assets", "read_character_asset", "create_character_asset_draft", "update_character_asset_draft", "prepare_character_asset_generation", "start_character_asset_generation", "get_character_asset_generation", "advance_character_asset_generation"];
const account = { mode: "account", userId: "user", bearerToken: "token", supabase: {} } as unknown as AccountMcpRequestContext;
const project = { mode: "project", userId: "user", projectId: IDS.projectId, role: "editor", bearerToken: "token", supabase: {} } as unknown as ProjectMcpRequestContext;
function server() { const tools: Tool[] = []; return { tools, value: { registerTool(name: string, config: Tool["config"], handler: Tool["handler"]) { tools.push({ name, config, handler }); } } as unknown as McpServer }; }
const plan = { schemaVersion: 1, kind: "character", name: "Scout", description: "A forest scout", perspective: "topdown", facing: "front", width: 96, height: 96, transparent: true };

Deno.test("character tools expose strict account and project schemas", () => {
  for (const context of [account, project]) {
    const target = server(); registerCharacterTools(target.value, context, { callApp: async () => ({}) });
    assertEquals(target.tools.map((tool) => tool.name), names);
    const list = target.tools[0];
    assertEquals(list.config.inputSchema.safeParse(context.mode === "account" ? { projectId: IDS.projectId } : {}).success, true);
    assertEquals(list.config.inputSchema.safeParse(context.mode === "account" ? {} : { projectId: IDS.projectId }).success, false);
    const start = target.tools.find((tool) => tool.name === "start_character_asset_generation")!;
    const identity = { assetId: IDS.assetId, attemptId: IDS.attemptId, generationId: IDS.generationId, planFingerprint: fingerprint, attemptCount: 0, confirmationToken: "signed", confirmPaidGeneration: true };
    assertEquals(start.config.inputSchema.safeParse(context.mode === "account" ? { projectId: IDS.projectId, ...identity } : identity).success, true);
    assertEquals(start.config.inputSchema.safeParse(context.mode === "account" ? { projectId: IDS.projectId, ...identity, confirmPaidGeneration: false } : { ...identity, confirmPaidGeneration: false }).success, false);
    assertMatch(start.config.description, /paid[\s\S]*explicit confirmation/i);
  }
});

Deno.test("viewer character tools expose provider-free reads only", () => {
  const target = server(); registerCharacterTools(target.value, { ...project, role: "viewer" }, { callApp: async () => ({}) });
  assertEquals(target.tools.map((tool) => tool.name), ["list_character_assets", "read_character_asset", "get_character_asset_generation"]);
});

Deno.test("character tools call the app route and remove unsafe provider fields", async () => {
  const calls: Record<string, unknown>[] = []; const target = server();
  registerCharacterTools(target.value, project, { callApp: async (_context, request) => { calls.push(request); return { assetId: IDS.assetId, status: "planned", confirmationToken: "signed", feeNotice: "Paid job.", providerSecret: "remove" }; } });
  const result = await target.tools.find((tool) => tool.name === "prepare_character_asset_generation")!.handler({ assetId: IDS.assetId, saveVersion: 0 });
  assertEquals(calls, [{ method: "POST", path: "/api/mcp/character-assets", body: { action: "prepare_character_asset_generation", projectId: IDS.projectId, assetId: IDS.assetId, saveVersion: 0 } }]);
  assertEquals(result.structuredContent, { ok: true, assetId: IDS.assetId, status: "planned", confirmationToken: "signed", feeNotice: "Paid job." });
});

Deno.test("character tools retain safe provider diagnostics in poll results", async () => {
  const target = server(); const providerDiagnostics = { keyPaths: ["content", "content[].text"], textLabels: ["animations", "status"], statusTokens: ["completed"], urlCount: 1 };
  registerCharacterTools(target.value, project, { callApp: async () => ({ assetId: IDS.assetId, status: "generating", providerDiagnostics, providerPayload: "must remove" }) });
  const result = await target.tools.find((tool) => tool.name === "advance_character_asset_generation")!.handler({ assetId: IDS.assetId, attemptId: IDS.attemptId, generationId: IDS.generationId, planFingerprint: fingerprint });
  assertEquals(result.structuredContent, { ok: true, assetId: IDS.assetId, status: "generating", providerDiagnostics });
});

Deno.test("character draft schemas enforce V3 animation frame bounds", () => {
  const target = server(); registerCharacterTools(target.value, account, { callApp: async () => ({}) });
  const create = target.tools.find((tool) => tool.name === "create_character_asset_draft")!;
  assertEquals(create.config.inputSchema.safeParse({ projectId: IDS.projectId, plan, idempotencyKey: IDS.key }).success, true);
  const animation = { schemaVersion: 1, kind: "animation", name: "walk", sourceCharacterAssetId: IDS.assetId, sourceCharacterSha256: fingerprint, motionDescription: "Walk", frameWidth: 96, frameHeight: 96, frameCount: 5, fps: 10, loop: true };
  assertEquals(create.config.inputSchema.safeParse({ projectId: IDS.projectId, plan: animation, idempotencyKey: IDS.key }).success, false);
  assertEquals(create.config.inputSchema.safeParse({ projectId: IDS.projectId, plan: { ...animation, frameWidth: 136, frameHeight: 136, frameCount: 6 }, idempotencyKey: IDS.key }).success, true);
});
