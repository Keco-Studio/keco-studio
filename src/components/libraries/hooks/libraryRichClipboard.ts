import { matrixToTsvString } from './libraryClipboardStorage';

export type LibraryClipboardMatrix = Array<Array<string | number | null>>;

export type SerializedLibraryClipboard = {
  plainText: string;
  html: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function serializeLibraryClipboardMatrix(
  matrix: LibraryClipboardMatrix,
): SerializedLibraryClipboard {
  const rows = matrix
    .map((row) => {
      const cells = row
        .map((cell) => `<td>${escapeHtml(cell === null ? '' : String(cell))}</td>`)
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return {
    plainText: matrixToTsvString(matrix),
    html: `<table><tbody>${rows}</tbody></table>`,
  };
}

type ClipboardWriter = Pick<Clipboard, 'write' | 'writeText'>;

export type ClipboardItemConstructor = new (
  items: Record<string, Blob>,
) => ClipboardItem;

type ClipboardDependencies = {
  clipboard?: ClipboardWriter;
  ClipboardItem?: ClipboardItemConstructor;
};

export async function writeLibraryClipboard(
  payload: SerializedLibraryClipboard,
  dependencies: ClipboardDependencies = {},
): Promise<void> {
  const clipboard = dependencies.clipboard ??
    (typeof navigator !== 'undefined' ? navigator.clipboard : undefined);
  const ClipboardItemClass = Object.prototype.hasOwnProperty.call(dependencies, 'ClipboardItem')
    ? dependencies.ClipboardItem
    : typeof globalThis.ClipboardItem !== 'undefined'
      ? globalThis.ClipboardItem
      : undefined;

  if (!clipboard) return;

  if (ClipboardItemClass && typeof clipboard.write === 'function') {
    try {
      await clipboard.write([
        new ClipboardItemClass({
          'text/plain': new Blob([payload.plainText], { type: 'text/plain' }),
          'text/html': new Blob([payload.html], { type: 'text/html' }),
        }),
      ]);
      return;
    } catch {
      // Fall through to the broadly supported plain-text API.
    }
  }

  if (typeof clipboard.writeText === 'function') {
    await clipboard.writeText(payload.plainText);
  }
}
