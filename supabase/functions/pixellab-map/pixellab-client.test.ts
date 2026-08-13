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

Deno.test("prefers create_image_pro for map objects and keeps create_map_object as live fallback", async () => {
  const pro = new PixelLabClient("private-token", async () => mcpResponse([
    { name: "create_map_object", inputSchema: { type: "object" } },
    { name: "create_image_pro", description: "Best quality image generation", inputSchema: { type: "object" } },
  ]));
  assertEquals((await pro.discover("map_object")).operation, "create_image_pro");

  const fallback = new PixelLabClient("private-token", async () => mcpResponse([
    { name: "create_map_object", inputSchema: { type: "object" } },
  ]));
  assertEquals((await fallback.discover("map_object")).operation, "create_map_object");
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

Deno.test("classifies MCP result errors instead of treating them as missing jobs", async () => {
  const client = new PixelLabClient("private-token", async () => new Response(`event: message\ndata: ${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text: "Too many concurrent generations; try again later" }],
      isError: true,
    },
  })}\n\n`));

  const error = await assertRejects(() => client.listTools(), PixelLabMapError);
  assertEquals(error.code, "pixellab_rate_limited");
  assertEquals(error.message, "PixelLab is temporarily rate limited. Retry this resource.");
  assertEquals(error.message.includes("private-token"), false);
});

Deno.test("does not classify retry guidance in a successful MCP result as rate limiting", async () => {
  const client = new PixelLabClient("private-token", async () => new Response(`event: message\ndata: ${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text: "Image queued. Try again later to check the result." }],
      isError: false,
      tools: [],
    },
  })}\n\n`));

  await client.listTools();
});

Deno.test("classifies an unflagged zero-credit MCP result as quota exhausted", async () => {
  const client = new PixelLabClient("private-token", async () => new Response(`event: message\ndata: ${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [{ type: "text", text: "credits: 0\ngenerations_remaining: 0\ntry again later" }],
      isError: false,
    },
  })}\n\n`));

  const error = await assertRejects(() => client.listTools(), PixelLabMapError);
  assertEquals(error.code, "pixellab_quota_exceeded");
  assertEquals(error.message, "PixelLab account credits or quota are unavailable.");
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

Deno.test("downloads the first provider candidate deterministically", async () => {
  const urls: string[] = [];
  const client = new PixelLabClient("private-token", async (url) => {
    urls.push(String(url));
    return new Response(new Uint8Array([137, 80, 78, 71]));
  });

  await client.downloadResult({
    images: [
      { image_url: "https://cdn.example/first.png" },
      { image_url: "https://cdn.example/second.png" },
    ],
  });

  assertEquals(urls, ["https://cdn.example/first.png"]);
});

Deno.test("decodes an inline provider PNG without a network request", async () => {
  const expected = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  let fetchCount = 0;
  const client = new PixelLabClient("private-token", async () => {
    fetchCount += 1;
    return new Response();
  });
  const encoded = btoa(String.fromCharCode(...expected));

  const bytes = await client.downloadResult({ image_base64: `data:image/png;base64,${encoded}` });

  assertEquals(bytes, expected);
  assertEquals(fetchCount, 0);
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

Deno.test("polls Pro obstacle images through get_image with a job id", async () => {
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
    semantic: "map_object",
    transport: "mcp",
    operation: "create_image_pro",
    schemaFingerprint: "fingerprint",
    inputSchema: {},
  }, "pro-job-id");

  assertEquals(JSON.parse(calls[0]).params, {
    name: "get_image",
    arguments: { job_id: "pro-job-id" },
  });
});

Deno.test("discovers only create_image_pro for direct maps and records get_image polling", async () => {
  const client = new PixelLabClient("private-token", async () => mcpResponse([
    {
      name: "create_image_pro",
      inputSchema: {
        type: "object",
        properties: {
          description: { type: "string" }, width: { type: "integer" }, height: { type: "integer" },
          no_background: { type: "boolean" },
        },
        required: ["description", "width", "height", "no_background"],
        additionalProperties: false,
      },
    },
    { name: "get_image", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
  ]));
  const capability = await client.discover("direct_map_image");
  assertEquals(capability.operation, "create_image_pro");
  assertEquals(capability.pollOperation, "get_image");
  assertEquals(capability.pollInputSchema, { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] });
});

Deno.test("discovers the live direct-map schema when generation fields have provider defaults", async () => {
  const client = new PixelLabClient("private-token", async () => mcpResponse([
    {
      name: "create_image_pro",
      inputSchema: {
        type: "object",
        properties: {
          description: { type: "string" }, width: { type: "integer" }, height: { type: "integer" },
          no_background: { type: "boolean" },
        },
        required: ["description"],
        additionalProperties: false,
      },
    },
    { name: "get_image", inputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] } },
  ]));

  assertEquals((await client.discover("direct_map_image")).operation, "create_image_pro");
});

Deno.test("polls direct maps through the discovered operation with a job id", async () => {
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
    semantic: "direct_map_image",
    transport: "mcp",
    operation: "create_image_pro",
    schemaFingerprint: "create-fingerprint",
    inputSchema: {},
    pollOperation: "discovered_get_image",
    pollSchemaFingerprint: "poll-fingerprint",
    pollInputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] },
  }, "direct-job-id");

  assertEquals(JSON.parse(calls[0]).params, {
    name: "discovered_get_image",
    arguments: { job_id: "direct-job-id" },
  });
});

