import type { ChatMessage } from '@/lib/agent/types';
import { completeLlm, type StreamLlmOptions } from '@/lib/agent/llm-client';
import { segmentStorySource } from '@/lib/story-plan/sourceSegments';
import { z } from 'zod';
import type { DialoguePlan } from '../dialogueResources';
import type { DialogueSceneEvent } from './dialogueSceneStream';

type Completion = (messages: ChatMessage[], options?: StreamLlmOptions) => Promise<string>;
const plannerText = (max: number) => z.string().trim().min(1).max(max);
const strictDialoguePlanSchema = z.object({
  chapterKey: plannerText(120),
  title: plannerText(160),
  content: plannerText(120_000),
  hasChoices: z.boolean(),
  branchSummary: z.array(plannerText(300)).max(50),
}).strict();

export class GddDialoguePlanningValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GddDialoguePlanningValidationError';
  }
}

function plannerOptions(signal?: AbortSignal): StreamLlmOptions {
  return {
    model: process.env.GDD_GENERATION_LLM_MODEL || process.env.LLM_MODEL || 'deepseek-v4-flash',
    ...(process.env.GDD_GENERATION_LLM_API_URL ? { baseUrl: process.env.GDD_GENERATION_LLM_API_URL } : {}),
    ...(process.env.GDD_GENERATION_LLM_API_KEY ? { apiKey: process.env.GDD_GENERATION_LLM_API_KEY } : {}),
    thinking: 'disabled',
    temperature: 0.2,
    maxCompletionTokens: 12_000,
    ...(signal ? { signal } : {}),
  };
}

function plannerMessages(input: { event: DialogueSceneEvent; gddContext: string }): ChatMessage[] {
  return [{
    role: 'system',
    content: [
      'You write one complete, importable dialogue script for a concrete scene already established in a game design document.',
      'Return one JSON object only. Do not return Markdown fences, commentary, or an array.',
      'The object must contain exactly: chapterKey, title, content, hasChoices, branchSummary.',
      'Preserve chapterKey and title exactly from the scene event.',
      'Use the scene event and preceding GDD text as the only design evidence.',
      'Write full spoken lines and actionable player choices. Keep branch outcomes consistent with the established scene.',
      'When the scene event has choices, preserve every choice label verbatim and write a complete explicit branch for each choice.',
      'Use this importable branch syntax inside content: O1: <choice text> (Jump O1), then O1 branch [O1 | <branch scene>], branch dialogue, (Jump Oend), and finally Oend merge [Oend | <merge scene>]. Use O2, O3, and so on for later choices.',
      'Never represent a player choice only as a Markdown bullet or prose. Every event choice must appear on its own exact O-numbered option row with a Jump target.',
      'When the scene event has no choices, set hasChoices to false and branchSummary to an empty array.',
    ].join('\n'),
  }, {
    role: 'user',
    content: [
      'SCENE EVENT',
      JSON.stringify(input.event),
      'BEGIN PRECEDING GDD TEXT',
      input.gddContext,
      'END PRECEDING GDD TEXT',
    ].join('\n'),
  }];
}

function parsePlan(raw: string, event: DialogueSceneEvent): DialoguePlan {
  let value: unknown;
  try {
    value = JSON.parse(raw.trim());
  } catch (error) {
    throw new GddDialoguePlanningValidationError(
      `Dialogue planner response is not JSON: ${error instanceof Error ? error.message : 'parse failed'}`,
    );
  }
  let plan: DialoguePlan;
  try {
    plan = strictDialoguePlanSchema.parse(value);
  } catch (error) {
    throw new GddDialoguePlanningValidationError(
      error instanceof Error ? error.message : 'Dialogue plan failed validation.',
    );
  }
  if (plan.chapterKey.toLocaleLowerCase() !== event.chapterKey.toLocaleLowerCase()) {
    throw new GddDialoguePlanningValidationError(`Dialogue plan chapter key must remain ${event.chapterKey}.`);
  }
  if (plan.title !== event.title) {
    throw new GddDialoguePlanningValidationError(`Dialogue plan title must remain ${event.title}.`);
  }
  const normalized = normalizeChoiceRows(plan, event);
  validateChoices(normalized, event);
  return normalized;
}

