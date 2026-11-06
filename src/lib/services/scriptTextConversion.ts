/** Convert to the existing Script text syntax; JSON is only an internal projection. */
import { parseStoryDocument } from '@/lib/story-ir/schema';
import { sourceRefForUnit } from '@/lib/story-ir/sourceUnits';
import { completeLlm } from '@/lib/agent/llm-client';
import type { ChatMessage } from '@/lib/agent/types';
import { buildStoryExtractionFromPlan } from '@/lib/story-extraction/fromPlan';
import { materializeStoryExtraction } from '@/lib/story-extraction/materializer';
import { buildDeterministicStoryPlotPlan } from '@/lib/story-plot/deterministicBuilder';
import { segmentStorySource, type SegmentedStorySource } from '@/lib/story-plan/sourceSegments';
import { tryParseExplicitStory, tryBuildLinearStoryFallback } from '@/lib/story-plan/explicitParser';
import { buildStoryAuditProjection } from '@/lib/story-plan/projection';
import type { ResolveStoryPlanOptions, ResolvedAuditedStory } from '@/lib/story-plan/conversion';
import type { StoryRelationshipPlan } from '@/lib/story-plan/schema';
import { SCRIPT_TEXT_CONVERSION_RULES } from './scriptTextGrammar';
import { readScriptCharacterProfiles } from '@/lib/script-system/scriptCharacterProfiles';
import { naturalScriptSource, naturalChoiceLabels } from './naturalScriptSource';

export type ResolvedScriptText = ResolvedAuditedStory & {
  scriptText?: string;
  originalSourceText: string;
  fallback: boolean;
};

function clean(raw: string): string {
  return raw.trim().replace(/^```[^\n]*\n/, '').replace(/\n```$/, '').trim();
}
const comparable = (text: string) => text.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

function compile(text: string, options: ResolveStoryPlanOptions, fallback = false): ResolvedScriptText {
  if (!fallback) {
    const parsed = segmentStorySource(text, 'format');
    text = parsed.units.map(unit => {
      const parts = parsed.segments.filter(s => s.unitId === unit.id);
      const speaker = parts.find(s => s.kind === 'speaker');
      const dialogue = parts.find(s => s.kind === 'dialogue');
      if (speaker && dialogue && !parts.some(s => s.kind === 'stage_direction' || s.kind === 'command')) {
        return `${speaker.text}: ${dialogue.text}`;
      }
      if (parts.length === 1 && parts[0].kind === 'scene_heading') return `**${parts[0].text}**`;
      if (parts.length === 1 && parts[0].kind === 'narration') return `*${parts[0].text}*`;
      return unit.text;
    }).join('\n');
  }
  const source = segmentStorySource(text, options.sourceId ?? 'script-text');
  // A failed import is readable content, never executable instructions.
  if (fallback) {
    source.commands = [];
    source.segments = source.units.map((unit, index) => ({
      id: `fallback-${index}`, unitId: unit.id, kind: 'narration' as const,
      text: unit.text, start: unit.start, end: unit.end, display: true, required: true,
    }));
  }
  const structured = source.segments.some(s => ['branch_marker', 'jump_hint', 'choice_text'].includes(s.kind));
  const plan: StoryRelationshipPlan | null = fallback
    ? tryBuildLinearStoryFallback(source)
    : tryParseExplicitStory(source) ?? (!structured ? tryBuildLinearStoryFallback(source) : null);
  if (!plan) throw new Error('Script branches or jumps could not be parsed.');
  const extraction = buildStoryExtractionFromPlan(plan, source);
  const document = fallback ? parseStoryDocument({
    version: 1, entryLabel: 'Node1',
    nodes: source.units.map((unit, index) => ({
      label: `Node${index + 1}`, type: 'narration', content: unit.text,
      ...(index + 1 < source.units.length ? { next: `Node${index + 2}` } : {}),
      commands: [], options: [], sourceRefs: [sourceRefForUnit(unit)],
    })),
  }) : materializeStoryExtraction(extraction, source, options.roleMap, { enforceVisibleTextContract: true });
  const projection = buildStoryAuditProjection(document);
  const plotPlan = buildDeterministicStoryPlotPlan(document);
  return {
    document, plotPlan, source, extraction, projection,
    audit: { verdict: 'pass', issues: [] }, approval: 'validation_pass', auditSkipped: true,
    converted: false, attempts: 0, scriptText: fallback ? undefined : text, originalSourceText: text, fallback,
  };
}

