'use client';

import { useEffect } from 'react';
import styles from './ChatPanel.module.css';
import type { ConfirmationView } from './types';
import { AssistantMarkdown } from './AssistantMarkdown';
import {
  clearStoryGraphPreview,
  showStoryGraphPreview,
  type StoryGraphFlowPreview,
} from '@/lib/script-system/storyGraphPreviewEvents';

interface Props {
  confirmation: ConfirmationView;
  disabled: boolean;
  onDecision: (actionId: string, decision: 'approve' | 'reject') => void;
}

const TOOL_LABELS: Record<string, string> = {
  create_asset: 'Create asset',
  update_asset: 'Update asset',
  delete_asset: 'Delete asset',
  set_conversation_option: 'Change conversation option',
  propose_document_edit: 'Apply document edit',
  delete_document: 'Delete document permanently',
  rename_document: 'Rename document',
  move_document: 'Move document',
  generate_from_document: 'Generate from document',
  insert_resource_reference: 'Insert reference',
  propose_story_graph_edit: 'Modify story graph',
};

type StoryGraphSummary = {
  nodeCount: number;
  edgeCount: number;
  endingCount: number;
  unreachableCount: number;
  entryToEndingPathCount: string;
};

type StoryGraphEditPreview = {
  type: 'story_graph_edit';
  libraryId: string;
  libraryName: string;
  createdNodes: Array<{
    label: string;
    title?: string;
    contentSummary: string;
    rowIndex: number;
    placement?: {
      relation: 'before' | 'after' | 'end';
      anchorTitle?: string;
    };
  }>;
  plotGraph?: StoryGraphFlowPreview;
  edgeChanges: Array<{
    kind: 'added' | 'removed' | 'redirected' | 'next_changed' | 'ending_changed' | 'entry_changed';
    fromLabel: string;
    text?: string;
    fromTarget?: string | null;
    toTarget?: string | null;
  }>;
  affectedRows: number[];
  addedFields: string[];
  warnings: Array<{ code: 'unreachable_node'; label: string }>;
  before: StoryGraphSummary;
  after: StoryGraphSummary;
};

function isStoryGraphEditPreview(value: unknown): value is StoryGraphEditPreview {
  if (!value || typeof value !== 'object') return false;
  const preview = value as Partial<StoryGraphEditPreview>;
  return (
    preview.type === 'story_graph_edit' &&
    typeof preview.libraryId === 'string' &&
    typeof preview.libraryName === 'string' &&
    Array.isArray(preview.createdNodes) &&
    Array.isArray(preview.edgeChanges) &&
    Array.isArray(preview.affectedRows) &&
    Array.isArray(preview.addedFields) &&
    Array.isArray(preview.warnings) &&
    Boolean(preview.before) &&
    Boolean(preview.after)
  );
}

export function shouldShowStoryGraphPreview(
  resolved: ConfirmationView['resolved']
): boolean {
  return resolved === undefined;
}

export type DiffRow = {
  kind: 'context' | 'added' | 'removed' | 'collapsed';
  text: string;
};

const DIFF_CONTEXT_LINES = 3;
const MAX_CHANGED_LINES = 40;
const MAX_RENDERED_DIFF_ROWS = 240;
const MAX_MYERS_TRACE_CELLS = 250_000;
const MAX_MYERS_TOTAL_LINES = 10_000;

function pushChangedRun(
  target: DiffRow[],
  rows: DiffRow[],
  start: number,
  end: number,
  kind: 'added' | 'removed'
): void {
  const length = end - start;
  if (length <= MAX_CHANGED_LINES) {
    for (let index = start; index < end; index++) target.push(rows[index]!);
    return;
  }
  const edgeLines = MAX_CHANGED_LINES / 2;
  for (let index = start; index < start + edgeLines; index++) target.push(rows[index]!);
  target.push({
    kind: 'collapsed',
    text: `${length - MAX_CHANGED_LINES} ${kind} lines omitted`,
  });
  for (let index = end - edgeLines; index < end; index++) target.push(rows[index]!);
}

