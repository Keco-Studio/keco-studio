/**
 * Text chunking strategies for agent vector indexing.
 */

import { createHash } from 'crypto';
import {
  AGENT_CHAT_LONG_MESSAGE_CHARS,
  AGENT_CHAT_TURN_GROUP_MAX_MESSAGES,
  AGENT_CHAT_TURN_GROUP_MIN_MESSAGES,
  AGENT_CHAT_TURN_GROUP_GAP_MINUTES,
  AGENT_LIBRARY_ROW_MIN_CHARS,
} from './embedding-config';
import type { LibrarySchemaData } from './library-schema-builder';

export interface IndexableChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

export interface ChatTurnGroup {
  chunkIndex: number;
  messageIds: string[];
  messages: IndexableChatMessage[];
  firstMessageAt: string;
  lastMessageAt: string;
}

export interface DesignDocChunk {
  chunkIndex: number;
  content: string;
  chunkHeading?: string;
}

export interface TurnGroupOptions {
  maxMessages?: number;
  minMessages?: number;
  gapMinutes?: number;
  longMessageChars?: number;
}

const DESIGN_DOC_PREFIX = '[Design document]';

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function isDesignDocumentMessage(text: string): boolean {
  return text.trimStart().startsWith(DESIGN_DOC_PREFIX);
}

export function stripDesignDocumentPrefix(text: string): string {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith(DESIGN_DOC_PREFIX)) return text;
  return trimmed.slice(DESIGN_DOC_PREFIX.length).replace(/^\s*\n?/, '');
}

function parseTime(iso: string): number {
  return new Date(iso).getTime();
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function formatChatTurnGroupText(messages: IndexableChatMessage[]): string {
  return messages
    .map((m) => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      return `[${formatTimestamp(m.createdAt)}] ${role}: ${m.text}`;
    })
    .join('\n');
}

function sealGroup(
  messages: IndexableChatMessage[],
  chunkIndex: number
): ChatTurnGroup {
  return {
    chunkIndex,
    messageIds: messages.map((m) => m.id),
    messages,
    firstMessageAt: messages[0].createdAt,
    lastMessageAt: messages[messages.length - 1].createdAt,
  };
}

/**
 * Group adjacent user/assistant messages into turn groups with overlap.
 */
export function buildChatTurnGroups(
  input: IndexableChatMessage[],
  options: TurnGroupOptions = {}
): ChatTurnGroup[] {
  const maxMessages = options.maxMessages ?? AGENT_CHAT_TURN_GROUP_MAX_MESSAGES;
  const minMessages = options.minMessages ?? AGENT_CHAT_TURN_GROUP_MIN_MESSAGES;
  const gapMinutes = options.gapMinutes ?? AGENT_CHAT_TURN_GROUP_GAP_MINUTES;
  const longMessageChars = options.longMessageChars ?? AGENT_CHAT_LONG_MESSAGE_CHARS;
  const gapMs = gapMinutes * 60 * 1000;

  const messages = input.filter((m) => m.text.trim().length > 0);
  if (messages.length === 0) return [];

  const groups: ChatTurnGroup[] = [];
  let i = 0;
  let chunkIndex = 0;
  let overlapMessage: IndexableChatMessage | null = null;

  while (i < messages.length) {
    const batch: IndexableChatMessage[] = [];
    if (overlapMessage) {
      batch.push(overlapMessage);
      overlapMessage = null;
    }

    while (i < messages.length && batch.length < maxMessages) {
      const current = messages[i];
      if (current.text.length > longMessageChars) {
        if (batch.length > 0) break;
        groups.push(sealGroup([current], chunkIndex++));
        i++;
        break;
      }

      if (batch.length >= minMessages && i < messages.length) {
        const prev = batch[batch.length - 1];
        const next = messages[i];
        const gap = parseTime(next.createdAt) - parseTime(prev.createdAt);
        if (gap > gapMs) break;
      }

      batch.push(current);
      i++;
      if (batch.length >= maxMessages) break;
    }

    if (batch.length === 0) continue;
    if (batch.length === 1 && batch[0].text.length > longMessageChars) {
      continue;
    }

    groups.push(sealGroup(batch, chunkIndex++));

    if (i < messages.length && batch.length > 1) {
      overlapMessage = batch[batch.length - 1];
    }
  }

  return groups;
}

export function getTailTurnGroups(
  input: IndexableChatMessage[],
  tailCount = 2,
  options?: TurnGroupOptions
): ChatTurnGroup[] {
  const all = buildChatTurnGroups(input, options);
  return all.slice(Math.max(0, all.length - tailCount));
}

export interface DesignDocChunkOptions {
  targetChars?: number;
  overlapChars?: number;
  minChars?: number;
}

