/**
 * Maps persisted agent_messages rows to frontend ChatItem[] for history display.
 */

import type { ChatItem } from './types';
import { deriveUserDisplay } from './userMessageDisplay';

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
  return typeof body.content === 'string' ? body.content : '';
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
  let i = 0;

  while (i < messages.length) {
    const m = messages[i];
    const body = (m.content ?? {}) as Record<string, unknown>;
    const text = textFromBody(body);

    if (m.role === 'user' && text) {
      const display = deriveUserDisplay(text);
      loaded.push({ id: m.id, role: 'user', text: display.text, attachments: display.attachments });
      i++;
      continue;
    }

    if (m.role === 'assistant') {
      const toolCalls = Array.isArray(body.tool_calls) ? (body.tool_calls as ToolCallRef[]) : [];

      if (toolCalls.length > 0) {
        if (text) {
          loaded.push({ id: m.id, role: 'assistant', text });
        }

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
          loaded.push({
            id: toolRow.id,
            role: 'tool',
            toolCall: { tool: name, status: 'success', data: parseToolData(toolText) },
          });
        }

        i = j;
        continue;
      }

      if (text) {
        loaded.push({ id: m.id, role: 'assistant', text });
      }
      i++;
      continue;
    }

    if (m.role === 'tool') {
      const toolName = typeof body.name === 'string' ? body.name : 'tool';
      loaded.push({
        id: m.id,
        role: 'tool',
        toolCall: { tool: toolName, status: 'success', data: parseToolData(text) },
      });
      i++;
      continue;
    }

    i++;
  }

  return loaded;
}
