import { describe, expect, it } from '@jest/globals';
import type { StoryPlotPlan } from './schema';
import { validateStoryPlotPlan } from './validator';

const plan: StoryPlotPlan = {
  version: 1,
  entryPlotNodeId: 'Opening',
  nodes: [
    { id: 'Opening', title: 'Opening', storyNodeIds: ['N1', 'N2'] },
    { id: 'Decision', title: 'Decision', storyNodeIds: ['N3'] },
    { id: 'Ending', title: 'Ending', storyNodeIds: ['N4'] },
  ],
  edges: [
    {
      fromPlotNodeId: 'Opening',
      toPlotNodeId: 'Decision',
      optionText: null,
      optionIndex: null,
    },
    {
      fromPlotNodeId: 'Decision',
      toPlotNodeId: 'Ending',
      optionText: 'Continue',
      optionIndex: 0,
    },
  ],
};

const storyNodeIds = ['N1', 'N2', 'N3', 'N4'];

describe('Story plot deterministic validation', () => {
  it('returns a complete reachable plan', () => {
    expect(validateStoryPlotPlan(plan, storyNodeIds)).toBe(plan);
  });

  it('rejects duplicate plot node ids', () => {
    expect(() => validateStoryPlotPlan({
      ...plan,
      nodes: [...plan.nodes, { id: 'Decision', title: 'Duplicate', storyNodeIds: ['N5'] }],
    }, [...storyNodeIds, 'N5'])).toThrow(/duplicate plot node id/i);
  });

  it('rejects an unknown entry plot node', () => {
    expect(() => validateStoryPlotPlan({ ...plan, entryPlotNodeId: 'Missing' }, storyNodeIds))
      .toThrow(/unknown entry plot node/i);
  });

  it('rejects story nodes assigned to more than one plot node', () => {
    expect(() => validateStoryPlotPlan({
      ...plan,
      nodes: [plan.nodes[0], { ...plan.nodes[1], storyNodeIds: ['N2', 'N3'] }, plan.nodes[2]],
    }, storyNodeIds)).toThrow(/more than one plot node/i);
  });

  it('rejects omitted expected story nodes', () => {
    expect(() => validateStoryPlotPlan({
      ...plan,
      nodes: [{ ...plan.nodes[0], storyNodeIds: ['N1'] }, plan.nodes[1], plan.nodes[2]],
    }, storyNodeIds)).toThrow(/exactly one plot node/i);
  });

  it('rejects unknown story node memberships', () => {
    expect(() => validateStoryPlotPlan({
      ...plan,
      nodes: [{ ...plan.nodes[0], storyNodeIds: ['N1', 'Unknown'] }, plan.nodes[1], plan.nodes[2]],
    }, storyNodeIds)).toThrow(/unknown story node/i);
  });

  it.each([
    ['source', { ...plan.edges[0], fromPlotNodeId: 'Missing' }],
    ['target', { ...plan.edges[0], toPlotNodeId: 'Missing' }],
  ])('rejects an edge with an unknown %s plot node', (_name, edge) => {
    expect(() => validateStoryPlotPlan({ ...plan, edges: [edge, plan.edges[1]] }, storyNodeIds))
      .toThrow(/edge references an unknown plot node/i);
  });

  it.each([
    ['ordinary edge with an option index', { ...plan.edges[0], optionIndex: 0 }],
    ['choice edge without an option index', { ...plan.edges[1], optionIndex: null }],
    ['choice edge with a negative option index', { ...plan.edges[1], optionIndex: -1 }],
    ['choice edge with a fractional option index', { ...plan.edges[1], optionIndex: 1.5 }],
  ])('rejects a malformed %s', (_name, edge) => {
    expect(() => validateStoryPlotPlan({ ...plan, edges: [edge] }, storyNodeIds))
      .toThrow(/option text and option index/i);
  });

  it('rejects duplicate choice option indexes from the same source plot', () => {
    expect(() => validateStoryPlotPlan({
      ...plan,
      edges: [
        ...plan.edges,
        {
          fromPlotNodeId: 'Decision',
          toPlotNodeId: 'Opening',
          optionText: 'Return',
          optionIndex: 0,
        },
      ],
    }, storyNodeIds)).toThrow(/duplicate option index/i);
  });

  it('allows the same choice option index from different source plots', () => {
    const changed: StoryPlotPlan = {
      ...plan,
      edges: [
        {
          fromPlotNodeId: 'Opening',
          toPlotNodeId: 'Decision',
          optionText: 'Choose',
          optionIndex: 0,
        },
        plan.edges[1],
      ],
    };

    expect(validateStoryPlotPlan(changed, storyNodeIds)).toBe(changed);
  });

  it('rejects plot nodes unreachable from the entry', () => {
    expect(() => validateStoryPlotPlan({ ...plan, edges: [plan.edges[0]] }, storyNodeIds))
      .toThrow(/unreachable plot node/i);
  });

  it('allows unreachable plot nodes only when the editing caller opts in', () => {
    expect(validateStoryPlotPlan(
      { ...plan, edges: [plan.edges[0]] },
      storyNodeIds,
      { allowUnreachable: true }
    )).toMatchObject({ nodes: plan.nodes });
  });

  it('rejects duplicate identical edges', () => {
    expect(() => validateStoryPlotPlan({
      ...plan,
      edges: [plan.edges[0], plan.edges[0], plan.edges[1]],
    }, storyNodeIds)).toThrow(/duplicate plot edge/i);
  });
});
