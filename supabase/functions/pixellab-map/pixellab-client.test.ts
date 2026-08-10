import { assertEquals, assertRejects } from "@std/assert";
import { PixelLabClient, providerArgumentsFor } from "./pixellab-client.ts";
import { PixelLabMapError } from "./types.ts";

function mcpResponse(tools: unknown[]) {
  return new Response(`event: message\ndata: ${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { tools },
  })}\n\n`, { headers: { "content-type": "text/event-stream" } });
}

Deno.test("discovers the live exact top-down capability and records a fingerprint", async () => {
  const calls: RequestInit[] = [];
  const client = new PixelLabClient("private-token", async (_url, init) => {
    calls.push(init ?? {});
    return mcpResponse([{
      name: "create_topdown_tileset",
      description: "Generate Wang tiles for top-down maps.",
      inputSchema: { type: "object", required: ["lower_description", "upper_description"] },
    }]);
  });

  const capability = await client.discover("topdown_tileset");

  assertEquals(capability.transport, "mcp");
  assertEquals(capability.operation, "create_topdown_tileset");
  assertEquals(capability.schemaFingerprint.length, 64);
  assertEquals(String(calls[0].body).includes("private-token"), false);
});

Deno.test("uses only the documented REST fallback when a semantic tool is absent", async () => {
  const client = new PixelLabClient("private-token", async () => mcpResponse([]));
  const capability = await client.discover("map_object");
  assertEquals(capability.transport, "rest");
  assertEquals(capability.operation, "/map-objects");
});

Deno.test("does not replace a missing road kit with a generic image generator", async () => {
  const client = new PixelLabClient("private-token", async () => mcpResponse([{
    name: "create_image_pixen",
    description: "Generate a freeform pixel image.",
    inputSchema: {},
  }]));
  const error = await assertRejects(() => client.discover("path_tiles"), PixelLabMapError);
  assertEquals(error.code, "pixellab_capability_missing");
  assertEquals(error.message.includes("private-token"), false);
});

Deno.test("classifies rate limits without exposing provider bodies or credentials", async () => {
  const client = new PixelLabClient("private-token", async () =>
    new Response("upstream body contains private-token", { status: 429 }));
  const error = await assertRejects(() => client.listTools(), PixelLabMapError);
  assertEquals(error.code, "pixellab_rate_limited");
  assertEquals(error.message.includes("private-token"), false);
});

Deno.test("downloads an image URL embedded in a real MCP text result", async () => {
  const urls: string[] = [];
  const client = new PixelLabClient("private-token", async (url) => {
    urls.push(String(url));
    return new Response(new Uint8Array([137, 80, 78, 71]));
  });

  const bytes = await client.downloadResult({
    content: [{
      type: "text",
      text: [
        "status: completed",
        "id: be61280c-b8d5-4559-b3ae-de945261369a",
        "download: https://api.pixellab.ai/mcp/map-objects/example/download",
      ].join("\n"),
    }],
  });

  assertEquals(urls, ["https://api.pixellab.ai/mcp/map-objects/example/download"]);
  assertEquals(bytes, new Uint8Array([137, 80, 78, 71]));
});

Deno.test("rejects insecure or oversized provider image downloads", async () => {
  let fetchCount = 0;
  const client = new PixelLabClient("private-token", async () => {
    fetchCount += 1;
    return new Response(new Uint8Array([1]).buffer, {
      headers: { "content-length": String(10 * 1024 * 1024 + 1) },
    });
  });

  const insecure = await assertRejects(() => client.downloadResult({
    image_url: "http://cdn.example/object.png",
  }), PixelLabMapError);
  assertEquals(insecure.code, "pixellab_invalid_response");
  assertEquals(fetchCount, 0);

  const oversized = await assertRejects(() => client.downloadResult({
    image_url: "https://cdn.example/object.png",
  }), PixelLabMapError);
  assertEquals(oversized.message, "Provider image size is invalid");
  assertEquals(fetchCount, 1);
});

Deno.test("polls path tiles through get_tiles_pro with a tile id", async () => {
  const calls: string[] = [];
  const client = new PixelLabClient("private-token", async (_url, init) => {
    calls.push(String(init?.body));
    return new Response(`event: message\ndata: ${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "status: processing" }], isError: false },
    })}\n\n`);
  });

  await client.pollJob({
    semantic: "path_tiles",
    transport: "mcp",
    operation: "create_path_tiles",
    schemaFingerprint: "fingerprint",
    inputSchema: {},
  }, "road-id");

  assertEquals(JSON.parse(calls[0]).params, {
    name: "get_tiles_pro",
    arguments: { tile_id: "road-id" },
  });
});

Deno.test("maps provider-independent V2 fields through the discovered live schema", () => {
  const arguments_ = providerArgumentsFor({
    semantic: "topdown_tileset",
    transport: "mcp",
    operation: "live-terrain-tool",
    schemaFingerprint: "fingerprint",
    inputSchema: {
      type: "object",
      properties: {
        lower_description: { type: "string" },
        upper_description: { type: "string" },
        tile_size: { type: "object" },
        palette: { type: "array" },
      },
    },
  }, "Mossy grass", {
    tileSize: 32,
    palette: ["#112233", "#445566"],
    requiredConnectivityMasks: [1, 3],
    projection: "top-down",
  });

  assertEquals(arguments_, {
    lower_description: "Mossy grass",
    upper_description: "Mossy grass",
    tile_size: { width: 32, height: 32 },
    palette: ["#112233", "#445566"],
  });
});

Deno.test("does not invent arguments when a discovered schema declares no properties", () => {
  const arguments_ = providerArgumentsFor({
    semantic: "map_object",
    transport: "mcp",
    operation: "live-object-tool",
    schemaFingerprint: "fingerprint",
    inputSchema: { type: "object", additionalProperties: false },
  }, "Ancient tree", {
    width: 64,
    height: 96,
    transparency: true,
    projection: "top-down",
  });

  assertEquals(arguments_, {});
});

Deno.test("maps required masks only when the discovered schema supports them", () => {
  const arguments_ = providerArgumentsFor({
    semantic: "path_tiles",
    transport: "mcp",
    operation: "live-path-tool",
    schemaFingerprint: "fingerprint",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        connectivity_masks: { type: "array" },
      },
    },
  }, "Stone road", {
    tileSize: 32,
    requiredConnectivityMasks: [1, 2, 5, 12],
    ignoredProviderField: "never-forwarded",
  });

  assertEquals(arguments_, {
    prompt: "Stone road",
    connectivity_masks: [1, 2, 5, 12],
  });
});
