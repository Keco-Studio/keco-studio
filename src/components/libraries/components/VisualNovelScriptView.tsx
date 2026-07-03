'use client';

import React, { useMemo } from 'react';
import type { AssetRow } from '@/lib/types/libraryAssets';
import styles from './VisualNovelScriptView.module.css';

export interface ScriptColumns {
  labelKey?: string;
  typeKey?: string;
  nameKey?: string;
  contentKey?: string;
}

interface VisualNovelScriptViewProps {
  rows: AssetRow[];
  scriptColumns: ScriptColumns;
}

/* ───────── helpers ───────── */

/** Resolve speaker name from Name column value. Non-numeric text is used directly (e.g. 崔, 魏). */
function resolveSpeakerName(nameValue: string | undefined | null): string {
  if (!nameValue) return 'Narrator';
  const v = String(nameValue).trim();
  if (v === '1') return 'Assistant';
  if (v === '2') return 'Altana';
  if (v && !/^\d+$/.test(v)) return v;
  return 'Narrator';
}

function resolveDialogType(typeValue: string | number | undefined | null): '1' | '2' | '3' | '4' | '5' | null {
  if (typeValue === undefined || typeValue === null) return null;
  const v = String(typeValue).trim();
  if (v === '1' || v === '2' || v === '3' || v === '4' || v === '5') return v;
  return null;
}

/** Type 4 or Name 4: plain text without dialog bubble, always left. */
function isNoDialogBox(
  typeValue: string | number | undefined | null,
  nameValue: string | undefined | null,
): boolean {
  if (resolveDialogType(typeValue) === '4') return true;
  return String(nameValue ?? '').trim() === '4';
}

/** Type 5: centered fullscreen text. */
function isFullscreenType(typeValue: string | number | undefined | null): boolean {
  return resolveDialogType(typeValue) === '5';
}

/** Branch / scene labels that begin a new Part. */
function isPartLabel(label: string): boolean {
  const l = label.trim();
  if (!l || l === '*') return false;
  if (l.toLowerCase() === 'start') return true;
  if (/^O\d+$/i.test(l)) return true;
  if (l.toLowerCase() === 'oend') return true;
  return false;
}

function resetDialogTurn(state: {
  lastSpeaker: string | null;
  lastSide: 'left' | 'right';
  activePartLabel: string | null;
}) {
  state.lastSpeaker = null;
  state.lastSide = 'left';
}

function computeDialogAlignments(
  rows: AssetRow[],
  nameKey: string | undefined,
  typeKey: string | undefined,
  contentKey: string | undefined,
  labelKey: string | undefined,
): Map<string, 'left' | 'right'> {
  const alignments = new Map<string, 'left' | 'right'>();
  const state = {
    lastSpeaker: null as string | null,
    lastSide: 'left' as 'left' | 'right',
    activePartLabel: null as string | null,
  };

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const labelVal = labelKey ? row.propertyValues[labelKey] : undefined;
    const typeVal = typeKey ? row.propertyValues[typeKey] : undefined;
    const nameVal = nameKey ? row.propertyValues[nameKey] : undefined;
    const contentVal = contentKey ? row.propertyValues[contentKey] : undefined;

    const label = String(labelVal ?? '').trim();
    const content = String(contentVal ?? '').trim();
    const prevLabel = index > 0
      ? String(rows[index - 1].propertyValues[labelKey ?? ''] ?? '').trim()
      : '';

    if (label === '*') {
      state.activePartLabel = null;
      resetDialogTurn(state);
      continue;
    }

    if (label.toLowerCase() === 'start') {
      if (state.activePartLabel !== 'start') {
        state.activePartLabel = 'start';
        resetDialogTurn(state);
      }
      continue;
    }

    if (prevLabel === '*' && label) {
      state.activePartLabel = label;
      resetDialogTurn(state);
    } else if (label && !content) {
      state.activePartLabel = label;
      resetDialogTurn(state);
      continue;
    } else if (isPartLabel(label) && label !== state.activePartLabel) {
      state.activePartLabel = label;
      resetDialogTurn(state);
    }

    if (!content) continue;

    const type = resolveDialogType(typeVal);

    if (type === '3') {
      alignments.set(row.id, 'left');
      continue;
    }

    if (type === '5' || isNoDialogBox(typeVal, nameVal)) {
      if (isNoDialogBox(typeVal, nameVal)) {
        alignments.set(row.id, 'left');
      }
      continue;
    }

    const speakerName = resolveSpeakerName(nameVal);

    let side: 'left' | 'right';
    if (state.lastSpeaker === null) {
      side = type === '2' ? 'right' : 'left';
    } else if (state.lastSpeaker === speakerName) {
      side = state.lastSide;
    } else {
      side = state.lastSide === 'left' ? 'right' : 'left';
    }

    alignments.set(row.id, side);
    state.lastSpeaker = speakerName;
    state.lastSide = side;
  }

  return alignments;
}

function getDialogColorClass(
  typeValue: string | number | undefined | null,
  alignment: 'left' | 'right',
): 'blue' | 'pink' | 'gray' {
  if (resolveDialogType(typeValue) === '3') return 'gray';
  return alignment === 'right' ? 'pink' : 'blue';
}