function checkCoverage(original: SegmentedStorySource, candidate: ResolvedScriptText): void {
  const originalProfiles = readScriptCharacterProfiles(original.content);
  const candidateProfiles = readScriptCharacterProfiles(candidate.scriptText ?? '');
  if (originalProfiles.length !== candidateProfiles.length || originalProfiles.some((profile, index) =>
    comparable(profile.name) !== comparable(candidateProfiles[index].name)
    || comparable(profile.description) !== comparable(candidateProfiles[index].description))) {
    throw new Error('Preserve explicit Character names and descriptions without inventing profiles.');
  }
  let output = comparable(candidate.document.nodes.flatMap(n => [n.content, ...n.options.map(o => o.text)]).join('\n'));
  // Compare player-visible source segments, not formatting markers or headings invented by the parser.
  for (const segment of original.segments.filter(s => s.display && s.kind !== 'speaker')) {
    const unit = original.units.find(u => u.id === segment.unitId);
    const choiceLabels = naturalChoiceLabels(unit?.text ?? '');
    if (choiceLabels.length) {
      const options = candidate.document.nodes.flatMap(n => n.options.map(o => comparable(o.text)));
      if (!choiceLabels.every(label => options.includes(comparable(label)))) throw new Error('Preserve all declared choice labels.');
      continue;
    }
    const content = comparable(segment.text);
    // A source routing heading can become a branch declaration. It is not spoken
    // dialogue, and must survive verbatim in that branch's description.
    const isChoiceCondition = /^(?:(?:\u5982\u679c|\u82e5|\u5f53).*(?:\u9009\u62e9|\u9009\u4e2d)|if\s+(?:the\s+)?player\s+chooses?\b).*[：:]\s*$/i.test(segment.text);
    if (segment.kind === 'narration' && isChoiceCondition
      && candidate.source.segments.some(s => s.kind === 'branch_marker' && comparable(s.text) === content)) continue;
    if (content && !output.includes(content)) throw new Error(`Preserve source text: ${segment.text.slice(0, 160)}`);
    if (content) output = output.replace(content, '');
  }
  if (candidate.document.nodes.some(n => n.options.length) && !/choose|choice|option|branch|either|\u9009\u62e9|\u9009\u9879|\u5206\u652f/i.test(original.content)) {
    throw new Error('Do not invent choices for a linear source.');
  }
  const commands = (source: SegmentedStorySource) => source.commands.map(c => `${c.variable}${c.operator}${c.value}`).sort().join('|');
  if (commands(original) !== commands(candidate.source)) throw new Error('Preserve the original variable effects exactly.');
  const remainingDialogue = candidate.document.nodes.filter(n => n.type === 'dialogue').map(n => ({
    speaker: comparable(n.speaker ?? ''), content: comparable(n.content),
  }));
  for (const unit of original.units) {
    if (naturalChoiceLabels(unit.text).length) continue;
    const segments = original.segments.filter(s => s.unitId === unit.id);
    const speaker = comparable(segments.find(s => s.kind === 'speaker')?.text ?? '');
    const dialogue = segments.find(s => s.kind === 'dialogue');
    if (!speaker || !dialogue) continue;
    const index = remainingDialogue.findIndex(n => n.speaker === speaker && n.content === comparable(dialogue.text));
    if (index < 0) throw new Error('Preserve dialogue ownership and repeated lines.');
    remainingDialogue.splice(index, 1);
  }
  if (remainingDialogue.length && original.segments.some(s => s.kind === 'dialogue')) {
    throw new Error('Do not add dialogue or repeat source lines.');
  }
  const sourceText = comparable(original.content);
  for (const node of candidate.document.nodes) {
    if (node.speaker && !sourceText.includes(comparable(node.speaker))) throw new Error('Do not invent speakers.');
    for (const text of [node.content, ...node.options.map(option => option.text)]) {
      const content = comparable(text);
      if (content && !sourceText.includes(content)) throw new Error(`Do not add or rewrite story text: ${text.slice(0, 160)}`);
    }
  }
}

export async function resolveScriptTextForImport(
  sourceText: string,
  options: ResolveStoryPlanOptions = {},
): Promise<ResolvedScriptText> {
  options.signal?.throwIfAborted();
  if (!sourceText.trim()) throw new Error('Document contains no readable text.');
  if (sourceText.length > (options.maxSourceChars ?? 60_000)) throw new Error('Document exceeds the conversion size limit.');
  const normalizedSource = naturalScriptSource(sourceText);
  const original = segmentStorySource(normalizedSource, options.sourceId ?? 'script-text');
  // Only explicit branch syntax can bypass AI; natural branch prose must never be flattened here.
  if (tryParseExplicitStory(original)) {
    try {
      const result = compile(sourceText, options);
      return { ...result, originalSourceText: sourceText, converted: result.scriptText !== sourceText };
    } catch { /* Repair invalid targets below. */ }
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: SCRIPT_TEXT_CONVERSION_RULES },
    { role: 'user', content: normalizedSource },
  ];
  for (let attempt = 1; attempt <= 2; attempt++) {
    options.signal?.throwIfAborted();
    options.onProgress?.({ phase: 'conversion', attempt, message: 'Converting document to Script' });
    const timeout = AbortSignal.timeout(options.llmTimeoutMs ?? 90_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let text = '';
    try {
      text = clean(await completeLlm(messages, {
        signal, usageBinding: options.usageBinding, temperature: 0, maxTokens: 16000, thinking: 'disabled',
      }));
      options.signal?.throwIfAborted();
      if (!text || /^[{[]/.test(text)) throw new Error('Return Script text, not JSON.');
      const candidate = compile(text, options);
      checkCoverage(original, candidate);
      return { ...candidate, originalSourceText: sourceText, converted: text !== sourceText, attempts: attempt };
    } catch (error) {
      options.signal?.throwIfAborted();
      options.onProgress?.({ phase: 'deterministic_validation', attempt,
        message: `Script validation failed: ${error instanceof Error ? error.message : 'Invalid Script'}` });
      if (!text) break; // Provider unavailable: keep content instead of waiting for another provider failure.
      messages.push({ role: 'assistant', content: text });
      messages.push({ role: 'user', content: `Repair the Script and return the complete text. ${error instanceof Error ? error.message : 'Invalid Script'}` });
    }
  }
  options.signal?.throwIfAborted();
  options.onProgress?.({ phase: 'deterministic_validation', message: 'Preserving document content for visual editing' });
  const result = compile(sourceText, options, true);
  return { ...result, converted: true, attempts: 2 };
}
