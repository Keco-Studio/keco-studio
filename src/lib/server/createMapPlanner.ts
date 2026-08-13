import 'server-only';

import { completeLlmNonStreaming, type StreamLlmOptions } from '@/lib/agent/llm-client';
import type { ChatMessage, OpenAITool } from '@/lib/agent/types';
import {
  validateMapPlanV2,
  type MapPlanV2,
  type MapPlanV2Issue,
} from '@/features/create-map/model/mapPlanSchema';
import {
  DIRECT_MAP_PROFILES,
  validateMapPlanV3,
  type MapPlanV3,
  type MapPlanV3Issue,
} from '@/features/create-map/model/directMapSchema';
import type { CreateMapDocumentSource } from './createMapDocumentSource';

const TOOL_NAME = 'submit_map_plan_v2';
const MAX_ATTEMPTS = 3;
const DIRECT_MAP_TOOL_NAME = 'submit_direct_map_plan_v3';
export const DIRECT_MAP_MAX_ATTEMPTS = 2;

const CREATE_MAP_LLM_MODEL = 'deepseek-v4-flash';
const CREATE_MAP_LLM_BASE_URL = 'https://api.deepseek.com';

/**
 * Resolve the planner-only LLM configuration for each request. The generic
 * model and endpoint are intentionally not consulted, so changing assistant
 * settings cannot silently change Map Plan output. A dedicated key is
 * preferred, with the existing server-side key retained as a compatibility
 * fallback for deployments that have not split credentials yet.
 */
export function getCreateMapPlannerLlmOptions(): Pick<StreamLlmOptions, 'model' | 'baseUrl' | 'apiKey'> {
  return {
    model: process.env.CREATE_MAP_LLM_MODEL || CREATE_MAP_LLM_MODEL,
    baseUrl: process.env.CREATE_MAP_LLM_API_URL || CREATE_MAP_LLM_BASE_URL,
    apiKey: process.env.CREATE_MAP_LLM_API_KEY || process.env.LLM_API_KEY || '',
  };
}

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
        visualBrief: { type: 'string', description: 'Concise English art direction for downstream generators.' },
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
            stylePrompt: { type: 'string', description: 'Concise English visual style only; do not list map contents.' },
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
                  id: { type: 'string' }, name: { type: 'string' }, prompt: { type: 'string', description: 'English PixelLab prompt describing only this path material.' },
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
            properties: { assetKey: { type: 'string' }, name: { type: 'string' }, prompt: { type: 'string', description: 'English PixelLab prompt describing only this terrain surface.' } },
            required: ['assetKey', 'name', 'prompt'], additionalProperties: false,
          },
        },
        obstacleAssets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              assetKey: { type: 'string' }, name: { type: 'string' }, prompt: { type: 'string', description: 'English PixelLab prompt describing only this static prop.' },
              size: {
                type: 'object', properties: {
                  width: { type: 'number', minimum: 32, maximum: 400 },
                  height: { type: 'number', minimum: 32, maximum: 400 },
                },
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

const directMapReference = {
  type: 'object',
  properties: {
    assetId: { type: 'string', format: 'uuid' },
    sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    role: { type: 'string', enum: ['content', 'layout'] },
    usage: { type: 'string', minLength: 1, maxLength: 240 },
  },
  required: ['assetId', 'sha256', 'role', 'usage'],
  additionalProperties: false,
};

const directMapStyleReference = {
  type: 'object',
  properties: {
    assetId: { type: 'string', format: 'uuid' },
    sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    copy: {
      type: 'array',
      items: { type: 'string', enum: ['color_palette', 'outline', 'detail', 'shading'] },
      minItems: 1,
      maxItems: 4,
      uniqueItems: true,
    },
  },
  required: ['assetId', 'sha256', 'copy'],
  additionalProperties: false,
};

export const CREATE_DIRECT_MAP_PLAN_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: DIRECT_MAP_TOOL_NAME,
    description: 'Return a complete direct-image MapPlan V3 for PixelLab Pro.',
    parameters: {
      type: 'object',
      properties: {
        schemaVersion: { type: 'integer', const: 3 },
        name: { type: 'string', minLength: 1, maxLength: 160 },
        summary: { type: 'string', minLength: 1, maxLength: 500 },
        map: {
          type: 'object',
          properties: {
            width: { type: 'integer', enum: [512, 688, 384] },
            height: { type: 'integer', enum: [512, 384, 688] },
          },
          required: ['width', 'height'],
          additionalProperties: false,
        },
        description: { type: 'string', minLength: 1, maxLength: 2_000 },
        references: { type: 'array', items: directMapReference, maxItems: 4 },
        styleReference: { oneOf: [{ type: 'null' }, directMapStyleReference] },
        generation: {
          type: 'object',
          properties: {
            provider: { const: 'pixellab' },
            operation: { const: 'create_image_pro' },
            noBackground: { const: false },
            seed: { oneOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
          },
          required: ['provider', 'operation', 'noBackground', 'seed'],
          additionalProperties: false,
        },
      },
      required: ['schemaVersion', 'name', 'summary', 'map', 'description', 'references', 'styleReference', 'generation'],
      additionalProperties: false,
    },
  },
};

