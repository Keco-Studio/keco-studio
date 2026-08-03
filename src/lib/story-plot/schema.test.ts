import { describe, expect, it } from '@jest/globals';
import { parseStoryPlotPlan } from './schema';

const validPlan = {
  version: 1,
  entryPlotNodeId: 'Opening',
  nodes: [
    { id: 'Opening', title: 'Opening', storyNodeIds: ['N1', 'N2'] },
    { id: 'Decision', title: 'Decision', storyNodeIds: ['N3'] },
  ],
  edges: [{
    fromPlotNodeId: 'Opening',
    toPlotNodeId: 'Decision',
    optionText: null,
    optionIndex: null,
  }],
};

describe('Story plot schema', () => {
  it('parses a strict version-one plan', () => {
    expect(parseStoryPlotPlan(validPlan)).toEqual(validPlan);
  });

  it.each([
    ['entry plot node id', { ...validPlan, entryPlotNodeId: 'bad id' }],
    ['plot node id', {
      ...validPlan,
      nodes: [{ ...validPlan.nodes[0], id: '_Opening' }, validPlan.nodes[1]],
    }],
    ['story node id', {
      ...validPlan,
      nodes: [{ ...validPlan.nodes[0], storyNodeIds: ['1bad'] }, validPlan.nodes[1]],
    }],
    ['edge source id', {
      ...validPlan,
      edges: [{ ...validPlan.edges[0], fromPlotNodeId: 'bad id' }],
    }],
    ['edge target id', {
      ...validPlan,
      edges: [{ ...validPlan.edges[0], toPlotNodeId: `A${'x'.repeat(64)}` }],
    }],
  ])('rejects an unsafe %s', (_name, value) => {
    expect(() => parseStoryPlotPlan(value)).toThrow();
  });

  it('rejects an empty plot title', () => {
    expect(() => parseStoryPlotPlan({
      ...validPlan,
      nodes: [{ ...validPlan.nodes[0], title: '' }, validPlan.nodes[1]],
    })).toThrow();
  });

  it('rejects a plan with no plot nodes', () => {
    expect(() => parseStoryPlotPlan({ ...validPlan, nodes: [] })).toThrow();
  });

  it('rejects a plot node with no story nodes', () => {
    expect(() => parseStoryPlotPlan({
      ...validPlan,
      nodes: [{ ...validPlan.nodes[0], storyNodeIds: [] }, validPlan.nodes[1]],
    })).toThrow();
  });

  it('rejects unsupported versions and unknown properties', () => {
    expect(() => parseStoryPlotPlan({ ...validPlan, version: 2 })).toThrow();
    expect(() => parseStoryPlotPlan({ ...validPlan, surprise: true })).toThrow();
  });

  it.each([
    ['missing choice index', { optionText: 'Choose', optionIndex: null }],
    ['missing choice text', { optionText: null, optionIndex: 0 }],
    ['empty choice text', { optionText: '', optionIndex: 0 }],
    ['negative choice index', { optionText: 'Choose', optionIndex: -1 }],
    ['fractional choice index', { optionText: 'Choose', optionIndex: 0.5 }],
  ])('rejects %s', (_label, edgeFields) => {
    expect(() => parseStoryPlotPlan({
      ...validPlan,
      edges: [{
        fromPlotNodeId: 'Opening',
        toPlotNodeId: 'Decision',
        ...edgeFields,
      }],
    })).toThrow();
  });
});
