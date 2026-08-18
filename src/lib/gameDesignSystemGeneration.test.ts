import { describe, expect, it, jest } from '@jest/globals';
jest.mock('server-only', () => ({}));
import {
  buildStructuredGenerationMessages,
  generateGameDesignSystemOutput,
  generateGameDesignRuleSet,
  RuleSetGenerationValidationError,
  hashResolvedGenerationInput,
} from '@/lib/gameDesignSystemGeneration';
import { compileGameArtStyle } from '@/lib/game-art-style/compiler';
import type { ChatMessage } from '@/lib/agent/types';
import type { StreamLlmOptions } from '@/lib/agent/llm-client';

const validRules = {
  schemaVersion: 1,
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  suitableFor: 'Tactical games',
  rules: [{
    id: 'readable-state',
    kind: 'principle',
    title: 'Readable state',
    statement: 'Show decision inputs.',
    appliesWhen: 'Presenting choices.',
    severity: 'required',
  }],
  tableGuidance: [],
};

const validDocument = {
  gameBackground: 'A river kingdom recovering from a magical flood.',
  designIntent: 'Make every tactical choice legible and consequential.',
  playerFantasy: 'Lead a small squad through uncertain encounters.',
  coreLoop: 'Scout, commit resources, resolve the encounter, and adapt the squad.',
  decisionStructure: 'Compare visible costs, risks, and future positioning.',
  systemBoundaries: 'Never conceal action costs from the player.',
  progressionEconomy: 'Expand tactical options without replacing player judgment.',
  contentModel: 'Define skills, encounters, enemies, and rewards as reusable data.',
  difficultyBalance: 'Increase difficulty through richer situations rather than opaque inflation.',
  experiencePresentation: 'Preview consequences and explain state changes.',
};

const validOutput = { document: validDocument, rules: validRules };

const artStyle = compileGameArtStyle({
  presetId: 'pixel-art',
  presetVersion: 1,
  customization: { direction: 'NEVER-IN-MODEL', referenceGames: [], avoid: '' },
});

const input = {
  title: 'Tactical Rules',
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  description: 'Prioritize explicit tradeoffs.',
  suitableFor: 'Tactical games',
  sourceSnapshots: [{
    kind: 'document' as const,
    projectId: 'project-1',
    resourceId: 'doc-1',
    label: 'Combat GDD',
    contentHash: 'a'.repeat(64),
    excerpt: 'Armor absorbs damage before health.',
    byteCount: 35,
    truncated: false,
  }],
  referenceGames: [],
  artStyle,
};

