import 'server-only';

import sharp from 'sharp';
import { completeLlmNonStreaming } from '@/lib/agent/llm-client';
import type { ChatMessage, OpenAITool } from '@/lib/agent/types';
import {
  DIRECT_MAP_COLLISION_CELL_SIZE,
  DirectMapCollisionGridSchema,
  type DirectMapCollisionGrid,
} from '@/features/create-map/model/directMapCollisionGrid';

const TOOL_NAME = 'submit_collision_grid_v1';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_REGION_CELLS = 32;

export type CreateMapCollisionAnalyzerErrorCode =
  | 'vision_not_configured'
  | 'vision_upstream_error'
  | 'collision_grid_invalid_response';

export class CreateMapCollisionAnalyzerError extends Error {
  constructor(readonly code: CreateMapCollisionAnalyzerErrorCode) {
    super(code);
    this.name = 'CreateMapCollisionAnalyzerError';
  }
}

export const CREATE_MAP_COLLISION_GRID_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: TOOL_NAME,
    description: 'Submit the complete row-major collision classification for the supplied map image.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['rows'],
      properties: {
        rows: {
          type: 'array',
          description: 'One top-to-bottom grid row per string. Each character is 0 or 1.',
          items: { type: 'string', pattern: '^[01]+$' },
        },
      },
    },
  },
};

function createCollisionGridTool(columns: number, rows: number): OpenAITool {
  return {
    type: 'function',
    function: {
      ...CREATE_MAP_COLLISION_GRID_TOOL.function,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['rows'],
        properties: {
          rows: {
            type: 'array',
            description: `Exactly ${rows} top-to-bottom grid rows.`,
            minItems: rows,
            maxItems: rows,
            items: {
              type: 'string',
              pattern: '^[01]+$',
              minLength: columns,
              maxLength: columns,
            },
          },
        },
      },
    },
  };
}

type AnalyzerInput = {
  pngBytes: Uint8Array;
  imageSha256: string;
  width: number;
  height: number;
};

function resolveVisionConfig(): { baseUrl: string; apiKey: string; model: string } {
  const baseUrl = (
    process.env.CREATE_MAP_VISION_API_URL?.trim()
    || process.env.EMBEDDING_API_URL?.trim()
    || 'https://api.minimax.io'
  ).replace(/\/+$/, '');
  const apiKey = process.env.CREATE_MAP_VISION_API_KEY?.trim()
    || process.env.MINIMAX_API_KEY?.trim()
    || process.env.EMBEDDING_API_KEY?.trim()
    || '';
  const model = process.env.CREATE_MAP_VISION_MODEL?.trim()
    || 'MiniMax-M3';
  if (!baseUrl || !apiKey || !model) throw new CreateMapCollisionAnalyzerError('vision_not_configured');
  return { baseUrl, apiKey, model };
}

type CollisionRegion = {
  column: number;
  row: number;
  columns: number;
  rows: number;
};

function createRegions(columns: number, rows: number): CollisionRegion[] {
  const regions: CollisionRegion[] = [];
  for (let row = 0; row < rows; row += MAX_REGION_CELLS) {
    for (let column = 0; column < columns; column += MAX_REGION_CELLS) {
      regions.push({
        column,
        row,
        columns: Math.min(MAX_REGION_CELLS, columns - column),
        rows: Math.min(MAX_REGION_CELLS, rows - row),
      });
    }
  }
  return regions;
}

function parseRows(
  raw: string,
  columns: number,
  rows: number,
): { cells: Array<0 | 1> } | { issue: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { issue: 'Return valid JSON tool arguments.' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { issue: 'Tool arguments must be an object containing rows.' };
  }
  const keys = Object.keys(value);
  const candidateRows = (value as { rows?: unknown }).rows;
  if (keys.length !== 1 || keys[0] !== 'rows' || !Array.isArray(candidateRows)) {
    return { issue: 'Tool arguments must contain only the rows array.' };
  }
  if (candidateRows.length !== rows) {
    return { issue: `Expected exactly ${rows} rows; received ${candidateRows.length}.` };
  }
  const cells: Array<0 | 1> = [];
  for (let row = 0; row < candidateRows.length; row += 1) {
    const line = candidateRows[row];
    if (typeof line !== 'string' || !/^[01]+$/.test(line)) {
      return { issue: `Row ${row + 1} must contain only 0 or 1.` };
    }
    if (line.length !== columns) {
      return { issue: `Row ${row + 1} must contain exactly ${columns} cells; received ${line.length}.` };
    }
    for (const character of line) cells.push(Number(character) as 0 | 1);
  }
  return { cells };
}