function getAvatarLetter(speakerName: string): string {
  if (speakerName === 'Altana') return 'A';
  if (speakerName === 'Assistant') return 'A';
  return speakerName.charAt(0) || 'N';
}

function renderPartTitle(rowId: string, label: string) {
  return (
    <div key={rowId} className={styles.partHeaderWrap}>
      <div className={styles.partHeaderRow}>
        <div className={styles.partHeaderLine} aria-hidden />
        <div className={styles.partTitleOval}>
          <span className={styles.sceneMarkerText}>{label}</span>
        </div>
        <div className={styles.partHeaderLine} aria-hidden />
      </div>
    </div>
  );
}

/* ───────── component ───────── */

export function VisualNovelScriptView({ rows, scriptColumns }: VisualNovelScriptViewProps) {
  const { labelKey, typeKey, nameKey, contentKey } = scriptColumns;

  // Step 1: filter rows — start from Label = "Start" (case-insensitive)
  const filteredRows = useMemo(() => {
    if (!labelKey) return rows;
    const startIndex = rows.findIndex((row) => {
      const labelVal = row.propertyValues[labelKey];
      return String(labelVal ?? '').trim().toLowerCase() === 'start';
    });
    if (startIndex === -1) return rows; // no "Start" found → show all
    return rows.slice(startIndex);
  }, [rows, labelKey]);

  // Step 2: build speaker → side map from filtered rows
  const dialogAlignments = useMemo(
    () => computeDialogAlignments(filteredRows, nameKey, typeKey, contentKey, labelKey),
    [filteredRows, nameKey, typeKey, contentKey, labelKey],
  );

  if (!filteredRows.length) {
    return <div className={styles.emptyState}>No script data</div>;
  }

  return (
    <div className={styles.container}>
      {filteredRows.map((row, index) => {
        const labelVal = labelKey ? row.propertyValues[labelKey] : undefined;
        const typeVal = typeKey ? row.propertyValues[typeKey] : undefined;
        const nameVal = nameKey ? row.propertyValues[nameKey] : undefined;
        const contentVal = contentKey ? row.propertyValues[contentKey] : undefined;

        const content = String(contentVal ?? '').trim();
        const label = String(labelVal ?? '').trim();

        // "Start" → centered title
        if (label.toLowerCase() === 'start') {
          return renderPartTitle(row.id, label);
        }

        // Label="*" → section separator, render nothing
        if (label === '*') return null;

        // Chapter title after "*" (e.g. O1, O2) → centered
        const prevLabel = index > 0
          ? String(filteredRows[index - 1].propertyValues[labelKey ?? ''] ?? '').trim()
          : '';
        const isChapterTitle = prevLabel === '*' && label;

        if (isChapterTitle) {
          if (!content) {
            return renderPartTitle(row.id, label);
          }
          return (
            <React.Fragment key={row.id}>
              {renderPartTitle(`${row.id}-title`, label)}
              {renderScriptLine(row.id, typeVal, nameVal, content, dialogAlignments)}
            </React.Fragment>
          );
        }

        if (label && !content) {
          return renderPartTitle(row.id, label);
        }

        if (!content && !label) return null;

        return renderScriptLine(row.id, typeVal, nameVal, content, dialogAlignments);
      })}
    </div>
  );
}

function renderScriptLine(
  rowId: string,
  typeVal: string | number | undefined | null,
  nameVal: string | undefined | null,
  content: string,
  alignments: Map<string, 'left' | 'right'>,
) {
  if (isFullscreenType(typeVal)) {
    return renderFullscreenText(rowId, content);
  }
  if (isNoDialogBox(typeVal, nameVal)) {
    return renderPlainText(rowId, content);
  }
  return renderDialog(rowId, typeVal, nameVal, content, alignments);
}

function renderFullscreenText(rowId: string, content: string) {
  return (
    <div key={rowId} className={styles.fullscreenRow}>
      <p className={styles.fullscreenText}>{content}</p>
    </div>
  );
}

function renderPlainText(rowId: string, content: string) {
  return (
    <div key={rowId} className={`${styles.plainTextRow} ${styles.left}`}>
      <p className={styles.plainText}>{content}</p>
    </div>
  );
}

function renderDialog(
  rowId: string,
  typeVal: string | number | undefined | null,
  nameVal: string | undefined | null,
  content: string,
  alignments: Map<string, 'left' | 'right'>,
) {
  const speakerName = resolveSpeakerName(nameVal);
  const alignment = alignments.get(rowId) ?? 'left';
  const dialogColor = getDialogColorClass(typeVal, alignment);
  const avatarLetter = getAvatarLetter(speakerName);

  return (
    <div key={rowId} className={`${styles.dialogRow} ${alignment === 'right' ? styles.right : styles.left}`}>
      <div>
        <div className={styles.speakerHeader}>
          <div className={`${styles.avatar} ${styles[dialogColor]}`}>
            {avatarLetter}
          </div>
          <span className={styles.speakerName}>{speakerName}</span>
        </div>
        <div className={`${styles.dialogBubble} ${styles[dialogColor]}`}>
          {content}
        </div>
      </div>
    </div>
  );
}