describe('structured Game Design System generation', () => {
  it('supports an isolated provider configuration for Game Design System jobs', async () => {
    const originalUrl = process.env.GAME_DESIGN_SYSTEM_LLM_API_URL;
    const originalKey = process.env.GAME_DESIGN_SYSTEM_LLM_API_KEY;
    const originalModel = process.env.GAME_DESIGN_SYSTEM_LLM_MODEL;
    process.env.GAME_DESIGN_SYSTEM_LLM_API_URL = 'https://game-design-llm.test';
    process.env.GAME_DESIGN_SYSTEM_LLM_API_KEY = 'game-design-key';
    process.env.GAME_DESIGN_SYSTEM_LLM_MODEL = 'game-design-model';
    try {
      const complete = jest.fn(async (_messages: ChatMessage[], _options?: StreamLlmOptions) => (
        JSON.stringify(validOutput)
      ));
      await generateGameDesignSystemOutput(input, complete);
      expect(complete).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
        apiKey: 'game-design-key',
        baseUrl: 'https://game-design-llm.test',
        model: 'game-design-model',
      }));
    } finally {
      if (originalUrl === undefined) delete process.env.GAME_DESIGN_SYSTEM_LLM_API_URL;
      else process.env.GAME_DESIGN_SYSTEM_LLM_API_URL = originalUrl;
      if (originalKey === undefined) delete process.env.GAME_DESIGN_SYSTEM_LLM_API_KEY;
      else process.env.GAME_DESIGN_SYSTEM_LLM_API_KEY = originalKey;
      if (originalModel === undefined) delete process.env.GAME_DESIGN_SYSTEM_LLM_MODEL;
      else process.env.GAME_DESIGN_SYSTEM_LLM_MODEL = originalModel;
    }
  });

  it('includes actual source excerpts and requires JSON rather than Markdown', () => {
    const messages = buildStructuredGenerationMessages(input);
    expect(messages[0].content).toContain('untrusted reference data');
    expect(messages[1].content).toContain('Armor absorbs damage before health.');
    expect(messages[1].content).not.toContain('document: Combat GDD\n');
    expect(messages[0].content).toContain('Return one JSON object');
    expect(messages[0].content).toContain('"document":{');
    expect(messages[0].content).toContain('gameBackground');
    expect(messages[0].content).toContain('designIntent');
    expect(messages[0].content).toContain('experiencePresentation');
    expect(messages[0].content).toContain('"tableGuidance":[{"table":');
    expect(JSON.stringify(messages)).not.toContain('NEVER-IN-MODEL');
    expect(JSON.stringify(messages)).not.toContain('/game-art-styles/');
  });

  it('includes the compiled Art Style snapshot in the durable input hash', () => {
    const changed = {
      ...input,
      artStyle: compileGameArtStyle({
        presetId: 'pixel-art',
        presetVersion: 1,
        customization: { direction: 'Different direction', referenceGames: [], avoid: '' },
      }),
    };
    expect(hashResolvedGenerationInput(input)).not.toBe(hashResolvedGenerationInput(changed));
  });

  it('repairs one invalid model response and returns a strict document and rules envelope', async () => {
    const complete = jest.fn(async () => complete.mock.calls.length === 1
      ? '# Directory\n## Principles\n...'
      : JSON.stringify(validOutput));
    const result = await generateGameDesignSystemOutput(input, complete);
    expect(result.document.coreLoop).toContain('Scout');
    expect(result.rules.rules[0].id).toBe('readable-state');
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('retains a rules-only compatibility wrapper', async () => {
    const complete = jest.fn(async () => JSON.stringify(validOutput));
    const result = await generateGameDesignRuleSet(input, complete);
    expect(result.rules[0].id).toBe('readable-state');
  });

  it('tells the repair pass that table guidance entries must be objects', async () => {
    const invalid = JSON.stringify({ ...validOutput, rules: { ...validRules, tableGuidance: ['Skills', 'Encounters'] } });
    const complete = jest.fn(async (_messages: ChatMessage[], _options?: StreamLlmOptions) => complete.mock.calls.length === 1 ? invalid : JSON.stringify(validOutput));
    await generateGameDesignSystemOutput(input, complete);
    expect((complete.mock.calls[1][0] as Array<{ content: string }>)[1].content).toContain('tableGuidance entries must be objects');
    expect((complete.mock.calls[1][0] as Array<{ content: string }>)[1].content).toContain('gameBackground');
  });

  it('keeps the normalized request and real sources in the repair pass', async () => {
    const complete = jest.fn(async (_messages: ChatMessage[], _options?: StreamLlmOptions) => complete.mock.calls.length === 1
      ? '{"schemaVersion":1}'
      : JSON.stringify(validOutput));
    await generateGameDesignSystemOutput(input, complete);
    const repairMessages = complete.mock.calls[1][0] as ChatMessage[];
    expect(repairMessages.some((message) => typeof message.content === 'string' && message.content.includes('Armor absorbs damage before health.'))).toBe(true);
    expect(repairMessages.some((message) => typeof message.content === 'string' && message.content.includes('Prioritize explicit tradeoffs.'))).toBe(true);
  });

  it('propagates an initial transport failure without attempting schema repair', async () => {
    const transportError = new Error('DeepSeek connection reset');
    const complete = jest.fn(async () => { throw transportError; });
    await expect(generateGameDesignSystemOutput(input, complete)).rejects.toBe(transportError);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('propagates a repair transport failure as retryable', async () => {
    const transportError = new Error('DeepSeek repair timeout');
    const complete = jest.fn(async () => {
      if (complete.mock.calls.length === 1) return '{"schemaVersion":1}';
      throw transportError;
    });
    await expect(generateGameDesignSystemOutput(input, complete)).rejects.toBe(transportError);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('fails permanently when the repair response is also invalid', async () => {
    const complete = jest.fn(async () => '{"document":{},"rules":{"schemaVersion":1,"rules":[]}}');
    await expect(generateGameDesignSystemOutput(input, complete)).rejects.toBeInstanceOf(RuleSetGenerationValidationError);
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
