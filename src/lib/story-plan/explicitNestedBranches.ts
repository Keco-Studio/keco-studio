import type {
  StoryContentExtraction,
  StoryGraphExtraction,
} from '@/lib/story-extraction/pipeline';
import type { SegmentedStorySource } from './sourceSegments';

type BranchMarker = {
  kind: 'top' | 'nested';
  unitId: string;
  unitIndex: number;
  text: string;
};

const NESTED_BRANCH_PATTERN = /^嵌套分支\s*[A-Za-z]\d+\s*[：:]\s*(.+)$/i;
const TOP_BRANCH_PATTERN = /^分支(?:点)?\s*(?:[A-Za-z]|[一二三四五六七八九十两\d]+)\s*[：:]\s*(.+)$/i;

export function recoverExplicitNestedBranchChoices(
  source: SegmentedStorySource,
  content: StoryContentExtraction
): StoryContentExtraction {
  const markers = explicitBranchMarkers(source);
  if (!hasNestedHierarchy(markers)) return content;

  const choices = [...content.choices];
  const usedIds = new Set(choices.map((choice) => choice.id));
  let recoveredIndex = 1;
  for (const marker of markers) {
    if (findMarkerChoice(marker, choices)) continue;
    let id = `RecoveredChoice${recoveredIndex}`;
    while (usedIds.has(id)) {
      recoveredIndex += 1;
      id = `RecoveredChoice${recoveredIndex}`;
    }
    usedIds.add(id);
    recoveredIndex += 1;
    choices.push({ id, text: marker.text, sourceUnitIds: [marker.unitId] });
  }
  const choiceUnitIds = new Set(choices.flatMap((choice) => choice.sourceUnitIds));
  return {
    ...content,
    structuralUnitIds: content.structuralUnitIds.filter((unitId) => !choiceUnitIds.has(unitId)),
    choices,
  };
}

export function applyExplicitNestedBranchGraph(
  source: SegmentedStorySource,
  content: StoryContentExtraction,
  graph: StoryGraphExtraction
): StoryGraphExtraction {
  const markers = explicitBranchMarkers(source);
  if (!hasNestedHierarchy(markers)) return graph;
  const topMarkers = markers.filter((marker) => marker.kind === 'top');
  const unitIndexById = new Map(source.units.map((unit, index) => [unit.id, index]));
  const nodePositions = content.nodes.map((node) => ({
    node,
    unitIndex: Math.min(...node.sourceUnitIds.map((unitId) => (
      unitIndexById.get(unitId) ?? Number.MAX_SAFE_INTEGER
    ))),
  }));
  const topOwner = [...nodePositions]
    .reverse()
    .find((candidate) => candidate.unitIndex < topMarkers[0].unitIndex)?.node;
  if (!topOwner) return graph;

  const choiceLinks = new Map(
    graph.choiceLinks.map((link) => [link.split('->')[0], link])
  );
  const nodeLinks = new Map(
    graph.nodeLinks.map((link) => [link.split('->')[0], link])
  );

  topMarkers.forEach((topMarker, topIndex) => {
    const nextTopIndex = topMarkers[topIndex + 1]?.unitIndex ?? Number.MAX_SAFE_INTEGER;
    const nestedMarkers = markers.filter((marker) => (
      marker.kind === 'nested'
      && marker.unitIndex > topMarker.unitIndex
      && marker.unitIndex < nextTopIndex
    ));
    const topTargetBoundary = nestedMarkers[0]?.unitIndex ?? nextTopIndex;
    const topTarget = firstNodeBetween(nodePositions, topMarker.unitIndex, topTargetBoundary);
    const topChoice = findMarkerChoice(topMarker, content.choices);
    if (topTarget && topChoice) {
      choiceLinks.set(topChoice.id, `${topChoice.id}->${topOwner.id}->${topTarget.id}`);
    }

    if (nestedMarkers.length === 0) {
      const terminal = lastNodeBetween(nodePositions, topMarker.unitIndex, nextTopIndex);
      if (terminal) nodeLinks.set(terminal.id, `${terminal.id}->`);
      return;
    }

    const nestedOwner = lastNodeBetween(
      nodePositions,
      topMarker.unitIndex,
      nestedMarkers[0].unitIndex
    );
    if (!nestedOwner) return;
    nodeLinks.set(nestedOwner.id, `${nestedOwner.id}->`);

    nestedMarkers.forEach((nestedMarker, nestedIndex) => {
      const nextMarkerIndex = nestedMarkers[nestedIndex + 1]?.unitIndex ?? nextTopIndex;
      const target = firstNodeBetween(nodePositions, nestedMarker.unitIndex, nextMarkerIndex);
      const terminal = lastNodeBetween(nodePositions, nestedMarker.unitIndex, nextMarkerIndex);
      const choice = findMarkerChoice(nestedMarker, content.choices);
      if (target && choice) {
        choiceLinks.set(choice.id, `${choice.id}->${nestedOwner.id}->${target.id}`);
      }
      if (terminal) nodeLinks.set(terminal.id, `${terminal.id}->`);
    });
  });

  return {
    ...graph,
    nodeLinks: content.nodes.map((node) => nodeLinks.get(node.id) ?? `${node.id}->`),
    choiceLinks: content.choices.map((choice) => (
      choiceLinks.get(choice.id) ?? `${choice.id}->${topOwner.id}->${topOwner.id}`
    )),
  };
}

function explicitBranchMarkers(source: SegmentedStorySource): BranchMarker[] {
  return source.units.flatMap<BranchMarker>((unit, unitIndex) => {
    const text = unit.text.trim();
    const nested = NESTED_BRANCH_PATTERN.exec(text);
    if (nested) {
      return [{ kind: 'nested' as const, unitId: unit.id, unitIndex, text: choiceText(nested[1]) }];
    }
    const top = TOP_BRANCH_PATTERN.exec(text);
    return top
      ? [{ kind: 'top' as const, unitId: unit.id, unitIndex, text: choiceText(top[1]) }]
      : [];
  }).filter((marker) => marker.text.length > 0);
}

function hasNestedHierarchy(markers: BranchMarker[]): boolean {
  return markers.filter((marker) => marker.kind === 'top').length >= 2
    && markers.some((marker) => marker.kind === 'nested');
}

function choiceText(value: string): string {
  return value
    .replace(/\s*[→].*$/, '')
    .replace(/\s*[（(][^）)]*(?:嵌套|结局)[^）)]*[）)]\s*$/, '')
    .trim();
}

function findMarkerChoice(
  marker: BranchMarker,
  choices: StoryContentExtraction['choices']
) {
  const normalizedMarker = normalizeChoiceText(marker.text);
  return choices.find((choice) => (
    choice.sourceUnitIds.includes(marker.unitId)
    || normalizeChoiceText(choice.text) === normalizedMarker
  ));
}

function normalizeChoiceText(value: string): string {
  return value.replace(/[\s，。！？、：:（）()\-—_]/g, '').toLowerCase();
}

function firstNodeBetween(
  nodes: Array<{ node: StoryContentExtraction['nodes'][number]; unitIndex: number }>,
  after: number,
  before: number
) {
  return nodes.find((candidate) => (
    candidate.unitIndex > after && candidate.unitIndex < before
  ))?.node;
}

function lastNodeBetween(
  nodes: Array<{ node: StoryContentExtraction['nodes'][number]; unitIndex: number }>,
  after: number,
  before: number
) {
  return [...nodes].reverse().find((candidate) => (
    candidate.unitIndex > after && candidate.unitIndex < before
  ))?.node;
}
