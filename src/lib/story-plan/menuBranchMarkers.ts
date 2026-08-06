export interface MenuChoiceLine {
  code: string;
  text: string;
  textStart: number;
  textEnd: number;
}

export interface MenuBranchTarget {
  code: string;
  heading: string;
  headingStart: number;
  headingEnd: number;
}

export interface MenuMergeMarker {
  heading: string;
  headingStart: number;
  headingEnd: number;
}

const CODE_PATTERN = '[A-Za-z]{1,3}\\d{0,3}|\\d{1,3}|[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u96f6〇\u4e24]{1,4}';
const LIST_PREFIX_PATTERN = '(?:[-*+]\\s+)?';
const WRAPPED_CHOICE_PATTERN = new RegExp(
  `^${LIST_PREFIX_PATTERN}[（(\\[【]\\s*(${CODE_PATTERN})\\s*[）)\\]】]\\s*(.+)$`,
  'i'
);
const PREFIXED_CHOICE_PATTERN = new RegExp(
  `^${LIST_PREFIX_PATTERN}(${CODE_PATTERN})\\s*(?:[：:、.．]|[-—–]|[）)])\\s*(.+)$`,
  'i'
);
const TARGET_PATTERN = new RegExp(
  `^(?:\u9009\u62e9|\u9009\u9879|\u5206\u652f|\u5b50\u5206\u652f|\u8def\u7ebf|\u8def\u5f84)\\s*(${CODE_PATTERN})(?:\\s*(?:[：:、.．]|[-—–]))?\\s*(.*)$`,
  'i'
);

export function isMenuMarker(line: string): boolean {
  const { text } = unwrapLine(line);
  const normalized = text.replace(/[：:]$/, '').replace(/\s+/g, '');
  return /^(?:\u9009\u9879\u51fa\u73b0|\u9009\u9879|\u53ef\u9009\u9879|\u5206\u652f\u9009\u9879|\u9009\u62e9\u51fa\u73b0|\u8bf7\u9009\u62e9|\u8bf7\u9009\u62e9\u4e00\u9879|\u505a\u51fa\u9009\u62e9)$/.test(normalized);
}

export function isMenuDivider(line: string): boolean {
  return /^(?:\*{3,}|-{3,}|_{3,})$/.test(line.trim());
}

export function parseMenuChoiceLine(line: string): MenuChoiceLine | null {
  const match = WRAPPED_CHOICE_PATTERN.exec(line) ?? PREFIXED_CHOICE_PATTERN.exec(line);
  if (!match) return null;
  const code = normalizeMenuCode(match[1]);
  const text = match[2].trim();
  const textStart = line.indexOf(text, match.index + match[0].indexOf(match[2]));
  if (!code || !text || textStart < 0) return null;
  return { code, text, textStart, textEnd: textStart + text.length };
}

export function parseMenuBranchTarget(line: string): MenuBranchTarget | null {
  const unwrapped = unwrapLine(line);
  const match = TARGET_PATTERN.exec(unwrapped.text);
  if (!match) return null;
  const code = normalizeMenuCode(match[1]);
  if (!code) return null;
  return {
    code,
    heading: unwrapped.text,
    headingStart: unwrapped.offset,
    headingEnd: unwrapped.offset + unwrapped.text.length,
  };
}

export function isFinalMenuMerge(line: string): boolean {
  return parseFinalMenuMerge(line) !== null;
}

export function parseFinalMenuMerge(line: string): MenuMergeMarker | null {
  const { text } = unwrapLine(line);
  if (!/(?:\u6700\u7ec8\u5c3e\u58f0|\u5171\u540c\u7ed3\u5c40|\u7edf\u4e00\u7ed3\u5c40|\u5206\u652f\u6c47\u603b|\u6c47\u805a\u4e0e\u5c3e\u58f0|\u6700\u7ec8\u6c47\u5408|\u6240\u6709\u5206\u652f.*(?:\u6c47\u805a|\u6c47\u5408|\u5408\u6d41)|(?:\u5168\u90e8|\u5168\u7ebf|\u6240\u6709\u8def\u7ebf).*(?:\u6c47\u805a|\u6c47\u5408|\u5408\u6d41))/.test(text)) {
    return null;
  }
  const unwrapped = unwrapLine(line);
  return {
    heading: unwrapped.text,
    headingStart: unwrapped.offset,
    headingEnd: unwrapped.offset + unwrapped.text.length,
  };
}

function normalizeMenuCode(value: string): string | null {
  const trimmed = value.trim();
  if (/^[A-Za-z]{1,3}\d{0,3}$/.test(trimmed)) return `alpha:${trimmed.toUpperCase()}`;
  if (/^\d{1,3}$/.test(trimmed)) {
    const number = Number(trimmed);
    return number > 0 ? `number:${number}` : null;
  }
  const number = parseChineseOrdinal(trimmed);
  return number ? `number:${number}` : null;
}

function parseChineseOrdinal(value: string): number | null {
  const digits: Record<string, number> = {
    '\u96f6': 0, '〇': 0, '\u4e00': 1, '\u4e8c': 2, '\u4e24': 2, '\u4e09': 3, '\u56db': 4, '\u4e94': 5,
    '\u516d': 6, '\u4e03': 7, '\u516b': 8, '\u4e5d': 9,
  };
  if (value.length === 1) return digits[value] || null;
  if (!value.includes('\u5341')) return null;
  const [tensText, onesText] = value.split('\u5341');
  const tens = tensText ? digits[tensText] : 1;
  const ones = onesText ? digits[onesText] : 0;
  if (tens === undefined || ones === undefined) return null;
  const result = tens * 10 + ones;
  return result > 0 && result <= 999 ? result : null;
}

function unwrapLine(line: string): { text: string; offset: number } {
  let start = 0;
  let end = line.length;
  while (start < end && /\s/.test(line[start])) start += 1;
  while (end > start && /\s/.test(line[end - 1])) end -= 1;
  const pairs: Record<string, string> = {
    '【': '】', '[': ']', '（': '）', '(': ')',
  };
  if (pairs[line[start]] === line[end - 1]) {
    start += 1;
    end -= 1;
  }
  while (start < end && /\s/.test(line[start])) start += 1;
  while (end > start && /\s/.test(line[end - 1])) end -= 1;
  return { text: line.slice(start, end), offset: start };
}
