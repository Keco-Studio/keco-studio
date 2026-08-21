import { describe, expect, it } from '@jest/globals';
import {
  buildStoryBranchTreeNodes,
  dialogueSnapshotExcerptLineCount,
  renderDialogueSnapshot,
  renderStoryBranchTree,
} from './dialogueSnapshots';
import { validateSanctionedMdx } from '@/lib/documents/sanctionedMdx';
import { parseSanctionedMdxAst } from '@/lib/documents/sanctionedMdxParser';
import { parseGddScriptBranchTree } from '@/lib/documents/gddScriptBranchSnapshot';

const document = {
  version: 1 as const,
  entryLabel: 'start',
  nodes: [
    {
      label: 'start', type: 'dialogue' as const, speaker: 'Guard', content: 'State your *business*.',
      next: 'choice', commands: [], options: [], sourceRefs: [{ sourceId: 's', unitId: 'u1', start: 0, end: 1 }],
    },
    {
      label: 'choice', type: 'dialogue' as const, speaker: 'Mira', content: 'I carry a sealed letter.',
      commands: [], next: 'end', options: [
        { text: 'Show [the] letter', target: 'open', commands: [], sourceRefs: [{ sourceId: 's', unitId: 'u2', start: 1, end: 2 }] },
        { text: 'Walk away', target: 'road', commands: [], sourceRefs: [{ sourceId: 's', unitId: 'u3', start: 2, end: 3 }] },
      ], sourceRefs: [{ sourceId: 's', unitId: 'u2', start: 1, end: 2 }],
    },
    {
      label: 'open', type: 'narration' as const, content: 'The gate opens.', commands: [], next: 'end', options: [], sourceRefs: [{ sourceId: 's', unitId: 'u4', start: 3, end: 4 }],
    },
    {
      label: 'road', type: 'narration' as const, content: 'The road waits.', commands: [], next: 'end', options: [], sourceRefs: [{ sourceId: 's', unitId: 'u5', start: 4, end: 5 }],
    },
    {
      label: 'end', type: 'narration' as const, content: 'Fade out.', commands: [], options: [], sourceRefs: [{ sourceId: 's', unitId: 'u6', start: 5, end: 6 }],
    },
  ],
};

const plotPlan = {
  version: 2 as const,
  entryPlotNodeId: 'start',
  storyNodeOrder: ['start', 'choice', 'open', 'road', 'end'],
  nodes: [
    { id: 'start', title: 'Arrival', storyNodeIds: ['start', 'choice'] },
    { id: 'open', title: 'Gate opens', storyNodeIds: ['open'] },
    { id: 'road', title: 'Road', storyNodeIds: ['road'] },
    { id: 'end', title: 'End', storyNodeIds: ['end'] },
  ],
  edges: [
    { fromPlotNodeId: 'start', toPlotNodeId: 'open', optionText: 'Show the letter', optionIndex: 0 },
    { fromPlotNodeId: 'start', toPlotNodeId: 'road', optionText: 'Walk away', optionIndex: 1 },
    { fromPlotNodeId: 'open', toPlotNodeId: 'end', optionText: null, optionIndex: null },
    { fromPlotNodeId: 'road', toPlotNodeId: 'end', optionText: null, optionIndex: null },
  ],
};

function treeFromSnapshotMarkdown(markdown: string) {
  const root = parseSanctionedMdxAst(markdown);
  const node = root.children?.find((child) => child.name === 'GddScriptBranchSnapshot');
  const tree = node?.attributes?.find((attribute) => attribute.name === 'tree')?.value;
  return typeof tree === 'string' ? parseGddScriptBranchTree(tree) : null;
}

describe('dialogue snapshot renderer', () => {
  it('renders a sanctioned GddScriptBranchSnapshot with encoded tree and FlowChart ids', () => {
    const result = renderDialogueSnapshot({
      dialogueJobId: 'job-1', chapterKey: 'chapter-1', title: 'Arrival at the Gate', projectId: 'project/1',
      dialogueDocumentId: 'doc-1', scriptLibraryId: 'lib-1', document, plotPlan,
    });

    expect(result).toContain('<GddScriptBranchSnapshot ');
    expect(result).toContain('dialogueJobId="job-1"');
    expect(result).toContain('scriptLibraryId="lib-1"');
    expect(result).toContain('projectId="project/1"');
    expect(result).toContain('title="Arrival at the Gate"');
    expect(() => validateSanctionedMdx(`# GDD\n\n${result}\n`)).not.toThrow();
    expect(treeFromSnapshotMarkdown(result)?.map((node) => `${node.depth}:${node.label}`)).toEqual([
      '0:Arrival',
      '1:Show the letter → Gate opens',
      '2:End',
      '1:Walk away → Road',
      '2:End',
    ]);
  });

  it('renders a single-node card for a linear scene and bounds excerpts', () => {
    const linearDocument = {
      ...document,
      nodes: [document.nodes[0]],
      entryLabel: 'start',
    };
    const result = renderDialogueSnapshot({
      dialogueJobId: 'job-2', chapterKey: 'chapter-2', title: 'Linear', projectId: 'p',
      dialogueDocumentId: 'doc-2', scriptLibraryId: 'lib-2', document: linearDocument,
    });

    expect(result).toContain('<GddScriptBranchSnapshot ');
    expect(dialogueSnapshotExcerptLineCount(linearDocument)).toBeLessThanOrEqual(8);
    expect(treeFromSnapshotMarkdown(result)).toEqual([{ depth: 0, label: 'State your *business*.' }]);
  });

  it('renders a deterministic plot tree from plot nodes and edges', () => {
    expect(renderStoryBranchTree(document, plotPlan)).toBe([
      '- Arrival',
      '  - Show the letter → Gate opens',
      '    - End',
      '  - Walk away → Road',
      '    - End',
    ].join('\n'));
    expect(buildStoryBranchTreeNodes(document, plotPlan).map((node) => node.label)).toContain('Arrival');
  });
});
