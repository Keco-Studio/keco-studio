export type ScenarioBranchMarker = {
  kind: 'core' | 'choice' | 'section' | 'structural';
  code: string;
  text: string;
  textStart: number;
  textEnd: number;
  control?: 'outcome' | 'return' | 'hypothetical';
};

const CORE_PATTERN = /^核心分支点\s*([A-Za-z][A-Za-z0-9-]*)\s*[：:]\s*(.+)$/i;
const SECTION_PATTERN = /^嵌套子分支点\s*([A-Za-z][A-Za-z0-9-]*)\s*[：:]\s*(.+)$/i;
const CHOICE_PATTERN = /^(?:转向)?子分支点\s*([A-Za-z][A-Za-z0-9-]*)\s*[：:]\s*(.+)$/i;

export function parseScenarioBranchMarker(line: string): ScenarioBranchMarker | null {
  const inner = unwrapParenthetical(line);
  const core = CORE_PATTERN.exec(inner.text);
  if (core) return visibleMarker('core', core[1], core[2], line, inner.offset);
  const section = SECTION_PATTERN.exec(inner.text);
  if (section) return visibleMarker('section', section[1], section[2], line, inner.offset);
  const choice = CHOICE_PATTERN.exec(inner.text);
  if (choice) return visibleMarker('choice', choice[1], choice[2], line, inner.offset);

  const control = /^(?:此分支通向结局|回到主线|主线[：:]|闪回\/?假设场景)/.exec(inner.text);
  if (!control) return null;
  return {
    kind: 'structural',
    code: '',
    text: inner.text,
    textStart: inner.offset,
    textEnd: inner.offset + inner.text.length,
    control: /^此分支通向结局/.test(inner.text)
      ? 'outcome'
      : /^(?:回到主线|主线[：:])/.test(inner.text)
        ? 'return'
        : 'hypothetical',
  };
}

function visibleMarker(
  kind: 'core' | 'choice' | 'section',
  codeValue: string,
  rawText: string,
  line: string,
  offset: number
): ScenarioBranchMarker {
  const text = cleanVisibleText(rawText);
  const rawStart = line.indexOf(rawText, offset);
  const textOffset = rawText.indexOf(text);
  return {
    kind,
    code: codeValue.toUpperCase(),
    text,
    textStart: rawStart + textOffset,
    textEnd: rawStart + textOffset + text.length,
  };
}

function cleanVisibleText(value: string): string {
  return value
    .replace(/[。.]如果[\s\S]*$/, '')
    .replace(/[。.!！]+$/, '')
    .trim();
}

function unwrapParenthetical(line: string): { text: string; offset: number } {
  let start = 0;
  let end = line.length;
  while (start < end && /\s/.test(line[start])) start += 1;
  while (end > start && /\s/.test(line[end - 1])) end -= 1;
  const pairs: Record<string, string> = { '(': ')', '（': '）' };
  if (pairs[line[start]] === line[end - 1]) {
    start += 1;
    end -= 1;
  }
  while (start < end && /\s/.test(line[start])) start += 1;
  while (end > start && /\s/.test(line[end - 1])) end -= 1;
  return { text: line.slice(start, end), offset: start };
}
