import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import type { EdgeAiUsageAttempt, EdgeAiUsageRecorder } from "../_shared/ai-usage.ts";
import { PixelLabCharacterClient } from "./pixellab-client.ts";

const USER_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const RAW_RESPONSE_MARKER = "character-provider-body-must-not-persist";

function mcpResponse(result: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: "fixture", result }));
}

Deno.test("records non-billable character and animation provider attempts without response bodies", async () => {
  const events: EdgeAiUsageAttempt[] = [];
  const recorder: EdgeAiUsageRecorder = async (event) => { events.push(event); };
  const client = new PixelLabCharacterClient("test-token", async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { params?: { name?: string } };
    const operation = request.params?.name;
    if (operation === "animate_character") {
      return mcpResponse({ character_id: "provider-character-1", credits: 2, note: RAW_RESPONSE_MARKER });
    }
    return mcpResponse({ character_id: "provider-character-1", status: "completed", note: RAW_RESPONSE_MARKER });
  }, undefined, {
    context: {
      actorUserId: USER_ID,
      projectId: PROJECT_ID,
      feature: "pixellab_character",
      operation: "character_asset",
      correlationId: "character-generation-1",
      artifactId: "character-asset-1",
    },
    recorder,
  });

  await client.callTool("create_character", { description: "not persisted" });
  await client.callTool("animate_character", { action_description: "not persisted" });
  await client.callTool("get_character", { character_id: "provider-character-1" });

  assertEquals(events.length, 3);
  assertEquals(events[0].provider, "pixellab");
  assertEquals(events[0].requestKind, "provider_generation");
  assertEquals(events[0].context.actorUserId, USER_ID);
  assertEquals(events[0].context.projectId, PROJECT_ID);
  assertEquals(events[0].usage, null);
  assertEquals(events[0].metadata?.providerOperation, "create_character");
  assertEquals(events[1].metadata?.providerOperation, "animate_character");
  assertEquals(events[1].providerCredits, 2);
  assertNotEquals(events[0].eventKey, events[1].eventKey);
  assertEquals(JSON.stringify(events).includes(RAW_RESPONSE_MARKER), false);
});

Deno.test("extracts allowlisted nested and text MCP values for character calls", async () => {
  const events: EdgeAiUsageAttempt[] = [];
  const client = new PixelLabCharacterClient("test-token", async () => mcpResponse({
    structuredContent: { character_id: "nested-character", credits: 3 },
    content: [{ type: "text", text: "job_id: text-character-job" }],
  }), undefined, {
    context: {
      actorUserId: USER_ID, projectId: PROJECT_ID, feature: "pixellab_character", operation: "poll",
      correlationId: "character-generation-1", artifactId: "character-asset-1", jobId: "stored-character-job",
    },
    recorder: async (event) => { events.push(event); },
  });

  await client.callTool("get_character", { character_id: "stored-character-job" });

  const textClient = new PixelLabCharacterClient("test-token", async () => mcpResponse({
    content: [{ type: "text", text: "request_id: text-character-request\ncredit_cost: 4" }],
  }), undefined, {
    context: {
      actorUserId: USER_ID, projectId: PROJECT_ID, feature: "pixellab_character", operation: "poll",
      correlationId: "character-generation-1", artifactId: "character-asset-1",
    },
    recorder: async (event) => { events.push(event); },
  });
  await textClient.callTool("get_character", { character_id: "stored-character-job" });

  assertEquals(events[0].providerRequestId, "nested-character");
  assertEquals(events[0].providerCredits, 3);
  assertEquals(events[0].context.jobId, "stored-character-job");
  assertEquals(events[1].providerRequestId, "text-character-request");
  assertEquals(events[1].providerCredits, 4);
});

Deno.test("marks malformed character MCP list, create, and poll results as provider errors", async () => {
  const events: EdgeAiUsageAttempt[] = [];
  const recorder: EdgeAiUsageRecorder = async (event) => { events.push(event); };
  const options = {
    context: { actorUserId: USER_ID, projectId: PROJECT_ID, feature: "pixellab_character", operation: "poll", correlationId: "character-generation-1" },
    recorder,
  };
  const malformedList = new PixelLabCharacterClient("test-token", async () => mcpResponse({}), undefined, options);
  const malformedCreate = new PixelLabCharacterClient("test-token", async () => mcpResponse({}), undefined, options);
  const malformedPoll = new PixelLabCharacterClient("test-token", async () => mcpResponse(null as unknown as Record<string, unknown>), undefined, options);

  await assertRejects(() => malformedList.listTools());
  await assertRejects(() => malformedCreate.callTool("create_character", {}));
  await assertRejects(() => malformedPoll.callTool("get_character", {}));

  assertEquals(events.map((event) => event.outcome), ["provider_error", "provider_error", "provider_error"]);
});
