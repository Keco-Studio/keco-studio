export type ImportResourceKind = 'document' | 'table';

export function importNameFromFile(
  fileName: string,
  kind: ImportResourceKind
): string {
  const base = fileName.replace(/\.[^.]+$/, '').trim();
  return base || `Imported ${kind}`;
}

export function nextImportName(input: {
  currentName: string;
  fileName: string;
  kind: ImportResourceKind;
  nameEdited: boolean;
}): string {
  return input.nameEdited
    ? input.currentName
    : importNameFromFile(input.fileName, input.kind);
}

export function normalizeImportNotes(notes: string): string | null {
  return notes.trim() || null;
}
