'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DocumentUpdatedPayload } from '@/lib/documents/documentBroadcast';

export type UseDocumentStaleCopyOptions = {
  documentId: string;
  localUpdatedAt: string;
  isDirty: boolean;
  onCleanRemoteSave: () => Promise<void>;
};

export type DocumentStaleCopyState = {
  isStale: boolean;
  remoteUpdatedAt: string | null;
};

export type DocumentStaleCopy = DocumentStaleCopyState & {
  receive: (update: DocumentUpdatedPayload) => void;
  reloadRemote: () => Promise<void>;
  keepLocal: () => string | null;
};

type Listener = () => void;

export class DocumentStaleCopyController {
  private options: UseDocumentStaleCopyOptions;
  private state: DocumentStaleCopyState = {
    isStale: false,
    remoteUpdatedAt: null,
  };
  private readonly listeners = new Set<Listener>();

  constructor(options: UseDocumentStaleCopyOptions) {
    this.options = options;
  }

  updateOptions(options: UseDocumentStaleCopyOptions): void {
    this.options = options;
  }

  getState(): DocumentStaleCopyState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async receive(update: DocumentUpdatedPayload): Promise<void> {
    if (!this.isNewerSave(update)) return;
    const remoteUpdatedAt = update.updatedAt!;
    if (this.options.isDirty) {
      this.setState({ isStale: true, remoteUpdatedAt });
      return;
    }

    try {
      await this.options.onCleanRemoteSave();
      this.setState({ isStale: false, remoteUpdatedAt: null });
    } catch (error) {
      this.setState({ isStale: true, remoteUpdatedAt });
      throw error;
    }
  }

  async reloadRemote(): Promise<void> {
    if (!this.state.remoteUpdatedAt) return;
    await this.options.onCleanRemoteSave();
    this.setState({ isStale: false, remoteUpdatedAt: null });
  }

  keepLocal(): string | null {
    const ignored = this.state.remoteUpdatedAt;
    this.setState({ isStale: false, remoteUpdatedAt: null });
    return ignored;
  }

  destroy(): void {
    this.listeners.clear();
  }

  private isNewerSave(update: DocumentUpdatedPayload): boolean {
    return (
      update.documentId === this.options.documentId &&
      update.action === 'save' &&
      typeof update.updatedAt === 'string' &&
      Date.parse(update.updatedAt) > Date.parse(this.options.localUpdatedAt)
    );
  }

  private setState(state: DocumentStaleCopyState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
}

export function createDocumentStaleCopyController(
  options: UseDocumentStaleCopyOptions
): DocumentStaleCopyController {
  return new DocumentStaleCopyController(options);
}

export function useDocumentStaleCopy(
  options: UseDocumentStaleCopyOptions
): DocumentStaleCopy {
  const [controller] = useState(() => createDocumentStaleCopyController(options));
  useEffect(() => controller.updateOptions(options), [controller, options]);

  const [state, setState] = useState<DocumentStaleCopyState>(() => controller.getState());
  useEffect(() => controller.subscribe(() => setState(controller.getState())), [controller]);
  useEffect(() => () => controller.destroy(), [controller]);

  const receive = useCallback(
    (update: DocumentUpdatedPayload) => {
      void controller.receive(update).catch(() => undefined);
    },
    [controller]
  );
  const reloadRemote = useCallback(() => controller.reloadRemote(), [controller]);
  const keepLocal = useCallback(() => controller.keepLocal(), [controller]);

  return useMemo(
    () => ({
      ...state,
      receive,
      reloadRemote,
      keepLocal,
    }),
    [keepLocal, receive, reloadRemote, state]
  );
}
