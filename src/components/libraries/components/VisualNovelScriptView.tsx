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

/** Resolve speaker name from Name column (人物名). */
function resolveSpeakerName(nameValue: string | undefined | null): string {
  const v = String(nameValue ?? '').trim();
  if (!v || v === 'Speaker') return 'Narrator';
  return v;
}

function resolveDialogType(typeValue: string | number | undefined | null): '1' | '2' | null {
  if (typeValue === undefined || typeValue === null || typeValue === '') return null;
  const v = String(typeValue).trim();
  if (v === '1') return '1';
  if (v === '2') return '2';
  return null;
}

/** Type 1 = 人物对话；Type 2 = 场景/旁白。 */
function isDialogueType(
  typeValue: string | number | undefined | null,
  nameValue: string | undefined | null,
): boolean {
  if (resolveDialogType(typeValue) === '1') return true;
  if (resolveDialogType(typeValue) === '2') return false;
  const name = String(nameValue ?? '').trim();
  return !!name && name !== 'Speaker';
}

function isNarrationType(typeValue: string | number | undefined | null): boolean {
  return resolveDialogType(typeValue) === '2';
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

/** Color classes for dialog bubbles — assigned by speaker identity */
const SPEAKER_COLORS = ['blue', 'pink', 'green', 'orange'] as const;
type DialogColor = typeof SPEAKER_COLORS[number];

function getSpeakerColor(speakerName: string, speakerOrder: Map<string, number>): DialogColor {
  let order = speakerOrder.get(speakerName);
  if (order === undefined) {
    order = speakerOrder.size;
    speakerOrder.set(speakerName, order);
  }
  return SPEAKER_COLORS[order % SPEAKER_COLORS.length];
}

/** Compute left/right alignment per row — alternates on speaker change, resets at part labels */
function computeDialogAlignments(
  rows: AssetRow[],
  nameKey: string | undefined,
  typeKey: string | undefined,
  contentKey: string | undefined,
  labelKey: string | undefined,
): Map<string, 'left' | 'right'> {
  const alignments = new Map<string, 'left' | 'right'>();
  let lastSpeaker: string | null = null;
  let lastSide: 'left' | 'right' = 'left';

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const labelVal = labelKey ? row.propertyValues[labelKey] : undefined;
    const typeVal = typeKey ? row.propertyValues[typeKey] : undefined;
    const nameVal = nameKey ? row.propertyValues[nameKey] : undefined;
    const contentVal = contentKey ? row.propertyValues[contentKey] : undefined;

    const label = String(labelVal ?? '').trim();
    const content = String(contentVal ?? '').trim();

    if (label === '*' || label.toLowerCase() === 'start' || (label && !content && isPartLabel(label))) {
      lastSpeaker = null;
      lastSide = 'left';
      continue;
    }

    if (!content) continue;

    if (!isDialogueType(typeVal, nameVal)) {
      alignments.set(row.id, 'left');
      // 旁白固定在左侧，并重置说话人跟踪，避免影响下一句人物对话
      lastSpeaker = null;
      lastSide = 'left';
      continue;
    }

    const speakerName = resolveSpeakerName(nameVal);
    let side: 'left' | 'right';
    if (lastSpeaker === null) {
      side = 'left';
    } else if (lastSpeaker === speakerName) {
      side = lastSide;
    } else {
      side = lastSide === 'left' ? 'right' : 'left';
    }

    alignments.set(row.id, side);
    lastSpeaker = speakerName;
    lastSide = side;
  }

  return alignments;
}