export function chunkDesignDocument(
  text: string,
  options: DesignDocChunkOptions = {}
): DesignDocChunk[] {
  const targetChars = options.targetChars ?? 500;
  const overlapChars = options.overlapChars ?? 100;
  const minChars = options.minChars ?? 50;

  const body = stripDesignDocumentPrefix(text).replace(/\r\n/g, '\n');
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return [];

  const chunks: DesignDocChunk[] = [];
  let buffer = '';
  let chunkIndex = 0;

  const flush = (heading?: string) => {
    const content = buffer.trim();
    if (content.length < minChars) {
      buffer = '';
      return;
    }
    chunks.push({ chunkIndex: chunkIndex++, content, chunkHeading: heading });
    const tail = content.slice(Math.max(0, content.length - overlapChars));
    buffer = tail;
  };

  for (const paragraph of paragraphs) {
    const heading = paragraph.length < 80 && !paragraph.includes('\n') ? paragraph : undefined;
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (candidate.length > targetChars && buffer.length >= minChars) {
      flush(chunks.length === 0 ? heading : undefined);
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      if (buffer.length > targetChars) {
        flush(heading);
      }
    } else {
      buffer = candidate;
      if (buffer.length >= targetChars) {
        flush(heading);
      }
    }
  }

  if (buffer.trim().length >= minChars) {
    chunks.push({ chunkIndex: chunkIndex++, content: buffer.trim() });
  }

  return chunks;
}

/** Media field types are skipped for library cell indexing. */
const SKIP_LIBRARY_FIELD_TYPES = new Set([
  'image',
  'file',
  'audio',
  'multimedia',
]);

export function isIndexableLibraryFieldType(dataType: string): boolean {
  return !SKIP_LIBRARY_FIELD_TYPES.has(dataType);
}

export function buildLibraryCellChunkText(
  libraryName: string,
  assetName: string,
  fieldLabel: string,
  cellText: string
): string {
  return `${libraryName} / ${assetName} / ${fieldLabel}: ${cellText}`;
}

export interface LibraryRowChunkField {
  label: string;
  displayValue: string;
  orderIndex: number;
}

export interface LibraryRowChunkInput {
  libraryName: string;
  rowIndex: number;
  assetName: string;
  primaryLabel?: string;
  fields: LibraryRowChunkField[];
}

const SCHEMA_ENUM_MAX_CHARS = 500;

function formatEnumOptions(options: string[]): string {
  const joined = options.join(', ');
  if (joined.length <= SCHEMA_ENUM_MAX_CHARS) return joined;
  let acc = '';
  let shown = 0;
  for (const opt of options) {
    const next = acc ? `${acc}, ${opt}` : opt;
    if (next.length > SCHEMA_ENUM_MAX_CHARS) break;
    acc = next;
    shown++;
  }
  const remaining = options.length - shown;
  return remaining > 0 ? `${acc} …(+${remaining} more)` : acc;
}

/**
 * Build indexable text for a full library row (non-empty visible fields only).
 * Returns null when the row should not be indexed (too short or empty Untitled row).
 */
export function buildLibraryRowChunkText(input: LibraryRowChunkInput): string | null {
  const sortedFields = [...input.fields]
    .filter((f) => f.displayValue.trim().length > 0)
    .sort((a, b) => a.orderIndex - b.orderIndex);

  if (sortedFields.length === 0 && input.assetName.trim() === 'Untitled') {
    return null;
  }

  const headlineLabel =
    input.primaryLabel?.trim() ||
    (input.assetName.trim() !== 'Untitled' ? input.assetName.trim() : '');
  const headline = headlineLabel
    ? `[${input.libraryName}] row ${input.rowIndex} · ${headlineLabel}`
    : `[${input.libraryName}] row ${input.rowIndex}`;

  const fieldLine = sortedFields.map((f) => `${f.label}: ${f.displayValue}`).join(' | ');
  const content = fieldLine ? `${headline}\n${fieldLine}` : headline;

  if (content.length < AGENT_LIBRARY_ROW_MIN_CHARS) return null;
  return content;
}

/** Build indexable text summarizing a library schema for semantic table discovery. */
export function buildLibrarySchemaChunkText(schema: LibrarySchemaData): string {
  const columnCount = schema.fields.length;
  const lines: string[] = [
    `[${schema.libraryName}] schema · ${columnCount} columns · ${schema.rowCount} non-empty rows`,
  ];

  if (schema.primaryLabelField) {
    lines.push(`Primary label: ${schema.primaryLabelField} (required)`);
  }

  lines.push('Columns:');
  for (const field of schema.fields) {
    const requiredSuffix = field.required ? ', required' : '';
    let detail = `- ${field.label} (${field.dataType}${requiredSuffix})`;
    if (field.label === schema.primaryLabelField) {
      detail += ' — main row identifier';
    }
    if (field.enumOptions?.length) {
      detail += ` — options: ${formatEnumOptions(field.enumOptions)}`;
    }
    lines.push(detail);
  }

  const refLibraries = schema.fields.flatMap((f) => f.referenceLibraries ?? []);
  lines.push(refLibraries.length > 0 ? `References: ${refLibraries.join(', ')}` : 'References: none');

  return lines.join('\n');
}
