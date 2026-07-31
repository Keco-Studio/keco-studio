import type { ResourceReferenceTarget } from '@/lib/documents/resourceReferenceTypes';

type PendingReference = {
  apply: (targets: ResourceReferenceTarget[]) => void;
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
  targets: ResourceReferenceTarget[],
  restoreFocus: RestoreEditorFocus
): PendingReference | null {
  if (!pending || targets.length === 0) return null;
  const { apply } = pending;
  restoreFocus(() => apply(targets));
  return null;
}
