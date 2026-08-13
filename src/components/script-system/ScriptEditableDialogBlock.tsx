'use client';

import React, { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { MenuOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import { CSS } from '@dnd-kit/utilities';
import { useSortable } from '@dnd-kit/sortable';
import type {
  ScriptDialogueAccent,
  ScriptDialogueBlock,
  ScriptDialogueCharacter,
} from '@/lib/script-system/scriptDialogueBlocks';
import styles from '../libraries/components/VisualNovelScriptView.module.css';

export type ScriptEditableDialogBlockProps = {
  block: ScriptDialogueBlock;
  characters: ScriptDialogueCharacter[];
  isEditing: boolean;
  onBeginEdit: () => void;
  onFinishEdit: () => void;
  onInsertCharacter: (speaker: string) => Promise<boolean>;
  onChangeSpeaker: (speaker: string) => Promise<boolean>;
  onSaveAction: (value: string) => Promise<boolean>;
  onSaveDialogue: (value: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
};

export function isDialogueSubmitShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey);
}

type DialogueDraftState = {
  blockId: string;
  sourceAction: string;
  sourceDialogue: string;
  action: string;
  dialogue: string;
};

type DialogueEditTarget = 'action' | 'dialogue';

export function isDialogueDraftEmpty(
  drafts: Pick<DialogueDraftState, 'action' | 'dialogue'>,
): boolean {
  return !drafts.action.trim() && !drafts.dialogue.trim();
}

export function reconcileDialogueDrafts(
  current: DialogueDraftState,
  next: { id: string; action: string; dialogue: string },
): DialogueDraftState {
  if (current.blockId !== next.id) {
    return {
      blockId: next.id,
      sourceAction: next.action,
      sourceDialogue: next.dialogue,
      action: next.action,
      dialogue: next.dialogue,
    };
  }
  if (
    current.sourceAction === next.action
    && current.sourceDialogue === next.dialogue
  ) {
    return current;
  }
  return {
    blockId: next.id,
    sourceAction: next.action,
    sourceDialogue: next.dialogue,
    action: current.action === current.sourceAction ? next.action : current.action,
    dialogue: current.dialogue === current.sourceDialogue ? next.dialogue : current.dialogue,
  };
}

export async function deleteDialogueBlockAndHide(
  deleteBlock: () => Promise<boolean>,
  hide: () => void,
): Promise<boolean> {
  const deleted = await deleteBlock();
  if (deleted) hide();
  return deleted;
}

export function isDialogueEditorOutsidePointer(
  root: { contains: (target: Node) => boolean } | null,
  target: Node,
): boolean {
  if (root?.contains(target as Node)) return false;
  return true;
}

function accentClass(accent: ScriptDialogueAccent): string {
  return styles[accent] ?? styles.pink;
}

export function ScriptEditableDialogBlock({
  block,
  characters,
  isEditing,
  onBeginEdit,
  onFinishEdit,
  onInsertCharacter,
  onChangeSpeaker,
  onSaveAction,
  onSaveDialogue,
  onDelete,
}: ScriptEditableDialogBlockProps) {
  const [hovered, setHovered] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [speakerPickerOpen, setSpeakerPickerOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [editTarget, setEditTarget] = useState<DialogueEditTarget>('action');
  const [drafts, setDrafts] = useState<DialogueDraftState>(() => ({
    blockId: block.id,
    sourceAction: block.action,
    sourceDialogue: block.dialogue,
    action: block.action,
    dialogue: block.dialogue,
  }));
  const reconciledDrafts = reconcileDialogueDrafts(drafts, block);
  if (reconciledDrafts !== drafts) setDrafts(reconciledDrafts);
  const rootRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const actionInputRef = useRef<HTMLInputElement>(null);
  const dialogueInputRef = useRef<HTMLTextAreaElement>(null);
  const commitRef = useRef<Promise<boolean> | null>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });
  const sortableStyle: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const commitDrafts = useCallback((): Promise<boolean> => {
    if (commitRef.current) return commitRef.current;
    const commit = async () => {
      if (
        reconciledDrafts.action !== reconciledDrafts.sourceAction
        && !await onSaveAction(reconciledDrafts.action)
      ) return false;
      if (
        reconciledDrafts.dialogue !== reconciledDrafts.sourceDialogue
        && !await onSaveDialogue(reconciledDrafts.dialogue)
      ) return false;
      return true;
    };
    const pending = commit().finally(() => {
      if (commitRef.current === pending) commitRef.current = null;
    });
    commitRef.current = pending;
    return pending;
  }, [onSaveAction, onSaveDialogue, reconciledDrafts]);

  useEffect(() => {
    if (!isEditing) return;
    if (editTarget === 'dialogue') {
      dialogueInputRef.current?.focus();
      return;
    }
    actionInputRef.current?.focus();
  }, [block.id, editTarget, isEditing]);

  const beginEditAt = useCallback((target: DialogueEditTarget) => {
    setEditTarget(target);
    onBeginEdit();
  }, [onBeginEdit]);

  const finishEditing = useCallback(async (): Promise<boolean> => {
    if (isDialogueDraftEmpty(reconciledDrafts)) {
      const deleted = await deleteDialogueBlockAndHide(onDelete, () => setHidden(true));
      if (deleted) onFinishEdit();
      return deleted;
    }
    const saved = await commitDrafts();
    if (saved) onFinishEdit();
    return saved;
  }, [commitDrafts, onDelete, onFinishEdit, reconciledDrafts]);

  useEffect(() => {
    if (!pickerOpen && !speakerPickerOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (pickerRef.current?.contains(target)) return;
      if (rootRef.current?.contains(target)) return;
      setSpeakerPickerOpen(false);
      setPickerOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [pickerOpen, speakerPickerOpen]);

  useEffect(() => {
    if (!isEditing) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!isDialogueEditorOutsidePointer(rootRef.current, target)) return;
      void finishEditing();
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [finishEditing, isEditing]);

  useEffect(() => {
    if (!pickerOpen && !speakerPickerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setPickerOpen(false);
      setSpeakerPickerOpen(false);
      setHovered(false);
      addButtonRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pickerOpen, speakerPickerOpen]);

  const showChrome = hovered || isEditing || pickerOpen || speakerPickerOpen;
  const avatarClass = `${styles.avatar} ${accentClass(block.accent)}`;
  const bubbleClass = `${styles.dialogBubble} ${accentClass(block.accent)}`;

  if (hidden) return null;
  if (!isEditing && isDialogueDraftEmpty(reconciledDrafts)) return null;

  return (
    <div
      style={sortableStyle}
      data-dragging={isDragging || undefined}
      className={[
        styles.dialogRow,
        styles[block.alignment],
        styles.editableDialogRow,
        showChrome ? styles.dialogRowHot : '',
        isEditing ? styles.dialogRowEditing : '',
      ].filter(Boolean).join(' ')}
      data-testid={`script-dialogue-block-${block.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        if (!pickerOpen) setHovered(false);
      }}
      ref={(node) => {
        rootRef.current = node;
        setNodeRef(node);
      }}
    >
      <div className={styles.editableDialogInner}>
        <div
          className={styles.editableDialogBody}
        >
          <div className={styles.speakerHeader}>
            <div className={styles.editControls} data-edit-controls="">
              {showChrome ? (
                <>
                  <Tooltip title="Drag to reorder">
                    <button
                      type="button"
                      className={styles.dragHandle}
                      aria-label="Drag to reorder"
                      {...attributes}
                      {...listeners}
                      onPointerDown={(event) => {
                        void commitDrafts();
                        listeners?.onPointerDown?.(event);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === ' ' || event.key === 'Enter') void commitDrafts();
                        listeners?.onKeyDown?.(event);
                      }}
                    >
                      <MenuOutlined aria-hidden />
                    </button>
                  </Tooltip>
                  <button
                    type="button"
                    className={styles.deleteThreadButton}
                    aria-label="Delete dialogue"
                    onClick={async () => {
                      if (await commitDrafts()) {
                        await deleteDialogueBlockAndHide(onDelete, () => setHidden(true));
                      }
                    }}
                  >
                    <MinusOutlined aria-hidden />
                  </button>
                </>
              ) : null}
            </div>
            <div className={styles.speakerPickerWrap}>
              <button
                type="button"
                className={`${avatarClass} ${styles.editEntryButton}`}
                aria-label={`Switch ${block.speaker} character`}
                onClick={(event) => {
                  event.stopPropagation();
                  setSpeakerPickerOpen((open) => !open);
                }}
              >
                {block.speaker.charAt(0) || '?'}
              </button>
              {speakerPickerOpen ? (
                <div
                  className={styles.characterPicker}
                  role="menu"
                  aria-label="SWITCH CHARACTER"
                >
                <div className={styles.characterPickerTitle}>SWITCH CHARACTER</div>
                <ul className={styles.characterPickerList}>
                  {characters.length === 0 ? (
                    <li className={styles.characterPickerEmpty}>No characters available</li>
                  ) : characters.map((character) => (
                    <li key={character.name}>
                      <button
                        type="button"
                        className={styles.characterPickerItem}
                        role="menuitem"
                        onClick={async (event) => {
                          event.stopPropagation();
                          setSpeakerPickerOpen(false);
                          setHovered(false);
                          await onChangeSpeaker(character.name);
                        }}
                      >
                        <span className={`${styles.avatar} ${accentClass(character.color)}`}>
                          {character.letter}
                        </span>
                        <span>{character.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                </div>
              ) : null}
            </div>
            <span className={styles.speakerName}>{block.speaker}</span>
            {isEditing ? (
              <input
                ref={actionInputRef}
                className={styles.actionInput}
                value={reconciledDrafts.action}
                placeholder="add your action here.."
                aria-label="Action"
                onChange={(event) => setDrafts((current) => ({
                  ...current,
                  action: event.target.value,
                }))}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    setEditTarget('dialogue');
                    dialogueInputRef.current?.focus();
                  }
                }}
              />
            ) : block.action ? (
              <button
                type="button"
                className={`${styles.actionChip} ${styles.editEntryButton}`}
                aria-label="Edit action"
                onClick={() => beginEditAt('action')}
              >
                {block.action}
              </button>
            ) : null}
          </div>

          {isEditing ? (
            <textarea
              ref={dialogueInputRef}
              className={`${styles.dialogueInput} ${accentClass(block.accent)}`}
              value={reconciledDrafts.dialogue}
              placeholder="add your thread text here"
              aria-label="Dialogue"
              rows={2}
              onChange={(event) => setDrafts((current) => ({
                ...current,
                dialogue: event.target.value,
              }))}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (!isDialogueSubmitShortcut(event)) return;
                event.preventDefault();
                void finishEditing();
              }}
            />
          ) : block.dialogue ? (
            <button
              type="button"
              className={`${bubbleClass} ${styles.editEntryButton}`}
              aria-label="Edit dialogue"
              onClick={() => beginEditAt('dialogue')}
            >
              {block.dialogue}
            </button>
          ) : null}
        </div>
      </div>

      {showChrome ? (
        <div className={styles.addThreadWrap}>
          <button
            ref={addButtonRef}
            type="button"
            className={styles.addThreadButton}
            aria-label="Add new thread"
            data-testid={`script-add-thread-${block.id}`}
            onClick={async (event) => {
              event.stopPropagation();
              if (isEditing && !await commitDrafts()) return;
              setPickerOpen((open) => !open);
            }}
          >
            <PlusOutlined aria-hidden />
          </button>
          {pickerOpen ? (
            <div
              ref={pickerRef}
              className={styles.characterPicker}
              role="menu"
              aria-label="ADD NEW THREAD"
            >
              <div className={styles.characterPickerTitle}>ADD NEW THREAD</div>
              <ul className={styles.characterPickerList}>
                {characters.length === 0 ? (
                  <li className={styles.characterPickerEmpty}>No characters available</li>
                ) : characters.map((character) => (
                  <li key={character.name}>
                    <button
                      type="button"
                      className={styles.characterPickerItem}
                      role="menuitem"
                      onClick={async (event) => {
                        event.stopPropagation();
                        setPickerOpen(false);
                        setHovered(false);
                        await onInsertCharacter(character.name);
                      }}
                    >
                      <span className={`${styles.avatar} ${accentClass(character.color)}`}>
                        {character.letter}
                      </span>
                      <span>{character.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