export async function analyzeCreateMapCollisionGrid(
  input: AnalyzerInput,
): Promise<DirectMapCollisionGrid> {
  const config = resolveVisionConfig();
  if (!SHA256_PATTERN.test(input.imageSha256)) {
    throw new CreateMapCollisionAnalyzerError('collision_grid_invalid_response');
  }
  const columns = input.width / DIRECT_MAP_COLLISION_CELL_SIZE;
  const rows = input.height / DIRECT_MAP_COLLISION_CELL_SIZE;
  if (!Number.isInteger(columns) || !Number.isInteger(rows)) {
    throw new CreateMapCollisionAnalyzerError('collision_grid_invalid_response');
  }

  const analyzeRegion = async (region: CollisionRegion): Promise<Array<0 | 1>> => {
    const regionBytes = await sharp(input.pngBytes)
      .extract({
        left: region.column * DIRECT_MAP_COLLISION_CELL_SIZE,
        top: region.row * DIRECT_MAP_COLLISION_CELL_SIZE,
        width: region.columns * DIRECT_MAP_COLLISION_CELL_SIZE,
        height: region.rows * DIRECT_MAP_COLLISION_CELL_SIZE,
      })
      .png()
      .toBuffer();
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'Classify walkability in this cropped region of a top-down game map. Call the required tool immediately and do not omit any cells.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              `Analyze this crop as exactly ${region.columns} columns by ${region.rows} rows.`,
              `Every cell represents ${DIRECT_MAP_COLLISION_CELL_SIZE}x${DIRECT_MAP_COLLISION_CELL_SIZE} pixels.`,
              'Use 0 for walkable ground, roads, bridges, doors, and intentional entrances.',
              'Use 1 for buildings, walls, cliffs, dense tree footprints, deep water, rocks, and sealed boundaries.',
              'Return rows from top to bottom and cells from left to right.',
            ].join(' '),
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${regionBytes.toString('base64')}`,
              detail: 'high',
            },
          },
        ],
      },
    ];
    const collisionGridTool = createCollisionGridTool(region.columns, region.rows);

    for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw: string;
    try {
      raw = await completeLlmNonStreaming(messages, {
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        temperature: 0,
        thinking: 'disabled',
        maxCompletionTokens: 8_000,
        tools: [collisionGridTool],
        toolName: TOOL_NAME,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes(`required tool ${TOOL_NAME}`) && attempt === 0) {
        messages.push({ role: 'user', content: `You must call ${TOOL_NAME} with the complete grid.` });
        continue;
      }
      if (error instanceof Error && error.message.includes(`required tool ${TOOL_NAME}`)) {
        throw new CreateMapCollisionAnalyzerError('collision_grid_invalid_response');
      }
      throw new CreateMapCollisionAnalyzerError('vision_upstream_error');
    }
      const parsed = parseRows(raw, region.columns, region.rows);
    if ('cells' in parsed) {
        return parsed.cells;
    }
    if (attempt === 0) {
      messages.push({ role: 'assistant', content: raw });
      messages.push({ role: 'user', content: `Correct the tool output. ${parsed.issue}` });
    }
    }
    throw new CreateMapCollisionAnalyzerError('collision_grid_invalid_response');
  };

  let analyzedRegions: Array<{ region: CollisionRegion; cells: Array<0 | 1> }>;
  try {
    analyzedRegions = await Promise.all(createRegions(columns, rows).map(async (region) => ({
      region,
      cells: await analyzeRegion(region),
    })));
  } catch (error) {
    if (error instanceof CreateMapCollisionAnalyzerError) throw error;
    throw new CreateMapCollisionAnalyzerError('vision_upstream_error');
  }
  const cells = Array.from({ length: columns * rows }, () => 0 as 0 | 1);
  for (const analyzed of analyzedRegions) {
    analyzed.cells.forEach((cell, index) => {
      const localRow = Math.floor(index / analyzed.region.columns);
      const localColumn = index % analyzed.region.columns;
      cells[(analyzed.region.row + localRow) * columns + analyzed.region.column + localColumn] = cell;
    });
  }
  return DirectMapCollisionGridSchema.parse({
    version: 1,
    cellSize: DIRECT_MAP_COLLISION_CELL_SIZE,
    columns,
    rows,
    cells,
    imageSha256: input.imageSha256,
  });
}
