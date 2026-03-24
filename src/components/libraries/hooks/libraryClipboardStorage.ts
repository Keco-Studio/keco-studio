/**
 * Persists last Copy/Cut payload so Paste works after navigating to another library/table.
 * Matches system clipboard TSV when possible so external copies (e.g. Excel) still win.
 */

export const LIBRARY_CLIPBOARD_STORAGE_KEY = 'keco:library-clipboard:v1';

export type PersistedLibraryClipboardV1 = {
  v: 1;
  matrix: Array<Array<string | number | null>>;
  propertyKeys: string[];
  propertyDataTypes: (string | undefined)[];
  isCut: boolean;
  sourceLibraryId: string | null;
  /** Exact TSV written to navigator.clipboard — used to detect if clipboard still matches this payload */
  tsvSignature: string;
};

export function matrixToTsvString(matrix: Array<Array<string | number | null>>): string {
  return matrix
    .map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))).join('\t'))
    .join('\n');
}

export function persistLibraryClipboard(
  payload: Omit<PersistedLibraryClipboardV1, 'v' | 'tsvSignature'> & {
    tsvSignature?: string;
  },
): void {
  try {
    const tsvSignature = payload.tsvSignature ?? matrixToTsvString(payload.matrix);
    const data: PersistedLibraryClipboardV1 = {
      v: 1,
      matrix: payload.matrix,
      propertyKeys: payload.propertyKeys,
      propertyDataTypes: payload.propertyDataTypes,
      isCut: payload.isCut,
      sourceLibraryId: payload.sourceLibraryId,
      tsvSignature,
    };
    sessionStorage.setItem(LIBRARY_CLIPBOARD_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // quota, private mode, SSR
  }
}

export function readLibraryClipboard(): PersistedLibraryClipboardV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(LIBRARY_CLIPBOARD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedLibraryClipboardV1;
    if (parsed?.v !== 1 || !Array.isArray(parsed.matrix) || !Array.isArray(parsed.propertyKeys)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearLibraryClipboard(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(LIBRARY_CLIPBOARD_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Parse OS clipboard TSV into a matrix (empty strings → null). */
export function parseClipboardTsvToMatrix(text: string): Array<Array<string | number | null>> {
  if (!text || !text.trim()) return [];
  return text.split(/\r?\n/).map((line) => line.split('\t').map((cell) => (cell === '' ? null : cell)));
}
