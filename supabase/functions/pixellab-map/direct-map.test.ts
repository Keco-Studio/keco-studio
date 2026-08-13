import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { directMapProviderArguments, resolveDirectMapReferences, assertStoredDirectMapCapability } from "./direct-map.ts";
import { PixelLabMapError, type DiscoveredCapability } from "./types.ts";

const PRO_SCHEMA = {
  type: "object",
  properties: {
    description: { type: "string" }, width: { type: "integer" }, height: { type: "integer" },
    no_background: { type: "boolean" }, seed: { type: "integer" },
    reference_images: { type: "string" }, style_image_url: { type: "string" },
    style_copy: { type: "array", items: { type: "string" } },
  },
  required: ["description", "width", "height", "no_background"],
  additionalProperties: false,
};
const CAPABILITY: DiscoveredCapability = {
  semantic: "direct_map_image", transport: "mcp", operation: "create_image_pro",
  schemaFingerprint: "a".repeat(64), inputSchema: PRO_SCHEMA,
  pollOperation: "get_image", pollSchemaFingerprint: "b".repeat(64),
  pollInputSchema: { type: "object", properties: { job_id: { type: "string" } }, required: ["job_id"] },
};

Deno.test("maps the approved prompt and private references exactly", () => {
  const args = directMapProviderArguments(CAPABILITY, {
    prompt: "Exact final prompt.  Keep spacing.",
    generationParams: { width: 512, height: 512, noBackground: false, seed: 7 },
  }, {
    references: [{ url: "https://signed.example/layout.png", usage: "layout reference" }],
    style: { url: "https://signed.example/style.png", copy: ["color_palette", "shading"] },
  });
  assertEquals(args, {
    description: "Exact final prompt.  Keep spacing.", width: 512, height: 512,
    no_background: false, seed: 7,
    reference_images: JSON.stringify([{ url: "https://signed.example/layout.png", usage: "layout reference" }]),
    style_image_url: "https://signed.example/style.png", style_copy: ["color_palette", "shading"],
  });
});

Deno.test("accepts the live create_image_pro schema with optional generation fields", () => {
  const liveCapability: DiscoveredCapability = {
    ...CAPABILITY,
    inputSchema: {
      ...PRO_SCHEMA,
      properties: {
        ...PRO_SCHEMA.properties,
        seed: { anyOf: [{ type: "integer" }, { type: "null" }] },
        reference_images: { anyOf: [{ type: "string" }, { type: "null" }] },
        style_image_url: { anyOf: [{ type: "string" }, { type: "null" }] },
        style_copy: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
      },
      required: ["description"],
    },
  };

  const args = directMapProviderArguments(liveCapability, {
    prompt: "Top-down pixel art map.",
    generationParams: { width: 512, height: 512, noBackground: false, seed: 7 },
  }, {
    references: [{ url: "https://signed.example/layout.png", usage: "layout reference" }],
    style: { url: "https://signed.example/style.png", copy: ["color_palette"] },
  });

  assertEquals(args.width, 512);
  assertEquals(args.height, 512);
  assertEquals(args.no_background, false);
  assertEquals(args.seed, 7);
  assertEquals(args.reference_images, JSON.stringify([{ url: "https://signed.example/layout.png", usage: "layout reference" }]));
  assertEquals(args.style_image_url, "https://signed.example/style.png");
  assertEquals(args.style_copy, ["color_palette"]);
});

Deno.test("rejects unsupported dimensions and incomplete live schemas", () => {
  const asset = { prompt: "prompt", generationParams: { width: 640, height: 480, noBackground: false } };
  const error = assertThrows(() => directMapProviderArguments(CAPABILITY, asset, { references: [], style: null }), PixelLabMapError);
  assertEquals(error.code, "pixellab_capability_missing");
  const incomplete = { ...CAPABILITY, inputSchema: { type: "object", properties: { description: { type: "string" } } } };
  const schemaError = assertThrows(() => directMapProviderArguments(incomplete, {
    prompt: "prompt", generationParams: { width: 512, height: 512, noBackground: false },
  }, { references: [], style: null }), PixelLabMapError);
  assertEquals(schemaError.code, "pixellab_capability_missing");
});

function referenceClient(rows: unknown[], signedUrl = "https://signed.example/reference.png") {
  const calls: string[] = [];
  const serviceClient = {
    from(table: string) {
      calls.push(table);
      return {
        select() { return this; },
        in() { return Promise.resolve({ data: rows, error: null }); },
      };
    },
    storage: { from(bucket: string) { return { createSignedUrl(path: string, expiry: number) {
      calls.push(`${bucket}:${path}:${expiry}`);
      return Promise.resolve({ data: { signedUrl }, error: null });
    } }; } },
  };
  return { serviceClient, calls };
}

const id = "11111111-1111-4111-8111-111111111111";
const row = { id, project_id: "project-a", storage_path: `references/project-a/${id}/${"a".repeat(64)}.png`, sha256: "a".repeat(64), width: 512, height: 512, content_type: "image/png", byte_size: 100 };

