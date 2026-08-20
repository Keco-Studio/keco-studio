import { createHash } from 'node:crypto';

export type GeneratedResourceKind =
  | 'gdd_document'
  | 'table'
  | 'dialogue_document'
  | 'script_table';

export type ExistingGeneratedResource = {
  kind: GeneratedResourceKind;
  logicalKey: string;
  resourceId: string;
  contentHash: string;
};

export type NextGeneratedResource = ExistingGeneratedResource;

export type ResourceChangeSummary = {
  created: string[];
  updated: string[];
  reused: string[];
  preserved: string[];
};

export type ClassifiedGeneratedResources = {
  created: NextGeneratedResource[];
  updated: ExistingGeneratedResource[];
  reused: ExistingGeneratedResource[];
  preserved: ExistingGeneratedResource[];
};

export function normalizeGddLogicalKey(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
  if (!normalized || normalized.length > 160) {
    throw new Error('Invalid GDD logical key.');
  }
  return normalized;
}

function resourceKey(resource: Pick<ExistingGeneratedResource, 'kind' | 'logicalKey'>): string {
  return `${resource.kind}:${normalizeGddLogicalKey(resource.logicalKey)}`;
}

export function classifyGeneratedResources(
  existing: readonly ExistingGeneratedResource[],
  next: readonly NextGeneratedResource[],
): ClassifiedGeneratedResources {
  const existingByKey = new Map(existing.map((resource) => [resourceKey(resource), resource]));
  const seen = new Set<string>();
  const created: NextGeneratedResource[] = [];
  const updated: ExistingGeneratedResource[] = [];
  const reused: ExistingGeneratedResource[] = [];

  for (const candidate of next) {
    const key = resourceKey(candidate);
    if (seen.has(key)) throw new Error(`Duplicate generated resource key: ${key}`);
    seen.add(key);
    const current = existingByKey.get(key);
    if (!current) {
      created.push({ ...candidate, logicalKey: normalizeGddLogicalKey(candidate.logicalKey) });
    } else if (current.contentHash === candidate.contentHash) {
      reused.push(current);
    } else {
      updated.push(current);
    }
  }

  return {
    created,
    updated,
    reused,
    preserved: existing.filter((resource) => !seen.has(resourceKey(resource))),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function sha256CanonicalJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  if (serialized === undefined) throw new TypeError('Value is not JSON serializable.');
  return sha256(serialized);
}

export function hashNormalizedMarkdown(markdown: string): string {
  const normalized = markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
  return sha256(normalized);
}