export type DirectMapReferenceSelection = Pick<MapPlanV3, 'references' | 'styleReference'>;

export class CreateMapPlannerError extends Error {
  readonly code = 'map_plan_invalid_response' as const;
  constructor(schemaVersion: 2 | 3 = 2) {
    super(`The model did not return a valid MapPlan V${schemaVersion}`);
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

function directMapCorrectionMessage(issues: MapPlanV3Issue[]): ChatMessage {
  return {
    role: 'user',
    content: `Correct the MapPlan V3 candidate and call ${DIRECT_MAP_TOOL_NAME} once more. Validation issues: ${JSON.stringify(
      issues.map(({ code, path, message }) => ({ code, path, message }))
    )}`,
  };
}

function readNullableSeed(candidate: unknown): number | null {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const generation = (candidate as Record<string, unknown>).generation;
  if (!generation || typeof generation !== 'object' || Array.isArray(generation)) return null;
  const seed = (generation as Record<string, unknown>).seed;
  return typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 ? seed : null;
}

function limitModelText(value: unknown, maxLength: number): unknown {
  if (typeof value !== 'string' || value.length <= maxLength) return value;
  const clipped = value.slice(0, maxLength + 1);
  const boundary = clipped.lastIndexOf(' ');
  return clipped.slice(0, boundary > 0 ? boundary : maxLength).trimEnd();
}

export function normalizeDirectMapPlanCandidate(
  candidate: unknown,
  selection: DirectMapReferenceSelection,
): unknown {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
  const record = candidate as Record<string, unknown>;
  const candidateMap = record.map && typeof record.map === 'object' && !Array.isArray(record.map)
    ? record.map as Record<string, unknown>
    : {};
  const width = typeof candidateMap.width === 'number' ? candidateMap.width : 512;
  const height = typeof candidateMap.height === 'number' ? candidateMap.height : 512;
  const profile = DIRECT_MAP_PROFILES.reduce((closest, current) => {
    const closestDistance = (closest.width - width) ** 2 + (closest.height - height) ** 2;
    const currentDistance = (current.width - width) ** 2 + (current.height - height) ** 2;
    return currentDistance < closestDistance ? current : closest;
  });
  return {
    ...record,
    schemaVersion: 3,
    name: limitModelText(record.name, 160),
    summary: limitModelText(record.summary, 500),
    map: { ...profile },
    description: limitModelText(record.description, 2_000),
    references: selection.references,
    styleReference: selection.styleReference,
    generation: {
      provider: 'pixellab', operation: 'create_image_pro', noBackground: false,
      seed: readNullableSeed(candidate),
    },
  };
}

function providerPromptIssues(plan: MapPlanV2): MapPlanV2Issue[] {
  const cjk = /[\u3400-\u9fff]/;
  const entries: Array<{ path: Array<string | number>; value: string }> = [
    { path: ['visualBrief'], value: plan.visualBrief },
    { path: ['background', 'stylePrompt'], value: plan.background.stylePrompt },
    ...plan.terrains.map((terrain, index) => ({ path: ['terrains', index, 'prompt'], value: terrain.prompt })),
    ...plan.background.paths.map((path, index) => ({ path: ['background', 'paths', index, 'prompt'], value: path.prompt })),
    ...plan.obstacleAssets.map((asset, index) => ({ path: ['obstacleAssets', index, 'prompt'], value: asset.prompt })),
  ];
  const issues: MapPlanV2Issue[] = entries.flatMap((entry) => cjk.test(entry.value) ? [{
    code: 'invalid_schema' as const,
    path: entry.path,
    message: 'Generation-facing prompts must be concise English and describe only this resource.',
  }] : []);
  const columns = plan.map.width / plan.map.tileSize;
  const rows = plan.map.height / plan.map.tileSize;
  const contains = (point: { x: number; y: number }, polygon: Array<{ x?: number; y?: number }>) => {
    let inside = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
      const current = polygon[index];
      const prior = polygon[previous];
      const currentX = Number(current.x);
      const currentY = Number(current.y);
      const priorX = Number(prior.x);
      const priorY = Number(prior.y);
      const crosses = (currentY > point.y) !== (priorY > point.y)
        && point.x < ((priorX - currentX) * (point.y - currentY)) / (priorY - currentY) + currentX;
      if (crosses) inside = !inside;
    }
    return inside;
  };
  const coverage = plan.background.regions.map((region) => {
    const cells = new Set<string>();
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const center = { x: (x + 0.5) * plan.map.tileSize, y: (y + 0.5) * plan.map.tileSize };
        if (contains(center, region.points)) cells.add(`${x}:${y}`);
      }
    }
    return cells;
  });
  coverage.forEach((cells, index) => {
    const duplicate = coverage.findIndex((candidate, prior) => prior < index
      && candidate.size === cells.size && [...cells].every((cell) => candidate.has(cell)));
    if (duplicate >= 0) issues.push({
      code: 'invalid_polygon',
      path: ['background', 'regions', index, 'points'],
      message: `Terrain region duplicates the raster coverage of region ${duplicate}; use distinct nested outer/inner polygons for banks and water.`,
    });
  });
  plan.background.paths.forEach((path, index) => {
    const supportingTerrain = plan.terrains.find((terrain) => terrain.assetKey === path.terrainKey);
    const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (supportingTerrain && normalized(supportingTerrain.prompt) === normalized(path.prompt)) {
      issues.push({
        code: 'invalid_schema',
        path: ['background', 'paths', index, 'terrainKey'],
        message: 'Path terrainKey must reference the supporting ground below the path, not a duplicate terrain copy of the path material.',
      });
    }
    const diagonalSegment = path.points.findIndex((point, pointIndex) => {
      if (pointIndex === 0) return false;
      const previous = path.points[pointIndex - 1];
      return point.x !== previous.x && point.y !== previous.y;
    });
    if (diagonalSegment >= 0) {
      issues.push({
        code: 'invalid_schema',
        path: ['background', 'paths', index, 'points', diagonalSegment],
        message: 'Generated path centerlines must use explicit horizontal and vertical segments; add an orthogonal turn point instead of a long diagonal segment.',
      });
    }
  });
  return issues;
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