Deno.test("resolves authorized references in memory and does not mutate the asset", async () => {
  const { serviceClient, calls } = referenceClient([row]);
  const asset = {
    reference_asset_ids: [id],
    reference_hashes: ["a".repeat(64)],
    generation_params: {
      references: [{ assetId: id, sha256: "a".repeat(64), role: "layout", usage: "layout reference" }],
      styleReference: null,
    },
  };
  const resolved = await resolveDirectMapReferences({ projectId: "project-a", serviceClient, asset } as never);
  assertEquals(resolved.references, [{ url: "https://signed.example/reference.png", usage: "layout reference" }]);
  assertEquals((asset.generation_params.references[0] as Record<string, unknown>).url, undefined);
  assertEquals(calls, ["map_reference_images", `map-assets:${row.storage_path}:300`]);
});

Deno.test("rejects references that do not exactly match the durable asset bindings", async () => {
  for (const asset of [
    {
      reference_asset_ids: [],
      reference_hashes: [],
      generation_params: { references: [{ assetId: id, sha256: "a".repeat(64), role: "content", usage: "content" }] },
    },
    {
      reference_asset_ids: [id],
      reference_hashes: ["b".repeat(64)],
      generation_params: { references: [{ assetId: id, sha256: "a".repeat(64), role: "content", usage: "content" }] },
    },
  ]) {
    const { serviceClient, calls } = referenceClient([row]);
    await assertRejects(
      () => resolveDirectMapReferences({ projectId: "project-a", serviceClient, asset } as never),
      PixelLabMapError,
    );
    assertEquals(calls, []);
  }
});

Deno.test("rejects duplicate style-copy values", async () => {
  const { serviceClient, calls } = referenceClient([row]);
  await assertRejects(() => resolveDirectMapReferences({
    projectId: "project-a",
    serviceClient,
    asset: {
      reference_asset_ids: [id],
      reference_hashes: ["a".repeat(64)],
      generation_params: {
        references: [],
        styleReference: { assetId: id, sha256: "a".repeat(64), copy: ["shading", "shading"] },
      },
    },
  } as never), PixelLabMapError);
  assertEquals(calls, []);
});

Deno.test("rejects a live style-copy schema with incompatible item values", () => {
  const capability = {
    ...CAPABILITY,
    inputSchema: {
      ...PRO_SCHEMA,
      properties: {
        ...PRO_SCHEMA.properties,
        style_copy: { type: "array", items: { type: "string", enum: ["outline"] } },
      },
    },
  };
  assertThrows(() => directMapProviderArguments(capability, {
    prompt: "prompt",
    generationParams: { width: 512, height: 512, noBackground: false },
  }, {
    references: [],
    style: { url: "https://signed.example/style.png", copy: ["shading"] },
  }), PixelLabMapError);
});

for (const [name, badRow] of [
  ["missing reference row", null],
  ["another project's row", { ...row, project_id: "project-b", storage_path: `references/project-b/${id}/${"a".repeat(64)}.png` }],
  ["hash mismatch", { ...row, sha256: "b".repeat(64) }],
  ["bad dimensions", { ...row, width: 0 }],
  ["bad private path", { ...row, storage_path: "public/image.png" }],
] as const) {
  Deno.test(`rejects ${name}`, async () => {
    const { serviceClient } = referenceClient(badRow ? [badRow] : []);
    const error = await assertRejects(() => resolveDirectMapReferences({
      projectId: "project-a", serviceClient, asset: {
        reference_asset_ids: [id], reference_hashes: ["a".repeat(64)], generation_params: {
          references: [{ assetId: id, sha256: "a".repeat(64), role: "content", usage: "content" }], styleReference: null,
        },
      },
    } as never), PixelLabMapError);
    assertEquals(error.code, "pixellab_invalid_response");
  });
}

Deno.test("rejects duplicate and excessive content references", async () => {
  const duplicate = { generation_params: { references: [
    { assetId: id, sha256: "a".repeat(64), role: "content", usage: "one" },
    { assetId: id, sha256: "a".repeat(64), role: "layout", usage: "two" },
  ] }, reference_asset_ids: [id, id], reference_hashes: ["a".repeat(64), "a".repeat(64)] };
  const { serviceClient } = referenceClient([row]);
  await assertRejects(() => resolveDirectMapReferences({ projectId: "project-a", serviceClient, asset: duplicate } as never), PixelLabMapError);
  const excessiveReferences = Array.from({ length: 5 }, (_, index) => ({ assetId: `${index}${id.slice(1)}`, sha256: "a".repeat(64), role: "content", usage: "content" }));
  const excessive = {
    generation_params: { references: excessiveReferences },
    reference_asset_ids: excessiveReferences.map((entry) => entry.assetId),
    reference_hashes: excessiveReferences.map((entry) => entry.sha256),
  };
  await assertRejects(() => resolveDirectMapReferences({ projectId: "project-a", serviceClient, asset: excessive } as never), PixelLabMapError);
});

Deno.test("rejects stale stored capability fingerprints", () => {
  const error = assertThrows(() => assertStoredDirectMapCapability({
    provider_operation: "create_image_pro", metadata: { schemaFingerprint: "a".repeat(64), pollOperation: "get_image", pollSchemaFingerprint: "stale" },
  }, CAPABILITY), PixelLabMapError);
  assertEquals(error.code, "pixellab_capability_missing");
});
