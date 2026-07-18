import type { ResourceReferenceTarget } from '@/lib/documents/resourceReferenceTypes';

type PendingReference = {
  apply: (target: ResourceReferenceTarget) => void;
};

export type RestoreEditorFocus = (after?: () => void) => void;

export type ResourceReferencePickerControllerState = {
  open: boolean;
  initialTarget?: ResourceReferenceTarget;
};

/**
 * Confirm must restore editor focus/selection before applying insertion.
 * MDXEditor's insertJsx$ only inserts when a RangeSelection exists after focus.
 */
export function confirmResourceReferenceSelection(
  pending: PendingReference | null,
  target: ResourceReferenceTarget,
  restoreFocus: RestoreEditorFocus
): PendingReference | null {
  if (!pending) return null;
  const { apply } = pending;
  restoreFocus(() => apply(target));
  return null;
}
