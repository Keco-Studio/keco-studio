import type { SourceRef, SourceUnit } from './schema';

export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

export function unitizeSource(content: string, sourceId: string): SourceUnit[] {
  if (!sourceId.trim()) throw new Error('Source ID is required');
  if (new TextEncoder().encode(content).byteLength > MAX_SOURCE_BYTES) {
    throw new Error('Source exceeds the 10 MB limit');
  }

  const units: SourceUnit[] = [];
  let lineStart = 0;
  let sourceIndex = 0;

  while (lineStart <= content.length) {
    const newlineIndex = content.indexOf('\n', lineStart);
    const rawEnd = newlineIndex === -1 ? content.length : newlineIndex;
    const lineEnd = rawEnd > lineStart && content[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd;
    const rawLine = content.slice(lineStart, lineEnd);
    const leading = rawLine.length - rawLine.trimStart().length;
    const trailing = rawLine.length - rawLine.trimEnd().length;
    const text = rawLine.trim();

    if (text) {
      const start = lineStart + leading;
      const end = lineEnd - trailing;
      units.push({
        id: `${sourceId}:${sourceIndex}`,
        sourceId,
        text,
        start,
        end,
        authoritative: true,
      });
      sourceIndex += 1;
    }

    if (newlineIndex === -1) break;
    lineStart = newlineIndex + 1;
  }

  if (units.length === 0) throw new Error('No script content to import');
  return units;
}

export function sourceRefForUnit(unit: SourceUnit): SourceRef {
  return {
    sourceId: unit.sourceId,
    unitId: unit.id,
    start: unit.start,
    end: unit.end,
  };
}
