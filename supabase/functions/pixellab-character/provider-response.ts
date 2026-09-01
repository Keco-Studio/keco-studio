import type { ProviderStatus } from "./types.ts";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID_PATTERN = new RegExp(`^${UUID}$`, "i");
const EMBEDDED_UUID_PATTERN = new RegExp(`\\b${UUID}\\b`, "i");
const EMBEDDED_UUIDS_PATTERN = new RegExp(UUID, "gi");

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
    const match = line.match(/^\s*(?:(?:([^:|>\/]{1,160})\s*[|>\/ ]\s*))?(south|east|north|west|south-east|south-west|north-east|north-west)\s*[:=]\s*((?:https?:\/\/|data:image\/)[^\s<>\"]+)/i);
    if (match) rows.push({ ...(match[1] ? { animation_name: match[1].trim() } : {}), direction: match[2].toLowerCase(), image_url: match[3].replace(/[),.;]+$/, "") });
  }
  return rows;
}

function textLeaves(value: unknown): string[] {
  return values(value).filter((item): item is string => typeof item === "string");
}

export type ProviderResponseDiagnostics = {
  keyPaths: string[];
  textLabels: string[];
  statusTokens: string[];
  urlCount: number;
};

const DIAGNOSTIC_LABELS = new Set([
  "animation", "animations", "animation_name", "character", "character_id",
  "direction", "directions", "display_name", "east", "error", "frame",
  "frame_count", "frames", "group", "group_id", "id", "image", "images",
  "name", "north", "south", "spritesheet", "spritesheet_url", "status", "type",
  "url", "west",
]);
const DIAGNOSTIC_STATUSES = new Set([
  "completed", "complete", "ready", "succeeded", "success", "processing",
  "generating", "pending", "queued", "failed", "error", "cancelled", "canceled",
]);

/**
 * Describe a provider response for internal debugging without retaining IDs,
 * URLs, prompt text, frame bytes, or any other provider values.
 */
