import { describe, expect, it } from '@jest/globals';
import {
  parseStoryGraphPlan,
  parseStoryPlanAudit,
  parseStoryRelationshipPlan,
} from './schema';

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
  it('accepts the provider edge-only graph contract', () => {
    const graph = {
      version: 2,
      entryNodeId: 'Node1',
      breakAfterNodeIds: ['Node2'],
      nextOverrides: [],
      choiceEdges: [{
        choiceId: 'Choice1',
        fromNodeId: 'Node1',
        targetNodeId: 'Node2',
      }],
    };

    expect(parseStoryGraphPlan(graph)).toEqual(graph);
  });

  it('rejects full node objects and wrapped edge collections at the provider boundary', () => {
    expect(() => parseStoryGraphPlan(validPlan)).toThrow();
    expect(() => parseStoryGraphPlan({
      version: 2,
      entryNodeId: 'Node1',
      breakAfterNodeIds: { item: ['Node1'] },
      nextOverrides: [],
      choiceEdges: [],
    })).toThrow();
  });

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

  it('drops self-negating MiniMax issues and resolves an empty failure to pass', () => {
    expect(parseStoryPlanAudit({
      verdict: 'fail',
      issues: [{
        code: 'table_mismatch',
        severity: 'critical',
        unitIds: ['u1'],
        nodeIds: ['n1'],
        message: 'The row uses physical fallthrough. This is correct. No issue here.',
      }],
    })).toEqual({ verdict: 'pass', issues: [] });
  });

  it('preserves genuine audit failures while removing contradictory noise', () => {
    expect(parseStoryPlanAudit({
      verdict: 'fail',
      issues: [
        {
          code: 'table_mismatch', severity: 'critical', unitIds: ['u1'], nodeIds: ['n1'],
          message: 'This is correct. No issue here.',
        },
        {
          code: 'omission', severity: 'major', unitIds: ['u2'], nodeIds: [],
          message: 'Visible source content is missing from every node.',
        },
      ],
    })).toEqual({
      verdict: 'fail',
      issues: [{
        code: 'omission', severity: 'major', unitIds: ['u2'], nodeIds: [],
        message: 'Visible source content is missing from every node.',
      }],
    });
  });

  it('does not drop a real failure that follows a partial no-issue statement', () => {
    const audit = parseStoryPlanAudit({
      verdict: 'fail',
      issues: [{
        code: 'omission', severity: 'major', unitIds: ['u2'], nodeIds: [],
        message: 'There is no issue with the Type value, but visible content is missing.',
      }],
    });

    expect(audit.verdict).toBe('fail');
    expect(audit.issues).toHaveLength(1);
  });

  it('drops issues that conclude the graph is faithful or has no leakage', () => {
    expect(parseStoryPlanAudit({
      verdict: 'fail',
      issues: [
        {
          code: 'wrong_branch', severity: 'major', unitIds: ['u1'], nodeIds: ['left'],
          message: 'The branch ordering matches the source. This ordering is faithful.',
        },
        {
          code: 'branch_leak', severity: 'major', unitIds: ['u2'], nodeIds: ['right'],
          message: 'Both choices are correctly isolated. No cross-branch leakage detected.',
        },
      ],
    })).toEqual({ verdict: 'pass', issues: [] });
  });

  it('drops an issue that explicitly concludes there is nothing to report', () => {
    expect(parseStoryPlanAudit({
      verdict: 'fail',
      issues: [{
        code: 'table_mismatch', severity: 'major', unitIds: ['u1'], nodeIds: ['end'],
        message: 'Physical fallthrough is canonical and consistent. No issue to report here.',
      }],
    })).toEqual({ verdict: 'pass', issues: [] });
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
