import { cellDisplayString } from '@/lib/utils/assetEmptiness';

export function joinTableRowDisplayValues(
  fields: readonly { id: string }[],
  values: Record<string, unknown>
): string {
  const parts = fields
    .map((field) => cellDisplayString(values[field.id]))
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(' · ') : '(empty)';
}
