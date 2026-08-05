import { parseNumericCommand } from '@/lib/story-ir/commands';
import type { SourceRef, SourceUnit } from '@/lib/story-ir/schema';
import { sourceRefForUnit, unitizeSource } from '@/lib/story-ir/sourceUnits';
import { parseHierarchicalBranchMarker } from './hierarchicalBranchMarkers';
import {
  isFinalMenuMerge,
  isMenuDivider,
  isMenuMarker,
  parseFinalMenuMerge,
  parseMenuBranchTarget,
  parseMenuChoiceLine,
  type MenuChoiceLine,
} from './menuBranchMarkers';
import { parseScenarioBranchMarker } from './scenarioBranchMarkers';

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

const BACKGROUND_PATTERN = /^(?:Background|Setting|Characters?|Cast)[：:]\s*(.+)$/i;
const NATURAL_BRANCH_PATTERN = /^Branch\s*\d+\s*[：:]\s*Choose\s*[【[]([^】\]]+)[】\]](?:\s*[（(]([^）)]+)[）)])?$/i;
const CHINESE_NATURAL_BRANCH_PATTERN = /^\u5206\u652f\s*[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u96f6〇\u4e24\d]+\s*[：:]\s*\u9009\u62e9\s*[【[]([^】\]]+)[】\]](?:\s*[（(]([^）)]+)[）)])?$/;
const EXPLICIT_BRANCH_PATTERN = /^([A-Za-z][A-Za-z0-9_-]{0,63})\s+(?:branch|merge)\s*[【[]\s*([A-Za-z][A-Za-z0-9_-]{0,63})\s*[|｜]\s*([^】\]]*)[】\]]$/i;
const EXPLICIT_OPTION_PREFIX = /^([A-Za-z][A-Za-z0-9_-]{0,63})\s*[：:]/;
const JUMP_ONLY_PATTERN = /^[（(]\s*Jump\s+([A-Za-z][A-Za-z0-9_-]{0,63})(?:\s+(?:branch|merge))?\s*[）)]$/i;
const JUMP_TOKEN_PATTERN = /Jump\s+([A-Za-z][A-Za-z0-9_-]{0,63})/i;
const CHINESE_BRANCH_PATTERN = /^【\s*\u5206\u652f\u9009\u62e9(?:[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u96f6〇\u4e24\d]+)?\s*[：:]\s*([^】]+?)\s*】$/;
const OUTCOME_PATTERN = /^\s*\*?\s*→\s*\u7ed3\u5c40[^：:]*[：:]\s*(.+)$/;
const BRACKETED_ENDING_PATTERN = /^\s*【\s*\u7ed3\u5c40[^：:】]*[：:][^】]+】[\s\S]*$/;
const HEADING_PATTERN = /^【([^】]+)】$/;
const ACT_OR_SCENE_PATTERN = /^(?:\u7b2c[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u96f6〇\u4e24\d]+\u5e55(?:[（(][^）)]*[）)])?|\u573a\u666f[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u96f6〇\u4e24\d]+)\s*[：:].+$/;
const CHINESE_SCRIPT_SECTION_PATTERN = /^(?:\u4eba\u7269|\u89d2\u8272|\u5267\u60c5\u80cc\u666f|\u573a\u666f|\u5b57\u5e55)\s*[：:][\s\S]*$/;
const CHARACTER_PROFILE_PATTERN = /^[^：:]{1,32}[：:]\s*\d{1,3}\u5c81[，,]/;
const PAREN_CHARACTER_PROFILE_PATTERN = /^[^：:]{1,32}[（(][^）)]*\d{1,3}\u5c81[^）)]*[）)][：:]/;
const BARE_CHARACTER_SECTION_PATTERN = /^(?:\u4eba\u7269|\u89d2\u8272|\u4eba\u7269\u8bbe\u5b9a|\u89d2\u8272\u8bbe\u5b9a)$/;
const BRACKETED_BRANCH_CONTROL_PATTERN = /^【\s*(?:\u5f00\u7bc7\u56fa\u5b9a\u5267\u60c5|\u7b2c[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u96f6〇\u4e24\d]+\u5c42\u7ea7.*\u5206\u652f.*|.*\u5206\u652f.*(?:\u7edf\u4e00|\u5171\u540c).*(?:\u6c47\u5165|\u6c47\u5408|\u6c47\u805a).*)\s*】$/;
const VOICEOVER_CUE_PATTERN = /^[（(](\u753b\u5916\u97f3[：:].+)[）)]$/;
const NUMBERED_ENDING_PATTERN = /^\u7ed3\u5c40\s*\d+\s*[：:].+$/;
const DIALOGUE_PATTERN = /^([^：:]{1,64})[：:]\s*(.+)$/;
const SPEAKER_CUE_PATTERN = /^(.+?)[（(]([^）)]*)[）)]$/;
const LEADING_STAGE_DIRECTION_PATTERN = /^[（(]([^）)]*)[）)]\s*/;
const COMMAND_TOKEN_PATTERN = /\$[A-Za-z_]\w*\s*(?:\+=|-=|\*=|\/=|=)\s*-?(?:\d+\.?\d*|\.\d+)/g;

