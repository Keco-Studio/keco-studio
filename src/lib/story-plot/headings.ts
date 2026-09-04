const STORY_PLOT_HEADING_PATTERN = /^(?:\u5267\u60c5\u80cc\u666f|\u5267\u60c5\u6897\u6982(?:\u4e0e\u73a9\u5bb6\u6307\u5f15)?|\u73a9\u5bb6\u6307\u5f15|(?:\u7537\u5973\u4e3b\u8eab\u4efd|\u4eba\u7269|\u89d2\u8272|\u8eab\u4efd)\u4ecb\u7ecd|\u60ac\u5ff5\u5bfc\u5165|\u5f00\u573a(?:\u5bf9\u8bdd)?|\u89e6\u53d1\u5206\u652f\u9009\u62e9|[^：:\n]{1,12}\u7684\u56de\u5fc6|\u5267\u60c5\u5bf9\u8bdd\u7ed3\u5c3e|\u672a\u5b8c\u5f85\u7eed|\u5267\u60c5\u8282\u70b9|\u7ed3\u5c40|\u7b2c.{0,8}[\u7ae0\u8282\u5e55\u573a]|chapter\b|scene\b|act\b|ending\b)/i;
const CHARACTER_SECTION_PATTERN = /^(\u4eba\u7269|\u89d2\u8272)(?:\u4ecb\u7ecd|\u8bbe\u5b9a)?\s*[：:]?$/;
const CHARACTER_INTRO_PREFIX = /^(\u4eba\u7269|\u89d2\u8272)(?:\u4ecb\u7ecd|\u8bbe\u5b9a)?\s*[：:]/;
const SCENE_SETTING_PREFIX = /^(?:\u573a\u666f|\u5b57\u5e55|Background|Setting|Scene)\s*[：:]\s*/i;
const GENERIC_PLOT_TITLE = /^(?:Branch|Plot|\u5267\u60c5|\u60c5\u8282|\u5206\u652f)\s*\d+$/i;
export const MAX_PLOT_TITLE_CHARS = 12;

export type PlotTitleContext = {
  optionText?: string;
  isEntry?: boolean;
  isMerge?: boolean;
  plotIndex: number;
};

export function isStoryPlotHeading(content: string): boolean {
  const title = stripOuterChineseBrackets(content.trim());
  return CHARACTER_SECTION_PATTERN.test(title)
    || CHARACTER_INTRO_PREFIX.test(title)
    || STORY_PLOT_HEADING_PATTERN.test(title)
    || SCENE_SETTING_PREFIX.test(title);
}

/** True chapter break: ending / flashback / act. Not a 场景 or 人物 list. */
export function isPlotSectionBreak(content: string): boolean {
  const title = stripOuterChineseBrackets(content.trim());
  if (!title) return false;
  if (SCENE_SETTING_PREFIX.test(title)) return false;
  if (CHARACTER_SECTION_PATTERN.test(title) || CHARACTER_INTRO_PREFIX.test(title)) return false;
  return /(?:\u7ed3\u5c40|\u672a\u5b8c\u5f85\u7eed|\u5c3e\u58f0|\u95ea\u56de|epilogue|ending)\b/i.test(title)
    || /\u7684\u56de\u5fc6$/.test(title)
    || /^\u7b2c.{0,8}[\u7ae0\u8282\u5e55\u573a]/.test(title);
}

export function storyPlotHeadingTitle(content: string): string | undefined {
  const trimmed = content.trim();
  const bracketedTitle = outerChineseBracketTitle(trimmed);
  if (bracketedTitle !== undefined) return bracketedTitle;
  const characterIntro = characterIntroTitle([trimmed]);
  if (characterIntro) return characterIntro;
  if (!isStoryPlotHeading(trimmed)) return undefined;
  return trimmed.match(/^\u5267\u60c5\u8282\u70b9[^：:]{0,8}[：:]\s*(.+)$/)?.[1]?.trim() || trimmed;
}

