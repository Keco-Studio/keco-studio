import { PixelLabCharacterError, type CharacterCapability, type CharacterAssetPlan, type ReferenceCompatibility, type ResolvedCharacterReference } from "./types.ts";
import { providerErrorText } from "./provider-response.ts";

const MCP_URL = "https://api.pixellab.ai/mcp";
const API_URL = "https://api.pixellab.ai/v2";
const CAPABILITY_DISCOVERY_ATTEMPTS = 3;
const CAPABILITY_DISCOVERY_RETRY_MS = [150, 450];
const BACKGROUND_JOB_ATTEMPTS = 3;
const BACKGROUND_JOB_RETRY_MS = [250, 750];

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
async function fingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function parsePayload(text: string): Record<string, unknown> {
  const line = text.split(/\r?\n/).filter((part) => part.startsWith("data: ")).at(-1)?.slice(6) ?? text;
  try { const value = JSON.parse(line); if (!value || typeof value !== "object") throw new Error(); return value as Record<string, unknown>; }
  catch { throw new PixelLabCharacterError("pixellab_invalid_response"); }
}
function compatible(tool: Record<string, unknown> | undefined, required: string[]): boolean {
  const schema = tool?.inputSchema as Record<string, unknown> | undefined;
  const properties = schema?.properties;
  if (!schema || schema.type !== "object" || !properties || typeof properties !== "object") return false;
  return required.every((key) => key in (properties as Record<string, unknown>));
}

export class PixelLabCharacterClient {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly sleeper: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    if (!token) throw new PixelLabCharacterError("pixellab_not_configured");
  }
  private async mcp(name: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetcher(MCP_URL, { method: "POST", headers: { authorization: `Bearer ${this.token}`, accept: "application/json, text/event-stream", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: name === "tools/list" ? "tools/list" : "tools/call", params: name === "tools/list" ? {} : { name, arguments: params } }) });
    } catch { throw new PixelLabCharacterError("pixellab_upstream"); }
    if (response.status === 401 || response.status === 403) {
      throw new PixelLabCharacterError("pixellab_not_configured", "PixelLab authentication failed");
    }
    if (response.status === 429) throw new PixelLabCharacterError("pixellab_rate_limited");
    if (!response.ok) throw new PixelLabCharacterError("pixellab_upstream");
    const payload = parsePayload(await response.text());
    const errorText = providerErrorText(payload.result ?? payload.error ?? payload);
    if (payload.error || (payload.result && typeof payload.result === "object" && (payload.result as Record<string, unknown>).isError === true)) {
      if (/credit|balance|quota|billing|payment|generations?_remaining\s*[:=]\s*0/i.test(errorText)) throw new PixelLabCharacterError("pixellab_quota_exceeded");
      if (/rate.?limit|too many|capacity|temporar/i.test(errorText)) throw new PixelLabCharacterError("pixellab_rate_limited");
      throw new PixelLabCharacterError("pixellab_upstream");
    }
    return payload;
  }
  async listTools(): Promise<Record<string, unknown>[]> {
    let payload: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < CAPABILITY_DISCOVERY_ATTEMPTS; attempt += 1) {
      try {
        payload = await this.mcp("tools/list", {});
        break;
      } catch (error) {
        const retryable = error instanceof PixelLabCharacterError
          && (error.code === "pixellab_upstream" || error.code === "pixellab_rate_limited");
        if (!retryable || attempt === CAPABILITY_DISCOVERY_ATTEMPTS - 1) throw error;
        await this.sleeper(CAPABILITY_DISCOVERY_RETRY_MS[attempt]);
      }
    }
    if (!payload) throw new PixelLabCharacterError("pixellab_upstream");
    const tools = (payload.result as Record<string, unknown> | undefined)?.tools;
    if (!Array.isArray(tools)) throw new PixelLabCharacterError("pixellab_invalid_response");
    return tools.filter((tool): tool is Record<string, unknown> => Boolean(tool && typeof tool === "object"));
  }
  async discover(semantic: "character" | "animation"): Promise<CharacterCapability> {
    const tools = await this.listTools();
    const operation = semantic === "character" ? "create_character" : "animate_character";
    const tool = tools.find((item) => item.name === operation);
    const poll = tools.find((item) => item.name === "get_character");
    const required = semantic === "character" ? ["description", "mode"] : ["character_id", "action_description", "frame_count", "mode"];
    if (!compatible(tool, required) || !compatible(poll, ["character_id"])) throw new PixelLabCharacterError("pixellab_capability_missing");
    const inputSchema = tool!.inputSchema as Record<string, unknown>;
    const pollInputSchema = poll!.inputSchema as Record<string, unknown>;
    // PixelLab V3 animation results are attached to the source character and
    // are retrieved through get_character, rather than the generic REST
    // background-jobs endpoint. Keep the live capability aligned with the
    // documented animate_character + get_character contract.
    return { semantic, operation, pollOperation: "get_character", schemaFingerprint: await fingerprint(inputSchema), pollSchemaFingerprint: await fingerprint(pollInputSchema), inputSchema, pollInputSchema };
  }
  async callTool(name: string, arguments_: Record<string, unknown>): Promise<Record<string, unknown>> { return (await this.mcp(name, arguments_)).result as Record<string, unknown>; }
  async getBackgroundJob(jobId: string): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < BACKGROUND_JOB_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(`${API_URL}/background-jobs/${encodeURIComponent(jobId)}`, {
          method: "GET", headers: { authorization: `Bearer ${this.token}`, accept: "application/json" },
        });
      } catch {
        if (attempt === BACKGROUND_JOB_ATTEMPTS - 1) throw new PixelLabCharacterError("pixellab_upstream");
        await this.sleeper(BACKGROUND_JOB_RETRY_MS[attempt]);
        continue;
      }
      if (response.status === 401 || response.status === 403) throw new PixelLabCharacterError("pixellab_not_configured", "PixelLab authentication failed");
      if (response.status === 429) {
        if (attempt === BACKGROUND_JOB_ATTEMPTS - 1) throw new PixelLabCharacterError("pixellab_rate_limited");
        await this.sleeper(BACKGROUND_JOB_RETRY_MS[attempt]);
        continue;
      }
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        if (attempt === BACKGROUND_JOB_ATTEMPTS - 1) throw new PixelLabCharacterError("pixellab_upstream");
        await this.sleeper(BACKGROUND_JOB_RETRY_MS[attempt]);
        continue;
      }
      if (!response.ok) throw new PixelLabCharacterError("pixellab_upstream");
      try {
        const value = await response.json();
        if (!value || typeof value !== "object") throw new Error();
        return value as Record<string, unknown>;
      } catch { throw new PixelLabCharacterError("pixellab_invalid_response"); }
    }
    throw new PixelLabCharacterError("pixellab_upstream");
  }
}

