import { parseNumericCommand } from '@/lib/story-ir/commands';
import type { SourceRef, SourceUnit } from '@/lib/story-ir/schema';
import { sourceRefForUnit, unitizeSource } from '@/lib/story-ir/sourceUnits';

export type SourceSegmentKind =
  | 'speaker'
  | 'dialogue'
  | 'stage_direction'
  | 'narration'
  | 'scene_heading'
  | 'choice_text'
  | 'branch_marker'
  | 'command'
  | 'jump_hint'
  | 'structural';

export interface SourceSegment {
  id: string;
  unitId: string;
  kind: SourceSegmentKind;
  text: string;
  start: number;
  end: number;
  display: boolean;
  required: boolean;
}

export interface SourceCommand {
  id: string;
  segmentId: string;
  source: string;
  variable: string;
  operator: '=' | '+=' | '-=' | '*=' | '/=';
  value: number;
}

export interface SegmentedStorySource {
  sourceId: string;
  content: string;
  units: SourceUnit[];
  segments: SourceSegment[];
  commands: SourceCommand[];
}

const BACKGROUND_PATTERN = /^(?:剧情背景|背景|人物|角色)[：:]\s*(.+)$/;
const NATURAL_BRANCH_PATTERN = /^分支[一二三四五六七八九十\d]+[：:]\s*选择[【[]([^】\]]+)[】\]](?:[（(]([^）)]+)[）)])?$/;
const EXPLICIT_BRANCH_PATTERN = /^([A-Za-z][A-Za-z0-9_-]{0,63})\s+(?:branch|merge|分支|统一收尾)\s*[【[]\s*([A-Za-z][A-Za-z0-9_-]{0,63})\s*[|｜]\s*([^】\]]*)[】\]]$/i;
const EXPLICIT_OPTION_PREFIX = /^([A-Za-z][A-Za-z0-9_-]{0,63})\s*[：:]/;
const JUMP_ONLY_PATTERN = /^[（(]\s*(?:Jump|跳转)\s+([A-Za-z][A-Za-z0-9_-]{0,63})(?:\s+(?:branch|merge|分支|统一收尾))?\s*[）)]$/i;
const JUMP_TOKEN_PATTERN = /(?:Jump|跳转)\s+([A-Za-z][A-Za-z0-9_-]{0,63})/i;
const HEADING_PATTERN = /^【([^】]+)】$/;
const DIALOGUE_PATTERN = /^([^：:]{1,64})[：:]\s*(.+)$/;
const SPEAKER_CUE_PATTERN = /^(.+?)[（(]([^）)]*)[）)]$/;
const COMMAND_TOKEN_PATTERN = /\$[A-Za-z_]\w*\s*(?:\+=|-=|\*=|\/=|=)\s*-?(?:\d+\.?\d*|\.\d+)/g;

