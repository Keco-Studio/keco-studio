const JOB_ID_KEYS = new Set(["job_id", "object_id", "tileset_id", "id"]);

export type ProviderTileReference = {
  key: string;
  connectivityMask: number;
  url: string;
};

export function providerTextBlocks(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try { return providerTextBlocks(JSON.parse(trimmed)); } catch { /* keep provider text */ }
    }
    return [value];
  }
  if (Array.isArray(value)) return value.flatMap(providerTextBlocks);
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap(providerTextBlocks);
}

export function providerTileReferences(value: unknown): ProviderTileReference[] {
  const references: ProviderTileReference[] = [];
  for (const block of providerTextBlocks(value)) {
    const masks: Array<[string, number]> = [];
    const urls = new Map<string, string>();
    for (const line of block.split(/\r?\n/)) {
      const mask = line.match(/^\s*([\w.-]+)\s*:\s*(?:mask|connectivity(?:_mask)?)\s*=\s*(\d+)\s*$/i);
      if (mask) masks.push([mask[1], Number(mask[2])]);
      const url = line.match(/^\s*([\w.-]+)\s*:\s*(https:\/\/\S+|data:image\/png;base64,\S+)\s*$/i);
      if (url) urls.set(url[1], url[2]);
    }
    for (const [key, connectivityMask] of masks) {
      const url = urls.get(key);
      if (url) references.push({ key, connectivityMask, url });
    }
  }
  return references;
}

export function providerImageReference(value: unknown): string | null {
  if (typeof value === "string") {
    if (value.startsWith("data:image/png;base64,")) return value;
    if (/^https:\/\/.*(?:\.png|\/download)(?:\?|$)/i.test(value)) return value;
    const download = value.match(/(?:^|\n)\s*(?:download|(?:image_)?url)\s*:\s*(https:\/\/[^\s]+)/i);
    if (download?.[1]) return download[1];
    try { return providerImageReference(JSON.parse(value)); } catch { return null; }
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = providerImageReference(entry);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string" && /url|download/i.test(key) && entry.startsWith("https://")) return entry;
    if (typeof entry === "string" && /base64|^data$/i.test(key) && entry.length > 32) return entry;
  }
  for (const entry of Object.values(value as Record<string, unknown>)) {
    const found = providerImageReference(entry);
    if (found) return found;
  }
  return null;
}

function textField(text: string, keys: Set<string>): string | null {
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    if (!keys.has(key)) continue;
    const value = line.slice(separator + 1).trim().split(/\s|\(/, 1)[0]?.replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  return null;
}

function nestedValue(
  value: unknown,
  objectKeys: Set<string>,
  textKeys: Set<string>,
): string | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      const nested = nestedValue(parsed, objectKeys, textKeys);
      if (nested) return nested;
    } catch {
      // MCP text results are commonly line-based rather than JSON.
    }
    return textField(value, textKeys);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = nestedValue(entry, objectKeys, textKeys);
      if (nested) return nested;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (objectKeys.has(key.toLowerCase()) && typeof entry === "string" && entry) return entry;
  }
  for (const entry of Object.values(value as Record<string, unknown>)) {
    const nested = nestedValue(entry, objectKeys, textKeys);
    if (nested) return nested;
  }
  return null;
}

export function providerJobId(value: Record<string, unknown>): string | null {
  return nestedValue(value, JOB_ID_KEYS, JOB_ID_KEYS);
}

export function providerStatus(value: Record<string, unknown>): "processing" | "completed" | "failed" {
  if (nestedValue(value, new Set(["error"]), new Set(["error"]))) return "failed";
  const raw = nestedValue(value, new Set(["status"]), new Set(["status"]))?.toLowerCase() ?? "";
  if (["completed", "complete", "ready", "succeeded", "success"].includes(raw)) return "completed";
  if (["failed", "error", "cancelled", "canceled"].includes(raw)) return "failed";
  return "processing";
}
