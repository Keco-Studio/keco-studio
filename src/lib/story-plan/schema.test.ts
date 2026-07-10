import { describe, expect, it } from '@jest/globals';
import { parseStoryPlanAudit, parseStoryRelationshipPlan } from './schema';

const validPlan = {
  version: 2,
  entryNodeId: 'n1',
  nodes: [{
    id: 'n1',
    type: 'dialogue',
    speakerSegmentId: 's1',
    contentSegmentIds: ['s2'],
    commandIds: [],
    nextNodeId: '',
  }],
  choices: [],
};

describe('Story relationship plan schema', () => {
  it('accepts the flat required-field contract', () => {
    expect(parseStoryRelationshipPlan(validPlan)).toEqual(validPlan);
  });

  it('rejects a provider-wrapped node collection', () => {
    expect(() => parseStoryRelationshipPlan({
      ...validPlan,
      nodes: { item: validPlan.nodes },
    })).toThrow();
  });

  it('rejects fields from the old source-reference contract', () => {
    expect(() => parseStoryRelationshipPlan({
      ...validPlan,
      nodes: [{ ...validPlan.nodes[0], sourceRefs: [] }],
    })).toThrow();
  });

  it('rejects an omitted required field', () => {
    const { speakerSegmentId: _speakerSegmentId, ...node } = validPlan.nodes[0];
    expect(() => parseStoryRelationshipPlan({
      ...validPlan,
      nodes: [node],
    })).toThrow();
  });

  it('accepts a flat mandatory audit result', () => {
    expect(parseStoryPlanAudit({ verdict: 'pass', issues: [] })).toEqual({
      verdict: 'pass',
      issues: [],
    });
  });

  it('rejects unknown audit issue codes', () => {
    expect(() => parseStoryPlanAudit({
      verdict: 'fail',
      issues: [{
        code: 'provider_wrapper',
        severity: 'major',
        unitIds: [],
        nodeIds: [],
        message: 'Malformed provider output',
      }],
    })).toThrow();
  });
});
