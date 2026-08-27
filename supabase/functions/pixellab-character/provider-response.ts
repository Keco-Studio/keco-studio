import type { ProviderStatus } from "./types.ts";

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
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  return [row, ...Object.values(row).flatMap(records)];
}

export function providerCharacterId(value: unknown): string | null {
  for (const item of values(value)) {
    if (typeof item !== "string") continue;
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(item)) return item;
  }
  const visit = (item: unknown): string | null => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (/^(character_id|id)$/i.test(key) && typeof child === "string" && child.length >= 8) return child;
      const nested = visit(child); if (nested) return nested;
    }
    return null;
  };
  return visit(value) ?? records(value).map((row) => {
    const candidate = row.character_id ?? row.id;
    return typeof candidate === "string" && candidate.length >= 8 ? candidate : null;
  }).find((candidate): candidate is string => Boolean(candidate)) ?? null;
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
  if (status === "completed" || status === "complete" || status === "ready" || status === "succeeded" || status === "success") return "completed";
  if (status === "failed" || status === "error" || status === "cancelled" || status === "canceled" || /\b(error|failed)\b/.test(text)) return "failed";
  return "processing";
}

function imageUrl(value: unknown): string | null {
  if (typeof value === "string" && /^https:\/\//.test(value)) return value;
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
  characterId: string; animationGroupId: string | null; imageUrl: string | null; frameUrls: string[]; frameCount: number; status: string;
} | null {
  const root = record(value);
  const characterId = providerCharacterId(value);
  if (!characterId) return null;
  const all = records(value);
  const parent = all.find((row) => String(row.display_name ?? row.animation_name ?? row.name ?? "").toLowerCase() === animationName.toLowerCase());
  const candidates = parent ? records(parent) : all;
  const selected = candidates.find((row) => String(row.direction ?? "").toLowerCase() === direction.toLowerCase()) ?? null;
  if (!selected) return null;
  const frameUrls = Array.isArray(selected.frames) ? selected.frames.map(imageUrl).filter((url): url is string => Boolean(url)) : [];
  return {
    characterId, animationGroupId: typeof selected.group_id === "string" ? selected.group_id : typeof parent?.group_id === "string" ? parent.group_id : null,
    imageUrl: imageUrl(selected), frameUrls,
    frameCount: Number(selected.frame_count ?? selected.frames_count ?? frameUrls.length ?? 0),
    status: providerStatus(selected),
  };
}

export function providerErrorText(value: unknown): string {
  return values(value).filter((entry): entry is string => typeof entry === "string").join(" ").slice(0, 1000);
}
