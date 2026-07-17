'use client';

import { useCallback, useState } from 'react';
import type { ResourceReferenceReplacementHandler } from './ResourceReferenceEditor';
import type { ResourceReferenceTarget } from '@/lib/documents/resourceReferenceTypes';

type PendingReference = {
  initialTarget?: ResourceReferenceTarget;
  apply: (target: ResourceReferenceTarget) => void;
};

export type ResourceReferencePickerController = {
  open: boolean;
  initialTarget?: ResourceReferenceTarget;
  openInsertion: (apply: (target: ResourceReferenceTarget) => void) => void;
  openReplacement: ResourceReferenceReplacementHandler;
  cancel: () => void;
  confirm: (target: ResourceReferenceTarget) => void;
};

export function useResourceReferencePickerController(
  restoreFocus: () => void
): ResourceReferencePickerController {
  const [pending, setPending] = useState<PendingReference | null>(null);
  const openInsertion = useCallback(
    (apply: (target: ResourceReferenceTarget) => void) => setPending({ apply }),
    []
  );
  const openReplacement = useCallback<ResourceReferenceReplacementHandler>(
    (initialTarget, apply) => setPending({ initialTarget, apply }),
    []
  );
  const cancel = useCallback(() => {
    setPending(null);
    restoreFocus();
  }, [restoreFocus]);
  const confirm = useCallback((target: ResourceReferenceTarget) => {
    if (!pending) return;
    pending.apply(target);
    setPending(null);
    restoreFocus();
  }, [pending, restoreFocus]);

  return {
    open: pending !== null,
    initialTarget: pending?.initialTarget,
    openInsertion,
    openReplacement,
    cancel,
    confirm,
  };
}