function propertyShape(capability: CharacterCapability, field: string): Record<string, unknown> {
  const properties = capability.inputSchema.properties;
  return properties && typeof properties === "object" && !Array.isArray(properties)
    ? ((properties as Record<string, unknown>)[field] as Record<string, unknown> | undefined) ?? {}
    : {};
}

function schemaVariants(shape: Record<string, unknown>): Record<string, unknown>[] {
  const variants = [shape];
  for (const key of ["anyOf", "oneOf"] as const) {
    const value = shape[key];
    if (Array.isArray(value)) variants.push(...value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))));
  }
  return variants;
}

function acceptsReferenceUrl(shape: Record<string, unknown>): boolean {
  return schemaVariants(shape).some((variant) => variant.type === "string" || (
    variant.type === "array"
    && Boolean(variant.items && typeof variant.items === "object" && !Array.isArray(variant.items))
    && schemaVariants(variant.items as Record<string, unknown>).some((item) => item.type === "string")
  ));
}

function acceptsReferenceUrlArray(shape: Record<string, unknown>): boolean {
  return schemaVariants(shape).some((variant) => variant.type === "array"
    && Boolean(variant.items && typeof variant.items === "object" && !Array.isArray(variant.items))
    && schemaVariants(variant.items as Record<string, unknown>).some((item) => item.type === "string"));
}

