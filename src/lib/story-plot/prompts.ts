import type { ChatMessage, OpenAITool } from '@/lib/agent/types';
import type { StoryDocument } from '@/lib/story-ir/schema';

export const STORY_PLOT_GROUPING_PROMPT = `You group one canonical visual-novel script into plot nodes for a tree view.
Call submit_story_plot_grouping exactly once and return no prose.
Use every supplied story node ID exactly once, in the exact supplied order.
Each plot node must contain one or more contiguous story nodes. Never reorder, omit, duplicate, or invent IDs.
Create a separate plot node for meaningful story sections such as background, character introduction, suspense opening, opening dialogue, a decision point, each branch route, each route ending, flashback, epilogue, and teaser when present.
Do not create plot nodes for selectable option text. Options belong only on graph edges, which the server derives from canonical options.
Titles must be concise Chinese labels copied or minimally shortened from visible section headings, route names, or ending names. Do not summarize dialogue as a new event.
Keep ordinary consecutive dialogue/action rows in the same plot node until a real story section, branch target, ending, flashback, or epilogue boundary.`;

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