function normalizeChoiceText(value: string): string {
  return value
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/^\s*O\d+\s*[：:]\s*/i, '')
    .replace(/\s*[（(]\s*Jump\s+O\d+(?:\s+(?:branch|merge))?\s*[）)]\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeChoiceRows(plan: DialoguePlan, event: DialogueSceneEvent): DialoguePlan {
  if (event.choices.length === 0 || !plan.hasChoices) return plan;
  const segmentedChoiceCount = segmentStorySource(plan.content, `gdd-dialogue:${event.chapterKey}`).segments
    .filter((segment) => segment.kind === 'choice_text').length;
  if (segmentedChoiceCount === event.choices.length) return plan;
  const lines = plan.content.split('\n');
  const matched = new Set<number>();
  let firstContentLine = -1;
  const normalizedChoices = event.choices.map(normalizeChoiceText);
  const normalizedLines = lines.map((line) => normalizeChoiceText(line));
  const rewritten = lines.map((line, index) => {
    const text = normalizedLines[index];
    if (text && firstContentLine < 0 && !/^O\d+\s*[：:]/i.test(line.trim())) firstContentLine = index;
    const choiceIndex = normalizedChoices.findIndex((choice, candidateIndex) => (
      !matched.has(candidateIndex) && choice === text
    ));
    if (choiceIndex < 0) return line;
    matched.add(choiceIndex);
    return `O${choiceIndex + 1}: ${event.choices[choiceIndex]} (Jump O${choiceIndex + 1})`;
  });

  const missing = event.choices
    .map((choice, index) => ({ choice, index }))
    .filter(({ index }) => !matched.has(index));
  if (missing.length > 0) {
    const rows = missing.map(({ choice, index }) => `O${index + 1}: ${choice} (Jump O${index + 1})`);
    const insertionIndex = firstContentLine >= 0 ? firstContentLine + 1 : 0;
    rewritten.splice(insertionIndex, 0, ...rows);
  }
  return rewritten.join('\n') === plan.content
    ? plan
    : { ...plan, content: rewritten.join('\n') };
}

function validateChoices(plan: DialoguePlan, event: DialogueSceneEvent): void {
  const expectedHasChoices = event.choices.length > 0;
  const source = segmentStorySource(plan.content, `gdd-dialogue:${event.chapterKey}`);
  const detectedChoices = source.segments
    .filter((segment) => segment.kind === 'choice_text')
    .map((segment) => segment.text);
  if (plan.hasChoices !== expectedHasChoices) {
    throw new GddDialoguePlanningValidationError(
      `Dialogue plan hasChoices must be ${expectedHasChoices} for scene ${event.chapterKey}.`,
    );
  }
  if (!expectedHasChoices) {
    if (plan.branchSummary.length > 0 || detectedChoices.length > 0) {
      throw new GddDialoguePlanningValidationError(
        'A dialogue scene without choices cannot have branch summaries or importable option rows.',
      );
    }
    return;
  }
  if (plan.branchSummary.length !== event.choices.length) {
    throw new GddDialoguePlanningValidationError(
      `Dialogue plan must contain exactly ${event.choices.length} branch summaries.`,
    );
  }
  const missingChoices = event.choices.filter(
    (choice) => !detectedChoices.includes(choice),
  );
  if (missingChoices.length > 0 || detectedChoices.length !== event.choices.length) {
    throw new GddDialoguePlanningValidationError(
      `Dialogue content must preserve exactly the scene choices in importable option rows; missing: ${missingChoices.join(', ') || 'none'}.`,
    );
  }

}

export async function planDialogueScene(
  input: { event: DialogueSceneEvent; gddContext: string },
  dependencies: { complete?: Completion } = {},
  runtime: { signal?: AbortSignal } = {},
): Promise<DialoguePlan> {
  const complete = dependencies.complete ?? completeLlm;
  const messages = plannerMessages(input);
  const first = await complete(messages, plannerOptions(runtime.signal));
  try {
    return parsePlan(first, input.event);
  } catch (error) {
    if (!(error instanceof GddDialoguePlanningValidationError)) throw error;
    const repairMessages: ChatMessage[] = [messages[0], {
      role: 'user',
      content: [
        'Repair the invalid dialogue response into one JSON object with exactly chapterKey, title, content, hasChoices, branchSummary.',
        'Preserve the scene chapterKey and title exactly. Return JSON only.',
        `Validation error: ${error.message}`,
        `Scene event: ${JSON.stringify(input.event)}`,
        `Preceding GDD text:\n${input.gddContext}`,
        `Invalid response:\n${first.slice(0, 16_000)}`,
      ].join('\n\n'),
    }];
    const repaired = await complete(repairMessages, plannerOptions(runtime.signal));
    try {
      return parsePlan(repaired, input.event);
    } catch (repairError) {
      if (!(repairError instanceof GddDialoguePlanningValidationError)) throw repairError;
      throw new GddDialoguePlanningValidationError(
        `Dialogue planner failed after one repair: ${repairError.message}`,
      );
    }
  }
}
