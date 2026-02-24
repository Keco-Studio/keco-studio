/**
 * Character display width: CJK = 2, ASCII = 1.
 */
function getCharWidth(char: string): number {
  const code = char.charCodeAt(0);
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2a6df) ||
    (code >= 0x3040 && code <= 0x309f) ||
    (code >= 0x30a0 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  )
    ? 2
    : 1;
}

/**
 * Truncate string by display width with ellipsis.
 */
export function truncateText(text: string, maxWidth: number): string {
  let width = 0;
  let result = '';
  for (const char of text) {
    const charWidth = getCharWidth(char);
    if (width + charWidth > maxWidth) return result + '...';
    result += char;
    width += charWidth;
  }
  return result;
}
