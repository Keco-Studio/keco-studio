'use client';

import { useCallback, useRef, useState } from 'react';
import type { ResourceReferenceTarget } from '@/lib/documents/resourceReferenceTypes';
import {
  confirmResourceReferenceSelection,
  type RestoreEditorFocus,
} from './resourceReferencePickerConfirm';

type PendingReference = {
  apply: (targets: ResourceReferenceTarget[]) => void;
};

export type ResourceReferencePickerController = {
  open: boolean;
  openInsertion: (apply: (targets: ResourceReferenceTarget[]) => void) => void;
  cancel: () => void;
  confirm: (targets: ResourceReferenceTarget[]) => void;
};

export function useResourceReferencePickerController(
  restoreFocus: RestoreEditorFocus
): ResourceReferencePickerController {
  const [pending, setPending] = useState<PendingReference | null>(null);
  const pendingRef = useRef<PendingReference | null>(null);
  pendingRef.current = pending;

  const openInsertion = useCallback(
    (apply: (targets: ResourceReferenceTarget[]) => void) => setPending({ apply }),
    []
  );
  const cancel = useCallback(() => {
    setPending(null);
    restoreFocus();
  }, [restoreFocus]);
  const confirm = useCallback((targets: ResourceReferenceTarget[]) => {
    const current = pendingRef.current;
    setPending(null);
    confirmResourceReferenceSelection(current, targets, restoreFocus);
  }, [restoreFocus]);

  return {
    open: pending !== null,
    openInsertion,
    cancel,
    confirm,
  };
}
