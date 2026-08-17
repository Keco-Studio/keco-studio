/**
 * Maps persisted agent_messages rows to frontend ChatItem[] for history display.
 */

import type { ChatItem } from './types';
import { deriveUserDisplay } from './userMessageDisplay';
import { getMessageText } from '@/lib/agent/content-parts';
import type { ChatMessage } from '@/lib/agent/types';
import { parseGameDesignRuleEvidence, type GameDesignRuleEvidence } from '@/lib/game-design-system/agentEvidence';

export interface HistoryMessageRow {
  id: string;
  role: string;
  content: Record<string, unknown>;
}

interface ToolCallRef {
  id: string;
  function?: { name?: string; arguments?: string };
}

function textFromBody(body: Record<string, unknown>): string {
  const content = body.content;
  if (typeof content === 'string') return content;
  // Multimodal user messages persist content as a part array; show their text.
  if (Array.isArray(content)) return getMessageText(content as ChatMessage['content']);
  return '';
}

/** Extract image URLs from a persisted multimodal message body, in order. */
function imageUrlsFromBody(body: Record<string, unknown>): string[] {
  const content = body.content;
  if (!Array.isArray(content)) return [];
  const urls: string[] = [];
  for (const part of content) {
    if (
      part &&
      typeof part === 'object' &&
      (part as { type?: unknown }).type === 'image_url'
    ) {
      const url = (part as { image_url?: { url?: unknown } }).image_url?.url;
      if (typeof url === 'string') urls.push(url);
    }
  }
  return urls;
}

function parseToolData(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toolNameFromCall(tc: ToolCallRef): string {
  return tc.function?.name ?? 'tool';
}

export function mapHistoryMessagesToChatItems(messages: HistoryMessageRow[]): ChatItem[] {
  const loaded: ChatItem[] = [];
  let turnItems: ChatItem[] = [];
  let assistantSegments: Array<{ id: string; text: string; evidence?: GameDesignRuleEvidence }> = [];
  let i = 0;

  const flushTurn = () => {
    loaded.push(...turnItems);
    const text = assistantSegments
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join('\n\n');
    const lastAssistant = assistantSegments.at(-1);
    const evidence = assistantSegments.findLast((segment) => segment.evidence)?.evidence;
    if (text && lastAssistant) {
      loaded.push({ id: lastAssistant.id, role: 'assistant', text, ...(evidence ? { gameDesignEvidence: evidence } : {}) });
    }
    turnItems = [];
    assistantSegments = [];
  };

  while (i < messages.length) {
    const m = messages[i];
    const body = (m.content ?? {}) as Record<string, unknown>;
    const text = textFromBody(body);

    if (m.role === 'user' && text) {
      flushTurn();
      const display = deriveUserDisplay(text, imageUrlsFromBody(body));
      loaded.push({ id: m.id, role: 'user', text: display.text, attachments: display.attachments });
      i++;
      continue;
    }

    if (m.role === 'assistant') {
      const toolCalls = Array.isArray(body.tool_calls) ? (body.tool_calls as ToolCallRef[]) : [];

      if (text) {
        assistantSegments.push({
          id: m.id,
          text,
          evidence: parseGameDesignRuleEvidence(body.game_design_evidence),
        });
      }

      if (toolCalls.length > 0) {
        const toolById = new Map<string, HistoryMessageRow>();
        let j = i + 1;
        while (j < messages.length && messages[j].role === 'tool') {
          const toolBody = (messages[j].content ?? {}) as Record<string, unknown>;
          const tid = typeof toolBody.tool_call_id === 'string' ? toolBody.tool_call_id : '';
          if (tid) toolById.set(tid, messages[j]);
          j++;
        }

        for (const tc of toolCalls) {
          const toolRow = toolById.get(tc.id);
          if (!toolRow) continue;
          const toolBody = (toolRow.content ?? {}) as Record<string, unknown>;
          const toolText = textFromBody(toolBody);
          const name =
            (typeof toolBody.name === 'string' && toolBody.name) || toolNameFromCall(tc);
          turnItems.push({
            id: toolRow.id,
            role: 'tool',
            toolCall: { tool: name, status: 'success', data: parseToolData(toolText) },
          });
        }

        i = j;
        continue;
      }

      i++;
      continue;
    }

    if (m.role === 'tool') {
      const toolName = typeof body.name === 'string' ? body.name : 'tool';
      turnItems.push({
        id: m.id,
        role: 'tool',
        toolCall: { tool: toolName, status: 'success', data: parseToolData(text) },
      });
      i++;
      continue;
    }

    i++;
  }

  flushTurn();
  return loaded;
}
