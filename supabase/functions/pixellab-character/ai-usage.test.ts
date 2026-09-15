import { assertEquals, assertNotEquals } from "@std/assert";
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
