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
  schemaVersion: 2,
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  suitableFor: 'Tactical games',
  rules: [
    { id: 'player-role', domain: 'player', kind: 'constraint', title: 'Player role', statement: 'The player commands a squad.', appliesWhen: 'Starting an encounter.', severity: 'required' },
    { id: 'objective-definition', domain: 'objective', kind: 'constraint', title: 'Objective definition', statement: 'Each encounter states a concrete objective.', appliesWhen: 'Presenting an encounter.', severity: 'required' },
    { id: 'action-availability', domain: 'action', kind: 'constraint', title: 'Action availability', statement: 'Show available actions before commitment.', appliesWhen: 'Presenting choices.', severity: 'required' },
    { id: 'object-state', domain: 'object_state', kind: 'constraint', title: 'Object state', statement: 'Expose relevant object states.', appliesWhen: 'Resolving actions.', severity: 'required' },
    { id: 'resolution-sequence', domain: 'sequence', kind: 'constraint', title: 'Resolution sequence', statement: 'Resolve actions in a visible order.', appliesWhen: 'Resolving actions.', severity: 'required' },
    { id: 'resource-cost', domain: 'resource_cost', kind: 'constraint', title: 'Resource cost', statement: 'Show resource costs before commitment.', appliesWhen: 'Presenting choices.', severity: 'required' },
    { id: 'resolution-feedback', domain: 'resolution_feedback', kind: 'constraint', title: 'Resolution feedback', statement: 'Explain state changes after resolution.', appliesWhen: 'Completing an action.', severity: 'required' },
    { id: 'fallback-outcome', domain: 'fallback', kind: 'constraint', title: 'Fallback outcome', statement: 'Define behavior when no valid action remains.', appliesWhen: 'No valid action is available.', severity: 'required' },
  ],
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
const legacyBaseRules = {
  schemaVersion: 1 as const,
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  suitableFor: 'Tactical games',
  rules: [{
    id: 'player-role',
    kind: 'principle' as const,
    title: 'Legacy player role',
    statement: 'Describe the player role.',
    appliesWhen: 'Documenting the game.',
    severity: 'required' as const,
  }],
  tableGuidance: [],
};
const chinese = (...codePoints: number[]) => String.fromCodePoint(...codePoints);
const bravePath = chinese(0x52c7, 0x95ef, 0x4e4b, 0x8def);
const roguelike = chinese(0x8089, 0x9e3d, 0x6a21, 0x62df);
const readableState = chinese(0x53ef, 0x8bfb, 0x72b6, 0x6001);

