/** CommonMark thematic break: 3+ matching -, *, or _ with optional spaces. */
const THEMATIC_BREAK_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

function isThematicBreak(line: string): boolean {
  return THEMATIC_BREAK_RE.test(line);
}

/**
 * Collapse consecutive Markdown thematic breaks (`---`, `***`, `___`) into one.
 * If the document is only breaks (and blank lines), strip them entirely.
 * Fenced code blocks are left unchanged.
 */
export function collapseMarkdownThematicBreaks(markdown: string): string {
  if (!markdown) return markdown;

  const lines = markdown.split('\n');
  const out: string[] = [];
  let inFence = false;
  let lastEmittedWasBreak = false;
  let hasSubstantiveContent = false;

  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      out.push(line);
      lastEmittedWasBreak = false;
      hasSubstantiveContent = true;
      continue;
    }

    if (inFence) {
      out.push(line);
      hasSubstantiveContent = true;
      continue;
    }

    if (isThematicBreak(line)) {
      if (!lastEmittedWasBreak) {
        out.push('---');
        lastEmittedWasBreak = true;
      }
      continue;
    }

    if (line.trim() === '') {
      // Drop blanks that sit inside a break run so `---\n\n---` stays one rule.
      if (!lastEmittedWasBreak) {
        out.push(line);
      }
      continue;
    }

    if (lastEmittedWasBreak && out[out.length - 1] !== '') {
      out.push('');
    }
    out.push(line);
    lastEmittedWasBreak = false;
    hasSubstantiveContent = true;
  }

  if (!hasSubstantiveContent) {
    return '';
  }

  return out.join('\n');
}
