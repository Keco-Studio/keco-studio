/**
 * Find the first dialogue separator colon.
 *
 * Half-width colons between two digits are treated as time separators and are
 * skipped, so "12:30: text" returns the second colon.
 */
export function findDialogueColon(line: string): number {
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char !== ':' && char !== '：') continue;

    const isHalfWidthTimeColon =
      char === ':' &&
      index > 0 &&
      /\d/.test(line[index - 1]) &&
      /\d/.test(line[index + 1] ?? '');

    if (!isHalfWidthTimeColon) {
      return index;
    }
  }

  return -1;
}