function getAvatarLetter(speakerName: string): string {
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

function renderSceneTitle(rowId: string, sceneNumber: string, sceneDescription: string) {
  return (
    <div key={rowId} className={styles.partHeaderWrap}>
      <div className={styles.partHeaderRow}>
        <div className={styles.partHeaderLine} aria-hidden />
        <div className={styles.partTitleOval}>
          <span className={styles.sceneMarkerText}>{sceneNumber}</span>
        </div>
        <div className={styles.partHeaderLine} aria-hidden />
      </div>
      {sceneDescription && (
        <div className={styles.sceneDescription}>{sceneDescription}</div>
      )}
    </div>
  );
}

/* ───────── component ───────── */

export function VisualNovelScriptView({ rows, scriptColumns }: VisualNovelScriptViewProps) {
  const { labelKey, typeKey, nameKey, contentKey } = scriptColumns;

  const filteredRows = useMemo(() => {
    let filtered = rows;
    if (nameKey) {
      filtered = filtered.filter((row) => {
        const nameVal = row.propertyValues[nameKey];
        return String(nameVal ?? '').trim() !== 'Speaker';
      });
    }
    if (labelKey) {
      const startIndex = filtered.findIndex((row) => {
        const labelVal = row.propertyValues[labelKey];
        return String(labelVal ?? '').trim().toLowerCase() === 'start';
      });
      if (startIndex !== -1) {
        filtered = filtered.slice(startIndex);
      }
    }
    return filtered;
  }, [rows, labelKey, nameKey]);

  const speakerOrder = useMemo(() => {
    const order = new Map<string, number>();
    for (const row of filteredRows) {
      const nameVal = nameKey ? row.propertyValues[nameKey] : undefined;
      const typeVal = typeKey ? row.propertyValues[typeKey] : undefined;
      if (!isDialogueType(typeVal, nameVal)) continue;
      const speakerName = resolveSpeakerName(nameVal);
      if (!order.has(speakerName)) {
        order.set(speakerName, order.size);
      }
    }
    return order;
  }, [filteredRows, nameKey, typeKey]);

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

        if (label.toLowerCase() === 'start') {
          return renderPartTitle(row.id, label);
        }

        if (label === '*') return null;

        const prevLabel = index > 0
          ? String(filteredRows[index - 1].propertyValues[labelKey ?? ''] ?? '').trim()
          : '';
        const isChapterTitle = prevLabel === '*' && label;

        if (isChapterTitle) {
          if (!content) {
            return renderPartTitle(row.id, label);
          }
          const alignment = dialogAlignments.get(row.id) ?? 'left';
          return (
            <React.Fragment key={row.id}>
              {renderPartTitle(`${row.id}-title`, label)}
              {renderScriptLine(row.id, typeVal, nameVal, content, speakerOrder, alignment)}
            </React.Fragment>
          );
        }

        if (label && !content) {
          return renderPartTitle(row.id, label);
        }

        if (isNarrationType(typeVal) && label) {
          return renderSceneTitle(row.id, label, content);
        }

        if (!content && !label) return null;

        const alignment = dialogAlignments.get(row.id) ?? 'left';
        return renderScriptLine(row.id, typeVal, nameVal, content, speakerOrder, alignment);
      })}
    </div>
  );
}

function renderScriptLine(
  rowId: string,
  typeVal: string | number | undefined | null,
  nameVal: string | undefined | null,
  content: string,
  speakerOrder: Map<string, number>,
  alignment: 'left' | 'right',
) {
  if (isNarrationType(typeVal)) {
    return renderNarrationText(rowId, content);
  }
  if (isDialogueType(typeVal, nameVal)) {
    return renderDialog(rowId, nameVal, content, speakerOrder, alignment);
  }
  return renderNarrationText(rowId, content);
}

function renderNarrationText(rowId: string, content: string) {
  return (
    <div key={rowId} className={styles.narrationRow}>
      <div>
        <div className={styles.speakerHeader}>
          <div className={`${styles.avatar} ${styles.gray}`}>N</div>
          <span className={styles.speakerName}>Narrator</span>
        </div>
        <div className={`${styles.dialogBubble} ${styles.gray}`}>
          {content}
        </div>
      </div>
    </div>
  );
}

function renderDialog(
  rowId: string,
  nameVal: string | undefined | null,
  content: string,
  speakerOrder: Map<string, number>,
  alignment: 'left' | 'right',
) {
  const speakerName = resolveSpeakerName(nameVal);
  const dialogColor = getSpeakerColor(speakerName, speakerOrder);
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
