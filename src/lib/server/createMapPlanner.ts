import 'server-only';

import { completeLlmNonStreaming } from '@/lib/agent/llm-client';
import type { ChatMessage, OpenAITool } from '@/lib/agent/types';
import {
  validateMapPlanV2,
  type MapPlanV2,
  type MapPlanV2Issue,
} from '@/features/create-map/model/mapPlanSchema';
import type { CreateMapDocumentSource } from './createMapDocumentSource';

const TOOL_NAME = 'submit_map_plan_v2';
const MAX_ATTEMPTS = 2;

const point = {
  type: 'object',
  properties: {
    x: { type: 'number', description: 'Horizontal map-space pixel coordinate.' },
    y: { type: 'number', description: 'Vertical map-space pixel coordinate.' },
  },
  required: ['x', 'y'],
  additionalProperties: false,
};

const localCollision = {
  oneOf: [
    {
      type: 'object',
      properties: {
        shape: { const: 'rectangle' }, x: { type: 'number' }, y: { type: 'number' },
        width: { type: 'number' }, height: { type: 'number' },
      },
      required: ['shape', 'x', 'y', 'width', 'height'], additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        shape: { const: 'circle' }, cx: { type: 'number' }, cy: { type: 'number' }, radius: { type: 'number' },
      },
      required: ['shape', 'cx', 'cy', 'radius'], additionalProperties: false,
    },
    {
      type: 'object',
      properties: { shape: { const: 'polygon' }, points: { type: 'array', items: point, minItems: 3 } },
      required: ['shape', 'points'], additionalProperties: false,
    },
  ],
};

export const CREATE_MAP_PLAN_V2_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: TOOL_NAME,
    description: 'Return a complete provider-independent layered top-down MapPlan V2.',
    parameters: {
      type: 'object',
      properties: {
        schemaVersion: { type: 'integer', const: 2 },
        name: { type: 'string' },
        visualBrief: { type: 'string' },
        map: {
          type: 'object',
          properties: {
            width: { type: 'integer', description: 'Total map width in pixels and divisible by tileSize.' },
            height: { type: 'integer', description: 'Total map height in pixels and divisible by tileSize.' },
            tileSize: { type: 'integer', enum: [16, 32, 48, 64] },
            projection: { const: 'top-down' },
          },
          required: ['width', 'height', 'tileSize', 'projection'], additionalProperties: false,
        },
        background: {
          type: 'object',
          properties: {
            stylePrompt: { type: 'string' },
            palette: { type: 'array', items: { type: 'string' }, minItems: 1 },
            baseTerrainKey: { type: 'string' },
            regions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' }, terrainKey: { type: 'string' },
                  points: { type: 'array', items: point, minItems: 3 },
                },
                required: ['id', 'terrainKey', 'points'], additionalProperties: false,
              },
            },
            paths: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' }, name: { type: 'string' }, prompt: { type: 'string' },
                  kind: { enum: ['road', 'river'] }, assetKey: { type: 'string' },
                  terrainKey: { type: 'string' }, width: { type: 'number' }, zIndex: { type: 'integer' },
                  points: { type: 'array', items: point, minItems: 2 },
                },
                required: ['id', 'name', 'prompt', 'kind', 'assetKey', 'terrainKey', 'width', 'zIndex', 'points'],
                additionalProperties: false,
              },
            },
          },
          required: ['stylePrompt', 'palette', 'baseTerrainKey', 'regions', 'paths'], additionalProperties: false,
        },
        terrains: {
          type: 'array', minItems: 1,
          items: {
            type: 'object',
            properties: { assetKey: { type: 'string' }, name: { type: 'string' }, prompt: { type: 'string' } },
            required: ['assetKey', 'name', 'prompt'], additionalProperties: false,
          },
        },
        obstacleAssets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              assetKey: { type: 'string' }, name: { type: 'string' }, prompt: { type: 'string' },
              size: {
                type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' } },
                required: ['width', 'height'], additionalProperties: false,
              },
              groundAnchor: point,
            },
            required: ['assetKey', 'name', 'prompt', 'size', 'groundAnchor'], additionalProperties: false,
          },
        },
        obstaclePlacements: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' }, assetKey: { type: 'string' }, position: point,
              scale: { type: 'number' }, rotation: { type: 'number' }, zIndex: { type: 'integer' },
              collision: localCollision,
            },
            required: ['id', 'assetKey', 'position', 'scale', 'rotation', 'zIndex', 'collision'],
            additionalProperties: false,
          },
        },
      },
      required: [
        'schemaVersion', 'name', 'visualBrief', 'map', 'background',
        'terrains', 'obstacleAssets', 'obstaclePlacements',
      ],
      additionalProperties: false,
    },
  },
};

export const CREATE_MAP_PLAN_TOOL = CREATE_MAP_PLAN_V2_TOOL;

export class CreateMapPlannerError extends Error {
  readonly code = 'map_plan_invalid_response' as const;
  constructor() {
    super('The model did not return a valid MapPlan V2');
    this.name = 'CreateMapPlannerError';
  }
}

export class CreateMapPlannerInputError extends Error {
  readonly code = 'map_description_required' as const;
  constructor() {
    super('Map description is required');
    this.name = 'CreateMapPlannerInputError';
  }
}

function correctionMessage(issues: MapPlanV2Issue[]): ChatMessage {
  return {
    role: 'user',
    content: `Correct the normalized MapPlan V2 candidate and call ${TOOL_NAME} once more. Validation issues: ${JSON.stringify(
      issues.map(({ code, path, message }) => ({ code, path, message }))
    )}`,
  };
}

