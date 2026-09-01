import { assertEquals, assertRejects } from "@std/assert";
import {
  characterArguments,
  animationArguments,
  PixelLabCharacterClient,
} from "./pixellab-client.ts";
import {
  animationResult,
  providerAnimationJobId,
  characterResult,
  providerCharacterId,
  providerStatus,
} from "./provider-response.ts";
import { PixelLabCharacterError } from "./types.ts";

const tool = (name: string, properties: Record<string, unknown>, required: string[]) => ({
  name,
  inputSchema: { type: "object", additionalProperties: false, properties, required },
});

function mcpResponse(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: "test", result }), {
    headers: { "content-type": "application/json" },
  });
}

Deno.test("discovers exact character and V3 animation tools with get_character polling", async () => {
  const tools = [
    tool("create_character", {
      description: { type: "string" }, mode: { type: "string", enum: ["standard", "pro", "v3"] },
      size: { anyOf: [{ type: "integer" }, { type: "null" }] }, view: { type: "string" },
    }, ["description"]),
    tool("animate_character", {
      character_id: { type: "string" }, action_description: { anyOf: [{ type: "string" }, { type: "null" }] },
      animation_name: { anyOf: [{ type: "string" }, { type: "null" }] }, directions: { anyOf: [{ type: "array" }, { type: "null" }] },
      mode: { anyOf: [{ type: "string", enum: ["template", "v3", "pro"] }, { type: "null" }] },
      frame_count: { type: "integer", minimum: 4, maximum: 16 }, keep_first_frame: { type: "boolean" },
    }, ["character_id"]),
    tool("get_character", { character_id: { type: "string" }, include_preview: { type: "boolean" } }, ["character_id"]),
  ];
  const client = new PixelLabCharacterClient("token", async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assertEquals(body.method, "tools/list");
    return mcpResponse({ tools });
  });

  const character = await client.discover("character");
  const animation = await client.discover("animation");

  assertEquals({ operation: character.operation, poll: character.pollOperation }, {
    operation: "create_character", poll: "get_character",
  });
  assertEquals({ operation: animation.operation, poll: animation.pollOperation }, {
    operation: "animate_character", poll: "get_background_job",
  });
  assertEquals(character.schemaFingerprint.length, 64);
  assertEquals(animation.schemaFingerprint.length, 64);
});

Deno.test("rejects stale or incompatible live animation schemas", async () => {
  const tools = [
    tool("animate_with_text", { prompt: { type: "string" } }, ["prompt"]),
    tool("get_character", { character_id: { type: "string" } }, ["character_id"]),
  ];
  const client = new PixelLabCharacterClient("token", async () => mcpResponse({ tools }));

  const error = await assertRejects(() => client.discover("animation"), PixelLabCharacterError);
  assertEquals(error.code, "pixellab_capability_missing");
});

Deno.test("retries transient capability discovery failures before submitting", async () => {
  const tools = [
    tool("create_character", { description: { type: "string" }, mode: { type: "string" } }, ["description"]),
    tool("get_character", { character_id: { type: "string" } }, ["character_id"]),
  ];
  let calls = 0;
  const client = new PixelLabCharacterClient("token", async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("temporary network failure");
    return mcpResponse({ tools });
  });

  const capability = await client.discover("character");
  assertEquals(capability.operation, "create_character");
  assertEquals(calls, 2);
});

Deno.test("maps provider authentication HTTP failures separately from outages", async () => {
  const client = new PixelLabCharacterClient("token", async () => new Response("unauthorized", { status: 401 }));
  const error = await assertRejects(() => client.listTools(), PixelLabCharacterError);
  assertEquals(error.code, "pixellab_not_configured");
});

Deno.test("retries transient background-job failures with backoff", async () => {
  let calls = 0;
  const delays: number[] = [];
  const client = new PixelLabCharacterClient("token", async () => {
    calls += 1;
    if (calls === 1) return new Response("temporarily unavailable", { status: 503 });
    return new Response(JSON.stringify({ id: "job", status: "completed" }), { status: 200 });
  }, async (ms) => { delays.push(ms); });

  assertEquals(await client.getBackgroundJob("job"), { id: "job", status: "completed" });
  assertEquals(calls, 2);
  assertEquals(delays, [250]);
});

Deno.test("maps Keco plans to pro character and single-direction V3 animation arguments", () => {
  assertEquals(characterArguments({
    schemaVersion: 1, kind: "character", name: "Scout", description: "A forest scout",
    perspective: "topdown", facing: "front", width: 96, height: 96, transparent: true,
  }), {
    description: "A forest scout", name: "Scout", mode: "pro", size: 96, view: "high top-down",
  });
  assertEquals(animationArguments({
    schemaVersion: 1, kind: "animation", name: "walk_left",
    sourceCharacterAssetId: "11111111-1111-4111-8111-111111111111",
    sourceCharacterSha256: "a".repeat(64), motionDescription: "Walk steadily",
    frameWidth: 96, frameHeight: 96, frameCount: 6, fps: 10, loop: true,
  }, "provider-character", "left"), {
    character_id: "provider-character", action_description: "Walk steadily",
    animation_name: "walk_left", directions: ["west"], mode: "v3",
    frame_count: 6, keep_first_frame: false,
  });
});

