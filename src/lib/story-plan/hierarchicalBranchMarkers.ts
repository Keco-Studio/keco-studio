export interface HierarchicalBranchMarker {
  code: string;
  groupKey: string;
  choiceText: string;
  choiceStart: number;
  choiceEnd: number;
}

const ALPHA_POINT_PATTERN = /^\s*(?:[*→]\s*)?\u5206\u652f\u70b9\s*([A-Za-z][A-Za-z0-9]*)\s*[：:]\s*(.+?)\s*$/i;
const NESTED_ALPHA_PATTERN = /^\s*(?:[*→]\s*)?\u5d4c\u5957\u5206\u652f\s*([A-Za-z][A-Za-z0-9]*)\s*[：:]\s*(.+?)\s*$/i;
const ALPHA_BRANCH_PATTERN = /^\s*(?:[*→]\s*)?\u5206\u652f\s*([A-Za-z][A-Za-z0-9]*)\s*[：:]\s*(.+?)\s*$/i;
const ORDINAL_BRANCH_PATTERN = /^\s*(?:[*→]\s*)?\u5206\u652f\s*([\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u96f6〇\u4e24\d]+)\s*[：:]\s*(.+?)\s*$/;
const LAYERED_ROOT_PATTERN = /^\s*\u4e00\u7ea7\u9009\u62e9\s*([\d]+)\s*[：:]\s*(.+?)\s*$/;
const LAYERED_NESTED_PATTERN = /^\s*\u4e8c\u7ea7\u5d4c\u5957\u5206\u652f\s*([\d]+)\s*[-－]\s*([\d]+)\s*[：:]\s*(.+?)\s*$/;

export function parseHierarchicalBranchMarker(
  line: string
): HierarchicalBranchMarker | null {
  const unwrapped = unwrapMarkerLine(line);
  const layeredNested = LAYERED_NESTED_PATTERN.exec(unwrapped.text);
  const layeredRoot = LAYERED_ROOT_PATTERN.exec(unwrapped.text);
  const match = ALPHA_POINT_PATTERN.exec(unwrapped.text)
    ?? NESTED_ALPHA_PATTERN.exec(unwrapped.text)
    ?? ALPHA_BRANCH_PATTERN.exec(unwrapped.text)
    ?? ORDINAL_BRANCH_PATTERN.exec(unwrapped.text);
  if (!match && !layeredRoot && !layeredNested) return null;

  const code = layeredNested
    ? `L2-${layeredNested[1]}-${layeredNested[2]}`
    : layeredRoot
      ? `L1-${layeredRoot[1]}`
      : match![1].toUpperCase();
  const rawChoice = layeredNested?.[3] ?? layeredRoot?.[2] ?? match![2];
  if (/^\u9009\u62e9\s*[【[]/.test(rawChoice)) return null;
  const cleaned = cleanChoice(rawChoice);
  if (!cleaned) return null;
  const rawStart = line.indexOf(rawChoice, unwrapped.offset);
  const choiceOffset = rawChoice.indexOf(cleaned);
  if (rawStart < 0 || choiceOffset < 0) return null;

  return {
    code,
    groupKey: groupKey(code),
    choiceText: cleaned,
    choiceStart: rawStart + choiceOffset,
    choiceEnd: rawStart + choiceOffset + cleaned.length,
  };
}

function groupKey(code: string): string {
  if (/^L1-\d+$/.test(code)) return 'layered-root';
  const layeredNested = /^L2-(\d+)-\d+$/.exec(code);
  if (layeredNested) return `layered-${layeredNested[1]}`;
  if (!/^[A-Z]/.test(code)) return 'ordinal-root';
  if (code.length === 1) return 'alpha-root';
  const parentCode = /[A-Z]$/.test(code)
    ? code.slice(0, -1)
    : code.replace(/\d+$/, '');
  return `alpha-${parentCode}`;
}

function cleanChoice(value: string): string {
  const beforeOutcome = value.replace(/\s*→[\s\S]*$/, '').trim();
  return beforeOutcome
    .replace(/\s*[（(][^）)]*(?:\u5d4c\u5957|\u7ed3\u5c40)[^）)]*[）)]\s*$/, '')
    .replace(/[。.!！]+$/, '')
    .trim();
}

function unwrapMarkerLine(line: string): { text: string; offset: number } {
  let start = 0;
  let end = line.length;
  while (start < end && /\s/.test(line[start])) start += 1;
  while (end > start && /\s/.test(line[end - 1])) end -= 1;

  const transfer = /\s*[（(]\s*\u8f6c[^）)]*[）)]\s*$/.exec(line.slice(start, end));
  if (transfer?.index !== undefined) end = start + transfer.index;
  while (end > start && /\s/.test(line[end - 1])) end -= 1;
  if (line[start] === '【' && line[end - 1] === '】') {
    start += 1;
    end -= 1;
  }
  while (start < end && /\s/.test(line[start])) start += 1;
  while (end > start && /\s/.test(line[end - 1])) end -= 1;
  return { text: line.slice(start, end), offset: start };
}
