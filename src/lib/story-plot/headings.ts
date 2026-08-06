const STORY_PLOT_HEADING_PATTERN = /^(?:\u5267\u60c5\u80cc\u666f|\u5267\u60c5\u6897\u6982(?:\u4e0e\u73a9\u5bb6\u6307\u5f15)?|\u73a9\u5bb6\u6307\u5f15|(?:\u7537\u5973\u4e3b\u8eab\u4efd|\u4eba\u7269|\u89d2\u8272|\u8eab\u4efd)\u4ecb\u7ecd|\u60ac\u5ff5\u5bfc\u5165|\u5f00\u573a(?:\u5bf9\u8bdd)?|\u89e6\u53d1\u5206\u652f\u9009\u62e9|[^：:\n]{1,12}\u7684\u56de\u5fc6|\u5267\u60c5\u5bf9\u8bdd\u7ed3\u5c3e|\u672a\u5b8c\u5f85\u7eed|\u5267\u60c5\u8282\u70b9|\u7ed3\u5c40|\u7b2c.{0,8}[\u7ae0\u8282\u5e55\u573a]|chapter\b|scene\b|act\b|ending\b)/i;
const CHARACTER_SECTION_PATTERN = /^(\u4eba\u7269|\u89d2\u8272)(?:\u4ecb\u7ecd|\u8bbe\u5b9a)?\s*[：:]?$/;

export function isStoryPlotHeading(content: string): boolean {
  const title = stripOuterChineseBrackets(content.trim());
  return CHARACTER_SECTION_PATTERN.test(title) || STORY_PLOT_HEADING_PATTERN.test(title);
}

export function storyPlotHeadingTitle(content: string): string | undefined {
  const trimmed = content.trim();
  const bracketedTitle = outerChineseBracketTitle(trimmed);
  if (bracketedTitle !== undefined) return bracketedTitle;
  const characterSection = CHARACTER_SECTION_PATTERN.exec(trimmed);
  if (characterSection) return `${characterSection[1]}\u4ecb\u7ecd`;
  if (!isStoryPlotHeading(trimmed)) return undefined;
  return trimmed.match(/^\u5267\u60c5\u8282\u70b9[^：:]{0,8}[：:]\s*(.+)$/)?.[1]?.trim() || trimmed;
}

function outerChineseBracketTitle(value: string): string | undefined {
  if (!value.startsWith('【') || !value.endsWith('】')) return undefined;
  const title = value.slice(1, -1).trim();
  return title || undefined;
}

function stripOuterChineseBrackets(value: string): string {
  return outerChineseBracketTitle(value) ?? value;
}
