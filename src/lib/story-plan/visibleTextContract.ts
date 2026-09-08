import type { StoryDocument } from '@/lib/story-ir/schema';
import type {
  SegmentedStorySource,
  SourceSegment,
  SourceSegmentKind,
} from './sourceSegments';

/**
 * Text that a player can read in the story UI. Structural labels and authoring
 * metadata deliberately stay outside this contract.
 */
export const PLAYER_VISIBLE_SEGMENT_KINDS = new Set<SourceSegmentKind>([
  'speaker',
  'dialogue',
  'narration',
  'choice_text',
]);

export interface VisibleTextRequirement {
  id: string;
  segmentId: string;
  unitId: string;
  kind: SourceSegmentKind;
  sourceText: string;
  text: string;
  start: number;
  end: number;
}

export interface VisibleTextManifest {
  version: 1;
  sourceId: string;
  items: VisibleTextRequirement[];
}

export interface VisibleTextAuditIssue {
  type: 'missing';
  requirementId: string;
  segmentId: string;
  text: string;
}

export interface VisibleTextAudit {
  verdict: 'pass' | 'fail';
  issues: VisibleTextAuditIssue[];
}

export function buildVisibleTextManifest(
  source: SegmentedStorySource
): VisibleTextManifest {
  return {
    version: 1,
    sourceId: source.sourceId,
    items: source.segments
      .filter(isPlayerVisibleSegment)
      .sort((left, right) => left.start - right.start || left.end - right.end)
      .flatMap((segment) => {
        const text = visibleTextForSegment(segment);
        if (text === null) return [];
        let start = segment.start;
        let end = segment.end;
        if (text !== segment.text) {
          const relativeStart = segment.text.indexOf(text);
          if (relativeStart < 0) return [];
          start = segment.start + relativeStart;
          end = start + text.length;
        }
        return [{
          id: `${source.sourceId}:${segment.id}`,
          segmentId: segment.id,
          unitId: segment.unitId,
          kind: segment.kind,
          sourceText: segment.text,
          text,
          start,
          end,
        }];
      }),
  };
}

/**
 * Check that every source string occurs verbatim and in source order. Extra
 * rendered strings are allowed so a game can extend the authored script.
 */
export function auditVisibleText(
  manifest: VisibleTextManifest,
  renderedText: string | readonly string[]
): VisibleTextAudit {
  const output = Array.isArray(renderedText)
    ? renderedText.join('\n')
    : renderedText;
  const issues: VisibleTextAuditIssue[] = [];
  let cursor = 0;

  for (const item of manifest.items) {
    const foundAt = output.indexOf(item.text, cursor);
    if (foundAt < 0) {
      issues.push({
        type: 'missing',
        requirementId: item.id,
        segmentId: item.segmentId,
        text: item.text,
      });
      continue;
    }
    cursor = foundAt + item.text.length;
  }

  return {
    verdict: issues.length === 0 ? 'pass' : 'fail',
    issues,
  };
}

export function renderStoryDocumentVisibleText(
  document: StoryDocument
): string[] {
  const rendered: string[] = [];
  for (const node of document.nodes) {
    if (node.speaker !== undefined && node.speaker.length > 0) {
      rendered.push(node.speaker);
    }
    if (node.content.length > 0) rendered.push(node.content);
    node.options.forEach((option) => {
      if (option.text.length > 0) rendered.push(option.text);
    });
  }
  return rendered;
}

function isPlayerVisibleSegment(
  segment: SourceSegment
): boolean {
  if (!segment.required || !PLAYER_VISIBLE_SEGMENT_KINDS.has(segment.kind)) return false;
  // A standalone parenthesized line is authoring-stage direction, even when
  // the permissive source parser classified it as narration.
  return !(segment.kind === 'narration' && /^[（(][^）)]*[）)]$/.test(segment.text.trim()));
}

function visibleTextForSegment(segment: SourceSegment): string | null {
  let text = segment.text;
  if (segment.kind === 'narration') {
    text = text
      .replace(/^[（(][^）)]*[）)]\s*/, '')
      .replace(/\$[A-Za-z_]\w*\s*(?:\+=|-=|\*=|\/=|=)\s*-?(?:\d+\.?\d*|\.\d+)/g, '')
      .replace(/^\s*[-*+]\s+/, '')
      .replace(/[\s,.!;:]*when\s+(?:this\s+)?(?:choice|option|selection)\s+is\s+(?:selected|made|chosen)[\s,.!;:]*(?:run|set|execute)?[\s,.!;:]*$/i, '')
      .trim();
    if (/^(?:final merge|merge|the paths merge|branch choice(?: point)?|choose one(?: of the following)?|there (?:are|is) (?:\d+ )?choices? here)\s*[:：]?$/i.test(text)) return null;
    if (/^if\b[^.!?;]{1,80}[:：]$/i.test(text)) return null;
  }
  return text || null;
}