function backtrackLineDiff(
  trace: Array<Map<number, number>>,
  base: string[],
  proposed: string[]
): DiffRow[] {
  let x = base.length;
  let y = proposed.length;
  const rows: DiffRow[] = [];

  for (let depth = trace.length - 1; depth >= 0; depth--) {
    const previous = trace[depth]!;
    const diagonal = x - y;
    const previousDiagonal =
      diagonal === -depth ||
      (diagonal !== depth &&
        (previous.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY) <
          (previous.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY))
        ? diagonal + 1
        : diagonal - 1;
    const previousX = previous.get(previousDiagonal) ?? 0;
    const previousY = previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      rows.push({ kind: 'context', text: base[x - 1]! });
      x -= 1;
      y -= 1;
    }
    if (depth === 0) break;
    if (x === previousX) {
      rows.push({ kind: 'added', text: proposed[y - 1]! });
      y -= 1;
    } else {
      rows.push({ kind: 'removed', text: base[x - 1]! });
      x -= 1;
    }
  }

  return rows.reverse();
}

function myersLineDiff(base: string[], proposed: string[]): DiffRow[] | null {
  const maximumDepth = base.length + proposed.length;
  const furthestX = new Map<number, number>([[1, 0]]);
  const trace: Array<Map<number, number>> = [];
  let traceCells = 0;

  for (let depth = 0; depth <= maximumDepth; depth++) {
    trace.push(new Map(furthestX));
    traceCells += furthestX.size;
    if (traceCells > MAX_MYERS_TRACE_CELLS) return null;

    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      const left = furthestX.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY;
      const right = furthestX.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
      let x = diagonal === -depth || (diagonal !== depth && left < right) ? right : left + 1;
      if (!Number.isFinite(x)) x = 0;
      let y = x - diagonal;

      while (x < base.length && y < proposed.length && base[x] === proposed[y]) {
        x += 1;
        y += 1;
      }
      furthestX.set(diagonal, x);
      if (x >= base.length && y >= proposed.length) {
        return backtrackLineDiff(trace, base, proposed);
      }
    }
  }
  return null;
}

function appendRange(
  target: DiffRow[],
  source: string[],
  start: number,
  end: number,
  kind: 'added' | 'removed'
): void {
  for (let index = start; index < end; index++) {
    target.push({ kind, text: source[index]! });
  }
}

/**
 * Linear fallback for high edit distances and line-dense documents. Matching
 * each base line to the earliest still-available equal proposed line produces
 * a valid monotonic edit script, including for duplicate line runs.
 */
function boundedLineDiff(base: string[], proposed: string[]): DiffRow[] {
  type PositionQueue = { positions: number[]; cursor: number };
  const proposedPositions = new Map<string, PositionQueue>();
  for (let index = 0; index < proposed.length; index++) {
    let queue = proposedPositions.get(proposed[index]!);
    if (!queue) {
      queue = { positions: [], cursor: 0 };
      proposedPositions.set(proposed[index]!, queue);
    }
    queue.positions.push(index);
  }

  const rows: DiffRow[] = [];
  let baseStart = 0;
  let proposedStart = 0;
  for (let baseIndex = 0; baseIndex < base.length; baseIndex++) {
    const queue = proposedPositions.get(base[baseIndex]!);
    if (!queue) continue;
    while (
      queue.cursor < queue.positions.length &&
      queue.positions[queue.cursor]! < proposedStart
    ) {
      queue.cursor += 1;
    }
    if (queue.cursor >= queue.positions.length) continue;

    const proposedIndex = queue.positions[queue.cursor]!;
    queue.cursor += 1;
    appendRange(rows, base, baseStart, baseIndex, 'removed');
    appendRange(rows, proposed, proposedStart, proposedIndex, 'added');
    rows.push({ kind: 'context', text: base[baseIndex]! });
    baseStart = baseIndex + 1;
    proposedStart = proposedIndex + 1;
  }
  appendRange(rows, base, baseStart, base.length, 'removed');
  appendRange(rows, proposed, proposedStart, proposed.length, 'added');
  return rows;
}

