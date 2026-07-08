import { useCallback, useRef, useState } from 'react';
import type { App } from 'antd';

type MessageApi = ReturnType<typeof App.useApp>['message'];

type UseLibrarySectionEditingArgs = {
  onAddSection?: () => Promise<string | void>;
  onUpdateSection?: (sectionId: string, newName: string) => Promise<void>;
  sectionStateStorageKey: string;
  sectionRenameHintStorageKey: string;
  message: MessageApi;
  setActiveSectionId: React.Dispatch<React.SetStateAction<string | null>>;
  setPreferredSectionNameAfterRename: React.Dispatch<React.SetStateAction<string | null>>;
  setToastMessage: React.Dispatch<React.SetStateAction<{ message: string; type: 'success' | 'error' | 'default' } | null>>;
  pendingNewSectionIdRef: React.MutableRefObject<string | null>;
};

export function useLibrarySectionEditing({
  onAddSection,
  onUpdateSection,
  sectionStateStorageKey,
  sectionRenameHintStorageKey,
  message,
  setActiveSectionId,
  setPreferredSectionNameAfterRename,
  setToastMessage,
  pendingNewSectionIdRef,
}: UseLibrarySectionEditingArgs) {
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSectionName, setEditingSectionName] = useState('');
  const [editingSectionOriginalName, setEditingSectionOriginalName] = useState('');
  const sectionInputRef = useRef<HTMLInputElement>(null);

  const handleSectionEditStart = useCallback((sectionId: string, currentName: string) => {
    setActiveSectionId(sectionId);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(sectionStateStorageKey, sectionId);
    }
    setEditingSectionId(sectionId);
    setEditingSectionName(currentName);
    setEditingSectionOriginalName(currentName);
    setTimeout(() => sectionInputRef.current?.focus(), 0);
  }, [sectionStateStorageKey, setActiveSectionId]);

  const handleSectionEditEnd = useCallback(async (submit: boolean) => {
    if (!editingSectionId) return;
    const trimmed = editingSectionName.trim();
    const originalTrimmed = editingSectionOriginalName.trim();
    const hasChanged = trimmed !== originalTrimmed;
    if (submit && trimmed && hasChanged && onUpdateSection) {
      try {
        setPreferredSectionNameAfterRename(trimmed);
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(sectionRenameHintStorageKey, trimmed);
        }
        await onUpdateSection(editingSectionId, trimmed);
        setToastMessage({ message: 'Section name updated', type: 'success' });
        setTimeout(() => setToastMessage(null), 2000);
      } catch {
        setPreferredSectionNameAfterRename(null);
        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem(sectionRenameHintStorageKey);
        }
        message.error('Update failed');
      }
    }
    setEditingSectionId(null);
    setEditingSectionName('');
    setEditingSectionOriginalName('');
  }, [
    editingSectionId,
    editingSectionName,
    editingSectionOriginalName,
    message,
    onUpdateSection,
    sectionRenameHintStorageKey,
    setPreferredSectionNameAfterRename,
    setToastMessage,
  ]);

  const handleSelectSection = useCallback((sectionId: string) => {
    setActiveSectionId(sectionId);
  }, [setActiveSectionId]);

  const handleAddSectionFromTabs = useCallback(async () => {
    if (!onAddSection) return;
    try {
      const newSectionId = await onAddSection();
      if (newSectionId) {
        pendingNewSectionIdRef.current = newSectionId;
        setActiveSectionId(newSectionId);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Failed to add section');
    }
  }, [message, onAddSection, pendingNewSectionIdRef, setActiveSectionId]);

  return {
    editingSectionId,
    editingSectionName,
    sectionInputRef,
    setEditingSectionName,
    handleSectionEditStart,
    handleSectionEditEnd,
    handleSelectSection,
    handleAddSectionFromTabs,
  };
}
