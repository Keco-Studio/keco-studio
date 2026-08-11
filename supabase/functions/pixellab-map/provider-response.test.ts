import { assertEquals } from "@std/assert";
import {
  providerAtlasReferences,
  providerContentQualityIssue,
  providerJobId,
  providerStatus,
  providerTileReferences,
} from "./provider-response.ts";

const textResult = (text: string): Record<string, unknown> => ({
  content: [{ type: "text", text }],
  isError: false,
});

Deno.test("flags provider-labelled character content without rejecting explicit exclusions", () => {
  assertEquals(providerContentQualityIssue({ labels: ["pixel art character", "forest"] }), "obstacle_output_contains_character_content");
  assertEquals(providerContentQualityIssue({ description: "Single rock, no characters or NPCs" }), null);
  assertEquals(providerContentQualityIssue({ image_url: "https://cdn.example/character.png" }), null);
});

Deno.test("extracts a provider job id from a real MCP text result", () => {
  assertEquals(providerJobId(textResult([
    "id: be61280c-b8d5-4559-b3ae-de945261369a",
    "status: processing (~30-90s)",
    "hint: get_map_object(object_id=\"be61280c-b8d5-4559-b3ae-de945261369a\")",
  ].join("\n"))), "be61280c-b8d5-4559-b3ae-de945261369a");
});

Deno.test("extracts a completed status from a real MCP text result", () => {
  assertEquals(providerStatus(textResult([
    "status: completed",
    "id: be61280c-b8d5-4559-b3ae-de945261369a",
    "download: https://api.pixellab.ai/mcp/map-objects/example/download",
  ].join("\n"))), "completed");
});

Deno.test("treats a real MCP error text as failed instead of processing forever", () => {
  assertEquals(providerStatus(textResult([
    "error: job b41389db-42b0-4d69-b0eb-aab0350fc5f4 not found",
    "hint: image jobs are kept for 8 hours after they finish",
  ].join("\n"))), "failed");
});

Deno.test("extracts every path tile reference from captured MCP text", () => {
  assertEquals(providerTileReferences(textResult([
    "placement_rules:",
    "  tile_2: mask=1",
    "  tile_14: mask=15",
    "storage_urls:",
    "  tile_2: https://cdn.example/tile_2.png",
    "  tile_14: https://cdn.example/tile_14.png",
  ].join("\n"))), [
    { key: "tile_2", connectivityMask: 1, url: "https://cdn.example/tile_2.png" },
    { key: "tile_14", connectivityMask: 15, url: "https://cdn.example/tile_14.png" },
  ]);
});

Deno.test("preserves repeated provider tile references for manifest validation", () => {
  const block = [
    "placement_rules:",
    "  tile_2: mask=2",
    "storage_urls:",
    "  tile_2: https://cdn.example/tile_2.png",
  ].join("\n");
  assertEquals(providerTileReferences({ content: [
    { type: "text", text: block },
    { type: "text", text: block },
  ] }).length, 2);
});

Deno.test("extracts external atlas PNG and metadata references from a completed terrain result", () => {
  assertEquals(providerAtlasReferences(textResult([
    "status: completed",
    "download_png: https://backblaze.example/terrain.png",
    "download_png_inline: https://api.pixellab.ai/terrain/download",
    "download_metadata: https://api.pixellab.ai/terrain/metadata",
  ].join("\n"))), {
    imageUrl: "https://api.pixellab.ai/terrain/download",
    metadataUrl: "https://api.pixellab.ai/terrain/metadata",
  });
});