function collapseDiffRows(rows: DiffRow[]): DiffRow[] {
  const collapsed: DiffRow[] = [];
  let index = 0;
  while (index < rows.length) {
    const kind = rows[index]!.kind;
    let end = index + 1;
    while (end < rows.length && rows[end]!.kind === kind) end += 1;
    const runLength = end - index;

    if (kind === 'added' || kind === 'removed') {
      pushChangedRun(collapsed, rows, index, end, kind);
    } else {
      const leading = index === 0;
      const trailing = end === rows.length;
      if (leading && trailing) {
        for (let rowIndex = index; rowIndex < end; rowIndex++) collapsed.push(rows[rowIndex]!);
      } else if (leading) {
        const visibleStart = Math.max(index, end - DIFF_CONTEXT_LINES);
        if (visibleStart > index) {
          collapsed.push({ kind: 'collapsed', text: `${visibleStart - index} unchanged lines` });
        }
        for (let rowIndex = visibleStart; rowIndex < end; rowIndex++) {
          collapsed.push(rows[rowIndex]!);
        }
      } else if (trailing) {
        const visibleEnd = Math.min(end, index + DIFF_CONTEXT_LINES);
        for (let rowIndex = index; rowIndex < visibleEnd; rowIndex++) {
          collapsed.push(rows[rowIndex]!);
        }
        if (visibleEnd < end) {
          collapsed.push({ kind: 'collapsed', text: `${end - visibleEnd} unchanged lines` });
        }
      } else if (runLength > DIFF_CONTEXT_LINES * 2) {
        for (let rowIndex = index; rowIndex < index + DIFF_CONTEXT_LINES; rowIndex++) {
          collapsed.push(rows[rowIndex]!);
        }
        collapsed.push({
          kind: 'collapsed',
          text: `${runLength - DIFF_CONTEXT_LINES * 2} unchanged lines`,
        });
        for (let rowIndex = end - DIFF_CONTEXT_LINES; rowIndex < end; rowIndex++) {
          collapsed.push(rows[rowIndex]!);
        }
      } else {
        for (let rowIndex = index; rowIndex < end; rowIndex++) collapsed.push(rows[rowIndex]!);
      }
    }
    index = end;
  }

  if (collapsed.length <= MAX_RENDERED_DIFF_ROWS) return collapsed;
  const leadingRows = Math.floor((MAX_RENDERED_DIFF_ROWS - 1) / 2);
  const trailingRows = MAX_RENDERED_DIFF_ROWS - leadingRows - 1;
  const bounded: DiffRow[] = [];
  for (let index = 0; index < leadingRows; index++) bounded.push(collapsed[index]!);
  bounded.push({
    kind: 'collapsed',
    text: `${collapsed.length - leadingRows - trailingRows} diff rows omitted`,
  });
  for (let index = collapsed.length - trailingRows; index < collapsed.length; index++) {
    bounded.push(collapsed[index]!);
  }
  return bounded;
}

export function buildDocumentEditDiff(baseMarkdown: string, proposedMarkdown: string): DiffRow[] {
  const base = baseMarkdown.split('\n');
  const proposed = proposedMarkdown.split('\n');
  if (baseMarkdown === proposedMarkdown) {
    return [{ kind: 'context', text: 'No content changes.' }];
  }
  const rows =
    base.length + proposed.length <= MAX_MYERS_TOTAL_LINES
      ? myersLineDiff(base, proposed) ?? boundedLineDiff(base, proposed)
      : boundedLineDiff(base, proposed);
  return collapseDiffRows(rows);
}

