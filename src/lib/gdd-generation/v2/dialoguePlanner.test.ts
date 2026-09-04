import { describe, expect, it, jest } from '@jest/globals';
import type { ChatMessage } from '@/lib/agent/types';
import {
  GddDialoguePlanningValidationError,
  planDialogueScene,
} from './dialoguePlanner';
import type { DialogueSceneEvent } from './dialogueSceneStream';

const event: DialogueSceneEvent = {
  chapterKey: 'arrival',
  title: 'Arrival',
  scene: 'The guide blocks the gate and asks the hero for proof.',
  participants: ['Guide', 'Hero'],
  choices: ['Show the letter', 'Leave'],
  consequences: 'Showing the letter opens the gate; leaving postpones entry.',
};

const noChoiceEvent: DialogueSceneEvent = {
  ...event,
  choices: [],
  consequences: 'The guide accepts the letter and opens the gate.',
};

const validPlan = {
  chapterKey: 'arrival',
  title: 'Arrival',
  content: [
    'Guide: Stop. Choose what to do.',
    'O1: Show the letter (Jump O1)',
    'O2: Leave (Jump O2)',
    'O1 branch [O1 | The letter is accepted]',
    'Guide: You may enter.',
    '(Jump Oend)',
    'O2 branch [O2 | The hero leaves]',
    'Hero: I will return later.',
    '(Jump Oend)',
    'Oend merge [Oend | The meeting ends]',
    'Narrator: The scene ends.',
  ].join('\n'),
  hasChoices: true,
  branchSummary: ['Show the letter and enter', 'Leave and return later'],
};

