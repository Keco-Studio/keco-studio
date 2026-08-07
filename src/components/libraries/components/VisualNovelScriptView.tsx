'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssetRow } from '@/lib/types/libraryAssets';
import { interpolateVariables } from '@/lib/story-ir/commands';
import {
  createScriptPlayerState,
  nextPosition,
  readScriptOptions,
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
  mode?: 'player' | 'plot-node';
  onSelectOptionTarget?: (targetLabel: string) => void;
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

function hasNamedSpeaker(nameValue: string | undefined | null): boolean {
  const v = String(nameValue ?? '').trim();
  return Boolean(v) && v !== 'Speaker';
}

function isNamedActionType(typeValue: string | number | undefined | null): boolean {
  return String(typeValue ?? '').trim() === '3';
}

function isSpeechDialogueType(typeValue: string | number | undefined | null): boolean {
  const type = String(typeValue ?? '').trim();
  return type === '1' || type === '2';
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

export function VisualNovelScriptView({
  rows,
  scriptColumns,
  mode = 'player',
  onSelectOptionTarget,
}: VisualNovelScriptViewProps) {
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
    if (nameKey && mode === 'player') {
      filtered = filtered.filter((row) => {
        const nameVal = row.propertyValues[nameKey];
        return String(nameVal ?? '').trim() !== 'Speaker';
      });
    }
    if (labelKey && mode === 'player') {
      const startIndex = filtered.findIndex((row) => {
        const labelVal = row.propertyValues[labelKey];
        return String(labelVal ?? '').trim().toLowerCase() === 'start';
      });
      if (startIndex !== -1) {
        filtered = filtered.slice(startIndex);
      }
    }
    return filtered;
  }, [rows, labelKey, nameKey, mode]);

  const createInitialPlayerState = useCallback(
    () => createScriptPlayerState(filteredRows, playerColumns),
    [filteredRows, playerColumns],
  );

  const [playerState, setPlayerState] = useState<ScriptPlayerState>(createInitialPlayerState);

  useEffect(() => {
    setPlayerState(createInitialPlayerState());
  }, [createInitialPlayerState]);

  useEffect(() => {
    if (mode === 'plot-node') resetNearestScrollContainer(rootRef.current);
  }, [filteredRows, mode]);

  const restart = useCallback(() => {
    setPlayerState(createInitialPlayerState());
    resetNearestScrollContainer(rootRef.current);
  }, [createInitialPlayerState]);

  const chooseOption = useCallback((choice: number) => {
    setPlayerState((state) => nextPosition(state, filteredRows, playerColumns, choice));
  }, [filteredRows, playerColumns]);

  const plotNodeOptions = useMemo(
    () => mode === 'plot-node'
      ? rows.flatMap((row) => readScriptOptions(row, playerColumns))
      : [],
    [mode, playerColumns, rows],
  );

  if (!filteredRows.length && plotNodeOptions.length === 0) {
    return <div className={styles.emptyState}>No script data</div>;
  }

  const revealedRows = mode === 'plot-node'
    ? filteredRows.map((row, rowIndex) => ({ row, rowIndex }))
    : getRevealedScriptRows(filteredRows, playerState.revealed);

  const preparedRows = revealedRows.map(({ row, rowIndex }) => {
    const labelVal = labelKey ? row.propertyValues[labelKey] : undefined;
    const typeVal = typeKey ? row.propertyValues[typeKey] : undefined;
    const nameVal = nameKey ? row.propertyValues[nameKey] : undefined;
    const content = mode === 'plot-node'
      ? renderPlayerContent(row, contentKey, {})
      : renderPlayerContent(row, contentKey, playerState.variables);
    return {
      row,
      rowIndex,
      label: String(labelVal ?? '').trim(),
      typeVal,
      nameVal,
      content,
    };
  });

  const mergedIntoPrevious = new Set<number>();
  const mergedSpeechByActionIndex = new Map<number, (typeof preparedRows)[number]>();

  for (let i = 0; i < preparedRows.length - 1; i++) {
    const current = preparedRows[i];
    const next = preparedRows[i + 1];
    if (
      isNamedActionType(current.typeVal)
      && hasNamedSpeaker(current.nameVal)
      && current.content
      && isSpeechDialogueType(next.typeVal)
      && hasNamedSpeaker(next.nameVal)
      && resolveSpeakerName(current.nameVal) === resolveSpeakerName(next.nameVal)
    ) {
      mergedSpeechByActionIndex.set(i, next);
      mergedIntoPrevious.add(i + 1);
    }
  }

  return (
    <div
      ref={rootRef}
      className={styles.container}
    >
      {mode === 'player' ? (
        <div className={styles.playerToolbar}>
          <button type="button" className={styles.restartButton} onClick={restart}>
            Restart
          </button>
        </div>
      ) : null}
      {preparedRows.map((prepared, index) => {
        if (mergedIntoPrevious.has(index)) return null;

        const { row, rowIndex, label, content } = prepared;
        let { typeVal, nameVal } = prepared;
        let lineContent = content;
        let action: string | undefined;

        const mergedSpeech = mergedSpeechByActionIndex.get(index);
        if (mergedSpeech) {
          action = content;
          lineContent = mergedSpeech.content;
          typeVal = mergedSpeech.typeVal;
          nameVal = mergedSpeech.nameVal;
        } else if (isNamedActionType(typeVal) && hasNamedSpeaker(nameVal) && content) {
          action = content;
          lineContent = '';
        }

        if (label.toLowerCase() === 'start' && !lineContent && !action) {
          return renderPartTitle(row.id, label);
        }

        if (label.toLowerCase() === 'start') {
          return (
            <React.Fragment key={row.id}>
              {renderPartTitle(`${row.id}-title`, label)}
              {renderScriptLine(row.id, typeVal, nameVal, lineContent, action)}
            </React.Fragment>
          );
        }

        if (label === '*') return null;

        const prevLabel = rowIndex > 0
          ? String(filteredRows[rowIndex - 1].propertyValues[labelKey ?? ''] ?? '').trim()
          : '';
        const isChapterTitle = prevLabel === '*' && label;

        if (isChapterTitle) {
          if (!lineContent && !action) {
            return renderPartTitle(row.id, label);
          }
          return (
            <React.Fragment key={row.id}>
              {renderPartTitle(`${row.id}-title`, label)}
              {renderScriptLine(row.id, typeVal, nameVal, lineContent, action)}
            </React.Fragment>
          );
        }

        if (label && !lineContent && !action) {
          return renderPartTitle(row.id, label);
        }

        if (resolveVisualNovelPresentation(typeVal, nameVal).kind === 'plain' && label) {
          return renderSceneTitle(row.id, label, lineContent);
        }

        if (!lineContent && !label && !action) return null;

        return renderScriptLine(row.id, typeVal, nameVal, lineContent, action);
      })}
      {((mode === 'player' && playerState.atChoice) || plotNodeOptions.length > 0) && (
        <div className={styles.choicePanel}>
          {(mode === 'plot-node' ? plotNodeOptions : playerState.options).map((option, position) => (
            <button
              key={`${option.index}-${position}`}
              type="button"
              className={styles.choiceButton}
              onClick={mode === 'plot-node'
                ? () => {
                    if (option.targetLabel) onSelectOptionTarget?.(option.targetLabel);
                  }
                : () => chooseOption(option.index)}
            >
              {interpolateVariables(
                option.text,
                mode === 'plot-node' ? {} : playerState.variables,
              )}
            </button>
          ))}
        </div>
      )}
      {mode === 'player' && playerState.warning && (
        <div className={styles.warningMessage} role="status">
          {playerState.warning}
        </div>
      )}
      {mode === 'player' && playerState.error && (
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
  action?: string,
) {
  const presentation = resolveVisualNovelPresentation(typeVal, nameVal);
  if (presentation.kind === 'plain') {
    return renderPlainText(rowId, content);
  }
  if (presentation.kind === 'fullscreen') {
    return renderFullscreenText(rowId, content);
  }
  return renderDialog(rowId, nameVal, content, presentation.color, presentation.alignment, action);
}

function renderDialog(
  rowId: string,
  nameVal: string | undefined | null,
  content: string,
  dialogColor: VisualNovelDialogColor,
  alignment: 'left' | 'right',
  action?: string,
) {
  const speakerName = resolveSpeakerName(nameVal);
  const avatarLetter = getAvatarLetter(speakerName);
  const actionText = action?.trim();

  return (
    <div key={rowId} className={`${styles.dialogRow} ${styles[alignment]}`}>
      <div>
        <div className={styles.speakerHeader}>
          <div className={`${styles.avatar} ${styles[dialogColor]}`}>
            {avatarLetter}
          </div>
          <span className={styles.speakerName}>{speakerName}</span>
          {actionText ? (
            <span className={styles.actionChip}>
              {actionText}
            </span>
          ) : null}
        </div>
        {content ? (
          <div className={`${styles.dialogBubble} ${styles[dialogColor]}`}>
            {content}
          </div>
        ) : null}
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