export function clipPlotTitle(value: string): string {
  const chars = Array.from(value.trim());
  return chars.length > MAX_PLOT_TITLE_CHARS
    ? `${chars.slice(0, MAX_PLOT_TITLE_CHARS).join('')}…`
    : chars.join('');
}

function optionBeatKeys(optionText: string | undefined): string[] {
  const text = optionText?.replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const inner = text.match(/[（(]([^）)]+)[）)]/u)?.[1]?.trim();
  const stripped = text
    .replace(/^[A-Za-z]?\d*\s*(?:\u9009\u9879|\u5206\u652f|\u9009\u62e9)\s*/u, '')
    .replace(/^[A-Za-z]\d+\s*[：:]\s*/u, '')
    .trim();
  return [...new Set([text, inner, stripped].filter(Boolean).map((value) => normalizeTitleKey(value)))]
    .filter(Boolean);
}

/** Show the player's choice, not the script's A选项 / A1分支 wrapper. */
export function displayChoiceLabel(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  const inner = trimmed.match(/[（(]([^）)]+)[）)]/u)?.[1]?.trim();
  if (inner) return inner;
  const stripped = trimmed
    .replace(/^[A-Za-z]?\d*\s*(?:\u9009\u9879|\u5206\u652f|\u9009\u62e9)\s*[：:]?\s*/u, '')
    .replace(/^[A-Za-z]\d+\s*[：:]\s*/u, '')
    .trim();
  return stripped || trimmed;
}

function characterIntroTitle(contents: string[]): string | undefined {
  for (const line of contents) {
    const trimmed = line.replace(/\s+/g, ' ').trim();
    const match = CHARACTER_SECTION_PATTERN.exec(trimmed) ?? CHARACTER_INTRO_PREFIX.exec(trimmed);
    if (match) return `${match[1]}\u4ecb\u7ecd`;
  }
  return undefined;
}
function isTimeOnlyClause(value: string): boolean {
  const trimmed = value.replace(/\s+/g, '').trim();
  return /^(?:凌晨|清晨|早晨|上午|中午|下午|傍晚|晚上|夜里|深夜|次日|翌日)?\d{0,2}(?:点(?:\d{0,2}分)?)?$/.test(trimmed)
    && !/(店|家|亭|屋|房|街|路|城|镇|村|园|馆|院|厅|室)/.test(trimmed);
}

function scenePlaceName(contents: string[]): string | undefined {
  const setting = contents
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .find((line) => SCENE_SETTING_PREFIX.test(line));
  const clause = setting
    ?.replace(SCENE_SETTING_PREFIX, '')
    .split(/[。.!？?\n]/u)[0]
    ?.trim() ?? '';
  const parts = clause.split(/[，,、]/u).map((part) => part.trim()).filter(Boolean);
  const place = [...parts].reverse().find((part) => !isTimeOnlyClause(part)) ?? parts.at(-1) ?? '';
  return place ? clipPlotTitle(place) : undefined;
}

function fallbackTitle(context: PlotTitleContext): string {
  if (context.isMerge) return '\u6c47\u5408';
  if (context.isEntry) return '\u5f00\u573a';
  return `\u5267\u60c5 ${context.plotIndex + 1}`;
}

/** Structural fallback only. Character lists are 人物介绍, not 开场. */
export function summarizePlotTitle(contents: string[], context: PlotTitleContext): string {
  if (context.isMerge) return '\u6c47\u5408';
  const characters = characterIntroTitle(contents);
  const place = scenePlaceName(contents);
  const playable = contents.some((line) => {
    const trimmed = line.replace(/\s+/g, ' ').trim();
    return Boolean(trimmed) && !isStoryPlotHeading(trimmed);
  });
  if (characters && !place && !playable) return characters;
  if (context.isEntry && !place) return '\u5f00\u573a';
  if (place && !titleCopiesIncomingOption(place, context.optionText)) return place;
  return fallbackTitle(context);
}