/** Plain chat text for document edit previews — no scrollable diff chrome. */
export function formatDocumentEditPlainText(rows: DiffRow[], proposedMarkdown: string): string {
  const added = rows
    .filter((row) => row.kind === 'added')
    .map((row) => row.text)
    .join('\n')
    .trim();
  const removed = rows
    .filter((row) => row.kind === 'removed')
    .map((row) => row.text)
    .join('\n')
    .trim();

  if (added && removed) {
    return `${added}\n\nRemoved:\n${removed}`;
  }
  if (added) return added;
  if (removed) return `Removed:\n${removed}`;
  return proposedMarkdown.trim();
}

type ChangeParts =
  | { kind: 'pair'; from: string; to: string }
  | { kind: 'text'; text: string };

function summarizeChangeParts(
  args: unknown,
  preview:
    | {
        existingValues?: Record<string, unknown>;
        changes?: Array<{ field: string; value: unknown }>;
        type?: string;
      }
    | undefined,
  label: string
): ChangeParts {
  const asRecord = args && typeof args === 'object' ? (args as Record<string, unknown>) : null;

  if (preview?.type === 'update_row' && Array.isArray(preview.changes) && preview.changes.length > 0) {
    const change = preview.changes[0]!;
    const previous = preview.existingValues?.[change.field];
    if (previous !== undefined && previous !== null && String(previous).trim()) {
      return { kind: 'pair', from: String(previous), to: String(change.value) };
    }
    return { kind: 'pair', from: change.field, to: String(change.value) };
  }

  if (!asRecord) return { kind: 'text', text: `Please confirm: ${label}` };

  const propertyValues =
    asRecord.propertyValues && typeof asRecord.propertyValues === 'object'
      ? (asRecord.propertyValues as Record<string, unknown>)
      : null;
  const existingValues =
    preview?.existingValues && typeof preview.existingValues === 'object'
      ? preview.existingValues
      : null;

  if (propertyValues && Object.keys(propertyValues).length > 0) {
    const [field, nextValue] = Object.entries(propertyValues)[0]!;
    const previousValue = existingValues?.[field];
    if (previousValue !== undefined && previousValue !== null && String(previousValue).trim()) {
      return { kind: 'pair', from: String(previousValue), to: String(nextValue) };
    }
    return { kind: 'pair', from: field, to: String(nextValue) };
  }

  const fromValue = asRecord.from ?? asRecord.find ?? asRecord.oldValue ?? asRecord.target;
  const toValue = asRecord.to ?? asRecord.replace ?? asRecord.newValue ?? asRecord.replacement;
  if (fromValue !== undefined && toValue !== undefined) {
    return { kind: 'pair', from: String(fromValue), to: String(toValue) };
  }

  if (typeof asRecord.name === 'string') return { kind: 'text', text: asRecord.name };
  return { kind: 'text', text: `Please confirm: ${label}` };
}

