import type { ProviderStatus } from "./types.ts";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID_PATTERN = new RegExp(`^${UUID}$`, "i");
const EMBEDDED_UUID_PATTERN = new RegExp(`\\b${UUID}\\b`, "i");

function values(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(values);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(values);
  return [value];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function records(value: unknown): Record<string, unknown>[] {
  if (typeof value === "string" && /^[\s]*[\[{]/.test(value)) {
    try { return records(JSON.parse(value)); } catch { return []; }
  }
  if (Array.isArray(value)) return value.flatMap(records);
  if (typeof value === "string") return textRecords(value);
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  return [row, ...Object.values(row).flatMap(records)];
}

// PixelLab's MCP server returns human-readable key/value text in content[].text
// rather than JSON. Preserve the useful directional rows for the same result
// parsers used by structured responses.
function textRecords(text: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(south|east|north|west|south-east|south-west|north-east|north-west)\s*:\s*(https:\/\/\S+)/i);
    if (match) rows.push({ direction: match[1].toLowerCase(), image_url: match[2].replace(/[),.;]+$/, "") });
  }
  return rows;
}

function textLeaves(value: unknown): string[] {
  return values(value).filter((item): item is string => typeof item === "string");
}

export function providerCharacterId(value: unknown): string | null {
  for (const item of values(value)) {
    if (typeof item !== "string") continue;
    if (UUID_PATTERN.test(item)) return item;
  }
  const visit = (item: unknown): string | null => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (/^(character_id|id)$/i.test(key) && typeof child === "string" && child.length >= 8) return child;
      const nested = visit(child); if (nested) return nested;
    }
    return null;
  };
  const keyed = visit(value) ?? records(value).map((row) => {
    const candidate = row.character_id ?? row.id;
    return typeof candidate === "string" && candidate.length >= 8 ? candidate : null;
  }).find((candidate): candidate is string => Boolean(candidate)) ?? null;
  if (keyed) return keyed;

  for (const text of textLeaves(value)) {
    const labelled = text.match(new RegExp(`\\b(?:character[_\\s-]*id|id)\\s*[:=]\\s*["']?(${UUID})`, "i"));
    if (labelled) return labelled[1];
  }
  for (const text of textLeaves(value)) {
    const embedded = text.match(EMBEDDED_UUID_PATTERN);
    if (embedded) return embedded[0];
  }
  return null;
}

function stringIds(value: unknown): string[] {
  return values(value).filter((item): item is string => typeof item === "string" && item.length >= 8);
}

/** PixelLab animation submission returns one background job per requested direction. */
export function providerAnimationJobId(value: unknown): string | null {
  const visit = (item: unknown): string | null => {
    if (Array.isArray(item)) {
      for (const child of item) { const found = visit(child); if (found) return found; }
      return null;
    }
    if (!item || typeof item !== "object") return null;
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (/^(background[_-]?job[_-]?ids?|job[_-]?ids?)$/i.test(key)) {
        const found = stringIds(child)[0]; if (found) return found;
      }
      const nested = visit(child); if (nested) return nested;
    }
    return null;
  };
  const structured = visit(value);
  if (structured) return structured;
  for (const text of textLeaves(value)) {
    const match = text.match(/(?:background[_ -]?job[_ -]?ids?|job[_ -]?ids?)\s*[:=]\s*\[?\s*([0-9a-f]{8}-[0-9a-f-]{27})/i);
    if (match) return match[1];
  }
  return null;
}

export function providerStatus(value: unknown): ProviderStatus {
  const text = values(value).filter((entry): entry is string => typeof entry === "string").join(" ").toLowerCase();
  const status = (() => {
    const visit = (item: unknown): string | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
        if (key.toLowerCase() === "status" && typeof child === "string") return child.toLowerCase();
        const nested = visit(child); if (nested) return nested;
      }
      return null;
    };
    return visit(value) ?? records(value).map((row) => typeof row.status === "string" ? row.status.toLowerCase() : "").find(Boolean) ?? "";
  })();
  const textStatus = textLeaves(value).join(" ").match(/\bstatus\s*[:=]\s*(completed|complete|ready|succeeded|success|failed|error|cancelled|canceled)\b/i)?.[1]?.toLowerCase();
  const normalizedStatus = status || textStatus || "";
  if (["completed", "complete", "ready", "succeeded", "success"].includes(normalizedStatus)) return "completed";
  if (["failed", "error", "cancelled", "canceled"].includes(normalizedStatus) || /\b(error|failed)\b/.test(text)) return "failed";
  return "processing";
}

function imageUrl(value: unknown): string | null {
  if (typeof value === "string") {
    const match = value.match(/https:\/\/[^\s<>"']+/i);
    return match?.[0]?.replace(/[),.;]+$/, "") ?? null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === "string" && /^https:\/\//.test(child) && /url|image|download|sheet|sprite/i.test(key)) return child;
  }
  for (const child of Object.values(value as Record<string, unknown>)) { const found = imageUrl(child); if (found) return found; }
  return null;
}

export function characterResult(value: unknown, direction: string): { characterId: string; imageUrl: string } | null {
  const root = record(value);
  const characterId = providerCharacterId(value);
  if (!characterId) return null;
  const allRecords = records(value);
  const rotations = allRecords.filter((item) => String(item.direction ?? item.name ?? "").toLowerCase() === direction.toLowerCase());
  const url = imageUrl(rotations[0]) ?? imageUrl(root) ?? imageUrl(allRecords);
  return url ? { characterId, imageUrl: url } : null;
}

export function animationResult(value: unknown, animationName: string, direction: string): {
  characterId: string | null; animationGroupId: string | null; imageUrl: string | null; frameUrls: string[]; frameData: string[]; frameCount: number; status: string;
} | null {
  const root = record(value);
  const payload = record(root.last_response ?? value);
  const characterId = providerCharacterId(value);
  const all = records(payload);
  const parent = all.find((row) => String(row.display_name ?? row.animation_name ?? row.name ?? "").toLowerCase() === animationName.toLowerCase());
  const candidates = parent ? records(parent) : all;
  const selected = candidates.find((row) => String(row.direction ?? "").toLowerCase() === direction.toLowerCase())
    ?? (Array.isArray(payload.images) ? payload : null);
  if (!selected) return null;
  const rawFrames = Array.isArray(selected.frames) ? selected.frames : Array.isArray(payload.images) ? payload.images : [];
  const frameUrls = rawFrames.map(imageUrl).filter((url): url is string => Boolean(url));
  const frameData = rawFrames.map((frame) => {
    if (!frame || typeof frame !== "object") return null;
    const row = frame as Record<string, unknown>;
    return typeof row.base64 === "string" ? row.base64 : typeof row.data === "string" && !row.data.startsWith("http") ? row.data : null;
  }).filter((data): data is string => Boolean(data));
  return {
    characterId, animationGroupId: typeof selected.group_id === "string" ? selected.group_id : typeof parent?.group_id === "string" ? parent.group_id : null,
    imageUrl: imageUrl(selected), frameUrls, frameData,
    frameCount: Number(selected.frame_count ?? selected.frames_count ?? frameUrls.length ?? 0),
    status: providerStatus(selected === payload ? value : selected),
  };
}

export function providerErrorText(value: unknown): string {
  return values(value).filter((entry): entry is string => typeof entry === "string").join(" ").slice(0, 1000);
}
