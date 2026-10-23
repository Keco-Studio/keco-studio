import { describe, expect, it } from '@jest/globals';
import { createGameDesignSystemVersionRequestSchema } from './versionRequest';

const versionId = '78200594-64e5-4e7e-a79a-409ebc741061';
const currentVersionId = '16662223-2c61-4af8-8a81-ea9f3da97d93';

const rules = {
  schemaVersion: 2 as const,
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  suitableFor: 'Tactical games',
  rules: [
    { id: 'readable-state', domain: 'player' as const, kind: 'principle' as const, title: 'Readable state', statement: 'Expose decision inputs.', appliesWhen: 'Presenting choices.', severity: 'required' as const },
    { id: 'objective-rule', domain: 'objective' as const, kind: 'constraint' as const, title: 'Objective rule', statement: 'Define the objective.', appliesWhen: 'Starting an encounter.', severity: 'required' as const },
    { id: 'action-rule', domain: 'action' as const, kind: 'constraint' as const, title: 'Action rule', statement: 'Define available actions.', appliesWhen: 'Presenting choices.', severity: 'required' as const },
    { id: 'object-state-rule', domain: 'object_state' as const, kind: 'constraint' as const, title: 'Object state rule', statement: 'Define object state.', appliesWhen: 'Resolving actions.', severity: 'required' as const },
    { id: 'sequence-rule', domain: 'sequence' as const, kind: 'constraint' as const, title: 'Sequence rule', statement: 'Define resolution sequence.', appliesWhen: 'Resolving actions.', severity: 'required' as const },
    { id: 'resource-cost-rule', domain: 'resource_cost' as const, kind: 'constraint' as const, title: 'Resource cost rule', statement: 'Define resource costs.', appliesWhen: 'Presenting choices.', severity: 'required' as const },
    { id: 'resolution-feedback-rule', domain: 'resolution_feedback' as const, kind: 'constraint' as const, title: 'Resolution feedback rule', statement: 'Define resolution feedback.', appliesWhen: 'Completing an action.', severity: 'required' as const },
    { id: 'fallback-rule', domain: 'fallback' as const, kind: 'constraint' as const, title: 'Fallback rule', statement: 'Define fallback behavior.', appliesWhen: 'No valid action remains.', severity: 'required' as const },
  ],
  tableGuidance: [],
};

describe('createGameDesignSystemVersionRequestSchema', () => {
  it('parses a simultaneous strict three-domain partial replacement', () => {
    const document = {
      designIntent: 'Make every tactical choice legible before commitment.',
      playerFantasy: 'Lead a compact squad through risky decisions.',
      coreLoop: 'Scout, commit, resolve consequences, and adapt.',
      decisionStructure: 'Trade immediate safety for positional advantage.',
      systemBoundaries: 'Uncertainty may hide outcomes but never action costs.',
      progressionEconomy: 'New tools widen options without invalidating old ones.',
      contentModel: 'Combine objectives, terrain pressure, and enemy roles.',
      difficultyBalance: 'Increase decision pressure instead of inflating stats.',
      experiencePresentation: 'Show intent, costs, and state changes at the point of action.',
    };
    const request = {
      parentVersionId: versionId,
      expectedCurrentVersionId: currentVersionId,
      document,
      rules,
      artStyle: {
        presetId: 'pixel-art',
        presetVersion: 2,
        customization: { referenceGames: [] },
      },
    };

    expect(createGameDesignSystemVersionRequestSchema.parse(request)).toEqual({
      ...request,
      artStyle: {
        ...request.artStyle,
        customization: { direction: '', referenceGames: [], avoid: '' },
      },
    });
  });

  it('accepts an explicit Art Style clear as the supplied domain', () => {
    expect(createGameDesignSystemVersionRequestSchema.parse({
      parentVersionId: versionId,
      expectedCurrentVersionId: currentVersionId,
      artStyle: null,
    })).toEqual({
      parentVersionId: versionId,
      expectedCurrentVersionId: currentVersionId,
      artStyle: null,
    });
  });

  it('rejects legacy v1 rules for a new version write at the rules schema field', () => {
    const legacyRules = {
      schemaVersion: 1,
      genres: rules.genres,
      philosophies: rules.philosophies,
      suitableFor: rules.suitableFor,
      rules: [{
        id: 'readable-state',
        kind: 'principle',
        title: 'Readable state',
        statement: 'Expose decision inputs.',
        appliesWhen: 'Presenting choices.',
        severity: 'required',
      }],
      tableGuidance: [],
    };

    const parsed = createGameDesignSystemVersionRequestSchema.safeParse({
      parentVersionId: versionId,
      expectedCurrentVersionId: currentVersionId,
      rules: legacyRules,
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['rules', 'schemaVersion'] }),
      ]));
    }
  });

  it.each([
    ['unknown top-level key', { rules, forged: true }],
    ['forged compiled snapshot fields', {
      artStyle: {
        presetId: 'pixel-art',
        presetVersion: 2,
        customization: { referenceGames: [] },
        specification: { visualIdentity: 'forged' },
      },
    }],
    ['unknown preset', {
      artStyle: { presetId: 'unknown-style', presetVersion: 1, customization: { referenceGames: [] } },
    }],
    ['retired preset version', {
      artStyle: { presetId: 'pixel-art', presetVersion: 1, customization: { referenceGames: [] } },
    }],
    ['unknown preset version', {
      artStyle: { presetId: 'pixel-art', presetVersion: 999, customization: { referenceGames: [] } },
    }],
    ['missing replacement', {}],
    ['invalid parent UUID', { parentVersionId: 'version-1', rules }],
    ['invalid expected current UUID', { expectedCurrentVersionId: 'current-1', rules }],
  ])('rejects %s', (_label, patch) => {
    expect(createGameDesignSystemVersionRequestSchema.safeParse({
      parentVersionId: versionId,
      expectedCurrentVersionId: currentVersionId,
      ...patch,
    }).success).toBe(false);
  });
});
