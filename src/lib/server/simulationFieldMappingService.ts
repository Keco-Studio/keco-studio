import { completeLlmNonStreaming } from '@/lib/agent/llm-client';
import type { OpenAITool } from '@/lib/agent/types';
import { SIM_FIELDS } from '@/lib/simulation/data';
import type {
  FieldMapping,
  LibraryRole,
  SimulationFieldDefinition,
  StudioColumnDefinition,
} from '@/lib/simulation/types';

const TOOL_NAME = 'submit_simulation_field_mapping';
const CACHE_TTL_MS = 15 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 200;

type CachedMapping = {
  expiresAt: number;
  mappings: FieldMapping;
};

const mappingCache = new Map<string, CachedMapping>();
const pendingMappings = new Map<string, Promise<FieldMapping>>();

const FIELD_MAPPING_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: TOOL_NAME,
    description: 'Return semantic one-to-one mappings from Studio columns to simulation fields.',
    parameters: {
      type: 'object',
      properties: {
        mappings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              canonicalFieldId: { type: 'string' },
              studioColumnId: { type: 'string' },
            },
            required: ['canonicalFieldId', 'studioColumnId'],
            additionalProperties: false,
          },
        },
      },
      required: ['mappings'],
      additionalProperties: false,
    },
  },
};

export interface AiMappingCandidate {
  canonicalFieldId: string;
  studioColumnId: string;
}

function isTypeCompatible(
  field: SimulationFieldDefinition,
  column: StudioColumnDefinition,
): boolean {
  return !column.valueType
    || !field.valueTypes
    || field.valueTypes.includes(column.valueType);
}

export function validateAiMappingCandidates(
  fields: readonly SimulationFieldDefinition[],
  columns: readonly StudioColumnDefinition[],
  candidates: readonly AiMappingCandidate[],
): FieldMapping {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const columnsById = new Map(columns.map((column) => [column.id, column]));
  const usedFields = new Set<string>();
  const usedColumns = new Set<string>();
  const mappings: Record<string, string> = {};

  for (const candidate of candidates) {
    const field = fieldsById.get(candidate.canonicalFieldId);
    const column = columnsById.get(candidate.studioColumnId);
    if (!field || !column) continue;
    if (usedFields.has(field.id) || usedColumns.has(column.id)) continue;
    if (!isTypeCompatible(field, column)) continue;

    mappings[field.id] = column.id;
    usedFields.add(field.id);
    usedColumns.add(column.id);
  }

  return mappings;
}

function parseCandidates(raw: string): AiMappingCandidate[] {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { mappings?: unknown }).mappings)) {
    throw new Error('AI field mapping response is invalid.');
  }

  return (parsed as { mappings: unknown[] }).mappings.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const { canonicalFieldId, studioColumnId } = candidate as Partial<AiMappingCandidate>;
    if (typeof canonicalFieldId !== 'string' || typeof studioColumnId !== 'string') return [];
    return [{ canonicalFieldId, studioColumnId }];
  });
}

function mappingCacheKey(
  role: LibraryRole,
  columns: readonly StudioColumnDefinition[],
): string {
  return JSON.stringify([role, columns.map(({ id, label, valueType }) => [id, label, valueType ?? null])]);
}

function readCachedMapping(key: string): FieldMapping | undefined {
  const cached = mappingCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    mappingCache.delete(key);
    return undefined;
  }
  return cached.mappings;
}

function cacheMapping(key: string, mappings: FieldMapping): void {
  if (Object.keys(mappings).length === 0) return;
  if (mappingCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = mappingCache.keys().next().value;
    if (oldest) mappingCache.delete(oldest);
  }
  mappingCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, mappings });
}

async function requestSimulationFieldMappings(
  role: LibraryRole,
  columns: readonly StudioColumnDefinition[],
): Promise<FieldMapping> {
  const fields = SIM_FIELDS[role];
  const messages = [
    {
      role: 'system' as const,
      content: [
        'Map Studio columns to canonical simulation fields by semantic meaning.',
        'Use exact IDs. Omit uncertain or type-incompatible mappings.',
        'Never reuse a Studio column or canonical field.',
        `Role: ${role}.`,
      ].join(' '),
    },
    {
      role: 'user' as const,
      content: JSON.stringify({
        fields: fields.map((field) => ({
          id: field.id,
          label: field.label,
          aliases: field.aliases ?? [],
          valueTypes: field.valueTypes ?? [],
          allowedValues: field.allowedValues ?? [],
        })),
        columns,
      }),
    },
  ];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const raw = await completeLlmNonStreaming(messages, {
        temperature: 0,
        maxTokens: 2_000,
        thinking: 'disabled',
        tools: [FIELD_MAPPING_TOOL],
        toolName: TOOL_NAME,
      });
      return validateAiMappingCandidates(fields, columns, parseCandidates(raw));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const retryableModelOutput = error instanceof SyntaxError
        || message === 'LLM aborted before completing the response.'
        || message === 'AI field mapping response is invalid.'
        || message.startsWith('LLM did not call required tool');
      if (!retryableModelOutput || attempt === 1) throw error;
    }
  }
  throw new Error('AI field mapping failed.');
}

export async function suggestSimulationFieldMappings(
  role: LibraryRole,
  columns: readonly StudioColumnDefinition[],
): Promise<FieldMapping> {
  const cacheKey = mappingCacheKey(role, columns);
  const cached = readCachedMapping(cacheKey);
  if (cached) return cached;

  const pending = pendingMappings.get(cacheKey);
  if (pending) return pending;

  const request = requestSimulationFieldMappings(role, columns);
  pendingMappings.set(cacheKey, request);
  try {
    const mappings = await request;
    cacheMapping(cacheKey, mappings);
    return mappings;
  } finally {
    pendingMappings.delete(cacheKey);
  }
}
