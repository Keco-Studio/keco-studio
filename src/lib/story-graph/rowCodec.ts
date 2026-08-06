import { parseJumpTarget } from '@/lib/script-system/parseJumpTarget';
import { parseStoryPlotPlan } from '@/lib/story-plot/schema';
import type {
  EditableChoice,
  EditableNodeType,
  EditableStoryGraph,
  NamedScriptRow,
} from './editableGraph';

const OPTION_TEXT_PATTERN = /^Option(\d+)$/;
const OPTION_VALUE_PATTERN = /^Option\d+(?:_Next|_Commands)?$/;

export function decodeEditableStoryGraph(input: {
  plotPlan: unknown;
  rows: NamedScriptRow[];
}): EditableStoryGraph {
  const plotPlan = parseStoryPlotPlan(input.plotPlan);
  if (plotPlan.version !== 2) {
    throw new Error('Editable story graphs require plot plan version 2');
  }
  if (
    plotPlan.storyNodeOrder.length !== input.rows.length
    || new Set(plotPlan.storyNodeOrder).size !== plotPlan.storyNodeOrder.length
  ) {
    throw new Error('Plot story node order must exactly match canonical Script row order');
  }

  const storyLabels = new Set(plotPlan.storyNodeOrder);
  const plotTitleByStoryLabel = new Map<string, string>();
  for (const plotNode of plotPlan.nodes) {
    for (const storyLabel of plotNode.storyNodeIds) {
      if (!storyLabels.has(storyLabel)) {
        throw new Error(`Unknown story node ${storyLabel} in plot membership`);
      }
      if (plotTitleByStoryLabel.has(storyLabel)) {
        throw new Error(`Story node ${storyLabel} belongs to more than one plot node`);
      }
      plotTitleByStoryLabel.set(storyLabel, plotNode.title);
    }
  }
  const missingMembership = plotPlan.storyNodeOrder.find(
    (storyLabel) => !plotTitleByStoryLabel.has(storyLabel)
  );
  if (missingMembership) {
    throw new Error(`Story node ${missingMembership} must belong to exactly one plot node`);
  }

  const entryPlotNode = plotPlan.nodes.find((node) => node.id === plotPlan.entryPlotNodeId);
  const entryLabel = entryPlotNode?.storyNodeIds[0];
  if (!entryLabel || !storyLabels.has(entryLabel)) {
    throw new Error('Entry plot node does not contain an ordered story node');
  }

  const nodes = input.rows.map((row, index) => {
    const values = { ...row.values };
    const choices = decodeChoices(values);
    const commandTokens = splitCommands(values.Commands ?? '');
    const explicitNext = commandTokens
      .map(controlJumpTarget)
      .find((target): target is string => Boolean(target));
    const hasEnd = commandTokens.some(isEndToken);
    const physicalNext = plotPlan.storyNodeOrder[index + 1] ?? null;
    const terminal = hasEnd
      || (!explicitNext && choices.length === 0 && physicalNext === null);
    const nextLabel = explicitNext
      ?? (!terminal && choices.length === 0 ? physicalNext : null);

    return {
      label: plotPlan.storyNodeOrder[index],
      plotTitle: plotTitleByStoryLabel.get(plotPlan.storyNodeOrder[index])!,
      assetId: row.assetId,
      rowIndex: row.rowIndex,
      nodeType: decodeNodeType(values.Type ?? ''),
      speaker: values.Name ?? '',
      content: values.Content ?? '',
      commands: commandTokens.filter((token) => (
        !controlJumpTarget(token) && !isEndToken(token)
      )).join('; '),
      nextLabel,
      terminal,
      choices,
      values,
    };
  });

  return { entryLabel, nodes, plotPlan };
}

export function encodeEditableStoryRows(graph: EditableStoryGraph): NamedScriptRow[] {
  const requiredLabels = new Set<string>([graph.entryLabel]);
  graph.nodes.forEach((node, index) => {
    node.choices.forEach((choice) => requiredLabels.add(choice.targetLabel));
    const physicalNext = graph.nodes[index + 1]?.label;
    if (node.nextLabel && node.nextLabel !== physicalNext) {
      requiredLabels.add(node.nextLabel);
    }
  });

  return graph.nodes.map((node, index) => {
    const values = { ...node.values };
    for (const key of Object.keys(values)) {
      if (OPTION_VALUE_PATTERN.test(key)) values[key] = '';
    }

    values.Label = requiredLabels.has(node.label) ? node.label : '';
    values.Type = encodeNodeType(node.nodeType);
    values.Name = node.speaker;
    values.Content = node.content;

    const physicalNext = graph.nodes[index + 1]?.label;
    const control = node.nextLabel
      ? node.nextLabel === physicalNext ? '' : `Jump ${node.nextLabel}`
      : node.terminal ? 'End' : '';
    values.Commands = [withoutControlTokens(node.commands), control]
      .filter(Boolean)
      .join('; ');

    for (const choice of node.choices) {
      values[`Option${choice.optionIndex}`] = choice.text;
      values[`Option${choice.optionIndex}_Next`] = `Jump ${choice.targetLabel}`;
      if (choice.commands || `Option${choice.optionIndex}_Commands` in values) {
        values[`Option${choice.optionIndex}_Commands`] = choice.commands;
      }
    }

    return {
      assetId: node.assetId,
      rowIndex: node.rowIndex,
      values,
    };
  });
}

function decodeChoices(values: Record<string, string>): EditableChoice[] {
  return Object.keys(values)
    .flatMap((key) => {
      const match = OPTION_TEXT_PATTERN.exec(key);
      return match && values[key] !== '' ? [Number(match[1])] : [];
    })
    .sort((left, right) => left - right)
    .map((optionIndex) => {
      const targetLabel = parseJumpTarget(values[`Option${optionIndex}_Next`] ?? '');
      if (!targetLabel) {
        throw new Error(`Option${optionIndex} must have a Jump target`);
      }
      return {
        optionIndex,
        text: values[`Option${optionIndex}`],
        targetLabel,
        commands: values[`Option${optionIndex}_Commands`] ?? '',
      };
    });
}

function decodeNodeType(value: string): EditableNodeType {
  switch (value.trim()) {
    case '1':
    case '2':
      return 'dialogue';
    case '4':
      return 'scene';
    case '5':
      return 'system';
    case '3':
    default:
      return 'narration';
  }
}

function encodeNodeType(type: EditableNodeType): string {
  switch (type) {
    case 'dialogue':
      return '1';
    case 'narration':
      return '3';
    case 'scene':
      return '4';
    case 'system':
      return '5';
  }
}

function splitCommands(value: string): string[] {
  return value
    .split(';')
    .map((token) => token.trim())
    .filter(Boolean);
}

function controlJumpTarget(token: string): string | undefined {
  if (!/^Jump\s+[A-Za-z][A-Za-z0-9_-]*$/i.test(token.trim())) return undefined;
  return parseJumpTarget(token);
}

function isEndToken(token: string): boolean {
  return /^End$/i.test(token.trim());
}

function withoutControlTokens(value: string): string {
  return splitCommands(value)
    .filter((token) => !controlJumpTarget(token) && !isEndToken(token))
    .join('; ');
}
