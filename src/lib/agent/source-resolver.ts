import type { ToolContext } from './types';
import { isDesignDocumentMessage, stripDesignDocumentPrefix } from './chunking';

export interface AgentImportSourceParams {
  sourceText?: unknown;
  sourceStart?: unknown;
  sourceEnd?: unknown;
}

export interface ResolvedAgentImportSource {
  sourceId: string;
  content: string;
  messageId?: string;
  start: number;
  end: number;
}

export function resolveSourceSpan(content: string, start: number, end: number): string {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > content.length) {
    throw new Error('Source offsets are outside the stored user message');
  }
  if (end <= start) throw new Error('Source span must be non-empty');
  return content.slice(start, end);
}

export function resolveAgentImportSource(
  params: AgentImportSourceParams,
  ctx: ToolContext
): ResolvedAgentImportSource {
  const authoritative = ctx.authoritativeUserSource;
  if (authoritative) {
    const hasStart = params.sourceStart !== undefined;
    const hasEnd = params.sourceEnd !== undefined;
    if (hasStart !== hasEnd) {
      throw new Error('Both sourceStart and sourceEnd are required when selecting a source span');
    }
    const start = hasStart ? requireInteger(params.sourceStart, 'sourceStart') : 0;
    const end = hasEnd ? requireInteger(params.sourceEnd, 'sourceEnd') : authoritative.content.length;
    const content = resolveSourceSpan(authoritative.content, start, end);
    return {
      sourceId: `agent-message:${authoritative.messageId}:${start}-${end}`,
      content,
      messageId: authoritative.messageId,
      start,
      end,
    };
  }

  if (typeof params.sourceText !== 'string' || !params.sourceText.trim()) {
    throw new Error('No authoritative user source is available for this import');
  }
  return {
    sourceId: 'agent-legacy-source',
    content: params.sourceText,
    start: 0,
    end: params.sourceText.length,
  };
}

export function resolveVerbatimDocumentSource(
  params: Pick<AgentImportSourceParams, 'sourceStart' | 'sourceEnd'>,
  ctx: ToolContext
): ResolvedAgentImportSource {
  const authoritative = ctx.authoritativeUserSource;
  if (!authoritative) {
    throw new Error('No authoritative user source is available for this document append');
  }

  const hasExplicitRange = params.sourceStart !== undefined || params.sourceEnd !== undefined;
  const resolved = resolveAgentImportSource(params, ctx);
  if (hasExplicitRange || !isDesignDocumentMessage(authoritative.content)) {
    return resolved;
  }

  const content = stripDesignDocumentPrefix(authoritative.content);
  const start = authoritative.content.length - content.length;
  return {
    sourceId: `agent-message:${authoritative.messageId}:${start}-${authoritative.content.length}`,
    content,
    messageId: authoritative.messageId,
    start,
    end: authoritative.content.length,
  };
}

function requireInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
  return value;
}