function referenceField(capability: CharacterCapability, role: "style" | "source"): string | null {
  const properties = capability.inputSchema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return null;
  const names = Object.keys(properties as Record<string, unknown>);
  const candidates = role === "style"
    ? ["style_reference", "style_reference_image", "style_image", "style_image_url"]
    : ["source_image", "source_reference", "source_image_url"];
  return candidates.find((candidate) => names.includes(candidate) && acceptsReferenceUrl(propertyShape(capability, candidate))) ?? null;
}

export function negotiateCharacterReferences(capability: CharacterCapability, references: ResolvedCharacterReference[]): ReferenceCompatibility {
  const provisional = references.map((reference) => {
    const field = referenceField(capability, reference.role);
    if (field) return { assetId: reference.assetId, role: reference.role, capability: "exact" as const, providerField: field };
    return { assetId: reference.assetId, role: reference.role, capability: reference.required ? "unavailable" as const : "fallback" as const, providerField: null };
  });
  const counts = new Map<string, number>();
  for (const mapping of provisional) if (mapping.providerField) counts.set(mapping.providerField, (counts.get(mapping.providerField) ?? 0) + 1);
  const mappings = provisional.map((mapping) => {
    if (!mapping.providerField || (counts.get(mapping.providerField) ?? 0) < 2 || acceptsReferenceUrlArray(propertyShape(capability, mapping.providerField))) return mapping;
    const reference = references.find((candidate) => candidate.assetId === mapping.assetId)!;
    return { ...mapping, capability: reference.required ? "unavailable" as const : "fallback" as const, providerField: null };
  });
  return {
    status: mappings.some((mapping) => mapping.capability === "unavailable")
      ? "unavailable"
      : mappings.some((mapping) => mapping.capability === "fallback") ? "fallback" : "exact",
    mappings,
  };
}

export function characterArguments(
  plan: Extract<CharacterAssetPlan, { kind: "character" }>,
  capability?: CharacterCapability,
  references: ResolvedCharacterReference[] = [],
): Record<string, unknown> {
  const compatibility = capability ? negotiateCharacterReferences(capability, references) : { status: "exact" as const, mappings: [] };
  if (compatibility.status === "unavailable") throw new PixelLabCharacterError("pixellab_capability_missing", "Required character reference capability is unavailable", 409);
  const fallback = references.filter((reference) => compatibility.mappings.find((mapping) => mapping.assetId === reference.assetId)?.capability === "fallback");
  const fallbackDirection = fallback.map((reference) => `Reference direction (${reference.role}): ${reference.usage}`).join("\n");
  const descriptionBudget = Math.max(0, 2_000 - (fallbackDirection ? fallbackDirection.length + 1 : 0));
  const args: Record<string, unknown> = {
    description: fallbackDirection
      ? `${plan.description.slice(0, descriptionBudget)}\n${fallbackDirection}`
      : plan.description,
    name: plan.name,
    mode: "pro",
    size: plan.width,
    view: plan.perspective === "topdown" ? "high top-down" : plan.perspective === "platformer" ? "side" : "high top-down",
  };
  for (const mapping of compatibility.mappings) {
    if (mapping.capability !== "exact" || !mapping.providerField) continue;
    const reference = references.find((candidate) => candidate.assetId === mapping.assetId)!;
    const shape = propertyShape(capability!, mapping.providerField);
    if (acceptsReferenceUrlArray(shape)) {
      const current = Array.isArray(args[mapping.providerField]) ? args[mapping.providerField] as string[] : [];
      args[mapping.providerField] = [...current, reference.imageUrl];
    } else if (args[mapping.providerField] === undefined) {
      args[mapping.providerField] = reference.imageUrl;
    } else {
      throw new PixelLabCharacterError("pixellab_capability_missing", "Provider cannot represent multiple character references", 409);
    }
  }
  return args;
}
const facingToDirection = { front: "south", back: "north", left: "west", right: "east" } as const;
export function animationArguments(plan: Extract<CharacterAssetPlan, { kind: "animation" }>, providerCharacterId: string, facing: keyof typeof facingToDirection): Record<string, unknown> {
  return { character_id: providerCharacterId, action_description: plan.motionDescription, animation_name: plan.name, directions: [facingToDirection[facing]], mode: "v3", frame_count: plan.frameCount, keep_first_frame: false };
}