Deno.test("parses character IDs, completed rotations, and animation sheets without exposing raw payloads", () => {
  assertEquals(providerCharacterId({ structuredContent: { character_id: "provider-character" } }), "provider-character");
  const completed = {
    structuredContent: {
      status: "completed",
      character_id: "provider-character",
      rotations: [{ direction: "south", image_url: "https://cdn.example.test/south.png" }],
      animations: [{
        display_name: "walk_left", group_id: "animation-group",
        directions: [{ direction: "west", status: "completed", spritesheet_url: "https://cdn.example.test/walk.png", frame_count: 6 }],
      }],
    },
  };
  assertEquals(providerStatus(completed), "completed");
  assertEquals(characterResult(completed, "south"), {
    characterId: "provider-character", imageUrl: "https://cdn.example.test/south.png",
  });
  assertEquals(animationResult(completed, "walk_left", "west"), {
    characterId: "provider-character", animationGroupId: "animation-group",
    imageUrl: "https://cdn.example.test/walk.png", frameUrls: [], frameData: [], frameCount: 6, status: "completed",
  });
});

Deno.test("extracts the first PixelLab background job from an animation submission", () => {
  const result = { structuredContent: { background_job_ids: ["acaee1a2-8cd8-4e56-89c8-3dca32b60dbd"] } };
  assertEquals(providerAnimationJobId(result), "acaee1a2-8cd8-4e56-89c8-3dca32b60dbd");
});

Deno.test("extracts a background job id from quoted MCP text arrays", () => {
  const result = {
    content: [{
      type: "text",
      text: "background_job_ids: [\"acaee1a2-8cd8-4e56-89c8-3dca32b60dbd\"]",
    }],
  };
  assertEquals(providerAnimationJobId(result), "acaee1a2-8cd8-4e56-89c8-3dca32b60dbd");
});

Deno.test("extracts an animation job id from an unlabeled MCP submission id", () => {
  const result = {
    content: [{
      type: "text",
      text: "Animation request accepted\nacaee1a2-8cd8-4e56-89c8-3dca32b60dbd",
    }],
  };
  assertEquals(providerAnimationJobId(result), "acaee1a2-8cd8-4e56-89c8-3dca32b60dbd");
});

Deno.test("parses JSON embedded in MCP text content", () => {
  const result = {
    content: [{ type: "text", text: JSON.stringify({
      status: "completed", character_id: "provider-character",
      rotations: [{ direction: "south", image_url: "https://cdn.example.test/south.png" }],
    }) }],
  };
  assertEquals(providerStatus(result), "completed");
  assertEquals(characterResult(result, "south"), {
    characterId: "provider-character", imageUrl: "https://cdn.example.test/south.png",
  });
});

Deno.test("parses PixelLab's human-readable create response from MCP text", () => {
  const result = {
    content: [{ type: "text", text: "id: 2ba78163-4be1-4e3f-8433-b2df9dddbb44\nstatus: processing (~2-3 minutes)" }],
    isError: false,
  };
  assertEquals(providerCharacterId(result), "2ba78163-4be1-4e3f-8433-b2df9dddbb44");
  assertEquals(providerStatus(result), "processing");
});

Deno.test("parses PixelLab completed rotations from human-readable MCP text", () => {
  const result = {
    content: [{ type: "text", text: [
      "status: completed",
      "id: 2ba78163-4be1-4e3f-8433-b2df9dddbb44",
      "rotations:",
      "  south: https://cdn.example.test/south.png?t=1",
      "  west: https://cdn.example.test/west.png?t=1",
    ].join("\n") }],
  };
  assertEquals(providerStatus(result), "completed");
  assertEquals(characterResult(result, "south"), {
    characterId: "2ba78163-4be1-4e3f-8433-b2df9dddbb44",
    imageUrl: "https://cdn.example.test/south.png?t=1",
  });
});

Deno.test("maps explicit provider quota and rate errors to stable codes", async () => {
  for (const [message, code] of [
    ["generation balance: 0", "pixellab_quota_exceeded"],
    ["rate limit exceeded", "pixellab_rate_limited"],
  ] as const) {
    const client = new PixelLabCharacterClient("token", async () =>
      mcpResponse({ content: [{ type: "text", text: message }], isError: true }));
    const error = await assertRejects(() => client.listTools(), PixelLabCharacterError);
    assertEquals(error.code, code);
  }
});
