import {
  type DiscoveredCapability,
  type PixelLabTool,
  PixelLabMapError,
  type SemanticCapability,
} from "./types.ts";
import { providerImageReference } from "./provider-response.ts";
import { MAX_PNG_BYTES } from "./png.ts";

const MCP_URL = "https://api.pixellab.ai/mcp";
const REST_URL = "https://api.pixellab.ai/v1";
const MAX_BASE64_LENGTH = Math.ceil(MAX_PNG_BYTES / 3) * 4 + 4;

const CAPABILITIES: Record<SemanticCapability, {
  preferred: string;
  requiredTerms: string[];
  restFallback?: string;
}> = {
  topdown_tileset: {
    preferred: "create_topdown_tileset",
    requiredTerms: ["top", "tile", "wang"],
    restFallback: "/create-tileset",
  },
  path_tiles: {
    preferred: "create_path_tiles",
    requiredTerms: ["path", "road", "tile"],
  },
  map_object: {
    preferred: "create_map_object",
    requiredTerms: ["map", "object", "transparent"],
    restFallback: "/map-objects",
  },
  inpaint: {
    preferred: "inpaint_image",
    requiredTerms: ["inpaint", "mask", "region"],
    restFallback: "/inpaint-v3",
  },
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function fingerprint(schema: Record<string, unknown>): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(schema));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseMcpPayload(text: string): Record<string, unknown> {
  const dataLine = text.split(/\r?\n/).find((line) => line.startsWith("data: "));
  const raw = dataLine ? dataLine.slice(6) : text;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new PixelLabMapError("pixellab_invalid_response");
  }
}

function responseError(status: number): PixelLabMapError {
  if (status === 429) return new PixelLabMapError("pixellab_rate_limited", undefined, 429);
  return new PixelLabMapError("pixellab_upstream", undefined, 502);
}

function providerDownloadUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PixelLabMapError("pixellab_invalid_response", "Provider image URL is invalid", 422);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new PixelLabMapError("pixellab_invalid_response", "Provider image URL must use HTTPS without credentials", 422);
  }
  return url.toString();
}

function decodeProviderBase64(value: string): Uint8Array {
  const encoded = value.replace(/^data:image\/png;base64,/, "");
  if (encoded.length === 0 || encoded.length > MAX_BASE64_LENGTH) {
    throw new PixelLabMapError("pixellab_invalid_response", "Provider image size is invalid", 422);
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  } catch {
    throw new PixelLabMapError("pixellab_invalid_response", "Provider image base64 is invalid", 422);
  }
  if (bytes.byteLength > MAX_PNG_BYTES) {
    throw new PixelLabMapError("pixellab_invalid_response", "Provider image size is invalid", 422);
  }
  return bytes;
}

async function readProviderImage(response: Response): Promise<Uint8Array> {
  const declaredValue = response.headers.get("content-length");
  if (declaredValue != null) {
    const declared = Number(declaredValue);
    if (!Number.isFinite(declared) || declared < 0 || declared > MAX_PNG_BYTES) {
      throw new PixelLabMapError("pixellab_invalid_response", "Provider image size is invalid", 422);
    }
  }
  if (!response.body) throw new PixelLabMapError("pixellab_invalid_response", "Provider image is empty", 422);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_PNG_BYTES) {
      await reader.cancel();
      throw new PixelLabMapError("pixellab_invalid_response", "Provider image size is invalid", 422);
    }
    chunks.push(value);
  }
  if (size === 0) throw new PixelLabMapError("pixellab_invalid_response", "Provider image is empty", 422);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function schemaProperties(capability: DiscoveredCapability): Record<string, Record<string, unknown>> {
  const properties = capability.inputSchema.properties;
  return properties && typeof properties === "object" && !Array.isArray(properties)
    ? properties as Record<string, Record<string, unknown>>
    : {};
}

export function providerArgumentsFor(
  capability: DiscoveredCapability,
  prompt: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const isV2SemanticPlan = "tileSize" in params || "projection" in params || "transparency" in params;
  if (!isV2SemanticPlan) {
    return capability.semantic === "topdown_tileset" ? params : { ...params, description: prompt };
  }

  const properties = schemaProperties(capability);
  const hasDiscoveredSchema = Object.keys(capability.inputSchema).length > 0;
  const hasSchemaProperties = Object.keys(properties).length > 0;
  const supports = (key: string) => key in properties;
  const output: Record<string, unknown> = {};
  const setFirst = (keys: string[], value: unknown, fallback = keys[0]) => {
    const key = keys.find(supports) ?? (!hasDiscoveredSchema ? fallback : undefined);
    if (key && value !== undefined) output[key] = value;
  };
  const tileSize = typeof params.tileSize === "number" ? params.tileSize : undefined;

  if (capability.semantic === "topdown_tileset") {
    if (!hasDiscoveredSchema || supports("lower_description")) output.lower_description = prompt;
    if (!hasDiscoveredSchema || supports("upper_description")) output.upper_description = prompt;
    if (hasSchemaProperties) setFirst(["description", "prompt"], prompt);
  } else {
    setFirst(["description", "prompt"], prompt);
  }
  if (tileSize != null) {
    const tileSchema = properties.tile_size;
    if (!hasDiscoveredSchema || supports("tile_size")) {
      output.tile_size = tileSchema?.type === "object"
        ? { width: tileSize, height: tileSize }
        : tileSize;
    }
  }
  setFirst(["width"], params.width);
  setFirst(["height"], params.height);
  setFirst(["view", "projection"], params.projection === "top-down" ? "high top-down" : params.projection);
  if (params.transparency === true) setFirst(["transparent_background", "transparency"], true);
  if (Array.isArray(params.palette)) setFirst(["palette", "colors"], params.palette);
  if (typeof params.pathKind === "string") setFirst(["path_type", "tile_type"], params.pathKind);
  if (Array.isArray(params.requiredConnectivityMasks)) {
    setFirst(["required_connectivity_masks", "connectivity_masks", "required_masks"], params.requiredConnectivityMasks);
  }
  return output;
}