describe('planDialogueScene', () => {
  it('generates one validated plan from only the emitted event and prior GDD context', async () => {
    const complete = jest.fn(async () => JSON.stringify(validPlan));

    await expect(planDialogueScene({
      event,
      gddContext: '# GDD\n\n## Arrival\nThe guide blocks the gate.',
    }, { complete })).resolves.toEqual(validPlan);

    expect(complete).toHaveBeenCalledTimes(1);
    const messages = (complete.mock.calls[0] as unknown as [ChatMessage[]])[0];
    const serialized = JSON.stringify(messages);
    expect(serialized).toContain('The guide blocks the gate.');
    expect(serialized).toContain('arrival');
    expect(serialized).not.toContain('creativeBrief');
    expect(serialized).not.toContain('Natural language description');
    expect(serialized).not.toContain('projectSources');
    expect(serialized).toContain('O1:');
    expect(serialized).toMatch(/branch/i);
  });

  it('repairs a linear response when the GDD scene contains player choices', async () => {
    const incompletePlan = {
      ...validPlan,
      content: 'Guide: Stop.\nHero: I will leave.',
      hasChoices: false,
      branchSummary: [],
    };
    const complete = jest.fn(async () => complete.mock.calls.length === 1
      ? JSON.stringify(incompletePlan)
      : JSON.stringify(validPlan));

    await expect(planDialogueScene({ event, gddContext: '# GDD\nScene.' }, { complete }))
      .resolves.toEqual(validPlan);

    expect(complete).toHaveBeenCalledTimes(2);
    const repairMessages = (complete.mock.calls[1] as unknown as [ChatMessage[]])[0];
    expect(JSON.stringify(repairMessages)).toMatch(/choice|branch/i);
  });

  it('repairs legacy aliases and coerced types instead of accepting them as strict planner JSON', async () => {
    const legacyResponse = {
      chapter_key: validPlan.chapterKey,
      name: validPlan.title,
      script: validPlan.content,
      has_choices: 'true',
      branches: validPlan.branchSummary,
      unexpected: 'must not be ignored',
    };
    const complete = jest.fn(async () => complete.mock.calls.length === 1
      ? JSON.stringify(legacyResponse)
      : JSON.stringify(validPlan));

    await expect(planDialogueScene({ event, gddContext: '# GDD\nScene.' }, { complete }))
      .resolves.toEqual(validPlan);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('repairs unexpected option rows when the GDD scene has no choices', async () => {
    const invalid = { ...validPlan, hasChoices: false, branchSummary: [] };
    const repaired = {
      ...validPlan,
      content: 'Guide: Your letter is valid. You may enter.\nHero: Thank you.',
      hasChoices: false,
      branchSummary: [],
    };
    const complete = jest.fn(async () => complete.mock.calls.length === 1
      ? JSON.stringify(invalid)
      : JSON.stringify(repaired));

    await expect(planDialogueScene({ event: noChoiceEvent, gddContext: '# GDD\nScene.' }, { complete }))
      .resolves.toEqual(repaired);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('accepts choice content that the downstream branch planner can resolve', async () => {
    const withoutMerge = {
      ...validPlan,
      content: [
        'Guide: Stop. Choose what to do.',
        'O1: Show the letter (Jump O1)',
        'O2: Leave (Jump O2)',
        'O1 branch [O1 | The letter is accepted]',
        'Guide: You may enter.',
        'O2 branch [O2 | The hero leaves]',
        'Hero: I will return later.',
      ].join('\n'),
    };
    const complete = jest.fn(async () => JSON.stringify(withoutMerge));

    await expect(planDialogueScene({ event, gddContext: '# GDD\nScene.' }, { complete }))
      .resolves.toEqual(withoutMerge);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('accepts parser-supported natural branch content when every GDD choice is preserved', async () => {
    const naturalPlan = {
      ...validPlan,
      content: [
        'Guide: Choose your path.',
        'Branch 1: Choose [Show the letter] (safe entry)',
        'Guide: The letter is accepted.',
        'Branch 2: Choose [Leave] (return later)',
        'Guide: Come back when you are ready.',
      ].join('\n'),
    };
    const complete = jest.fn(async () => JSON.stringify(naturalPlan));

    await expect(planDialogueScene({ event, gddContext: '# GDD\nScene.' }, { complete }))
      .resolves.toEqual(naturalPlan);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('repairs choice text whose casing or spacing is changed by the model', async () => {
    const altered = {
      ...validPlan,
      content: validPlan.content.replace('Show the letter', 'show  the letter'),
    };
    const complete = jest.fn(async () => complete.mock.calls.length === 1
      ? JSON.stringify(altered)
      : JSON.stringify(validPlan));

    await expect(planDialogueScene({ event, gddContext: '# GDD\nScene.' }, { complete }))
      .resolves.toEqual(validPlan);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('removes duplicate importable choice rows instead of claiming no choices are missing', async () => {
    const duplicated = {
      ...validPlan,
      content: validPlan.content.replace(
        'O2: Leave (Jump O2)',
        'O2: Leave (Jump O2)\nO1: Show the letter (Jump O1)',
      ),
    };
    const complete = jest.fn(async () => JSON.stringify(duplicated));

    await expect(planDialogueScene({ event, gddContext: '# GDD\\nScene.' }, { complete }))
      .resolves.toEqual(validPlan);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('does not treat bracketed branch dialogue as extra player choices', async () => {
    const withBranchDialogue = {
      ...validPlan,
      content: validPlan.content.replace(
        'Guide: You may enter.',
        'Guide: You may enter.\n【\u5206\u652f\u9009\u62e9：\u9648\u963f\u59e8，\u6211\u786e\u5b9e\u6ca1\u7ecf\u9a8c。\u60a8\u548c\u7237\u7237\u505a\u4e86\u8fd9\u4e48\u591a\u5e74\u90bb\u5c45，\u80fd\u6559\u6559\u6211\u5417】\n【\u5206\u652f\u9009\u62e9：\u6211\u4f1a\u7528\u4e1a\u7ee9\u8bc1\u660e\u81ea\u5df1。\u4e00\u5468\u5185\u8ba9\u8d85\u5e02\u8425\u4e1a\u989d\u63d0\u534720%】\n【\u5206\u652f\u9009\u62e9：\u8fd9\u662f\u6211\u7684\u8d85\u5e02，\u6211\u81ea\u5df1\u4f1a\u60f3\u529e\u6cd5.】',
      ),
    };
    const complete = jest.fn(async () => JSON.stringify(withBranchDialogue));

    await expect(planDialogueScene({ event, gddContext: '# GDD\\nScene.' }, { complete }))
      .resolves.toEqual(withBranchDialogue);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('does not treat numbered dialogue alternatives inside a branch as top-level choices', async () => {
    const withNestedAlternatives = {
      ...validPlan,
      content: validPlan.content.replace(
        'Guide: You may enter.',
        [
          'Guide: You may enter.',
          '\u9009\u9879：',
          '1. \u963f\u59e8\u597d！\u6211\u4eec\u521a\u5f00\u5f20，\u8d27\u8fd8\u6ca1\u4e0a\u9f50，\u4f46\u60a8\u9700\u8981\u4ec0\u4e48\u6211\u5c3d\u91cf\u627e',
          '2. \u6709\u5356\u7684，\u60a8\u770b\u770b\u9700\u8981\u4ec0\u4e48',
          '3. \u521a\u5f00\u5f20，\u5f88\u591a\u4e1c\u897f\u8fd8\u6ca1\u5230，\u60a8\u6539\u5929\u518d\u6765\u5427',
          'Guide: The customer considers the answer.',
        ].join('\n'),
      ),
    };
    const complete = jest.fn(async () => JSON.stringify(withNestedAlternatives));

    await expect(planDialogueScene({ event, gddContext: '# GDD\\nScene.' }, { complete }))
      .resolves.toEqual(withNestedAlternatives);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('canonicalizes choice rows when the model adds punctuation to the labels', async () => {
    const punctuationEvent: DialogueSceneEvent = {
      ...event,
      chapterKey: 'princess-secret',
      title: 'Princess Secret',
      choices: ['Ask why he hid it', 'Ask about the chamber of commerce', 'Promise to protect him'],
    };
    const punctuated = {
      ...validPlan,
      chapterKey: 'princess-secret',
      title: 'Princess Secret',
      content: [
        'Hero: Tell me what happened.',
        'O1: Ask why he hid it? (Jump O1)',
        'O2: Ask about the chamber of commerce. (Jump O2)',
        'O3: Promise to protect him! (Jump O3)',
        'O1 branch [O1 | The hidden truth]',
        'O2 branch [O2 | The chamber records]',
        'O3 branch [O3 | A promise is made]',
      ].join('\n'),
      branchSummary: punctuationEvent.choices,
    };
    const complete = jest.fn(async () => JSON.stringify(punctuated));

    const plan = await planDialogueScene({ event: punctuationEvent, gddContext: '# GDD\nScene.' }, { complete });
    expect(plan).toEqual(expect.objectContaining({
      content: expect.stringContaining('O1: Ask why he hid it (Jump O1)'),
    }));
    expect(plan.content).toContain('O2: Ask about the chamber of commerce (Jump O2)');
    expect(plan.content).toContain('O3: Promise to protect him (Jump O3)');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('normalizes markdown choice rows for multilingual scene choices before validation', async () => {
    const multilingualEvent: DialogueSceneEvent = {
      ...event,
      chapterKey: 'council',
      title: 'Council',
      choices: ['Choose Lin Xiao', 'Choose Wang Jianguo', 'Choose Chen Ayi', 'Choose Li Qiang', 'Choose Zhao Min', 'Choose Lao Zhou'],
    };
    const response = {
      ...validPlan,
      chapterKey: 'council',
      title: 'Council',
      content: [
        'Elder: Who will lead the delegation?',
        '- Choose Lin Xiao',
        '- Choose Wang Jianguo',
        '- Choose Chen Ayi',
        '- Choose Li Qiang',
        '- Choose Zhao Min',
        '- Choose Lao Zhou',
        'The council awaits the decision.',
      ].join('\n'),
      branchSummary: multilingualEvent.choices,
    };
    const complete = jest.fn(async () => JSON.stringify(response));

    const plan = await planDialogueScene({ event: multilingualEvent, gddContext: '# GDD\n## Council\nChoose a delegate.' }, { complete });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(plan.content).toContain('O1: Choose Lin Xiao (Jump O1)');
    expect(plan.content).toContain('O6: Choose Lao Zhou (Jump O6)');
  });

  it('passes the abort signal to the model completion', async () => {
    const complete = jest.fn(async () => JSON.stringify(validPlan));
    const controller = new AbortController();

    await planDialogueScene({ event, gddContext: '# GDD\nScene.' }, { complete }, { signal: controller.signal });

    expect((complete.mock.calls[0] as unknown as [ChatMessage[], { signal: AbortSignal }])[1].signal)
      .toBe(controller.signal);
  });

  it('repairs one invalid response and keeps the scene identity stable', async () => {
    const complete = jest.fn(async () => complete.mock.calls.length === 1
      ? '{bad json}'
      : JSON.stringify(validPlan));

    await expect(planDialogueScene({ event, gddContext: '# GDD\nScene.' }, { complete }))
      .resolves.toEqual(validPlan);

    expect(complete).toHaveBeenCalledTimes(2);
    const repairMessages = (complete.mock.calls[1] as unknown as [ChatMessage[]])[0];
    expect(JSON.stringify(repairMessages)).toContain('Validation error');
    expect(JSON.stringify(repairMessages)).toContain('{bad json}');
  });

  it('rejects a second invalid response instead of treating it as no dialogue', async () => {
    const complete = jest.fn(async () => '{bad json}');

    await expect(planDialogueScene({ event, gddContext: '# GDD\nScene.' }, { complete }))
      .rejects.toBeInstanceOf(GddDialoguePlanningValidationError);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('rejects a plan that changes the triggering chapter key', async () => {
    const complete = jest.fn(async () => JSON.stringify({ ...validPlan, chapterKey: 'other-scene' }));

    await expect(planDialogueScene({ event, gddContext: '# GDD\nScene.' }, { complete }))
      .rejects.toThrow(/chapter key must remain arrival/i);
  });
});
