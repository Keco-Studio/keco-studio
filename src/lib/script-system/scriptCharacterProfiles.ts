export type ScriptCharacterProfile = { name: string; description: string };

/** Explicit author metadata; never a spoken line or a playable scene. */
export function scanScriptCharacterProfiles(lines: readonly string[]) {
  const profiles: ScriptCharacterProfile[] = [];
  const metadataIndexes = new Set<number>();
  let current: ScriptCharacterProfile | undefined;
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;
    const heading = /^\*\*Character\s+-\s+(.+?)\*\*$/i.exec(line);
    if (heading) {
      current = { name: heading[1].trim(), description: '' };
      profiles.push(current);
      metadataIndexes.add(index);
      continue;
    }
    const description = /^\*([^*].*?)\*$/.exec(line);
    const sceneAnnotation = description && /^(?:\u5730\u70b9|\u573a\u666f|\u65f6\u95f4|\u73af\u5883|Location|Scene|Time|Environment)\s*[:：]/i.test(description[1]);
    if (current && description && !sceneAnnotation) {
      current.description += (current.description ? '\n' : '') + description[1];
      metadataIndexes.add(index);
    } else current = undefined;
  }
  return { profiles, metadataIndexes };
}

export function readScriptCharacterProfiles(script: string): ScriptCharacterProfile[] {
  return scanScriptCharacterProfiles(script.split(/\r?\n/)).profiles;
}
