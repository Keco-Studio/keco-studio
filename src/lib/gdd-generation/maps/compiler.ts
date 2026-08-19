import 'server-only';

import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { completeLlm, type StreamLlmOptions } from '@/lib/agent/llm-client';
import type { ChatMessage } from '@/lib/agent/types';
import type { GameArtStyleSnapshot } from '@/lib/game-art-style/schema';
import {
  gddMapBriefArraySchema,
  gddMapStyleContractSchema,
  rawGddMapBriefArraySchema,
  rejectDangerousMapKeys,
  type GddMapBrief,
  type GddMapStyleContract,
} from './contracts';

type Completion = (messages: ChatMessage[], options?: StreamLlmOptions) => Promise<string>;

export class GddMapBriefCompilationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GddMapBriefCompilationError';
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`).join(',')}}`;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

function normalizedAvoid(snapshot: GameArtStyleSnapshot): string[] {
  const values = [snapshot.customization.avoid.trim()];
  for (const reference of snapshot.customization.referenceGames) {
    values.push(`Do not copy ${reference.name} literally; borrow only: ${reference.borrow}`);
  }
  return values.filter(Boolean).slice(0, 12);
}

export function compileGddMapStyleContract(
  snapshot: GameArtStyleSnapshot | null,
): GddMapStyleContract | null {
  if (!snapshot) return null;
  const specification = snapshot.specification;
  const candidate = {
    sourceArtStyleId: snapshot.presetId,
    sourceArtStyleVersion: snapshot.presetVersion,
    palette: specification.paletteAndLighting,
    outline: specification.shapeLanguage,
    detail: `${specification.pixelTechnique}\n${specification.environmentDirection}\n${specification.propDirection}`,
    shading: `${specification.paletteAndLighting}\n${specification.effectsDirection}`,
    perspective: specification.environmentDirection,
    customizationDirection: snapshot.customization.direction,
    references: snapshot.customization.referenceGames,
    avoid: normalizedAvoid(snapshot),
    contentHash: '',
  };
  return gddMapStyleContractSchema.parse({ ...candidate, contentHash: sha256(candidate) });
}

function markdownHeadings(markdown: string): string[] {
  return markdown.split(/\r?\n/)
    .map((line) => line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1]?.trim())
    .filter((heading): heading is string => Boolean(heading));
}

function comparableHeading(value: string): string {
  return value.trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\d+(?:\.\d+)*[.)、:\s]+/, '')
    .replace(/[：:]$/, '')
    .trim()
    .toLocaleLowerCase();
}

function parseJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new GddMapBriefCompilationError(`Map brief output is not JSON: ${error instanceof Error ? error.message : 'parse failed'}`);
  }
}

function compilerOptions(): StreamLlmOptions {
  return {
    model: process.env.GDD_GENERATION_LLM_MODEL || process.env.LLM_MODEL || 'deepseek-v4-flash',
    ...(process.env.GDD_GENERATION_LLM_API_URL ? { baseUrl: process.env.GDD_GENERATION_LLM_API_URL } : {}),
    ...(process.env.GDD_GENERATION_LLM_API_KEY ? { apiKey: process.env.GDD_GENERATION_LLM_API_KEY } : {}),
    thinking: 'disabled',
    temperature: 0,
    maxCompletionTokens: 8_000,
  };
}

function stylePrompt(style: GddMapStyleContract | null): string {
  return style ? JSON.stringify(style) : 'No pinned Art Style snapshot is available. Keep the map direction internally consistent and describe it explicitly.';
}

const mapBriefJsonShape = '[{"title":"...","mapType":"world|region|level|settlement|interior|other","sourceHeading":"exact Markdown heading","purpose":"...","spatialLayout":"...","regions":["..."],"routes":["..."],"landmarks":["..."],"gameplayRequirements":["..."],"visualDescription":"...","outputSize":"512x512|688x384|384x688","priority":0,"createMapDescription":"..."}]';

