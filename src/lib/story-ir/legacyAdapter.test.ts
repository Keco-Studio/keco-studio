import { describe, expect, it } from '@jest/globals';
import { tryLegacyStoryImport } from './legacyAdapter';

const CANONICAL_LINEAR_SCRIPT = `【Start｜Opening】
（Type1・Guide）Begin.`;

const CANONICAL_BRANCH_SCRIPT = `【Start｜Opening】
（Type1・Orb）Choose a path.
O1：Left（$trust+=1, jump O1 branch）
O2：Right（$trust+=2, jump O2 branch）
O1 branch【O1｜Left path】
（Type1・OldMan）Hello.
（Jump Oend）
O2 branch【O2｜Right path】
（Type1・Guard）Stop.
（Jump Oend）
Oend merge【Oend｜End】
（Type1・Orb）Trust: [trust].`;

const USER_NESTED_SAMPLE = `Orb of Light: “You are awake. Pick a path.”

O1: Take the left path. ($trust+=1; jump O1)
O2: Take the right path. ($trust+=2; jump O2)

O1 branch [O1 | Left trail]

Old Man: “Young one, where do you come from?”

O1A: Answer “I do not know”. ($trust+=1; jump O1A_END)
O1B: Walk on without answering. ($trust-=1; jump O1B_END)

O1A_END branch [O1A_END | The old man nods]

Old Man: “An honest child.”

(Jump Merge)

Oend merge [Oend | End of the road]

Orb of Light: “You have arrived. Trust: [trust].”`;

describe('legacy standard script adapter', () => {
  it('imports canonical linear scripts losslessly', () => {
    const result = tryLegacyStoryImport(CANONICAL_LINEAR_SCRIPT, 'linear');
    expect(result?.document.entryLabel).toBe('Start');
    expect(result?.document.nodes.map((node) => node.content)).toEqual(['Opening', 'Begin.']);
  });

  it('imports canonical branches with option commands and jumps', () => {
    const result = tryLegacyStoryImport(CANONICAL_BRANCH_SCRIPT, 'branch');
    const choiceNode = result?.document.nodes.find((node) => node.content === 'Choose a path.');
    expect(choiceNode?.options).toMatchObject([
      { text: 'Left', target: 'O1', commands: [{ source: '$trust+=1' }] },
      { text: 'Right', target: 'O2', commands: [{ source: '$trust+=2' }] },
    ]);
    expect(result?.document.nodes.find((node) => node.content === 'Hello.')?.next).toBe('Oend');
  });

  it('rejects the user sample instead of misclassifying O1 lines as dialogue', () => {
    expect(tryLegacyStoryImport(USER_NESTED_SAMPLE, 'sample')).toBeNull();
  });

  it('allows natural dialogue only when every line is preserved', () => {
    const result = tryLegacyStoryImport('Atana: Hello.\nAI: Welcome back.', 'natural');
    expect(result?.document.nodes.map((node) => [node.speaker, node.content])).toEqual([
      ['Atana', 'Hello.'],
      ['AI', 'Welcome back.'],
    ]);
  });
});
