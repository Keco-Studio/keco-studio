import type { RoleMap } from '@/lib/script-parser';
import { parseNumericCommand } from './commands';
import type {
  SourceRef,
  SourceUnit,
  StoryCommand,
  StoryDocument,
  StoryNode,
  StoryOption,
} from './schema';
import { LABEL_PATTERN } from './schema';
import { sourceRefForUnit, unitizeSource } from './sourceUnits';
import { validateStoryDocument } from './validator';

const SCENE_PATTERN = /^【([^｜】]+)｜([^】]*)】$/;
const BRANCH_PATTERN = /^([A-Za-z][A-Za-z0-9_-]{0,63})\s+(?:branch|merge|分支|统一收尾)【([^｜】]+)｜([^】]*)】$/i;
const TYPED_DIALOGUE_PATTERN = /^（(?:Type|类型)(\d+)・(.+?)）(.*)$/;
const OPTION_PATTERN = /^([A-Za-z][A-Za-z0-9_-]{0,63})[：:]\s*(.+?)（(.+)）$/;
const JUMP_PATTERN = /^（(?:Jump|跳转)\s+([A-Za-z][A-Za-z0-9_-]{0,63})(?:\s+(?:branch|merge|分支|统一收尾))?\s*）$/i;
const DIALOGUE_PATTERN = /^([^：:]{1,64})[：:]\s*(.+)$/;
const OPTION_LIKE_SPEAKER = /^O[A-Za-z0-9_-]*$/i;

export interface LegacyStoryResult {
  document: StoryDocument;
  units: SourceUnit[];
}

export function tryLegacyStoryImport(
  source: string,
  sourceId: string,
  roleMap: RoleMap = {}
): LegacyStoryResult | null {
  let units: SourceUnit[];
  try {
    units = unitizeSource(source, sourceId);
  } catch {
    return null;
  }

  const nodes: StoryNode[] = [];
  const usedLabels = new Set<string>();
  let generatedIndex = 1;

  const generatedLabel = (unit: SourceUnit): { label: string; repair: StoryNode['structuralRepair'] } => {
    let label = nodes.length === 0 ? 'Start' : `Line${generatedIndex++}`;
    while (usedLabels.has(label)) label = `Line${generatedIndex++}`;
    return {
      label,
      repair: {
        kind: 'generated_label',
        reason: 'Legacy line has no explicit label',
        sourceRefs: [sourceRefForUnit(unit)],
      },
    };
  };

  for (const unit of units) {
    const line = unit.text;
    const ref = sourceRefForUnit(unit);

    const branch = BRANCH_PATTERN.exec(line);
    if (branch) {
      if (branch[1] !== branch[2] || !LABEL_PATTERN.test(branch[1])) return null;
      if (!pushExplicitNode(nodes, usedLabels, {
        label: branch[1],
        type: 'scene',
        content: branch[3],
        commands: [],
        options: [],
        sourceRefs: [ref],
      })) return null;
      continue;
    }

    const scene = SCENE_PATTERN.exec(line);
    if (scene) {
      if (!LABEL_PATTERN.test(scene[1])) return null;
      if (!pushExplicitNode(nodes, usedLabels, {
        label: scene[1],
        type: 'scene',
        content: scene[2],
        commands: [],
        options: [],
        sourceRefs: [ref],
      })) return null;
      continue;
    }

    const jump = JUMP_PATTERN.exec(line);
    if (jump) {
      const previous = nodes.at(-1);
      if (!previous || previous.next) return null;
      previous.next = jump[1];
      previous.sourceRefs = appendRef(previous.sourceRefs, ref);
      continue;
    }

    const option = OPTION_PATTERN.exec(line);
    if (option) {
      const previous = nodes.at(-1);
      if (!previous) return null;
      const parsed = parseOption(option[2], option[3], ref);
      if (!parsed) return null;
      previous.options.push(parsed);
      continue;
    }

    const typed = TYPED_DIALOGUE_PATTERN.exec(line);
    if (typed) {
      const rawType = Number(typed[1]);
      const generated = generatedLabel(unit);
      const node: StoryNode = {
        label: generated.label,
        type: rawType <= 2 ? 'dialogue' : 'narration',
        speaker: rawType <= 2 ? typed[2] : undefined,
        content: stripMatchedQuotes(typed[3]),
        commands: [],
        options: [],
        sourceRefs: [ref],
        structuralRepair: generated.repair,
      };
      nodes.push(node);
      usedLabels.add(node.label);
      continue;
    }

    const dialogue = DIALOGUE_PATTERN.exec(line);
    if (dialogue) {
      const speaker = dialogue[1].trim();
      if (OPTION_LIKE_SPEAKER.test(speaker)) return null;
      const generated = generatedLabel(unit);
      const mappedSpeaker = roleMap[speaker]?.id || speaker;
      const node: StoryNode = {
        label: generated.label,
        type: 'dialogue',
        speaker: mappedSpeaker,
        content: stripMatchedQuotes(dialogue[2]),
        commands: [],
        options: [],
        sourceRefs: [ref],
        structuralRepair: generated.repair,
      };
      nodes.push(node);
      usedLabels.add(node.label);
      continue;
    }

    return null;
  }

  if (nodes.length === 0) return null;
  const document: StoryDocument = { version: 1, entryLabel: nodes[0].label, nodes };
  return validateStoryDocument(document, units).length === 0 ? { document, units } : null;
}

function pushExplicitNode(
  nodes: StoryNode[],
  usedLabels: Set<string>,
  node: StoryNode
): boolean {
  if (usedLabels.has(node.label)) return false;
  nodes.push(node);
  usedLabels.add(node.label);
  return true;
}

function parseOption(text: string, metadata: string, ref: SourceRef): StoryOption | null {
  const commands: StoryCommand[] = [];
  let target: string | undefined;

  for (const rawPart of metadata.split(/[，,;；]/)) {
    const part = rawPart.trim();
    if (!part) continue;
    const jump = /^(?:jump|跳转)\s+([A-Za-z][A-Za-z0-9_-]{0,63})(?:\s+(?:branch|merge|分支|统一收尾))?$/i.exec(part);
    if (jump) {
      if (target) return null;
      target = jump[1];
      continue;
    }
    try {
      commands.push({
        source: part,
        ...parseNumericCommand(part),
        sourceRefs: [ref],
      });
    } catch {
      return null;
    }
  }

  if (!target) return null;
  return {
    text: stripMatchedQuotes(text.trim()),
    target,
    commands,
    sourceRefs: [ref],
  };
}

function stripMatchedQuotes(value: string): string {
  const trimmed = value.trim();
  const pairs: Record<string, string> = {
    '"': '"',
    "'": "'",
    '“': '”',
    '‘': '’',
    '「': '」',
  };
  const closing = pairs[trimmed[0]];
  return closing && trimmed.endsWith(closing)
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

function appendRef(refs: SourceRef[], ref: SourceRef): SourceRef[] {
  return refs.some((item) => item.unitId === ref.unitId) ? refs : [...refs, ref];
}
