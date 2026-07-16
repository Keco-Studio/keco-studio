export type DocumentEditOperation =
  | { type: 'replace_all'; markdown: string }
  | { type: 'replace_text'; target: string; replacement: string }
  | { type: 'insert_before'; anchor: string; content: string }
  | { type: 'insert_after'; anchor: string; content: string }
  | { type: 'append'; content: string }
  | { type: 'delete_text'; target: string };

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function exactMatchIndex(markdown: string, target: string): number {
  if (target.length === 0) {
    throw new Error('Edit target must be non-empty.');
  }

  let count = 0;
  let firstIndex = -1;
  let searchFrom = 0;
  while (searchFrom <= markdown.length - target.length) {
    const index = markdown.indexOf(target, searchFrom);
    if (index === -1) break;
    if (firstIndex === -1) firstIndex = index;
    count += 1;
    searchFrom = index + target.length;
  }

  if (count !== 1) {
    throw new Error(`Edit target must occur exactly once; found ${count} matches.`);
  }
  return firstIndex;
}

function lineBoundary(left: string, right: string): string {
  if (left.length === 0 || right.length === 0) return '';
  return left.endsWith('\n') || right.startsWith('\n') ? '' : '\n';
}

function insertAtLineBoundary(prefix: string, content: string, suffix: string): string {
  return `${prefix}${lineBoundary(prefix, content)}${content}${lineBoundary(content, suffix)}${suffix}`;
}

function appendWithBlankLine(markdown: string, content: string): string {
  if (markdown.length === 0) return content;

  const trailingNewlines = markdown.length - markdown.replace(/\n+$/, '').length;
  const leadingNewlines = content.length - content.replace(/^\n+/, '').length;
  const missingNewlines = Math.max(0, 2 - trailingNewlines - leadingNewlines);
  return `${markdown}${'\n'.repeat(missingNewlines)}${content}`;
}

export function applyDocumentEditOperation(
  currentMarkdown: string,
  operation: DocumentEditOperation
): string {
  const markdown = normalizeLineEndings(currentMarkdown);

  switch (operation.type) {
    case 'replace_all':
      return normalizeLineEndings(operation.markdown);
    case 'replace_text': {
      const target = normalizeLineEndings(operation.target);
      const replacement = normalizeLineEndings(operation.replacement);
      const index = exactMatchIndex(markdown, target);
      return `${markdown.slice(0, index)}${replacement}${markdown.slice(index + target.length)}`;
    }
    case 'delete_text': {
      const target = normalizeLineEndings(operation.target);
      const index = exactMatchIndex(markdown, target);
      return `${markdown.slice(0, index)}${markdown.slice(index + target.length)}`;
    }
    case 'insert_before': {
      const anchor = normalizeLineEndings(operation.anchor);
      const content = normalizeLineEndings(operation.content);
      const index = exactMatchIndex(markdown, anchor);
      return insertAtLineBoundary(markdown.slice(0, index), content, markdown.slice(index));
    }
    case 'insert_after': {
      const anchor = normalizeLineEndings(operation.anchor);
      const content = normalizeLineEndings(operation.content);
      const index = exactMatchIndex(markdown, anchor) + anchor.length;
      return insertAtLineBoundary(markdown.slice(0, index), content, markdown.slice(index));
    }
    case 'append':
      return appendWithBlankLine(markdown, normalizeLineEndings(operation.content));
  }
}

export function summarizeDocumentEditOperation(operation: DocumentEditOperation): string {
  switch (operation.type) {
    case 'replace_all':
      return `Replace entire document (${operation.markdown.length} characters).`;
    case 'replace_text':
      return `Replace one exact text occurrence (${operation.target.length} characters) with ${operation.replacement.length} characters.`;
    case 'insert_before':
      return `Insert ${operation.content.length} characters before one exact anchor (${operation.anchor.length} characters).`;
    case 'insert_after':
      return `Insert ${operation.content.length} characters after one exact anchor (${operation.anchor.length} characters).`;
    case 'append':
      return `Append ${operation.content.length} characters.`;
    case 'delete_text':
      return `Delete one exact text occurrence (${operation.target.length} characters).`;
  }
}