const artStyle = compileGameArtStyle({
  presetId: 'pixel-art',
  presetVersion: 2,
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

  it('requires runtime gameplay rules across the Game Rules Kernel domains', () => {
    const [system] = buildStructuredGenerationMessages(input);

    expect(system.content).toContain('runtime behavior');
    expect(system.content).toContain('not production, design-review, or workflow rules');
    expect(system.content).toContain('resource_cost');
    expect(system.content).toContain('resolution_feedback');
    expect(system.content).toContain('fallback');
  });

  it('bounds large source context before sending a generation request', () => {
    const messages = buildStructuredGenerationMessages({
      ...input,
      pastedMarkdown: 'P'.repeat(20_000),
      sourceSnapshots: Array.from({ length: 10 }, (_, index) => ({
        ...input.sourceSnapshots[0],
        label: `Source ${index}`,
        excerpt: `${index}:${'S'.repeat(20_000)}`,
      })),
    });
    expect(String(messages[1].content).length).toBeLessThan(45_000);
    expect(String(messages[1].content)).toContain('Source 0');
    expect(String(messages[1].content)).toContain('truncated for generation context');
  });

  it('requests Simplified Chinese when the normalized GDS input is Chinese', () => {
    const messages = buildStructuredGenerationMessages({
      ...input,
      title: bravePath,
      genres: [roguelike],
      philosophies: [readableState],
      description: `${chinese(0x5355, 0x4eba)}${roguelike}${chinese(0x63a2, 0x9669, 0x6e38, 0x620f)}`,
    });
    expect(messages[0].content).toMatch(/Simplified Chinese|Chinese output/i);
  });

  it('repairs a schema-valid English response when Chinese output was requested', async () => {
    const chineseOutput = {
      document: Object.fromEntries(Object.keys(validDocument).map((key) => [key, chinese(0x4e2d, 0x6587, 0x8bbe, 0x8ba1, 0x5185, 0x5bb9)])),
      rules: {
        ...validRules,
        genres: [roguelike],
        philosophies: [readableState],
        suitableFor: chinese(0x5355, 0x4eba, 0x73a9, 0x5bb6),
        rules: validRules.rules.map((rule) => ({
          ...rule,
          title: readableState,
          statement: chinese(0x5c55, 0x793a, 0x51b3, 0x7b56, 0x4fe1, 0x606f, 0x3002),
        })),
      },
    };
    const complete = jest.fn(async () => complete.mock.calls.length === 1
      ? JSON.stringify(validOutput)
      : JSON.stringify(chineseOutput));

    const result = await generateGameDesignSystemOutput({
      ...input,
      title: bravePath,
      genres: [roguelike],
      philosophies: [readableState],
      description: `${chinese(0x5355, 0x4eba)}${roguelike}${chinese(0x63a2, 0x9669, 0x6e38, 0x620f)}`,
    }, complete);

    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.document.gameBackground).toContain(chinese(0x4e2d, 0x6587));
    const calls = complete.mock.calls as unknown as Array<unknown[]>;
    expect(((calls[1]?.[0] as ChatMessage[])[1]?.content ?? '')).toMatch(/Simplified Chinese|Chinese output/i);
  });

  it('includes the compiled Art Style snapshot in the durable input hash', () => {
    const changed = {
      ...input,
      artStyle: compileGameArtStyle({
        presetId: 'pixel-art',
        presetVersion: 2,
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
    expect(result.rules.rules[0].id).toBe('player-role');
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('repairs a v2 output that omits the required fallback domain', async () => {
    const invalidOutput = {
      ...validOutput,
      rules: {
        ...validRules,
        rules: validRules.rules.filter((rule) => rule.domain !== 'fallback'),
      },
    };
    const complete = jest.fn(async (_messages: ChatMessage[], _options?: StreamLlmOptions) => complete.mock.calls.length === 1
      ? JSON.stringify(invalidOutput)
      : JSON.stringify(validOutput));

    const result = await generateGameDesignSystemOutput(input, complete);

    expect(result).toEqual(validOutput);
    expect((complete.mock.calls[1][0] as Array<{ content: string }>)[1].content)
      .toContain('fallback');
    expect((complete.mock.calls[1][0] as Array<{ content: string }>)[1].content)
      .toContain('runtime behavior');
  });

  it('repairs a legacy v1 response into a v2 Game Rules Kernel', async () => {
    const legacyOutput = {
      ...validOutput,
      rules: {
        ...validRules,
        schemaVersion: 1,
        rules: validRules.rules.map(({ domain: _domain, ...rule }) => rule),
      },
    };
    const complete = jest.fn(async (_messages: ChatMessage[], _options?: StreamLlmOptions) => complete.mock.calls.length === 1
      ? JSON.stringify(legacyOutput)
      : JSON.stringify(validOutput));

    const result = await generateGameDesignSystemOutput(input, complete);

    expect(result.rules.schemaVersion).toBe(2);
    expect(complete).toHaveBeenCalledTimes(2);
    expect((complete.mock.calls[1][0] as Array<{ content: string }>)[1].content)
      .toContain('rules.schemaVersion must be 2');
  });

  it('repairs a v2 response that inherits a legacy v1 rule ID', async () => {
    const freshV2Output = {
      ...validOutput,
      rules: {
        ...validRules,
        rules: validRules.rules.map((rule) => rule.id === 'player-role'
          ? { ...rule, id: 'squad-commander-role' }
          : rule),
      },
    };
    const complete = jest.fn(async (_messages: ChatMessage[], _options?: StreamLlmOptions) => complete.mock.calls.length === 1
      ? JSON.stringify(validOutput)
      : JSON.stringify(freshV2Output));

    const result = await generateGameDesignSystemOutput({ ...input, baseRules: legacyBaseRules }, complete);

    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.rules.rules.map((rule) => rule.id)).not.toContain('player-role');
    expect((complete.mock.calls[1][0] as Array<{ content: string }>)[1].content)
      .toContain('Generate fresh v2 rule IDs');
  });

  it('bounds the repair request after a large first response', async () => {
    const complete = jest.fn(async () => complete.mock.calls.length === 1
      ? 'X'.repeat(30_000)
      : JSON.stringify(validOutput));
    await generateGameDesignSystemOutput({ ...input, pastedMarkdown: 'P'.repeat(30_000) }, complete);
    const calls = complete.mock.calls as unknown as Array<unknown[]>;
    const repair = (calls[1][0] as ChatMessage[])[1];
    expect(String(repair.content).length).toBeLessThanOrEqual(40_000);
    expect(String(repair.content)).toContain('Invalid response:');
  });

  it('retains a rules-only compatibility wrapper', async () => {
    const complete = jest.fn(async () => JSON.stringify(validOutput));
    const result = await generateGameDesignRuleSet(input, complete);
    expect(result.rules[0].id).toBe('player-role');
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

  it('cancels the active completion when the generation signal aborts', async () => {
    const controller = new AbortController();
    const complete = jest.fn((_messages: ChatMessage[], options?: StreamLlmOptions) => {
      const signal = options?.signal;
      if (!signal) return Promise.reject(new Error('Generation signal did not reach the completion request.'));
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const generation = generateGameDesignSystemOutput(input, complete, undefined, controller.signal);

    controller.abort(new Error('Generation deadline exceeded.'));

    await expect(generation).rejects.toThrow('Generation deadline exceeded.');
  });

  it('uses the same generation signal for the repair completion', async () => {
    const controller = new AbortController();
    let markRepairStarted: (() => void) | undefined;
    const repairStarted = new Promise<void>((resolve) => { markRepairStarted = resolve; });
    const complete = jest.fn((_messages: ChatMessage[], options?: StreamLlmOptions) => {
      if (complete.mock.calls.length === 1) return Promise.resolve('{"invalid":true}');
      const signal = options?.signal;
      if (!signal) return Promise.reject(new Error('Generation signal did not reach the repair request.'));
      markRepairStarted?.();
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const generation = generateGameDesignSystemOutput(input, complete, undefined, controller.signal);
    await repairStarted;

    controller.abort(new Error('Repair deadline exceeded.'));

    await expect(generation).rejects.toThrow('Repair deadline exceeded.');
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
