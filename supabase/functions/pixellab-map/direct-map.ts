import type { AuthorizedAsset } from "./auth.ts";
import { PixelLabMapError, type DiscoveredCapability } from "./types.ts";

export type DirectMapProviderAsset = {
  prompt: string;
  generationParams: Record<string, unknown>;
};

export type ResolvedDirectMapReferences = {
  references: Array<{ url: string; usage: string }>;
  style: null | { url: string; copy: string[] };
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PROFILES = new Set(["512x512", "688x384", "384x688"]);
const STYLE_COPY = new Set(["color_palette", "outline", "detail", "shading"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function invalid(message: string): never {
  throw new PixelLabMapError("pixellab_invalid_response", message, 422);
}

function capabilityMissing(message = "Stored PixelLab capability no longer matches live schemas"): never {
  throw new PixelLabMapError("pixellab_capability_missing", message, 409);
}

function propertiesOf(capability: DiscoveredCapability): Record<string, Record<string, unknown>> {
  const properties = capability.inputSchema.properties;
  return properties && typeof properties === "object" && !Array.isArray(properties)
    ? properties as Record<string, Record<string, unknown>>
    : {};
}

function supports(capability: DiscoveredCapability, name: string, type: string): boolean {
  const property = propertiesOf(capability)[name];
  if (!property) return false;
  if (property.type === type) return true;
  const variants = property.anyOf;
  return Array.isArray(variants)
    && variants.some((variant) => variant && typeof variant === "object" && (variant as Record<string, unknown>).type === type);
}

function requires(capability: DiscoveredCapability, name: string, type: string): boolean {
  const properties = propertiesOf(capability);
  const required = Array.isArray(capability.inputSchema.required) ? capability.inputSchema.required : [];
  return required.includes(name) && supports(capability, name, type);
}

function supportsStyleCopy(capability: DiscoveredCapability, values: string[]): boolean {
  const property = propertiesOf(capability).style_copy;
  const arrayProperty = property?.type === "array"
    ? property
    : Array.isArray(property?.anyOf)
      ? property.anyOf.find((variant) => variant && typeof variant === "object" && (variant as Record<string, unknown>).type === "array") as Record<string, unknown> | undefined
      : undefined;
  const items = record(arrayProperty?.items);
  if (arrayProperty?.type !== "array" || items.type !== "string") return false;
  if (items.enum === undefined) return true;
  const allowed = items.enum;
  return Array.isArray(allowed) && values.every((value) => allowed.includes(value));
}

function exactStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value as string[]
    : null;
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function directMapProviderArguments(
  capability: DiscoveredCapability,
  asset: DirectMapProviderAsset,
  references: ResolvedDirectMapReferences,
): Record<string, unknown> {
  if (capability.semantic !== "direct_map_image" || capability.transport !== "mcp" || capability.operation !== "create_image_pro") capabilityMissing();
  if (!capability.pollOperation || !capability.pollSchemaFingerprint || !capability.pollInputSchema) capabilityMissing();
  // PixelLab marks width/height/no_background as optional because it supplies
  // defaults. We provide them explicitly for direct-map profiles, so they must
  // be supported with the right type but do not need to be provider-required.
  if (!requires(capability, "description", "string") || !supports(capability, "width", "integer")
    || !supports(capability, "height", "integer") || !supports(capability, "no_background", "boolean")) capabilityMissing();

  const params = asset.generationParams;
  const width = params.width;
  const height = params.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || !PROFILES.has(`${width}x${height}`)) capabilityMissing("Unsupported direct map image profile");
  if (params.noBackground !== false) capabilityMissing("Direct map images require an opaque background");
  if (typeof asset.prompt !== "string") capabilityMissing("Direct map prompt is invalid");

  const output: Record<string, unknown> = {
    description: asset.prompt,
    width,
    height,
    no_background: false,
  };
  if (params.seed !== undefined && params.seed !== null) {
    if (!Number.isInteger(params.seed) || Number(params.seed) < 0 || !supports(capability, "seed", "integer")) capabilityMissing("Direct map seed is incompatible with the live schema");
    output.seed = params.seed;
  }
  if (references.references.length > 0) {
    if (!supports(capability, "reference_images", "string")) capabilityMissing("Direct map reference_images is missing from the live schema");
    output.reference_images = JSON.stringify(references.references);
  }
  if (references.style) {
    if (!supports(capability, "style_image_url", "string") || !supportsStyleCopy(capability, references.style.copy)) capabilityMissing("Direct map style fields are incompatible with the live schema");
    output.style_image_url = references.style.url;
    output.style_copy = references.style.copy;
  }
  return output;
}

export async function resolveDirectMapReferences(authorized: AuthorizedAsset): Promise<ResolvedDirectMapReferences> {
  const params = record(authorized.asset.generation_params);
  const content = params.references === undefined ? [] : params.references;
  if (!Array.isArray(content) || content.length > 4) invalid("Invalid direct map content references");
  const parsedContent = content.map((value) => {
    const entry = record(value);
    if (typeof entry.assetId !== "string" || !UUID_PATTERN.test(entry.assetId)
      || typeof entry.sha256 !== "string" || !SHA256_PATTERN.test(entry.sha256)
      || (entry.role !== "content" && entry.role !== "layout")
      || typeof entry.usage !== "string" || entry.usage.trim().length === 0 || entry.usage.length > 240) invalid("Invalid direct map content reference");
    return { id: entry.assetId, sha256: entry.sha256, usage: entry.usage };
  });
  const styleValue = params.styleReference;
  let styleInput: { id: string; sha256: string; copy: string[] } | null = null;
  if (styleValue !== undefined && styleValue !== null) {
    const style = record(styleValue);
    if (typeof style.assetId !== "string" || !UUID_PATTERN.test(style.assetId)
      || typeof style.sha256 !== "string" || !SHA256_PATTERN.test(style.sha256)
      || !Array.isArray(style.copy) || style.copy.length < 1 || style.copy.length > 4
      || style.copy.some((entry) => typeof entry !== "string" || !STYLE_COPY.has(entry))
      || new Set(style.copy).size !== style.copy.length) invalid("Invalid direct map style reference");
    styleInput = { id: style.assetId, sha256: style.sha256, copy: style.copy as string[] };
  }
  const all = [...parsedContent.map((entry) => entry.id), ...(styleInput ? [styleInput.id] : [])];
  const hashes = [...parsedContent.map((entry) => entry.sha256), ...(styleInput ? [styleInput.sha256] : [])];
  if (new Set(all).size !== all.length) invalid("Duplicate direct map references");
  const durableIds = exactStringArray(authorized.asset.reference_asset_ids);
  const durableHashes = exactStringArray(authorized.asset.reference_hashes);
  if (!durableIds || !durableHashes || !sameStrings(durableIds, all) || !sameStrings(durableHashes, hashes)) {
    invalid("Direct map reference bindings do not match the immutable asset plan");
  }
  if (all.length === 0) return { references: [], style: null };

  const { data, error } = await (authorized.serviceClient as unknown as {
    from(table: string): { select(columns: string): { in(column: string, values: string[]): Promise<{ data: unknown; error: unknown }> } };
  }).from("map_reference_images").select("id, project_id, storage_path, sha256, width, height, content_type, byte_size").in("id", all);
  if (error || !Array.isArray(data) || data.length !== all.length) invalid("Direct map reference image is missing");
  const rows = new Map<string, Record<string, unknown>>();
  for (const value of data) {
    const row = record(value);
    if (typeof row.id === "string") rows.set(row.id, row);
  }
  if (rows.size !== all.length) invalid("Direct map reference image is missing");

  const signed = new Map<string, string>();
  for (const id of all) {
    const row = rows.get(id)!;
    const expectedHash = parsedContent.find((entry) => entry.id === id)?.sha256 ?? styleInput?.sha256;
    const width = Number(row.width);
    const height = Number(row.height);
    const byteSize = Number(row.byte_size);
    if (row.project_id !== authorized.projectId || row.sha256 !== expectedHash || !SHA256_PATTERN.test(String(row.sha256))
      || !Number.isInteger(width) || width < 1 || width > 2048 || !Number.isInteger(height) || height < 1 || height > 2048
      || row.content_type !== "image/png" || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > 5242880
      || row.storage_path !== `references/${authorized.projectId}/${id}/${row.sha256}.png`) invalid("Direct map reference image metadata is invalid");
    const path = String(row.storage_path);
    const result = await authorized.serviceClient.storage.from("map-assets").createSignedUrl(path, 300);
    if (result.error || !result.data?.signedUrl || typeof result.data.signedUrl !== "string") invalid("Could not prepare direct map reference");
    signed.set(id, result.data.signedUrl);
  }
  return {
    references: parsedContent.map((entry) => ({ url: signed.get(entry.id)!, usage: entry.usage })),
    style: styleInput ? { url: signed.get(styleInput.id)!, copy: styleInput.copy } : null,
  };
}

export function assertStoredDirectMapCapability(asset: Record<string, unknown>, capability: DiscoveredCapability): void {
  const metadata = record(asset.metadata);
  if (
    asset.provider_operation !== capability.operation
    || metadata.schemaFingerprint !== capability.schemaFingerprint
    || metadata.pollOperation !== capability.pollOperation
    || metadata.pollSchemaFingerprint !== capability.pollSchemaFingerprint
  ) capabilityMissing();
}
