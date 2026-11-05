/** Normalize unambiguous author annotations before auditing AI conversion. */
export function naturalScriptSource(text: string): string {
  let profiles = false;
  const lines = text.split('\n');
  const profilePattern = /^([^:：—\-*]{1,40})\s*(?:——|—| - )\s*(.+)$/;
  return lines.flatMap((line, index) => {
    const trimmed = line.trim();
    if (/^(?:\u4eba\u7269\u8d44\u6599|\u89d2\u8272\u8d44\u6599|\u4eba\u7269\u4ecb\u7ecd|\u89d2\u8272\u4ecb\u7ecd)[:：]?$/.test(trimmed)
      && profilePattern.test(lines.slice(index + 1).find(next => next.trim())?.trim() ?? '')) {
      profiles = true;
      return [];
    }
    if (!trimmed) return [line];
    const profile = profiles && profilePattern.exec(trimmed);
    if (profile) return [`**Character - ${profile[1].trim()}**`, `*${profile[2].trim()}*`];
    profiles = false;
    if (/^(?:\u5730\u70b9|\u573a\u666f|\u65f6\u95f4|\u73af\u5883)[:：]/.test(trimmed)) return [`*${trimmed}*`];
    // Only quoted prose cues carry a reporting verb. A standard unquoted
    // speaker whose name ends in \u8bf4 must retain that name.
    const speech = /^(.+?)(?:\u56de\u7b54|\u8bf4\u9053|\u95ee\u9053|\u8bf4|\u95ee)[:：]\s*[“「"](.+)[”」"]\s*$/.exec(trimmed);
    return [speech ? `${speech[1].trim()}: ${speech[2]}` : line];
  }).join('\n');
}

export function naturalChoiceLabels(line: string): string[] {
  const match = /^(?:\u8fd9\u91cc)?(?:\u8ba9|\u7531)?\u73a9\u5bb6\u9009\u62e9[:：]\s*(.+)$/.exec(line.trim());
  if (!match) return [];
  const labels = match[1].replace(/[。.]$/, '').split(/\s*[/／]\s*/).filter(Boolean);
  return labels.length >= 2 ? labels : [];
}