Deno.test("rejects a direct map when get_image is missing or lacks job_id", async () => {
  const missing = new PixelLabClient("private-token", async () => mcpResponse([{ name: "create_image_pro", inputSchema: {} }]));
  const missingError = await assertRejects(() => missing.discover("direct_map_image"), PixelLabMapError);
  assertEquals(missingError.code, "pixellab_capability_missing");

  const incompatible = new PixelLabClient("private-token", async () => mcpResponse([
    { name: "create_image_pro", inputSchema: { type: "object", properties: { description: {}, width: {}, height: {}, no_background: {} } } },
    { name: "get_image", inputSchema: { type: "object", properties: { image_id: { type: "string" } }, required: ["image_id"] } },
  ]));
  const incompatibleError = await assertRejects(() => incompatible.discover("direct_map_image"), PixelLabMapError);
  assertEquals(incompatibleError.code, "pixellab_capability_missing");
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

Deno.test("maps isolated terrain material controls without copying a scene brief", () => {
  const arguments_ = providerArgumentsFor({
    semantic: "topdown_tileset",
    transport: "mcp",
    operation: "create_topdown_tileset",
    schemaFingerprint: "fingerprint",
    inputSchema: {
      type: "object",
      properties: {
        lower_description: { type: "string" },
        upper_description: { type: "string" },
        transition_size: { type: "number" },
        tile_size: { type: "object" },
        mode: { type: "string" },
        outline: { type: "string" },
        shading: { type: "string" },
        detail: { type: "string" },
        tile_strength: { type: "number" },
      },
    },
  }, "provider fallback prompt", {
    tileSize: 32,
    lowerDescription: "seamless dark green grass",
    upperDescription: "seamless dark green grass",
    transitionSize: 0,
    mode: "standard",
    outline: "lineless",
    shading: "basic shading",
    detail: "medium detail",
    tileStrength: 1.5,
  });

  assertEquals(arguments_, {
    lower_description: "seamless dark green grass",
    upper_description: "seamless dark green grass",
    tile_size: { width: 32, height: 32 },
    transition_size: 0,
    mode: "standard",
    outline: "lineless",
    shading: "basic shading",
    detail: "medium detail",
    tile_strength: 1.5,
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

Deno.test("maps V2 paths to the live square-topdown enum and provider tile size", () => {
  const arguments_ = providerArgumentsFor({
    semantic: "path_tiles",
    transport: "mcp",
    operation: "create_path_tiles",
    schemaFingerprint: "fingerprint",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string" },
        tile_type: { type: "string", enum: ["square_topdown", "isometric"] },
        tile_size: { type: "integer", minimum: 32, maximum: 96 },
      },
    },
  }, "Muddy forest road", {
    tileSize: 64,
    pathKind: "road",
    projection: "top-down",
  });

  assertEquals(arguments_, {
    description: "Muddy forest road",
    tile_size: 32,
    tile_type: "square_topdown",
  });
});

Deno.test("clamps small V2 map objects to the live provider canvas bounds", () => {
  const arguments_ = providerArgumentsFor({
    semantic: "map_object",
    transport: "mcp",
    operation: "create_map_object",
    schemaFingerprint: "fingerprint",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string" },
        width: { type: "integer", minimum: 32, maximum: 400 },
        height: { type: "integer", minimum: 32, maximum: 400 },
        view: { type: "string" },
      },
    },
  }, "Small forest bush", {
    width: 24,
    height: 28,
    projection: "top-down",
    transparency: true,
  });

  assertEquals(arguments_, {
    description: "Small forest bush",
    width: 32,
    height: 32,
    view: "high top-down",
  });
});

Deno.test("maps transparent Pro obstacles and an ephemeral style reference to the live schema", () => {
  const arguments_ = providerArgumentsFor({
    semantic: "map_object",
    transport: "mcp",
    operation: "create_image_pro",
    schemaFingerprint: "fingerprint",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string" },
        width: { type: "integer" },
        height: { type: "integer" },
        no_background: { type: "boolean" },
        style_image_url: { type: "string" },
      },
    },
  }, "One mossy rock", {
    width: 96,
    height: 80,
    transparency: true,
    styleImageUrl: "https://storage.example/background.png?temporary=1",
  });

  assertEquals(arguments_, {
    description: "One mossy rock",
    width: 96,
    height: 80,
    no_background: true,
    style_image_url: "https://storage.example/background.png?temporary=1",
  });
});
