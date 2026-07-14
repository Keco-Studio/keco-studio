'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export type PersistReason = 'debounce' | 'navigate' | 'unmount' | 'visibility';
export type PersistState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export type UseDocumentAutosaveOptions = {
  initialContent: string;
  initialUpdatedAt: string;
  readOnly: boolean;
  delayMs?: number;
  getSnapshot: () => string;
  save: (content: string) => Promise<{ updatedAt: string }>;
  onSaved?: (content: string, updatedAt: string) => void;
};

export type DocumentAutosaveState = {
  state: PersistState;
  lastSavedAt: string;
  error: string | null;
  isDirty: boolean;
  lastSavedContent: string;
};

export type DocumentAutosave = DocumentAutosaveState & {
  handleChange: (markdown: string) => void;
  flush: (reason?: PersistReason) => Promise<void>;
  acceptRemote: (content: string, updatedAt: string) => void;
  keepLocalAfterRemote: (remoteUpdatedAt: string) => void;
};

type Listener = () => void;

export class DocumentAutosaveController {
  private options: UseDocumentAutosaveOptions;
  private currentContent: string;
  private lastSavedContent: string;
  private lastSavedAt: string;
  private persistState: PersistState = 'saved';
  private error: string | null = null;
  private dirty = false;
  private explicitEmpty = false;
  private pending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activeSave: Promise<void> | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(options: UseDocumentAutosaveOptions) {
    this.options = options;
    this.currentContent = options.initialContent;
    this.lastSavedContent = options.initialContent;
    this.lastSavedAt = options.initialUpdatedAt;
  }

  updateOptions(options: UseDocumentAutosaveOptions): void {
    this.options = options;
  }

  getState(): DocumentAutosaveState {
    return {
      state: this.persistState,
      lastSavedAt: this.lastSavedAt,
      error: this.error,
      isDirty: this.dirty,
      lastSavedContent: this.lastSavedContent,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  handleChange(markdown: string): void {
    if (this.options.readOnly) return;
    this.currentContent = markdown;
    this.explicitEmpty = markdown === '';
    this.dirty = markdown !== this.lastSavedContent;
    this.error = null;
    this.persistState = this.activeSave
      ? 'saving'
      : this.dirty
        ? 'dirty'
        : 'saved';
    if (this.activeSave) this.pending = true;
    this.clearTimer();
    if (this.dirty) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush('debounce').catch(() => undefined);
      }, this.options.delayMs ?? 1500);
    }
    this.emit();
  }

  async flush(reason: PersistReason = 'navigate'): Promise<void> {
    if (this.options.readOnly) return;
    this.clearTimer();

    if (this.activeSave) {
      await this.activeSave;
      if (this.dirty) await this.flush(reason);
      return;
    }

    const save = this.persistLoop(reason);
    this.activeSave = save;
    try {
      await save;
    } finally {
      if (this.activeSave === save) this.activeSave = null;
    }
  }

  acceptRemote(content: string, updatedAt: string): void {
    this.clearTimer();
    this.currentContent = content;
    this.lastSavedContent = content;
    this.lastSavedAt = updatedAt;
    this.explicitEmpty = false;
    this.pending = false;
    this.dirty = false;
    this.error = null;
    this.persistState = 'saved';
    this.emit();
  }

  keepLocalAfterRemote(remoteUpdatedAt: string): void {
    if (Date.parse(remoteUpdatedAt) > Date.parse(this.lastSavedAt)) {
      this.lastSavedAt = remoteUpdatedAt;
    }
    this.emit();
  }

  destroy(): void {
    this.clearTimer();
    this.listeners.clear();
  }

  private async persistLoop(reason: PersistReason): Promise<void> {
    try {
      do {
        this.pending = false;
        const content = this.resolveContent(reason);
        if (content === this.lastSavedContent) {
          this.dirty = false;
          break;
        }

        this.persistState = 'saving';
        this.error = null;
        this.emit();
        const { updatedAt } = await this.options.save(content);
        this.lastSavedContent = content;
        this.lastSavedAt = updatedAt;
        this.options.onSaved?.(content, updatedAt);
        this.dirty = this.currentContent !== this.lastSavedContent;
      } while (this.pending || this.dirty);

      this.persistState = this.dirty ? 'dirty' : 'saved';
      this.emit();
    } catch (error) {
      this.dirty = true;
      this.persistState = 'error';
      this.error = error instanceof Error ? error.message : 'Save failed';
      this.emit();
      throw error;
    }
  }

  private resolveContent(reason: PersistReason): string {
    if (reason === 'debounce') return this.currentContent;

    let snapshot = '';
    try {
      snapshot = this.options.getSnapshot();
    } catch {
      snapshot = '';
    }
    if (snapshot.length > 0) {
      this.currentContent = snapshot;
      this.explicitEmpty = false;
      return snapshot;
    }
    if (this.explicitEmpty && this.dirty) return '';
    return this.currentContent || this.lastSavedContent;
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export function createDocumentAutosaveController(
  options: UseDocumentAutosaveOptions
): DocumentAutosaveController {
  return new DocumentAutosaveController(options);
}

export function useDocumentAutosave(
  options: UseDocumentAutosaveOptions
): DocumentAutosave {
  const [controller] = useState(() => createDocumentAutosaveController(options));
  useEffect(() => controller.updateOptions(options), [controller, options]);

  const [state, setState] = useState<DocumentAutosaveState>(() => controller.getState());
  useEffect(() => controller.subscribe(() => setState(controller.getState())), [controller]);
  useEffect(() => () => controller.destroy(), [controller]);

  const handleChange = useCallback(
    (markdown: string) => controller.handleChange(markdown),
    [controller]
  );
  const flush = useCallback(
    (reason?: PersistReason) => controller.flush(reason),
    [controller]
  );
  const acceptRemote = useCallback(
    (content: string, updatedAt: string) => controller.acceptRemote(content, updatedAt),
    [controller]
  );
  const keepLocalAfterRemote = useCallback(
    (remoteUpdatedAt: string) => controller.keepLocalAfterRemote(remoteUpdatedAt),
    [controller]
  );

  return useMemo(
    () => ({
      ...state,
      handleChange,
      flush,
      acceptRemote,
      keepLocalAfterRemote,
    }),
    [acceptRemote, flush, handleChange, keepLocalAfterRemote, state]
  );
}
