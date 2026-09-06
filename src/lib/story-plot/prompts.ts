import type { ChatMessage, OpenAITool } from '@/lib/agent/types';
import type { StoryDocument } from '@/lib/story-ir/schema';

export const STORY_PLOT_GROUPING_PROMPT = `You group one canonical visual-novel script into plot nodes for a tree view.
Call submit_story_plot_grouping exactly once and return no prose.
Use every supplied story node ID exactly once, in the exact supplied order.
Each plot node must contain one or more contiguous story nodes. Never reorder, omit, duplicate, or invent IDs.
Decision constraints are server-owned: every listed decision owner must be in a different plot node from every listed option target. Never group a decision owner with one of its option targets, because that would hide the selectable edge.
Keep consecutive setup rows (\u573a\u666f, \u4eba\u7269/\u89d2\u8272 lists, and opening narration) in the same plot node as the first decision they lead to. Do not start a new plot node for every \u573a\u666f line or character list.
Only start a new plot node at a choice destination, a merge of multiple branches, an ending, a flashback, or a true act break.
Keep sibling option targets in separate plot nodes when they lead to different branches. A shared merge node may be grouped with later shared content only when every incoming branch reaches that same node.
Do not create plot nodes for selectable option text. Options belong only on graph edges, which the server derives from canonical options.
Titles must summarize that plot node in about 4–12 Chinese characters (place, event, or outcome). Do not copy dialogue, option text, or a full \u573a\u666f paragraph. Never use numbered placeholders such as \u5206\u652f 3, \u5267\u60c5 1, Branch 4, or Plot 2. Never reuse the incoming choice label as the title. If the chapter introduces characters (\u4eba\u7269：…), title it \u4eba\u7269\u4ecb\u7ecd, not \u5f00\u573a.
Keep ordinary consecutive dialogue/action rows in the same plot node until a choice destination, merge, ending, flashback, or act break.`;

const idSchema = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' };

export const STORY_PLOT_GROUPING_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'submit_story_plot_grouping',
    description: 'Group canonical story nodes into ordered contiguous plot nodes.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        nodes: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string', minLength: 1 },
              storyNodeIds: { type: 'array', minItems: 1, items: idSchema },
            },
            required: ['title', 'storyNodeIds'],
          },
        },
      },
      required: ['nodes'],
    },
  },
};

export function buildStoryPlotGroupingMessages(document: StoryDocument): ChatMessage[] {
  return [
    { role: 'system', content: STORY_PLOT_GROUPING_PROMPT },
    { role: 'user', content: JSON.stringify({
      task: 'GROUP_CANONICAL_STORY_PLOT',
      entryNodeId: document.entryLabel,
      decisionPoints: document.nodes.flatMap((node) => node.options.length > 0 ? [{
        ownerNodeId: node.label,
        options: node.options.map((option) => ({
          text: option.text,
          targetNodeId: option.target,
        })),
      }] : []),
      nodes: document.nodes.map((node) => ({
        id: node.label,
        type: node.type,
        speaker: node.speaker ?? '',
        content: node.content,
        next: node.next ?? '',
        options: node.options.map((option) => ({
          text: option.text,
          target: option.target,
        })),
      })),
    }) },
  ];
}

export const STORY_PLOT_TITLE_PROMPT = `You name existing plot-node chapters for a visual-novel tree view.
Call submit_plot_titles exactly once and return no prose.
Return one title for every supplied chapter id. Do not invent or omit ids.
Each title must summarize that chapter's content in about 4–12 Chinese characters (place, event, or outcome).
Do not copy dialogue, narration sentences, option text, or a full \u573a\u666f paragraph.
Do not use numbered placeholders such as \u5206\u652f 3, \u5267\u60c5 1, Branch 4, or Plot 2.
incomingOption is the edge label that leads here. Never reuse it, its parenthetical, or a close variant (\u9012\u6e29\u6c34 → \u9012\u4e0a\u6e29\u6c34). Options belong only on graph edges.
If rejectedTitles is present, do not repeat those titles.
If the chapter introduces characters (\u4eba\u7269：… / \u89d2\u8272：…), title it \u4eba\u7269\u4ecb\u7ecd, not \u5f00\u573a.
Keep titles distinct from each other.`;

export const STORY_PLOT_TITLE_TOOL: OpenAITool = {
  type: 'function',
  function: {
    name: 'submit_plot_titles',
    description: 'Name each existing plot node by summarizing its chapter content.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        nodes: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 64 },
              title: { type: 'string', minLength: 1 },
            },
            required: ['id', 'title'],
          },
        },
      },
      required: ['nodes'],
    },
  },
};

export function buildStoryPlotTitleMessages(
  chapters: Array<{
    id: string;
    contents: string[];
    incomingOption?: string;
  }>,
  rejected: Array<{ id: string; title: string }> = [],
): ChatMessage[] {
  return [
    { role: 'system', content: STORY_PLOT_TITLE_PROMPT },
    { role: 'user', content: JSON.stringify({
      task: 'NAME_PLOT_CHAPTERS',
      ...(rejected.length > 0 ? { rejectedTitles: rejected } : {}),
      chapters: chapters.map((chapter) => ({
        id: chapter.id,
        incomingOption: chapter.incomingOption ?? '',
        contents: chapter.contents,
      })),
    }) },
  ];
}
