export type ScenarioBranchMarker = {
  kind: 'core' | 'choice' | 'section' | 'structural';
  code: string;
  text: string;
  textStart: number;
  textEnd: number;
  control?: 'outcome' | 'return' | 'hypothetical';
};

const CORE_PATTERN = /^\u6838\u5fc3\u5206\u652f\u70b9\s*([A-Za-z][A-Za-z0-9-]*)\s*[：:]\s*(.+)$/i;
const SECTION_PATTERN = /^\u5d4c\u5957\u5b50\u5206\u652f\u70b9\s*([A-Za-z][A-Za-z0-9-]*)\s*[：:]\s*(.+)$/i;
const CHOICE_PATTERN = /^(?:\u8f6c\u5411)?\u5b50\u5206\u652f\u70b9\s*([A-Za-z][A-Za-z0-9-]*)\s*[：:]\s*(.+)$/i;

export function parseScenarioBranchMarker(line: string): ScenarioBranchMarker | null {
  const inner = unwrapParenthetical(line);
  const core = CORE_PATTERN.exec(inner.text);
  if (core) return visibleMarker('core', core[1], core[2], line, inner.offset);
  const section = SECTION_PATTERN.exec(inner.text);
  if (section) return visibleMarker('section', section[1], section[2], line, inner.offset);
  const choice = CHOICE_PATTERN.exec(inner.text);
  if (choice) return visibleMarker('choice', choice[1], choice[2], line, inner.offset);

  const control = /^(?:\u6b64\u5206\u652f\u901a\u5411\u7ed3\u5c40|\u56de\u5230\u4e3b\u7ebf|\u4e3b\u7ebf[：:]|\u95ea\u56de\/?\u5047\u8bbe\u573a\u666f)/.exec(inner.text);
  if (!control) return null;
  return {
    kind: 'structural',
    code: '',
    text: inner.text,
    textStart: inner.offset,
    textEnd: inner.offset + inner.text.length,
    control: /^\u6b64\u5206\u652f\u901a\u5411\u7ed3\u5c40/.test(inner.text)
      ? 'outcome'
      : /^(?:\u56de\u5230\u4e3b\u7ebf|\u4e3b\u7ebf[：:])/.test(inner.text)
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
    .replace(/[。.]\u5982\u679c[\s\S]*$/, '')
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
