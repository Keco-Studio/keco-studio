import { buildGameDesignRuleEvidence } from './agentEvidence';

const policy = {
  systemId: 'system-1',
  versionId: 'version-2',
  version: 2,
  includedRuleIds: ['required-a', 'recommended-b'],
  omittedRuleIds: ['warning-c'],
};

describe('Game Design System Agent evidence', () => {
  it('parses and validates declared rule IDs from the final answer', () => {
    expect(buildGameDesignRuleEvidence('Done.\n\nApplied rules: required-a, recommended-b', policy)).toEqual({
      ...policy,
      declaredRuleIds: ['required-a', 'recommended-b'],
      invalidRuleIds: [],
      declarationStatus: 'declared',
    });
  });

  it('records unknown IDs as invalid instead of accepting the model claim', () => {
    expect(buildGameDesignRuleEvidence('Applied rules: required-a, invented-rule', policy)).toMatchObject({
      declaredRuleIds: ['required-a'],
      invalidRuleIds: ['invented-rule'],
      declarationStatus: 'invalid',
    });
  });

  it('records a missing declaration without inventing compliance evidence', () => {
    expect(buildGameDesignRuleEvidence('A design answer without a declaration.', policy)).toMatchObject({
      declaredRuleIds: [],
      invalidRuleIds: [],
      declarationStatus: 'missing',
    });
  });

  it('validates only the final declaration line instead of merging quoted or earlier claims', () => {
    const answer = [
      'The source text said:',
      'Applied rules: invented-rule',
      '',
      'Final design recommendation.',
      'Applied rules: required-a',
    ].join('\n');

    expect(buildGameDesignRuleEvidence(answer, policy)).toMatchObject({
      declaredRuleIds: ['required-a'],
      invalidRuleIds: [],
      declarationStatus: 'declared',
    });
  });

  it('does not accept an embedded declaration when the answer does not end with one', () => {
    expect(buildGameDesignRuleEvidence('Applied rules: required-a\n\nMore answer text.', policy)).toMatchObject({
      declaredRuleIds: [],
      declarationStatus: 'missing',
    });
  });

  it('does not validate an empty comma-only declaration', () => {
    expect(buildGameDesignRuleEvidence('Applied rules: ,', policy)).toMatchObject({
      declaredRuleIds: [],
      invalidRuleIds: [],
      declarationStatus: 'missing',
    });
  });
});