export class PixelLabClient {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!token) throw new PixelLabMapError("pixellab_not_configured", undefined, 503);
  }

  private async mcp(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetcher(MCP_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
      });
    } catch {
      throw new PixelLabMapError("pixellab_upstream");
    }
    if (!response.ok) throw responseError(response.status);
    const payload = parseMcpPayload(await response.text());
    if (payload.error) throw new PixelLabMapError("pixellab_upstream");
    return payload;
  }

  async listTools(): Promise<PixelLabTool[]> {
    const payload = await this.mcp("tools/list", {});
    const result = payload.result as { tools?: unknown } | undefined;
    if (!Array.isArray(result?.tools)) throw new PixelLabMapError("pixellab_invalid_response");
    return result.tools.filter((tool): tool is PixelLabTool =>
      Boolean(tool && typeof tool === "object" && typeof (tool as PixelLabTool).name === "string"));
  }

  async discover(semantic: SemanticCapability): Promise<DiscoveredCapability> {
    const spec = CAPABILITIES[semantic];
    const tools = await this.listTools();
    const exact = tools.find((tool) => tool.name === spec.preferred);
    const semanticMatch = exact ?? tools.find((tool) => {
      const haystack = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
      return spec.requiredTerms.every((term) => haystack.includes(term));
    });
    if (semanticMatch) {
      const inputSchema = semanticMatch.inputSchema ?? {};
      return {
        semantic,
        transport: "mcp",
        operation: semanticMatch.name,
        schemaFingerprint: await fingerprint(inputSchema),
        inputSchema,
      };
    }
    if (spec.restFallback) {
      return {
        semantic,
        transport: "rest",
        operation: spec.restFallback,
        schemaFingerprint: await fingerprint({ fallback: spec.restFallback }),
        inputSchema: {},
      };
    }
    throw new PixelLabMapError("pixellab_capability_missing", undefined, 409);
  }

  async submitAsset(capability: DiscoveredCapability, arguments_: Record<string, unknown>) {
    if (capability.transport === "mcp") {
      const payload = await this.mcp("tools/call", {
        name: capability.operation,
        arguments: arguments_,
      });
      const result = payload.result;
      if (!result || typeof result !== "object") throw new PixelLabMapError("pixellab_invalid_response");
      return result as Record<string, unknown>;
    }
    const response = await this.fetcher(`${REST_URL}${capability.operation}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(arguments_),
    });
    if (!response.ok) throw responseError(response.status);
    const result = await response.json().catch(() => null);
    if (!result || typeof result !== "object") throw new PixelLabMapError("pixellab_invalid_response");
    return result as Record<string, unknown>;
  }

  async pollJob(capability: DiscoveredCapability, jobId: string): Promise<Record<string, unknown>> {
    if (capability.transport === "mcp") {
      const operation = capability.semantic === "topdown_tileset" ? "get_topdown_tileset"
        : capability.semantic === "path_tiles" ? "get_tiles_pro"
        : capability.semantic === "map_object" ? "get_map_object" : "get_image";
      const key = capability.semantic === "topdown_tileset" ? "tileset_id"
        : capability.semantic === "path_tiles" ? "tile_id"
        : capability.semantic === "map_object" ? "object_id" : "job_id";
      const payload = await this.mcp("tools/call", { name: operation, arguments: { [key]: jobId } });
      if (!payload.result || typeof payload.result !== "object") throw new PixelLabMapError("pixellab_invalid_response");
      return payload.result as Record<string, unknown>;
    }
    const response = await this.fetcher(`${REST_URL}${capability.operation}/${encodeURIComponent(jobId)}`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) throw responseError(response.status);
    const result = await response.json().catch(() => null);
    if (!result || typeof result !== "object") throw new PixelLabMapError("pixellab_invalid_response");
    return result as Record<string, unknown>;
  }

  async downloadResult(result: Record<string, unknown>): Promise<Uint8Array> {
    const found = providerImageReference(result);
    if (!found) throw new PixelLabMapError("pixellab_invalid_response", "Provider image result is missing");
    if (!found.startsWith("https://")) return decodeProviderBase64(found);
    const response = await this.fetcher(providerDownloadUrl(found));
    if (!response.ok) throw responseError(response.status);
    return readProviderImage(response);
  }
}
