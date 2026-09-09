import { describe, expect, it } from '@jest/globals';
import { segmentStorySource } from './sourceSegments';
import { shouldTryBranchPlanner } from './conversion';

describe('story branch planner gating', () => {
  it('does not invoke the branch planner for a linear multi-line epilogue', () => {
    const source = segmentStorySource([
      'Maren: The harbor map is whole again.',
      'Maren: I kept the light burning for years.',
      'Maren: Now you can see what lies beyond.',
      'Maren: Follow the coast north.',
      'Player: (Nods, studying the assembled map.)',
      'Maren: The valley awaits.',
    ].join('\n\n'), 'linear-epilogue');

    expect(shouldTryBranchPlanner(source)).toBe(false);
  });

  it('invokes the branch planner when explicit choice evidence is present', () => {
    const source = segmentStorySource([
      'Maren: Which way will you go?',
      'O1: Follow the coast. (Jump O1)',
      'O1 branch [O1 | Coast]',
      'Maren: The coast is clear.',
      'O2: Take the valley. (Jump O2)',
      'O2 branch [O2 | Valley]',
      'Maren: The valley is overgrown.',
    ].join('\n\n'), 'branched-scene');

    expect(shouldTryBranchPlanner(source)).toBe(true);
  });
});
