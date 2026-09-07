/** True when the user has a non-empty DOM text range (substring select). */
export function hasDomTextSelection(
  selection: Pick<Selection, 'isCollapsed' | 'toString'> | null | undefined,
): boolean {
  if (!selection || selection.isCollapsed) return false;
  return (selection.toString()?.length ?? 0) > 0;
}