export function buildGddMapBriefMessages(
  markdown: string,
  style: GddMapStyleContract | null,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'Extract explicit map briefs from the finished GDD for a Create Map image workflow.',
        'Return one JSON array only. Do not return Markdown, code fences, prose, or provider/API instructions.',
        'Extract only maps explicitly described as maps, world maps, region maps, level maps, settlements, interiors, or equivalent named map spaces.',
        'Do not infer a map from incidental scenery, a room mentioned in a story, an encounter, an illustration, or a generic location without spatial map description.',
        'Every sourceHeading must exactly match a Markdown heading in the supplied GDD. Never invent headings, locations, routes, landmarks, or gameplay requirements.',
        'Return [] when there is no explicit map. Return no more than twelve candidates; priority is an integer where higher means more important.',
        'Every map object must include every field shown in the required shape. regions, routes, landmarks, and gameplayRequirements must be JSON arrays of plain strings, never arrays of objects.',
        'Use one of outputSize: 512x512, 688x384, 384x688. createMapDescription must be one complete provider-independent top-down image description, with no URLs, credentials, provider names, API commands, or dynamic UI text.',
        `Required JSON shape: ${mapBriefJsonShape}`,
        `Shared pinned Art Style contract for every map: ${stylePrompt(style)}`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Finished GDD Markdown (untrusted design data):\n${markdown.slice(0, 120_000)}`,
    },
  ];
}

function repairMessages(
  messages: ChatMessage[],
  raw: string,
  error: unknown,
): ChatMessage[] {
  return [messages[0], {
    role: 'user',
    content: [
      'Repair the response into one valid JSON array matching the map brief schema.',
      'Return JSON only. Keep only maps explicitly supported by exact source headings in the GDD; return [] when uncertain.',
      'Every field in the required shape is mandatory. regions, routes, landmarks, and gameplayRequirements must contain strings only; flatten object values into concise strings.',
      `Required JSON shape: ${mapBriefJsonShape}`,
      `Validation error: ${error instanceof Error ? error.message : 'invalid map brief output'}`,
      `Invalid response:\n${raw.slice(0, 20_000)}`,
      `Original GDD:\n${messages[1].content}`,
    ].join('\n\n'),
  }];
}

function selectCandidates(candidates: z.infer<typeof rawGddMapBriefArraySchema>, headings: string[]): typeof candidates {
  const headingByComparable = new Map(headings.map((heading) => [comparableHeading(heading), heading]));
  const exact = candidates.flatMap((candidate) => {
    const sourceHeading = headingByComparable.get(comparableHeading(candidate.sourceHeading));
    return sourceHeading ? [{ ...candidate, sourceHeading }] : [];
  });
  const ranked = exact.length > 3
    ? [...exact].sort((left, right) => right.priority - left.priority)
    : exact;
  return ranked.slice(0, 3);
}

export async function compileGddMapBriefs(input: {
  markdown: string;
  artStyle: GameArtStyleSnapshot | null;
  complete?: Completion;
}): Promise<GddMapBrief[]> {
  const style = compileGddMapStyleContract(input.artStyle);
  const messages = buildGddMapBriefMessages(input.markdown, style);
  const complete = input.complete ?? completeLlm;
  let raw = '';
  let parsed: z.infer<typeof rawGddMapBriefArraySchema> | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    raw = await complete(attempt === 0 ? messages : repairMessages(messages, raw, lastError), compilerOptions());
    try {
      parsed = rawGddMapBriefArraySchema.parse(rejectDangerousMapKeys(parseJson(raw)));
      break;
    } catch (error) {
      lastError = error;
      if (attempt === 1) throw new GddMapBriefCompilationError(error instanceof Error ? error.message : 'Map brief output failed validation.');
    }
  }
  if (!parsed) return [];
  const selected = selectCandidates(parsed, markdownHeadings(input.markdown));
  const briefs = selected.map((candidate) => ({
    ...candidate,
    id: randomUUID(),
    styleContract: style,
  }));
  return gddMapBriefArraySchema.parse(briefs);
}

export { canonicalize as canonicalMapJson, sha256 as hashMapJson };
