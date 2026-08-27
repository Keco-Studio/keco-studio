import { PixelLabCharacterError, type CharacterCapability, type CharacterAssetPlan } from "./types.ts";
import { providerErrorText } from "./provider-response.ts";

const MCP_URL = "https://api.pixellab.ai/mcp";

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
  constructor(private readonly token: string, private readonly fetcher: typeof fetch = fetch) {
    if (!token) throw new PixelLabCharacterError("pixellab_not_configured");
  }
  private async mcp(name: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetcher(MCP_URL, { method: "POST", headers: { authorization: `Bearer ${this.token}`, accept: "application/json, text/event-stream", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: name === "tools/list" ? "tools/list" : "tools/call", params: name === "tools/list" ? {} : { name, arguments: params } }) });
    } catch { throw new PixelLabCharacterError("pixellab_upstream"); }
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
    const payload = await this.mcp("tools/list", {});
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
    return { semantic, operation, pollOperation: "get_character", schemaFingerprint: await fingerprint(inputSchema), pollSchemaFingerprint: await fingerprint(pollInputSchema), inputSchema, pollInputSchema };
  }
  async callTool(name: string, arguments_: Record<string, unknown>): Promise<Record<string, unknown>> { return (await this.mcp(name, arguments_)).result as Record<string, unknown>; }
}

export function characterArguments(plan: Extract<CharacterAssetPlan, { kind: "character" }>): Record<string, unknown> {
  return { description: plan.description, name: plan.name, mode: "pro", size: plan.width, view: plan.perspective === "topdown" ? "high top-down" : plan.perspective === "platformer" ? "side" : "high top-down" };
}
const facingToDirection = { front: "south", back: "north", left: "west", right: "east" } as const;
export function animationArguments(plan: Extract<CharacterAssetPlan, { kind: "animation" }>, providerCharacterId: string, facing: keyof typeof facingToDirection): Record<string, unknown> {
  return { character_id: providerCharacterId, action_description: plan.motionDescription, animation_name: plan.name, directions: [facingToDirection[facing]], mode: "v3", frame_count: plan.frameCount, keep_first_frame: false };
}
