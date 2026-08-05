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

const CODE_PATTERN = '[A-Za-z]{1,3}\\d{0,3}|\\d{1,3}|[一二三四五六七八九十百零〇两]{1,4}';
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
  `^(?:选择|选项|分支|子分支|路线|路径)\\s*(${CODE_PATTERN})(?:\\s*(?:[：:、.．]|[-—–]))?\\s*(.*)$`,
  'i'
);

export function isMenuMarker(line: string): boolean {
  const { text } = unwrapLine(line);
  const normalized = text.replace(/[：:]$/, '').replace(/\s+/g, '');
  return /^(?:选项出现|选项|可选项|分支选项|选择出现|请选择|请选择一项|做出选择)$/.test(normalized);
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
  if (!/(?:最终尾声|共同结局|统一结局|分支汇总|汇聚与尾声|最终汇合|所有分支.*(?:汇聚|汇合|合流)|(?:全部|全线|所有路线).*(?:汇聚|汇合|合流))/.test(text)) {
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
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9,
  };
  if (value.length === 1) return digits[value] || null;
  if (!value.includes('十')) return null;
  const [tensText, onesText] = value.split('十');
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