export function segmentStorySource(content: string, sourceId: string): SegmentedStorySource {
  const units = unitizeSource(content, sourceId);
  const segments: SourceSegment[] = [];
  const commands: SourceCommand[] = [];
  const segmentCounts = new Map<string, number>();
  const commandCounts = new Map<string, number>();
  const menuStructure = collectMenuStructure();

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

    if (
      BARE_CHARACTER_SECTION_PATTERN.test(line)
      || BRACKETED_BRANCH_CONTROL_PATTERN.test(line)
    ) {
      add(unit, 'structural', 0, line.length, false, true);
      return;
    }

    if (isMenuDivider(line)) {
      add(unit, 'structural', 0, line.length, false, false);
      return;
    }

    if (isMenuMarker(line)) {
      add(unit, 'structural', 0, line.length, false, true);
      return;
    }

    const menuChoice = menuStructure.choicesByUnitId.get(unit.id);
    if (menuChoice) {
      add(unit, 'choice_text', menuChoice.textStart, menuChoice.textEnd, true, true);
      return;
    }

    const menuTarget = menuStructure.targetsByUnitId.get(unit.id);
    if (menuTarget) {
      add(unit, 'scene_heading', menuTarget.headingStart, menuTarget.headingEnd, true, true);
      return;
    }

    if (menuStructure.mergeUnitIds.has(unit.id)) {
      const merge = parseFinalMenuMerge(line)!;
      add(unit, 'scene_heading', merge.headingStart, merge.headingEnd, true, true);
      return;
    }

    const scenarioBranch = parseScenarioBranchMarker(line);
    if (scenarioBranch) {
      if (scenarioBranch.kind === 'choice') {
        add(unit, 'choice_text', scenarioBranch.textStart, scenarioBranch.textEnd, true, true);
      } else if (scenarioBranch.kind === 'core' || scenarioBranch.kind === 'section') {
        add(unit, 'scene_heading', scenarioBranch.textStart, scenarioBranch.textEnd, true, true);
      } else {
        add(unit, 'structural', 0, line.length, false, true);
      }
      return;
    }

    const hierarchicalBranch = parseHierarchicalBranchMarker(line);
    if (hierarchicalBranch) {
      add(
        unit,
        'choice_text',
        hierarchicalBranch.choiceStart,
        hierarchicalBranch.choiceEnd,
        true,
        true
      );
      return;
    }

    const naturalBranch = NATURAL_BRANCH_PATTERN.exec(line);
    if (naturalBranch) {
      addMatchedText(unit, add, 'choice_text', naturalBranch[1], 0, true, true);
      if (naturalBranch[2]) {
        addMatchedText(unit, add, 'branch_marker', naturalBranch[2], line.indexOf(naturalBranch[1]) + naturalBranch[1].length, false, false);
      }
      return;
    }

    const chineseNaturalBranch = CHINESE_NATURAL_BRANCH_PATTERN.exec(line);
    if (chineseNaturalBranch) {
      addMatchedText(unit, add, 'choice_text', chineseNaturalBranch[1], 0, true, true);
      if (chineseNaturalBranch[2]) {
        addMatchedText(
          unit,
          add,
          'branch_marker',
          chineseNaturalBranch[2],
          line.indexOf(chineseNaturalBranch[1]) + chineseNaturalBranch[1].length,
          false,
          false
        );
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

    const chineseBranch = CHINESE_BRANCH_PATTERN.exec(line);
    if (chineseBranch) {
      addMatchedText(unit, add, 'choice_text', chineseBranch[1], 0, true, true);
      return;
    }

    if (OUTCOME_PATTERN.test(line)) {
      add(unit, 'narration', 0, line.length, true, true);
      return;
    }

    if (BRACKETED_ENDING_PATTERN.test(line)) {
      add(unit, 'narration', 0, line.length, true, true);
      return;
    }

    const heading = HEADING_PATTERN.exec(line);
    if (heading) {
      addMatchedText(unit, add, 'scene_heading', heading[1], 0, true, true);
      return;
    }

    if (ACT_OR_SCENE_PATTERN.test(line)) {
      add(unit, 'scene_heading', 0, line.length, true, true);
      return;
    }

    if (CHINESE_SCRIPT_SECTION_PATTERN.test(line) || NUMBERED_ENDING_PATTERN.test(line)) {
      add(unit, 'scene_heading', 0, line.length, true, true);
      return;
    }

    const voiceoverCue = VOICEOVER_CUE_PATTERN.exec(line);
    if (voiceoverCue) {
      addMatchedText(unit, add, 'scene_heading', voiceoverCue[1], 0, true, true);
      return;
    }

    if (
      CHARACTER_PROFILE_PATTERN.test(line)
      || PAREN_CHARACTER_PROFILE_PATTERN.test(line)
    ) {
      add(unit, 'narration', 0, line.length, true, true);
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
      let dialogueStart = skipWhitespace(line, colonIndex + 1);
      const leadingStageDirection = LEADING_STAGE_DIRECTION_PATTERN.exec(
        line.slice(dialogueStart)
      );
      if (leadingStageDirection) {
        addMatchedText(
          unit,
          add,
          'stage_direction',
          leadingStageDirection[1].trim(),
          dialogueStart,
          true,
          true
        );
        dialogueStart += leadingStageDirection[0].length;
      }
      const [start, end] = stripMatchedQuoteSpan(line, dialogueStart, line.length);
      if (end > start) add(unit, 'dialogue', start, end, true, true);
      return;
    }

    add(unit, 'narration', 0, line.length, true, true);
  }

  function collectMenuStructure(): {
    choicesByUnitId: Map<string, MenuChoiceLine>;
    targetsByUnitId: Map<string, ReturnType<typeof parseMenuBranchTarget> & {}>;
    mergeUnitIds: Set<string>;
  } {
    const choicesByUnitId = new Map<string, MenuChoiceLine>();
    const targetsByUnitId = new Map<string, ReturnType<typeof parseMenuBranchTarget> & {}>();
    const mergeUnitIds = new Set<string>();
    const declaredCodes = new Set<string>();
    let collectingChoices = false;
    let collectingBranches = false;
    for (const unit of units) {
      if (isMenuMarker(unit.text)) {
        collectingChoices = true;
        collectingBranches = false;
        declaredCodes.clear();
        continue;
      }
      if (collectingChoices) {
        if (isMenuDivider(unit.text)) continue;
        const choice = parseMenuChoiceLine(unit.text);
        if (choice) {
          choicesByUnitId.set(unit.id, choice);
          declaredCodes.add(choice.code);
          continue;
        }
        const target = parseMenuBranchTarget(unit.text);
        collectingChoices = false;
        collectingBranches = Boolean(target && declaredCodes.has(target.code));
        if (collectingBranches && target) targetsByUnitId.set(unit.id, target);
        continue;
      }
      if (!collectingBranches) continue;
      if (isFinalMenuMerge(unit.text)) {
        mergeUnitIds.add(unit.id);
        collectingBranches = false;
        continue;
      }
      const target = parseMenuBranchTarget(unit.text);
      if (target && declaredCodes.has(target.code)) targetsByUnitId.set(unit.id, target);
    }
    return { choicesByUnitId, targetsByUnitId, mergeUnitIds };
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
  };
  const closing = pairs[value[start]];
  return closing && value[end - 1] === closing ? [start + 1, end - 1] : [start, end];
}