export function isGenericPlotTitle(title: string): boolean {
  return GENERIC_PLOT_TITLE.test(title.trim());
}

export function titleCopiesIncomingOption(title: string, optionText?: string): boolean {
  const key = normalizeTitleKey(title);
  if (!key) return false;
  return optionBeatKeys(optionText).some((beat) => {
    if (!beat) return false;
    if (beat === key) return true;
    const beatChars = Array.from(beat);
    const titleChars = Array.from(key);
    if (Math.min(beatChars.length, titleChars.length) < 2) return false;
    if (key.includes(beat) || beat.includes(key)) return true;
    const [shorter, longer] = beatChars.length <= titleChars.length
      ? [beatChars, titleChars]
      : [titleChars, beatChars];
    if (longer.length - shorter.length > 2) return false;
    let index = 0;
    for (const char of longer) {
      if (char === shorter[index]) {
        index += 1;
        if (index === shorter.length) return true;
      }
    }
    return false;
  });
}

export function isCopiedPlotTitle(title: string, contents: string[]): boolean {
  const trimmed = title.trim();
  if (!trimmed) return true;
  if (isGenericPlotTitle(trimmed)) return true;
  const key = normalizeTitleKey(trimmed);
  const place = scenePlaceName(contents);
  if (place && normalizeTitleKey(place) === key) return false;
  const titleChars = Array.from(trimmed).length;
  return contents.some((line) => {
    const raw = line.replace(/\s+/g, ' ').trim();
    if (!raw) return false;
    const setting = SCENE_SETTING_PREFIX.test(raw);
    const source = setting ? raw.replace(SCENE_SETTING_PREFIX, '').trim() : raw;
    const firstClause = source.split(/[。.!？?\n]/u)[0]?.trim() ?? '';
    const body = normalizeTitleKey(source);
    const clause = normalizeTitleKey(firstClause);
    if (!body) return false;
    if (body === key || clause === key) return setting || /[。！？]/.test(raw);
    return titleChars >= 4
      && (body.startsWith(key) || clause.startsWith(key))
      && body.length > key.length;
  });
}

export function isUsablePlotTitle(
  title: string,
  contents: string[],
  optionText?: string,
): boolean {
  const trimmed = title.trim();
  if (!trimmed || /[。！？]/.test(trimmed)) return false;
  if (isGenericPlotTitle(trimmed)) return false;
  if (titleCopiesIncomingOption(trimmed, optionText)) return false;
  if (trimmed === '\u6c47\u5408') return true;
  if (trimmed === '\u5f00\u573a') return false;
  if (trimmed === '\u4eba\u7269\u4ecb\u7ecd' && scenePlaceName(contents)) return false;
  if (isCopiedPlotTitle(trimmed, contents)) return false;
  return true;
}

export function needsAiPlotTitle(
  title: string,
  contents: string[],
  optionText?: string,
): boolean {
  return !isUsablePlotTitle(title, contents, optionText);
}

export function displayPlotTitle(title: string): string {
  if (isGenericPlotTitle(title)) return title.trim();
  const place = scenePlaceName([title]);
  return place ?? title.trim();
}

function normalizeTitleKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function outerChineseBracketTitle(value: string): string | undefined {
  if (!value.startsWith('【') || !value.endsWith('】')) return undefined;
  const title = value.slice(1, -1).trim();
  return title || undefined;
}

function stripOuterChineseBrackets(value: string): string {
  return outerChineseBracketTitle(value) ?? value;
}

export function readFlowRowContent(row: Record<string, string> | undefined): string {
  if (!row) return '';
  const direct = String(row.Content ?? row.content ?? '').trim();
  if (direct) return direct;
  const match = Object.entries(row).find(([key, value]) => (
    String(value).trim() && /content|内容|dialogue/i.test(key)
  ));
  return String(match?.[1] ?? '').trim();
}
