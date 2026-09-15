import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { recordEdgeAiUsage, type EdgeAiUsageAttempt, type EdgeAiUsageRecorder } from "../_shared/ai-usage.ts";
import { PixelLabClient } from "./pixellab-client.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const RAW_RESPONSE_MARKER = "raw-provider-response-must-not-persist";

function mcpResponse(result: Record<string, unknown>): Response {
  return new Response(`data: ${JSON.stringify({ jsonrpc: "2.0", id: "fixture", result })}\n\n`);
}

Deno.test("records distinct non-billable map submit retry poll and validation attempts", async () => {
  const events: EdgeAiUsageAttempt[] = [];
  const recorder: EdgeAiUsageRecorder = async (event) => { events.push(event); };
  const client = new PixelLabClient("test-token", async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { params?: { name?: string } };
    const operation = request.params?.name;
    if (operation === "create_image_pro") {
      return mcpResponse({ job_id: "provider-job-1", credits_used: 1.5, note: RAW_RESPONSE_MARKER });
    }
    return mcpResponse({ status: "completed", job_id: "provider-job-1", note: RAW_RESPONSE_MARKER });
  }, {
    context: {
      actorUserId: USER_ID,
      projectId: PROJECT_ID,
      feature: "pixellab_map",
      operation: "map_asset",
      correlationId: "map-generation-1",
      artifactId: "map-asset-1",
    },
    recorder,
  });
  const capability = {
    semantic: "map_object" as const,
    transport: "mcp" as const,
    operation: "create_image_pro",
    schemaFingerprint: "a".repeat(64),
    inputSchema: {},
  };

  await client.submitAsset(capability, { description: "not persisted" });
  await client.submitAsset(capability, { description: "not persisted retry" });
  await client.pollJob(capability, "provider-job-1");
  await client.pollJob(capability, "provider-job-1");

  assertEquals(events.length, 4);
  assertEquals(events[0].provider, "pixellab");
  assertEquals(events[0].requestKind, "provider_generation");
  assertEquals(events[0].context.actorUserId, USER_ID);
  assertEquals(events[0].context.projectId, PROJECT_ID);
  assertEquals(events[0].usage, null);
  assertEquals(events[0].metadata?.providerOperation, "create_image_pro");
  assertEquals(events[0].providerCredits, 1.5);
  assertNotEquals(events[0].eventKey, events[1].eventKey);
  assertEquals(events[2].providerCredits, undefined);
  assertEquals(JSON.stringify(events).includes(RAW_RESPONSE_MARKER), false);
});

Deno.test("persists a PixelLab attempt idempotently with only safe ledger fields", async () => {
  let row: Record<string, unknown> | undefined;
  let options: Record<string, unknown> | undefined;
  const serviceClient = {
    from: (_table: "ai_usage_events") => ({
      upsert: async (candidate: Record<string, unknown>, candidateOptions: Record<string, unknown>) => {
        row = candidate;
        options = candidateOptions;
        return { error: null };
      },
    }),
  };
  await recordEdgeAiUsage(serviceClient, {
    eventKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    context: {
      actorUserId: USER_ID, projectId: PROJECT_ID, feature: "pixellab_map", operation: "submit",
      correlationId: "map-generation-1", artifactId: "map-asset-1",
    },
    requestKind: "provider_generation", provider: "pixellab", model: null, attempt: 1,
    outcome: "succeeded", usage: null, providerCredits: 1.5,
    startedAt: "2026-09-15T00:00:00.000Z", finishedAt: "2026-09-15T00:00:01.000Z",
    metadata: { providerOperation: "create_image_pro" },
  });

  assertEquals(options, { onConflict: "event_key", ignoreDuplicates: true });
  assertEquals(row?.usage_status, "unknown");
  assertEquals(row?.input_tokens, null);
  assertEquals(row?.provider_credits, 1.5);
  assertEquals(row?.metadata, { providerOperation: "create_image_pro" });
});

Deno.test("records an outbound MCP failure as a transport error", async () => {
  const events: EdgeAiUsageAttempt[] = [];
  const client = new PixelLabClient("test-token", async () => { throw new TypeError("network unavailable"); }, {
    context: {
      actorUserId: USER_ID, projectId: PROJECT_ID, feature: "pixellab_map", operation: "poll",
      correlationId: "map-generation-1", artifactId: "map-asset-1",
    },
    recorder: async (event) => { events.push(event); },
  });

  await assertRejects(() => client.listTools());
  assertEquals(events[0].outcome, "transport_error");
  assertEquals(events[0].usage, null);
});