type GridDimensions = { columns: number; rows: number };

function declaredGrid(text: string): GridDimensions | null {
  const match = text.match(/\b(\d{1,4})\s*(?:x|\u00d7|by)\s*(\d{1,4})\s*(?:tiles?|\u683c)/i);
  if (!match) return null;
  const columns = Number(match[1]);
  const rows = Number(match[2]);
  return columns > 0 && rows > 0 ? { columns, rows } : null;
}

function finiteNumber(value: unknown): unknown {
  if (typeof value !== 'string' || value.trim() === '') return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

function normalizeRecord(value: unknown, numericKeys: string[] = []): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = { ...(value as Record<string, unknown>) };
  numericKeys.forEach((key) => {
    if (key in record) record[key] = finiteNumber(record[key]);
  });
  return record;
}

function normalizePoint(value: unknown): unknown {
  return normalizeRecord(value, ['x', 'y']);
}

function normalizeCollision(value: unknown): unknown {
  const collision = normalizeRecord(value, ['x', 'y', 'width', 'height', 'cx', 'cy', 'radius']);
  if (!collision) return collision;
  if (Array.isArray(collision.points)) collision.points = collision.points.map(normalizePoint);
  return collision;
}

export function normalizeMapPlanV2Candidate(input: unknown, grid: GridDimensions | null = null): unknown {
  const candidate = normalizeRecord(input);
  if (!candidate) return candidate;
  candidate.schemaVersion = finiteNumber(candidate.schemaVersion);
  candidate.map = normalizeRecord(candidate.map, ['width', 'height', 'tileSize']);
  if (grid && candidate.map && typeof candidate.map === 'object' && !Array.isArray(candidate.map)) {
    const map = candidate.map as Record<string, unknown>;
    if (map.width === grid.columns && map.height === grid.rows && typeof map.tileSize === 'number') {
      map.width = grid.columns * map.tileSize;
      map.height = grid.rows * map.tileSize;
    }
  }
  candidate.background = normalizeRecord(candidate.background);
  if (candidate.background && typeof candidate.background === 'object' && !Array.isArray(candidate.background)) {
    const background = candidate.background as Record<string, unknown>;
    if (Array.isArray(background.regions)) {
      background.regions = background.regions.map((value) => {
        const region = normalizeRecord(value);
        if (region && Array.isArray(region.points)) {
          region.points = region.points.map(normalizePoint);
        }
        return region;
      });
    }
    if (Array.isArray(background.paths)) {
      background.paths = background.paths.map((value) => {
        const path = normalizeRecord(value, ['width', 'zIndex']);
        if (path && Array.isArray(path.points)) {
          path.points = path.points.map(normalizePoint);
        }
        return path;
      });
    }
  }
  if (Array.isArray(candidate.obstacleAssets)) {
    candidate.obstacleAssets = candidate.obstacleAssets.map((value) => {
      const asset = normalizeRecord(value);
      if (asset) {
        asset.size = normalizeRecord(asset.size, ['width', 'height']);
        asset.groundAnchor = normalizePoint(asset.groundAnchor);
      }
      return asset;
    });
  }
  if (Array.isArray(candidate.obstaclePlacements)) {
    candidate.obstaclePlacements = candidate.obstaclePlacements.map((value) => {
      const placement = normalizeRecord(value, ['scale', 'rotation', 'zIndex']);
      if (placement) {
        placement.position = normalizePoint(placement.position);
        placement.collision = normalizeCollision(placement.collision);
      }
      return placement;
    });
  }
  return candidate;
}

export async function createMapPlanV2(
  descriptionInput: string,
  source?: CreateMapDocumentSource
): Promise<MapPlanV2> {
  const description = descriptionInput.trim();
  if (!description) throw new CreateMapPlannerInputError();
  const grid = declaredGrid(description) ?? (source ? declaredGrid(source.markdown) : null);
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'Create a complete editable layered MapPlan V2.',
        'The user description is authoritative; optional Document text is supporting context only.',
        'Use top-down projection. Width, height, regions, paths, placements, anchors, and collisions use map-space pixels.',
        'Width and height must divide evenly by tileSize. Keep every terrain polygon and path point inside map bounds.',
        'Every region and path must reference declared terrain or path asset keys.',
        'PixelLab creates resource images only; Keco owns layout and local collision geometry.',
        'Use stable unique kebab-case asset keys and stable IDs.',
        `Call ${TOOL_NAME} with the complete plan.`,
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        description,
        document: source ? { name: source.documentName, markdown: source.markdown } : null,
      }),
    },
  ];

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let raw: string;
    try {
      raw = await completeLlmNonStreaming(messages, {
        temperature: 0,
        thinking: 'disabled',
        maxTokens: 8_000,
        tools: [CREATE_MAP_PLAN_V2_TOOL],
        toolName: TOOL_NAME,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const invalidOutput = message.includes('required tool') || message.includes('valid JSON') ||
        message.includes('did not contain a completion');
      if (!invalidOutput) throw error;
      if (attempt === MAX_ATTEMPTS - 1) throw new CreateMapPlannerError();
      messages.push(correctionMessage([{ code: 'invalid_schema', path: [], message: 'Model did not submit structured output' }]));
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
    const normalized = normalizeMapPlanV2Candidate(parsed, grid);
    const result = validateMapPlanV2(normalized);
    if (result.success) return result.data;
    if (attempt < MAX_ATTEMPTS - 1) {
      messages.push({ role: 'assistant', content: JSON.stringify(normalized) });
      messages.push(correctionMessage(result.success === false ? result.issues : []));
    }
  }
  throw new CreateMapPlannerError();
}
