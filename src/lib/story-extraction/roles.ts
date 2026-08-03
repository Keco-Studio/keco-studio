const PROTAGONIST_SPEAKER_PATTERN = /^(?:\u4f60|\u6211|\u4e3b\u89d2|\u73a9\u5bb6|you|i|me|player|protagonist)$/i;
const LEAD_ROLE_PATTERN = /^(?:\u7537\u4e3b|\u5973\u4e3b|male lead|female lead)$/i;
const FIRST_PERSON_CONTENT_PATTERN = /(?:\u6211|\u4ffa|\u672c\u4eba|\b(?:i|me)\b)/i;
const SECOND_PERSON_CONTENT_PATTERN = /(?:\u4f60|\u60a8|\byou\b)/i;

type DialogueIdentityLine = {
  type?: string;
  speaker: string;
  content?: string;
};

export function isProtagonistSpeaker(speaker: string): boolean {
  return PROTAGONIST_SPEAKER_PATTERN.test(speaker.trim());
}

export function resolveProtagonistSpeaker(
  lines: DialogueIdentityLine[]
): string | undefined {
  const dialogue = lines.filter((line) => line.type === 'dialogue' && line.speaker.trim());
  const direct = dialogue.find((line) => isProtagonistSpeaker(line.speaker));
  if (direct) return direct.speaker.trim();

  const leadSpeakers = [...new Set(
    dialogue
      .map((line) => line.speaker.trim())
      .filter((speaker) => LEAD_ROLE_PATTERN.test(speaker))
  )];
  if (leadSpeakers.length === 1) return leadSpeakers[0];
  if (leadSpeakers.length < 2) return undefined;

  const scores = leadSpeakers.map((speaker) => {
    const ownFirstPersonLines = dialogue.filter((line) => (
      line.speaker.trim() === speaker
      && FIRST_PERSON_CONTENT_PATTERN.test(line.content ?? '')
    )).length;
    const addressedByOtherLeadLines = dialogue.filter((line) => (
      line.speaker.trim() !== speaker
      && leadSpeakers.includes(line.speaker.trim())
      && SECOND_PERSON_CONTENT_PATTERN.test(line.content ?? '')
    )).length;
    return { speaker, score: ownFirstPersonLines + addressedByOtherLeadLines };
  });
  const highest = Math.max(...scores.map(({ score }) => score));
  const winners = scores.filter(({ score }) => score === highest);
  return highest > 0 && winners.length === 1 ? winners[0].speaker : undefined;
}
