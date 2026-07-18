'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssetRow } from '@/lib/types/libraryAssets';
import { interpolateVariables } from '@/lib/story-ir/commands';
import {
  createScriptPlayerState,
  nextPosition,
  renderPlayerContent,
  type ScriptPlayerColumns,
  type ScriptPlayerState,
} from './scriptPlayer';
import {
  resolveVisualNovelPresentation,
  type VisualNovelDialogColor,
} from './visualNovelPresentation';
import styles from './VisualNovelScriptView.module.css';

export interface ScriptColumns extends ScriptPlayerColumns {
  labelKey?: string;
  typeKey?: string;
  nameKey?: string;
  contentKey?: string;
}

interface VisualNovelScriptViewProps {
  rows: AssetRow[];
  scriptColumns: ScriptColumns;
}

export type RevealedScriptRow = {
  rowIndex: number;
  row: AssetRow;
};

type ScrollContainerNode = {
  parentElement: ScrollContainerNode | null;
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
  scrollTo?: (options: ScrollToOptions) => void;
};

/* ───────── helpers ───────── */

/** Resolve speaker name from the Name column. */
function resolveSpeakerName(nameValue: string | undefined | null): string {
  const v = String(nameValue ?? '').trim();
  if (!v || v === 'Speaker') return 'Narrator';
  return v;
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

export function getRevealedScriptRows(rows: AssetRow[], revealedIndexes: number[]): RevealedScriptRow[] {
  return revealedIndexes.flatMap((rowIndex) => {
    const row = rows[rowIndex];
    return row ? [{ rowIndex, row }] : [];
  });
}

export function resetNearestScrollContainer(element: ScrollContainerNode | null): void {
  let current = element?.parentElement ?? null;

  while (current) {
    if (current.scrollHeight > current.clientHeight) {
      scrollNodeToTop(current);
      return;
    }
    current = current.parentElement;
  }

  if (element) {
    scrollNodeToTop(element);
  }
}

function scrollNodeToTop(node: ScrollContainerNode): void {
  if (typeof node.scrollTo === 'function') {
    node.scrollTo({ top: 0, behavior: 'auto' });
    return;
  }
  node.scrollTop = 0;
}

/* ───────── component ───────── */

export function VisualNovelScriptView({ rows, scriptColumns }: VisualNovelScriptViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const {
    labelKey,
    typeKey,
    nameKey,
    contentKey,
    commandsKey,
    options,
    option0Key,
    option0NextKey,
    option0CommandsKey,
    option1Key,
    option1NextKey,
    option1CommandsKey,
    option2Key,
    option2NextKey,
    option2CommandsKey,
  } = scriptColumns;

  const playerColumns = useMemo<ScriptPlayerColumns>(() => ({
    labelKey,
    commandsKey,
    options,
    option0Key,
    option0NextKey,
    option0CommandsKey,
    option1Key,
    option1NextKey,
    option1CommandsKey,
    option2Key,
    option2NextKey,
    option2CommandsKey,
  }), [
    labelKey,
    commandsKey,
    options,
    option0Key,
    option0NextKey,
    option0CommandsKey,
    option1Key,
    option1NextKey,
    option1CommandsKey,
    option2Key,
    option2NextKey,
    option2CommandsKey,
  ]);

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

  const createInitialPlayerState = useCallback(
    () => createScriptPlayerState(filteredRows, playerColumns),
    [filteredRows, playerColumns],
  );

  const [playerState, setPlayerState] = useState<ScriptPlayerState>(createInitialPlayerState);

  useEffect(() => {
    setPlayerState(createInitialPlayerState());
  }, [createInitialPlayerState]);

  const restart = useCallback(() => {
    setPlayerState(createInitialPlayerState());
    resetNearestScrollContainer(rootRef.current);
  }, [createInitialPlayerState]);

  const chooseOption = useCallback((choice: number) => {
    setPlayerState((state) => nextPosition(state, filteredRows, playerColumns, choice));
  }, [filteredRows, playerColumns]);

  if (!filteredRows.length) {
    return <div className={styles.emptyState}>No script data</div>;
  }

  const revealedRows = getRevealedScriptRows(filteredRows, playerState.revealed);

  return (
    <div
      ref={rootRef}
      className={styles.container}
    >
      <div className={styles.playerToolbar}>
        <button type="button" className={styles.restartButton} onClick={restart}>
          Restart
        </button>
      </div>
      {revealedRows.map(({ row, rowIndex: index }) => {
        const labelVal = labelKey ? row.propertyValues[labelKey] : undefined;
        const typeVal = typeKey ? row.propertyValues[typeKey] : undefined;
        const nameVal = nameKey ? row.propertyValues[nameKey] : undefined;
        const content = renderPlayerContent(row, contentKey, playerState.variables);
        const label = String(labelVal ?? '').trim();

        if (label.toLowerCase() === 'start' && !content) {
          return renderPartTitle(row.id, label);
        }

        if (label.toLowerCase() === 'start') {
          return (
            <React.Fragment key={row.id}>
              {renderPartTitle(`${row.id}-title`, label)}
              {renderScriptLine(row.id, typeVal, nameVal, content)}
            </React.Fragment>
          );
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
          return (
            <React.Fragment key={row.id}>
              {renderPartTitle(`${row.id}-title`, label)}
              {renderScriptLine(row.id, typeVal, nameVal, content)}
            </React.Fragment>
          );
        }

        if (label && !content) {
          return renderPartTitle(row.id, label);
        }

        if (resolveVisualNovelPresentation(typeVal, nameVal).kind === 'plain' && label) {
          return renderSceneTitle(row.id, label, content);
        }

        if (!content && !label) return null;

        return renderScriptLine(row.id, typeVal, nameVal, content);
      })}
      {playerState.atChoice && (
        <div className={styles.choicePanel}>
          {playerState.options.map((option) => (
            <button
              key={option.index}
              type="button"
              className={styles.choiceButton}
              onClick={() => chooseOption(option.index)}
            >
              {interpolateVariables(option.text, playerState.variables)}
            </button>
          ))}
        </div>
      )}
      {playerState.warning && (
        <div className={styles.warningMessage} role="status">
          {playerState.warning}
        </div>
      )}
      {playerState.error && (
        <div className={styles.errorMessage} role="alert">
          {playerState.error}
        </div>
      )}
    </div>
  );
}

function renderScriptLine(
  rowId: string,
  typeVal: string | number | undefined | null,
  nameVal: string | undefined | null,
  content: string,
) {
  const presentation = resolveVisualNovelPresentation(typeVal, nameVal);
  if (presentation.kind === 'plain') {
    return renderPlainText(rowId, content);
  }
  if (presentation.kind === 'fullscreen') {
    return renderFullscreenText(rowId, content);
  }
  return renderDialog(rowId, nameVal, content, presentation.color, presentation.alignment);
}

function renderDialog(
  rowId: string,
  nameVal: string | undefined | null,
  content: string,
  dialogColor: VisualNovelDialogColor,
  alignment: 'left' | 'right',
) {
  const speakerName = resolveSpeakerName(nameVal);
  const avatarLetter = getAvatarLetter(speakerName);

  return (
    <div key={rowId} className={`${styles.dialogRow} ${styles[alignment]}`}>
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

function renderPlainText(rowId: string, content: string) {
  return (
    <div key={rowId} className={styles.plainTextRow}>
      <p className={styles.plainText}>{content}</p>
    </div>
  );
}

function renderFullscreenText(rowId: string, content: string) {
  return (
    <div key={rowId} className={styles.fullscreenRow}>
      <p className={styles.fullscreenText}>{content}</p>
    </div>
  );
}