function normalizeOrthogonalPathPoints(values: unknown[]): unknown[] {
  const points = values.map(normalizePoint);
  const output: unknown[] = [];
  for (const point of points) {
    const previous = output.at(-1);
    if (
      previous && point && typeof previous === 'object' && !Array.isArray(previous) &&
      typeof point === 'object' && !Array.isArray(point)
    ) {
      const start = previous as Record<string, unknown>;
      const end = point as Record<string, unknown>;
      if (
        typeof start.x === 'number' && typeof start.y === 'number' &&
        typeof end.x === 'number' && typeof end.y === 'number' &&
        start.x !== end.x && start.y !== end.y
      ) {
        output.push({ x: end.x, y: start.y });
      }
    }
    output.push(point);
  }
  return output;
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
          path.points = normalizeOrthogonalPathPoints(path.points);
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
        'Write visualBrief, background.stylePrompt, and every terrain/path/obstacle prompt in concise English even when the user writes another language.',
        'Each resource prompt must describe only that material or prop; never copy the complete scene contents into an individual asset prompt.',
        'Terrain regions are applied in array order. For a shoreline, define a larger outer bank region first and a smaller inner water region second; never reuse the same polygon for both.',
        'A path terrainKey is the supporting ground beneath it (for example grass below a road or water below a bridge). Never duplicate a road, river, or bridge material in terrains.',
        'PixelLab path tiles use cardinal connectivity. Build every generated path from explicit horizontal and vertical segments; add orthogonal turn points instead of diagonal segments.',
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
        ...getCreateMapPlannerLlmOptions(),
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
    const issues: MapPlanV2Issue[] = 'issues' in result
      ? result.issues
      : providerPromptIssues(result.data);
    if (result.success && issues.length === 0) return result.data;
    if (attempt < MAX_ATTEMPTS - 1) {
      messages.push({ role: 'assistant', content: JSON.stringify(normalized) });
      messages.push(correctionMessage(issues));
    }
  }
  throw new CreateMapPlannerError();
}