export function ConfirmationCard({ confirmation, disabled, onDecision }: Props) {
  const { actionId, tool, args, resolved } = confirmation;
  const label = TOOL_LABELS[tool] ?? tool;
  const storyGraphPreview = isStoryGraphEditPreview(confirmation.preview)
    ? confirmation.preview
    : undefined;
  useEffect(() => {
    if (!storyGraphPreview?.plotGraph || !shouldShowStoryGraphPreview(resolved)) return;
    showStoryGraphPreview({
      actionId,
      libraryId: storyGraphPreview.libraryId,
      graph: storyGraphPreview.plotGraph,
    });
    return () => clearStoryGraphPreview(actionId);
  }, [actionId, resolved, storyGraphPreview]);
  const documentPreview = confirmation.preview as
    | {
        type?: string;
        documentId?: string;
        name?: string;
        documentName?: string;
        folderName?: string | null;
        operationType?: string;
        operationSummary?: string;
        baseMarkdown?: string;
        proposedMarkdown?: string;
        existingValues?: Record<string, unknown>;
        changes?: Array<{ field: string; value: unknown }>;
        exportType?: 'table' | 'script';
        libraryName?: string;
        summary?: string;
        kind?: string;
        fallbackLabel?: string;
        snippet?: string;
      }
    | undefined;
  const isDocumentEdit =
    documentPreview?.type === 'document_edit' &&
    typeof documentPreview.baseMarkdown === 'string' &&
    typeof documentPreview.proposedMarkdown === 'string';
  const isDocumentDelete =
    documentPreview?.type === 'document_delete' &&
    typeof documentPreview.name === 'string';
  const isGenerateFromDocument =
    documentPreview?.type === 'generate_from_document' &&
    typeof documentPreview.name === 'string' &&
    (documentPreview.exportType === 'table' || documentPreview.exportType === 'script');
  const isInsertResourceReference =
    documentPreview?.type === 'insert_resource_reference' &&
    typeof documentPreview.name === 'string' &&
    typeof documentPreview.summary === 'string';
  const isBoundDocument =
    !isDocumentEdit &&
    !isDocumentDelete &&
    !isGenerateFromDocument &&
    !isInsertResourceReference &&
    typeof documentPreview?.documentId === 'string' &&
    typeof documentPreview.name === 'string';
  const diff = isDocumentEdit
    ? buildDocumentEditDiff(documentPreview.baseMarkdown!, documentPreview.proposedMarkdown!)
    : [];
  const documentEditPlainText = isDocumentEdit
    ? formatDocumentEditPlainText(diff, documentPreview.proposedMarkdown!)
    : '';

  const changeParts = summarizeChangeParts(args, documentPreview, label);
  const useSimpleCard =
    !storyGraphPreview &&
    !isDocumentEdit &&
    !isDocumentDelete &&
    !isBoundDocument &&
    !isGenerateFromDocument &&
    !isInsertResourceReference;

  if (storyGraphPreview) {
    return (
      <div
        className={styles.confirmCard}
        data-testid="agent-confirmation"
        role="group"
        aria-label="Confirmation required"
      >
        <div className={styles.confirmTitle}>
          {resolved === 'approved'
            ? '正在应用剧情修改...'
            : resolved === 'rejected'
              ? '已取消剧情修改'
              : '确认剧情修改'}
        </div>
        <div className={styles.graphPreviewTarget}>{storyGraphPreview.libraryName}</div>

        {storyGraphPreview.createdNodes.length > 0 ? (
          <section className={styles.graphIntentList} aria-label="待添加节点">
            {storyGraphPreview.createdNodes.map((node) => (
              <div className={styles.graphIntent} key={`${node.label}-${node.rowIndex}`}>
                <strong>添加「{node.title ?? node.contentSummary}」</strong>
                <span className={styles.graphIntentLocation}>
                  {node.placement?.relation === 'before' && node.placement.anchorTitle
                    ? `在「${node.placement.anchorTitle}」之前`
                    : node.placement?.relation === 'after' && node.placement.anchorTitle
                      ? `在「${node.placement.anchorTitle}」之后`
                      : '在剧情末尾'}
                </span>
                {node.contentSummary ? (
                  <span className={styles.graphIntentContent}>{node.contentSummary}</span>
                ) : null}
              </div>
            ))}
          </section>
        ) : (
          <div className={styles.graphIntentFallback}>将更新剧情节点之间的连接关系</div>
        )}
        {storyGraphPreview.warnings.length > 0 ? (
          <div className={styles.graphWarning}>
            修改后有 {storyGraphPreview.warnings.length} 个节点无法从入口到达
          </div>
        ) : null}

        {resolved ? (
          <div className={styles.resolvedNote}>
            {resolved === 'approved' ? 'Approved.' : 'Cancelled.'}
          </div>
        ) : (
          <div className={styles.confirmInlineActions}>
            <button
              className={`${styles.btn} ${styles.btnPillPrimary}`}
              data-testid="agent-confirm"
              disabled={disabled}
              aria-label="Approve action"
              onClick={() => onDecision(actionId, 'approve')}
            >
              ✓ Confirm
            </button>
            <button
              className={`${styles.btn} ${styles.btnPillGhost}`}
              data-testid="agent-reject"
              disabled={disabled}
              aria-label="Reject action"
              onClick={() => onDecision(actionId, 'reject')}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  if (isInsertResourceReference) {
    const location = documentPreview.folderName
      ? `${documentPreview.name} / ${documentPreview.folderName}`
      : documentPreview.name;
    const kindLabel =
      documentPreview.kind === 'document-block'
        ? 'document block'
        : documentPreview.kind === 'table-row'
          ? 'table row'
          : 'resource';
    return (
      <div
        className={styles.confirmCard}
        data-testid="agent-confirmation"
        role="group"
        aria-label="Confirmation required"
      >
        <div className={styles.confirmTitle}>
          {resolved === 'approved'
            ? 'Inserting reference…'
            : resolved === 'rejected'
              ? 'Reference insert cancelled.'
              : 'Confirm: Insert reference'}
        </div>
        <div className={styles.documentEditMeta}>
          <div className={styles.documentEditTarget}>{location}</div>
          <div>{documentPreview.summary}</div>
          {typeof documentPreview.fallbackLabel === 'string' &&
          documentPreview.fallbackLabel.trim() ? (
            <div>
              {kindLabel}: {documentPreview.fallbackLabel}
            </div>
          ) : null}
        </div>
        {resolved === 'approved' ? (
          <div className={styles.resolvedNote}>Approved.</div>
        ) : resolved === 'rejected' ? (
          <div className={styles.resolvedNote}>Cancelled.</div>
        ) : (
          <div className={styles.confirmInlineActions}>
            <button
              className={`${styles.btn} ${styles.btnPillPrimary}`}
              data-testid="agent-confirm"
              disabled={disabled}
              aria-label="Approve action"
              onClick={() => onDecision(actionId, 'approve')}
            >
              ✓ Confirm
            </button>
            <button
              className={`${styles.btn} ${styles.btnPillGhost}`}
              data-testid="agent-reject"
              disabled={disabled}
              aria-label="Reject action"
              onClick={() => onDecision(actionId, 'reject')}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  if (isGenerateFromDocument) {
    const kind = documentPreview.exportType === 'table' ? 'table' : 'conversation';
    const location = documentPreview.folderName
      ? `${documentPreview.name} / ${documentPreview.folderName}`
      : documentPreview.name;
    const detail =
      typeof documentPreview.summary === 'string' && documentPreview.summary.trim()
        ? documentPreview.summary
        : `Generate ${kind} from document "${documentPreview.name}"`;
    return (
      <div
        className={styles.confirmCard}
        data-testid="agent-confirmation"
        role="group"
        aria-label="Confirmation required"
      >
        <div className={styles.confirmTitle}>
          {resolved === 'approved'
            ? `Generating ${kind}…`
            : resolved === 'rejected'
              ? 'Generation cancelled.'
              : `Confirm: Generate ${kind}`}
        </div>
        <div className={styles.documentEditMeta}>
          <div className={styles.documentEditTarget}>{location}</div>
          <div>{detail}</div>
          {typeof documentPreview.libraryName === 'string' && documentPreview.libraryName.trim() ? (
            <div>Result: {documentPreview.libraryName}</div>
          ) : null}
        </div>
        {resolved === 'approved' ? (
          <div className={styles.resolvedNote}>Approved.</div>
        ) : resolved === 'rejected' ? (
          <div className={styles.resolvedNote}>Cancelled.</div>
        ) : (
          <div className={styles.confirmInlineActions}>
            <button
              className={`${styles.btn} ${styles.btnPillPrimary}`}
              data-testid="agent-confirm"
              disabled={disabled}
              aria-label="Approve action"
              onClick={() => onDecision(actionId, 'approve')}
            >
              ✓ Confirm
            </button>
            <button
              className={`${styles.btn} ${styles.btnPillGhost}`}
              data-testid="agent-reject"
              disabled={disabled}
              aria-label="Reject action"
              onClick={() => onDecision(actionId, 'reject')}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  if (useSimpleCard) {
    return (
      <div
        className={styles.confirmCard}
        data-testid="agent-confirmation"
        role="group"
        aria-label="Confirmation required"
      >
        <div className={styles.confirmSimpleTitle}>
          {resolved === 'approved'
            ? 'Modification successful!'
            : resolved === 'rejected'
              ? 'Modification cancelled.'
              : 'Confirm this change:'}
        </div>
        <div className={styles.confirmSimpleChange}>
          {changeParts.kind === 'pair' ? (
            <span className={styles.confirmSimpleChangeRow}>
              <span className={styles.entityChip}>{changeParts.from}</span>
              {' has been changed to '}
              <span className={styles.entityChip}>{changeParts.to}</span>
            </span>
          ) : (
            changeParts.text
          )}
        </div>

        {resolved ? null : (
          <div className={styles.confirmInlineActions}>
            <button
              className={`${styles.btn} ${styles.btnPillPrimary}`}
              data-testid="agent-confirm"
              disabled={disabled}
              aria-label="Approve action"
              onClick={() => onDecision(actionId, 'approve')}
            >
              ✓ Confirm
            </button>
            <button
              className={`${styles.btn} ${styles.btnPillGhost}`}
              data-testid="agent-reject"
              disabled={disabled}
              aria-label="Reject action"
              onClick={() => onDecision(actionId, 'reject')}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={styles.confirmCard}
      data-testid="agent-confirmation"
      role="group"
      aria-label="Confirmation required"
    >
      <div className={styles.confirmTitle}>Confirm: {label}</div>
      {isDocumentEdit &&
        typeof documentPreview.documentName === 'string' &&
        typeof documentPreview.operationSummary === 'string' && (
          <div className={styles.documentEditMeta}>
            <div className={styles.documentEditTarget}>
              {documentPreview.documentName}
              {documentPreview.folderName ? ` / ${documentPreview.folderName}` : ''}
            </div>
            <div>{documentPreview.operationSummary}</div>
          </div>
        )}
      {isDocumentDelete && (
        <div className={styles.documentEditMeta}>
          <div className={styles.documentEditTarget}>
            {documentPreview.name}
            {documentPreview.folderName ? ` / ${documentPreview.folderName}` : ''}
          </div>
          <div>
            This document will be permanently deleted. This action is irreversible and cannot be
            undone.
          </div>
        </div>
      )}
      {isBoundDocument && (
        <div className={styles.documentEditMeta}>
          <div className={styles.documentEditTarget}>
            {documentPreview.name}
            {documentPreview.folderName ? ` / ${documentPreview.folderName}` : ''}
          </div>
          <div>Bound document</div>
        </div>
      )}
      {isDocumentEdit && documentEditPlainText ? (
        <div className={styles.documentEditBody} aria-label="Document changes">
          <AssistantMarkdown markdown={documentEditPlainText} />
        </div>
      ) : null}

      {resolved ? (
        <div className={styles.resolvedNote}>
          {resolved === 'approved' ? 'Approved.' : 'Cancelled.'}
        </div>
      ) : (
        <div className={styles.confirmInlineActions}>
          <button
            className={`${styles.btn} ${styles.btnPillPrimary}`}
            data-testid="agent-confirm"
            disabled={disabled}
            aria-label="Approve action"
            onClick={() => onDecision(actionId, 'approve')}
          >
            ✓ Confirm
          </button>
          <button
            className={`${styles.btn} ${styles.btnPillGhost}`}
            data-testid="agent-reject"
            disabled={disabled}
            aria-label="Reject action"
            onClick={() => onDecision(actionId, 'reject')}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export default ConfirmationCard;
