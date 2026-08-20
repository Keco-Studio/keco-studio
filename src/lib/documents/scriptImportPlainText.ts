/**
 * Convert project-document markdown into plain story text for Import script /
 * Generate conversation. Collaborative docs embed void MDX markers that confuse
 * the story Extractor/Auditor when left in place.
 */
export function toScriptImportPlainText(markdown: string): string {
  return markdown
    .replace(/<BlockAnchor\b[^>]*\/?>/gi, '')
    .replace(
      /<ResourceReference\b[^>]*\bfallbackLabel="([^"]*)"[^>]*\/?>/gi,
      '$1'
    )
    .replace(/<ResourceReference\b[^>]*\/?>/gi, '')
    .replace(
      /<GddMapReference\b[^>]*\bfallbackTitle="([^"]*)"[^>]*\/?>/gi,
      '$1'
    )
    .replace(/<GddMapReference\b[^>]*\/?>/gi, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCharCode(Number.parseInt(dec, 10))
    )
    .split('\n')
    .map(normalizeMarkdownLine)
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeMarkdownLine(line: string): string {
  return line
    .replace(/\\([\\`*_\[\]{}()#+\-.!>])/g, '$1')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*[-+]\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1');
}