export function providerResponseDiagnostics(value: unknown): ProviderResponseDiagnostics {
  const keyPaths = new Set<string>();
  const textLabels = new Set<string>();
  const statusTokens = new Set<string>();
  let urlCount = 0;
  const visit = (item: unknown, path: string): void => {
    if (Array.isArray(item)) {
      for (const child of item.slice(0, 20)) visit(child, `${path}[]`);
      return;
    }
    if (!item || typeof item !== "object") return;
    for (const [rawKey, child] of Object.entries(item as Record<string, unknown>).slice(0, 100)) {
      const key = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(rawKey) ? rawKey : "<other>";
      const childPath = path ? `${path}.${key}` : key;
      keyPaths.add(childPath);
      if (rawKey.toLowerCase() === "status" && typeof child === "string") {
        const normalized = child.toLowerCase();
        if (DIAGNOSTIC_STATUSES.has(normalized)) statusTokens.add(normalized);
      }
      visit(child, childPath);
    }
  };
  visit(value, "");

  for (const text of textLeaves(value)) {
    urlCount += text.match(/https:\/\/[^\s<>"']+/gi)?.length ?? 0;
    for (const match of text.matchAll(/^\s*([^:\r\n]{1,64})\s*:/gm)) {
      const normalized = match[1].trim().toLowerCase().replace(/[ -]+/g, "_");
      textLabels.add(DIAGNOSTIC_LABELS.has(normalized) ? normalized : "other");
    }
    for (const match of text.matchAll(/\b(completed|complete|ready|succeeded|success|processing|generating|pending|queued|failed|error|cancelled|canceled)\b/gi)) {
      statusTokens.add(match[1].toLowerCase());
    }
  }

  return {
    keyPaths: [...keyPaths].sort().slice(0, 200),
    textLabels: [...textLabels].sort(),
    statusTokens: [...statusTokens].sort(),
    urlCount,
  };
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
export function providerAnimationJobId(value: unknown, excludedId?: string): string | null {
  const excluded = excludedId?.toLowerCase();
  const usable = (candidate: string): string | null => candidate.toLowerCase() === excluded ? null : candidate;
  const visit = (item: unknown): string | null => {
    if (Array.isArray(item)) {
      for (const child of item) { const found = visit(child); if (found) return found; }
      return null;
    }
    if (!item || typeof item !== "object") return null;
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (/^(background[_-]?job[_-]?ids?|job[_-]?ids?)$/i.test(key)) {
        const found = stringIds(child).map(usable).find((entry): entry is string => Boolean(entry));
        if (found) return found;
      }
      const nested = visit(child); if (nested) return nested;
    }
    return null;
  };
  const structured = visit(value);
  if (structured) return structured;
  for (const text of textLeaves(value)) {
    // MCP text responses may render arrays using JSON or Python-style quotes,
    // and some provider versions use a singular `*_job_id` field. Accept the
    // field label plus a quoted/unquoted identifier without depending on the
    // exact surrounding serialization.
    const match = text.match(/(?:background[_ -]?job[_ -]?ids?|job[_ -]?ids?)\s*[:=]\s*(?:[\[({]\s*)?["']?([A-Za-z0-9][A-Za-z0-9_-]{7,})["']?/i);
    if (!match) continue;
    const candidate = usable(match[1]);
    if (candidate) return candidate;
  }
  // Some MCP transports return a short acknowledgement followed by the job
  // UUID without a field label. The submission response contains no character
  // output yet, so accepting the embedded UUID is unambiguous here and keeps
  // the paid attempt resumable for polling.
  for (const text of textLeaves(value)) {
    for (const embedded of text.matchAll(EMBEDDED_UUIDS_PATTERN)) {
      const candidate = usable(embedded[0]);
      if (candidate) return candidate;
    }
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
    const match = value.match(/(?:https?:\/\/|data:image\/)[^\s<>"']+/i);
    return match?.[0]?.replace(/[),.;]+$/, "") ?? null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (typeof child === "string" && /^(?:https?:\/\/|data:image\/)/i.test(child) && /url|image|download|sheet|sprite/i.test(key)) return child;
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
  const characterId = providerCharacterId(value);
  const all = animationRecords(value);
  const matching = all.filter((row) => String(row.direction ?? "").toLowerCase() === direction.toLowerCase());
  const named = matching.filter((row) => String(row.__animationName ?? row.display_name ?? row.animation_name ?? row.name ?? "").toLowerCase() === animationName.toLowerCase());
  const hasDirectionalRows = all.some((row) => typeof row.direction === "string");
  const selected = named[0] ?? matching[0] ?? (!hasDirectionalRows ? all.find((row) => hasAnimationOutput(row)) : undefined);
  if (!selected) return null;
  const rawFrames = frameValues(selected);
  const frameUrls = rawFrames.map(imageUrl).filter((url): url is string => typeof url === "string" && !/^data:image\//i.test(url));
  const frameData = rawFrames.map((frame) => {
    if (typeof frame === "string" && /^data:image\//i.test(frame)) return frame;
    if (!frame || typeof frame !== "object") return null;
    const row = frame as Record<string, unknown>;
    return typeof row.base64 === "string" ? row.base64 : typeof row.data === "string" && !/^https?:\/\//i.test(row.data) ? row.data : null;
  }).filter((data): data is string => Boolean(data));
  return {
    characterId, animationGroupId: typeof selected.group_id === "string" ? selected.group_id : typeof selected.__animationGroupId === "string" ? selected.__animationGroupId : null,
    imageUrl: imageUrl(selected), frameUrls, frameData,
    frameCount: Number(selected.frame_count ?? selected.frames_count ?? selected.frameCount ?? (frameUrls.length || frameData.length || 0)),
    status: providerStatus(selected) === "processing" && providerStatus(value) !== "processing" ? providerStatus(value) : providerStatus(selected),
  };
}

const DIRECTIONS = new Set(["south", "east", "north", "west", "south-east", "south-west", "north-east", "north-west"]);
function frameValues(row: Record<string, unknown>): unknown[] {
  for (const key of ["frames", "images", "frame_urls", "frameUrls"]) if (Array.isArray(row[key])) return row[key] as unknown[];
  return [];
}
function hasAnimationOutput(row: Record<string, unknown>): boolean { return Boolean(imageUrl(row) || frameValues(row).length); }
function animationRecords(value: unknown, context: { animationName?: string; direction?: string; animationGroupId?: string } = {}): Record<string, unknown>[] {
  if (typeof value === "string") {
    if (/^[\s]*[\[{]/.test(value)) { try { return animationRecords(JSON.parse(value), context); } catch { /* text */ } }
    return textRecords(value).map((row) => ({ ...row, ...(context.animationName ? { __animationName: context.animationName } : {}), ...(context.animationGroupId ? { __animationGroupId: context.animationGroupId } : {}) }));
  }
  if (Array.isArray(value)) return value.flatMap((item) => animationRecords(item, context));
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const ownName = typeof row.display_name === "string" ? row.display_name : typeof row.animation_name === "string" ? row.animation_name : typeof row.name === "string" ? row.name : context.animationName;
  const ownDirection = typeof row.direction === "string" ? row.direction : context.direction;
  const ownGroupId = typeof row.group_id === "string" ? row.group_id : context.animationGroupId;
  const output: Record<string, unknown>[] = [];
  const withContext = (child: unknown, childContext: { animationName?: string; direction?: string; animationGroupId?: string }) => output.push(...animationRecords(child, childContext));
  if (row.directions && typeof row.directions === "object") {
    if (Array.isArray(row.directions)) withContext(row.directions, { animationName: ownName, animationGroupId: ownGroupId });
    else for (const [key, child] of Object.entries(row.directions as Record<string, unknown>)) withContext(child, { animationName: ownName, animationGroupId: ownGroupId, direction: DIRECTIONS.has(key.toLowerCase()) ? key.toLowerCase() : undefined });
  }
  const candidate = { ...row, ...(ownName ? { __animationName: ownName } : {}), ...(ownDirection ? { direction: ownDirection } : {}), ...(ownGroupId ? { __animationGroupId: ownGroupId } : {}) };
  if (hasAnimationOutput(candidate) || (ownDirection && typeof row.status === "string")) output.push(candidate);
  for (const [key, child] of Object.entries(row)) {
    if (key === "directions" || key === "frames" || key === "images") continue;
    if (child && typeof child === "object") withContext(child, { animationName: ownName, animationGroupId: ownGroupId, direction: DIRECTIONS.has(key.toLowerCase()) ? key.toLowerCase() : ownDirection });
    else if (typeof child === "string" && /(?:spritesheet|sheet|frame|image|download|url)/i.test(key)) output.push({ ...candidate, [key]: child });
  }
  return output;
}

export function providerErrorText(value: unknown): string {
  return values(value).filter((entry): entry is string => typeof entry === "string").join(" ").slice(0, 1000);
}