Deno.test("extracts allowlisted nested MCP identifiers and native credits", async () => {
  const events: EdgeAiUsageAttempt[] = [];
  const client = new PixelLabClient("test-token", async () => mcpResponse({
    structuredContent: { request_id: "nested-map-request", job_id: "nested-map-job", credits_used: 2.5 },
    content: [{ type: "text", text: "job_id: text-map-job\ncredits_used: 3.5" }],
  }), {
    context: {
      actorUserId: USER_ID, projectId: PROJECT_ID, feature: "pixellab_map", operation: "submit",
      correlationId: "map-generation-1", artifactId: "map-asset-1", jobId: "stored-map-job",
    },
    recorder: async (event) => { events.push(event); },
  });
  const capability = {
    semantic: "map_object" as const, transport: "mcp" as const, operation: "create_image_pro",
    schemaFingerprint: "a".repeat(64), inputSchema: {},
  };

  await client.submitAsset(capability, {});

  assertEquals(events[0].providerRequestId, "nested-map-request");
  assertEquals(events[0].providerCredits, 2.5);
  assertEquals(events[0].context.jobId, "stored-map-job");
});

Deno.test("extracts labelled MCP text identifiers when structured content is absent", async () => {
  const events: EdgeAiUsageAttempt[] = [];
  const client = new PixelLabClient("test-token", async () => mcpResponse({
    content: [{ type: "text", text: "job_id: text-map-job\ncredit_cost: 4" }],
  }), {
    context: {
      actorUserId: USER_ID, projectId: PROJECT_ID, feature: "pixellab_map", operation: "poll",
      correlationId: "map-generation-1", artifactId: "map-asset-1",
    },
    recorder: async (event) => { events.push(event); },
  });
  const capability = {
    semantic: "map_object" as const, transport: "mcp" as const, operation: "create_image_pro",
    schemaFingerprint: "a".repeat(64), inputSchema: {},
  };

  await client.pollJob(capability, "stored-map-job");

  assertEquals(events[0].providerRequestId, "text-map-job");
  assertEquals(events[0].providerCredits, 4);
});

Deno.test("normalizes REST fallback operations before the ledger persists them", async () => {
  const events: EdgeAiUsageAttempt[] = [];
  let row: Record<string, unknown> | undefined;
  const client = new PixelLabClient("test-token", async () =>
    new Response(JSON.stringify({ job_id: "rest-map-job" })), {
    context: {
      actorUserId: USER_ID, projectId: PROJECT_ID, feature: "pixellab_map", operation: "submit",
      correlationId: "map-generation-1", artifactId: "map-asset-1",
    },
    recorder: async (event) => { events.push(event); },
  });

  await client.submitAsset({
    semantic: "topdown_tileset", transport: "rest", operation: "/create-tileset",
    schemaFingerprint: "a".repeat(64), inputSchema: {},
  }, {});
  await recordEdgeAiUsage({
    from: () => ({ upsert: async (candidate: Record<string, unknown>) => {
      row = candidate;
      return { error: null };
    } }),
  }, events[0]);

  assertEquals(events[0].metadata?.providerOperation, "rest_create_tileset");
  assertEquals(row?.metadata, { providerOperation: "rest_create_tileset" });
});

Deno.test("marks malformed MCP list, create, and poll results as provider errors", async () => {
  const events: EdgeAiUsageAttempt[] = [];
  const recorder: EdgeAiUsageRecorder = async (event) => { events.push(event); };
  const malformedList = new PixelLabClient("test-token", async () => mcpResponse({}), {
    context: { actorUserId: USER_ID, projectId: PROJECT_ID, feature: "pixellab_map", operation: "capabilities", correlationId: PROJECT_ID }, recorder,
  });
  const malformedCreate = new PixelLabClient("test-token", async () => mcpResponse({}), {
    context: { actorUserId: USER_ID, projectId: PROJECT_ID, feature: "pixellab_map", operation: "submit", correlationId: "map-generation-1" }, recorder,
  });
  const malformedPoll = new PixelLabClient("test-token", async () => new Response(`data: ${JSON.stringify({ jsonrpc: "2.0", id: "fixture", result: null })}\n\n`), {
    context: { actorUserId: USER_ID, projectId: PROJECT_ID, feature: "pixellab_map", operation: "poll", correlationId: "map-generation-1" }, recorder,
  });
  const capability = { semantic: "map_object" as const, transport: "mcp" as const, operation: "create_image_pro", schemaFingerprint: "a".repeat(64), inputSchema: {} };

  await assertRejects(() => malformedList.listTools());
  await assertRejects(() => malformedCreate.submitAsset(capability, {}));
  await assertRejects(() => malformedPoll.pollJob(capability, "stored-map-job"));

  assertEquals(events.map((event) => event.outcome), ["provider_error", "provider_error", "provider_error"]);
});
