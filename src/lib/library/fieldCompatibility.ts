export const INTERNAL_FIELD_GROUP_NAME = '__keco_flat_fields__';

export function getInternalFieldGroupId(libraryId: string): string {
  return `${libraryId}:keco-flat-fields`;
}

export function getInternalFieldGroupColumns(libraryId: string) {
  return {
    section: INTERNAL_FIELD_GROUP_NAME,
    section_id: getInternalFieldGroupId(libraryId),
  } as const;
}
