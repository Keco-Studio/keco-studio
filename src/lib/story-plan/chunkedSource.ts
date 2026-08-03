import type { SourceUnit } from '@/lib/story-ir/schema';
import type { SegmentedStorySource } from './sourceSegments';

const STORY_BOUNDARY_PATTERN = /^(?:【|\u573a\u666f(?:[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\d]|[：:])|\u5206\u652f(?:\u70b9)?\s*[A-Za-z\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\d]|\*?→|\u7ed3\u5c40|\u7edf\u4e00(?:\u5408\u5e76)?\u7ed3\u5c40|\u7b2c.{0,8}[\u7ae0\u8282\u5e55\u573a])/i;

export function chunkStorySource(
  source: SegmentedStorySource,
  maxCharacters: number
): SegmentedStorySource[] {
  if (source.units.length === 0) return [];
  if (!Number.isFinite(maxCharacters) || maxCharacters <= 0) return [source];

  const groups: SourceUnit[][] = [];
  let current: SourceUnit[] = [];

  const groupLength = (units: SourceUnit[]) => units.reduce(
    (total, unit, index) => total + unit.text.length + (index > 0 ? 1 : 0),
    0
  );
  const flush = (units: SourceUnit[]) => {
    if (units.length > 0) groups.push(units);
  };

  for (const unit of source.units) {
    if (current.length === 0) {
      current.push(unit);
      continue;
    }

    const projected = groupLength(current) + 1 + unit.text.length;
    if (projected <= maxCharacters || unit.text.length > maxCharacters) {
      current.push(unit);
      continue;
    }

    if (isStoryBoundary(unit.text)) {
      flush(current);
      current = [unit];
      continue;
    }

    const lastBoundaryIndex = current.findLastIndex((candidate, index) => (
      index > 0 && isStoryBoundary(candidate.text)
    ));
    if (lastBoundaryIndex > 0) {
      flush(current.slice(0, lastBoundaryIndex));
      current = [...current.slice(lastBoundaryIndex), unit];
      continue;
    }

    flush(current);
    current = [unit];
  }
  flush(current);

  if (groups.length <= 1) return [source];
  return groups.map((units) => sourceChunk(source, units));
}

function isStoryBoundary(text: string): boolean {
  return STORY_BOUNDARY_PATTERN.test(text.trim());
}

function sourceChunk(
  source: SegmentedStorySource,
  units: SourceUnit[]
): SegmentedStorySource {
  const unitIds = new Set(units.map((unit) => unit.id));
  const segments = source.segments.filter((segment) => unitIds.has(segment.unitId));
  const segmentIds = new Set(segments.map((segment) => segment.id));
  return {
    sourceId: source.sourceId,
    content: source.content,
    units,
    segments,
    commands: source.commands.filter((command) => segmentIds.has(command.segmentId)),
  };
}
