'use client';

import styles from './ChatPanel.module.css';
import type { ConfirmationView } from './types';

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
};

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

export function ConfirmationCard({ confirmation, disabled, onDecision }: Props) {
  const { actionId, tool, args, resolved } = confirmation;
  const label = TOOL_LABELS[tool] ?? tool;
  const documentPreview = confirmation.preview as
    | {
        type?: string;
        documentName?: string;
        folderName?: string | null;
        operationType?: string;
        operationSummary?: string;
        baseMarkdown?: string;
        proposedMarkdown?: string;
      }
    | undefined;
  const isDocumentEdit =
    documentPreview?.type === 'document_edit' &&
    typeof documentPreview.baseMarkdown === 'string' &&
    typeof documentPreview.proposedMarkdown === 'string';
  let visibleArgs = args;
  if (isDocumentEdit && args && typeof args === 'object') {
    const rawArgs = args as Record<string, unknown>;
    const rawOperation = rawArgs.operation;
    const visibleOperation =
      rawOperation && typeof rawOperation === 'object'
        ? Object.fromEntries(
            Object.entries(rawOperation as Record<string, unknown>).map(([key, value]) => [
              key,
              key === 'type' ? value : '[shown in document diff]',
            ])
          )
        : rawOperation;
    visibleArgs = {
      ...rawArgs,
      ...(Object.hasOwn(rawArgs, 'markdown')
        ? { markdown: '[shown in document diff]' }
        : {}),
      ...(rawOperation !== undefined ? { operation: visibleOperation } : {}),
    };
  }
  const diff = isDocumentEdit
    ? buildDocumentEditDiff(documentPreview.baseMarkdown!, documentPreview.proposedMarkdown!)
    : [];

  return (
    <div className={styles.confirmCard} data-testid="agent-confirmation">
      <div className={styles.confirmTitle}>Confirm: {label}</div>
      <pre className={styles.pre}>{JSON.stringify(visibleArgs, null, 2)}</pre>
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
      {isDocumentEdit && (
        <div className={styles.documentDiff} aria-label="Document changes">
          {diff.map((row, index) => (
            <div
              className={`${styles.documentDiffLine} ${styles[`documentDiff${row.kind[0]!.toUpperCase()}${row.kind.slice(1)}`]}`}
              key={`${row.kind}-${index}`}
            >
              <span className={styles.documentDiffMarker} aria-hidden="true">
                {row.kind === 'added' ? '+' : row.kind === 'removed' ? '-' : ' '}
              </span>
              <span>
                {(row.kind === 'added' || row.kind === 'removed') && (
                  <span className={styles.srOnly}>
                    {row.kind === 'added' ? 'Added: ' : 'Removed: '}
                  </span>
                )}
                {row.text}
              </span>
            </div>
          ))}
        </div>
      )}
      {isDocumentEdit && (
        <details className={styles.documentProposal}>
          <summary>Proposed Markdown</summary>
          <pre className={styles.pre}>{documentPreview.proposedMarkdown}</pre>
        </details>
      )}

      {resolved ? (
        <div className={styles.resolvedNote}>
          {resolved === 'approved' ? 'Approved.' : 'Cancelled.'}
        </div>
      ) : (
        <div className={styles.confirmActions}>
          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            data-testid="agent-confirm"
            disabled={disabled}
            onClick={() => onDecision(actionId, 'approve')}
          >
            Confirm
          </button>
          <button
            className={`${styles.btn} ${styles.btnGhost}`}
            disabled={disabled}
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