export function segmentStorySource(content: string, sourceId: string): SegmentedStorySource {
  const units = unitizeSource(content, sourceId);
  const segments: SourceSegment[] = [];
  const commands: SourceCommand[] = [];
  const segmentCounts = new Map<string, number>();
  const commandCounts = new Map<string, number>();

  const push = (
    unit: SourceUnit,
    kind: SourceSegmentKind,
    relativeStart: number,
    relativeEnd: number,
    display: boolean,
    required: boolean
  ): SourceSegment => {
    const index = segmentCounts.get(unit.id) ?? 0;
    segmentCounts.set(unit.id, index + 1);
    const segment: SourceSegment = {
      id: `${unit.id}:segment:${index}`,
      unitId: unit.id,
      kind,
      text: unit.text.slice(relativeStart, relativeEnd),
      start: unit.start + relativeStart,
      end: unit.start + relativeEnd,
      display,
      required,
    };
    if (content.slice(segment.start, segment.end) !== segment.text) {
      throw new Error(`Segment ${segment.id} does not match its source slice`);
    }
    segments.push(segment);
    return segment;
  };

  for (const unit of units) {
    segmentUnit(unit, push);

    for (const match of unit.text.matchAll(COMMAND_TOKEN_PATTERN)) {
      const source = match[0].trim();
      const leading = match[0].indexOf(source);
      const start = (match.index ?? 0) + leading;
      const segment = push(unit, 'command', start, start + source.length, false, true);
      const commandIndex = commandCounts.get(unit.id) ?? 0;
      commandCounts.set(unit.id, commandIndex + 1);
      commands.push({
        id: `${unit.id}:command:${commandIndex}`,
        segmentId: segment.id,
        source,
        ...parseNumericCommand(source),
      });
    }
  }

  segments.sort((left, right) => left.start - right.start || left.end - right.end);
  return { sourceId, content, units, segments, commands };

  function segmentUnit(
    unit: SourceUnit,
    add: typeof push
  ): void {
    const line = unit.text;

    const naturalBranch = NATURAL_BRANCH_PATTERN.exec(line);
    if (naturalBranch) {
      addMatchedText(unit, add, 'choice_text', naturalBranch[1], 0, true, true);
      if (naturalBranch[2]) {
        addMatchedText(unit, add, 'branch_marker', naturalBranch[2], line.indexOf(naturalBranch[1]) + naturalBranch[1].length, false, false);
      }
      return;
    }

    const explicitBranch = EXPLICIT_BRANCH_PATTERN.exec(line);
    if (explicitBranch) {
      if (explicitBranch[3]) {
        addMatchedText(unit, add, 'branch_marker', explicitBranch[3], line.indexOf(explicitBranch[2]) + explicitBranch[2].length, false, false);
      }
      return;
    }

    const jumpOnly = JUMP_ONLY_PATTERN.exec(line);
    if (jumpOnly) {
      addMatchedText(unit, add, 'jump_hint', jumpOnly[1], 0, false, false);
      return;
    }

    const heading = HEADING_PATTERN.exec(line);
    if (heading) {
      addMatchedText(unit, add, 'scene_heading', heading[1], 0, true, true);
      return;
    }

    const background = BACKGROUND_PATTERN.exec(line);
    if (background) {
      addMatchedText(unit, add, 'narration', background[1], 0, true, true);
      return;
    }

    const optionPrefix = EXPLICIT_OPTION_PREFIX.exec(line);
    if (optionPrefix && JUMP_TOKEN_PATTERN.test(line)) {
      const colonIndex = firstDelimiterIndex(line);
      const bodyStart = skipWhitespace(line, colonIndex + 1);
      const metadataStart = Math.max(line.lastIndexOf('('), line.lastIndexOf('（'));
      const displayEnd = metadataStart > bodyStart ? trimEndIndex(line, metadataStart) : line.length;
      if (displayEnd > bodyStart) add(unit, 'choice_text', bodyStart, displayEnd, true, true);
      const jump = JUMP_TOKEN_PATTERN.exec(line);
      if (jump) addMatchedText(unit, add, 'jump_hint', jump[1], jump.index, false, false);
      return;
    }

    const dialogue = DIALOGUE_PATTERN.exec(line);
    if (dialogue) {
      const colonIndex = firstDelimiterIndex(line);
      const left = line.slice(0, colonIndex).trim();
      const cue = SPEAKER_CUE_PATTERN.exec(left);
      if (cue) {
        addMatchedText(unit, add, 'speaker', cue[1].trim(), 0, false, true);
        addMatchedText(unit, add, 'stage_direction', cue[2].trim(), cue[1].length, true, true);
      } else {
        addMatchedText(unit, add, 'speaker', left, 0, false, true);
      }
      const dialogueStart = skipWhitespace(line, colonIndex + 1);
      const [start, end] = stripMatchedQuoteSpan(line, dialogueStart, line.length);
      add(unit, 'dialogue', start, end, true, true);
      return;
    }

    add(unit, 'narration', 0, line.length, true, true);
  }
}

export function sourceRefsForSegmentIds(
  source: SegmentedStorySource,
  segmentIds: string[]
): SourceRef[] {
  const segmentsById = new Map(source.segments.map((segment) => [segment.id, segment]));
  const unitsById = new Map(source.units.map((unit) => [unit.id, unit]));
  const refs: SourceRef[] = [];

  for (const segmentId of segmentIds) {
    const segment = segmentsById.get(segmentId);
    if (!segment) throw new Error(`Unknown source segment ${segmentId}`);
    const unit = unitsById.get(segment.unitId);
    if (!unit) throw new Error(`Unknown source unit ${segment.unitId}`);
    if (!refs.some((ref) => ref.unitId === unit.id)) refs.push(sourceRefForUnit(unit));
  }
  return refs;
}

function addMatchedText(
  unit: SourceUnit,
  add: (
    unit: SourceUnit,
    kind: SourceSegmentKind,
    relativeStart: number,
    relativeEnd: number,
    display: boolean,
    required: boolean
  ) => SourceSegment,
  kind: SourceSegmentKind,
  text: string,
  fromIndex: number,
  display: boolean,
  required: boolean
): SourceSegment {
  const start = unit.text.indexOf(text, Math.max(0, fromIndex));
  if (start < 0) throw new Error(`Could not locate ${kind} text in source unit ${unit.id}`);
  return add(unit, kind, start, start + text.length, display, required);
}

function skipWhitespace(value: string, start: number): number {
  let index = start;
  while (index < value.length && /\s/.test(value[index])) index += 1;
  return index;
}

function trimEndIndex(value: string, end: number): number {
  let index = end;
  while (index > 0 && /\s/.test(value[index - 1])) index -= 1;
  return index;
}

function firstDelimiterIndex(value: string): number {
  const indexes = [value.indexOf(':'), value.indexOf('：')].filter((index) => index >= 0);
  if (indexes.length === 0) throw new Error('Expected a dialogue or option delimiter');
  return Math.min(...indexes);
}

function stripMatchedQuoteSpan(value: string, start: number, end: number): [number, number] {
  const pairs: Record<string, string> = {
    '"': '"',
    "'": "'",
    '“': '”',
    '‘': '’',
    '「': '」',
  };
  const closing = pairs[value[start]];
  return closing && value[end - 1] === closing ? [start + 1, end - 1] : [start, end];
}