export async function createMapPlanV3(
  descriptionInput: string,
  source?: CreateMapDocumentSource,
  selection: DirectMapReferenceSelection = { references: [], styleReference: null },
): Promise<MapPlanV3> {
  const description = descriptionInput.trim();
  if (!description) throw new CreateMapPlannerInputError();
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'Create a complete direct-image MapPlan V3.',
        'The user description is authoritative; optional Document text is supporting context only.',
        'Write the final PixelLab create_image_pro description in English as one complete scene description.',
        'The final description must cover camera and top-down projection, composition, terrain, routes, landmarks, buildings, vegetation, lighting, palette, pixel-art treatment, and exclusions.',
        'Do not include URLs, data URIs, credentials, provider instructions, PixelLab, MCP, API commands, or dynamic Keco UI text in the description.',
        'Use exactly one supported profile: 512x512, 688x384, or 384x688.',
        `Call ${DIRECT_MAP_TOOL_NAME} with the complete plan.`,
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

  for (let attempt = 0; attempt < DIRECT_MAP_MAX_ATTEMPTS; attempt += 1) {
    let raw: string;
    try {
      raw = await completeLlmNonStreaming(messages, {
        ...getCreateMapPlannerLlmOptions(),
        temperature: 0,
        thinking: 'disabled',
        maxTokens: 4_000,
        tools: [CREATE_DIRECT_MAP_PLAN_TOOL],
        toolName: DIRECT_MAP_TOOL_NAME,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const invalidOutput = message.includes('required tool') || message.includes('valid JSON') ||
        message.includes('did not contain a completion');
      if (!invalidOutput) throw error;
      if (attempt === DIRECT_MAP_MAX_ATTEMPTS - 1) throw new CreateMapPlannerError(3);
      messages.push(directMapCorrectionMessage([
        { code: 'invalid_schema', path: [], message: 'Model did not submit structured output' },
      ]));
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
    const finalized = normalizeDirectMapPlanCandidate(parsed, selection);
    const result = validateMapPlanV3(finalized);
    if (result.success === true) return result.data;
    if (attempt < DIRECT_MAP_MAX_ATTEMPTS - 1) {
      messages.push({ role: 'assistant', content: JSON.stringify(finalized) });
      messages.push(directMapCorrectionMessage(result.issues));
    }
  }
  throw new CreateMapPlannerError(3);
}
