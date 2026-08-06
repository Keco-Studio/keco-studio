export type EdgeLabelAnchor = {
  id: string;
  text: string;
  x: number;
  y: number;
};

export type PlacedEdgeLabel = {
  id: string;
  text: string;
  x: number;
  y: number;
  lines: string[];
  width: number;
  height: number;
};

const CHAR_WIDTH = 11;
const LINE_HEIGHT = 14;
const MAX_CHARS_PER_LINE = 8;
const MAX_LINES = 3;
const LABEL_PAD = 6;

export function wrapEdgeLabel(
  text: string,
  maxCharsPerLine = MAX_CHARS_PER_LINE,
  maxLines = MAX_LINES
): string[] {
  const chars = Array.from(text);
  if (chars.length === 0) return [''];
  if (chars.length <= maxCharsPerLine) return [text];

  const lines: string[] = [];
  for (let i = 0; i < chars.length; i += maxCharsPerLine) {
    lines.push(chars.slice(i, i + maxCharsPerLine).join(''));
  }

  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  const last = Array.from(kept[maxLines - 1] ?? '');
  kept[maxLines - 1] =
    last.slice(0, Math.max(1, maxCharsPerLine - 1)).join('') + '…';
  return kept;
}

function labelSize(lines: string[]): { width: number; height: number } {
  const width = Math.max(1, ...lines.map((line) => Array.from(line).length)) * CHAR_WIDTH;
  return { width, height: lines.length * LINE_HEIGHT };
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  const ax1 = a.x - a.width / 2 - LABEL_PAD;
  const ax2 = a.x + a.width / 2 + LABEL_PAD;
  const ay1 = a.y - a.height / 2 - LABEL_PAD;
  const ay2 = a.y + a.height / 2 + LABEL_PAD;
  const bx1 = b.x - b.width / 2 - LABEL_PAD;
  const bx2 = b.x + b.width / 2 + LABEL_PAD;
  const by1 = b.y - b.height / 2 - LABEL_PAD;
  const by2 = b.y + b.height / 2 + LABEL_PAD;
  return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
}

/**
 * Place edge option labels with wrapping and simple collision resolution.
 * Labels are nudged into free space (prefer vertical, then horizontal).
 */
export function placeEdgeLabels(anchors: EdgeLabelAnchor[]): PlacedEdgeLabel[] {
  const placed: PlacedEdgeLabel[] = anchors.map((anchor) => {
    const lines = wrapEdgeLabel(anchor.text);
    const size = labelSize(lines);
    return {
      id: anchor.id,
      text: anchor.text,
      x: anchor.x,
      y: anchor.y,
      lines,
      width: size.width,
      height: size.height,
    };
  });

  // Multiple passes so cascading overlaps settle.
  for (let pass = 0; pass < 4; pass += 1) {
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        const current = placed[i]!;
        const earlier = placed[j]!;
        if (!overlaps(current, earlier)) continue;

        const pushDown =
          earlier.y + earlier.height / 2 + LABEL_PAD - (current.y - current.height / 2);
        if (pushDown > 0 && pushDown < LINE_HEIGHT * 4) {
          current.y += pushDown;
          continue;
        }

        const preferRight = current.x >= earlier.x;
        const needed =
          earlier.width / 2 +
          current.width / 2 +
          LABEL_PAD -
          Math.abs(current.x - earlier.x) +
          1;
        current.x += preferRight ? needed : -needed;
      }
    }
  }

  return placed;
}
