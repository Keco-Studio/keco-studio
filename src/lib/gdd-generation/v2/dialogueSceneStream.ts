import { z } from 'zod';

const MARKER_START = '<!-- KECO_DIALOGUE_SCENE ';
const MARKER_END = '-->';
const MAX_OPEN_MARKER_LENGTH = 20_000;
const boundedText = (max: number) => z.string().trim().min(1).max(max);

export const dialogueSceneEventSchema = z.object({
  chapterKey: boundedText(120),
  title: boundedText(160),
  scene: boundedText(12_000),
  participants: z.array(boundedText(160)).max(30),
  choices: z.array(boundedText(300)).max(50),
  consequences: z.string().trim().max(4_000),
}).strict();

export type DialogueSceneEvent = z.infer<typeof dialogueSceneEventSchema>;

export const dialogueSceneShapeExample = JSON.stringify({
  chapterKey: 'arrival',
  title: 'Arrival',
  scene: 'The guide blocks the gate and asks the hero for proof.',
  participants: ['Guide', 'Hero'],
  choices: ['Show the letter', 'Leave'],
  consequences: 'Showing the letter opens the gate; leaving postpones entry.',
});

export class GddDialogueSceneValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GddDialogueSceneValidationError';
  }
}

function possibleMarkerPrefixLength(value: string): number {
  const limit = Math.min(value.length, MARKER_START.length - 1);
  for (let length = limit; length > 0; length -= 1) {
    if (value.endsWith(MARKER_START.slice(0, length))) return length;
  }
  return 0;
}

export class DialogueSceneStreamParser {
  private pending = '';
  private readonly chapterKeys = new Set<string>();

  push(chunk: string): { markdown: string; events: DialogueSceneEvent[] } {
    this.pending += chunk;
    let markdown = '';
    const events: DialogueSceneEvent[] = [];

    while (this.pending) {
      const markerIndex = this.pending.indexOf(MARKER_START);
      if (markerIndex < 0) {
        const retainedLength = possibleMarkerPrefixLength(this.pending);
        markdown += this.pending.slice(0, this.pending.length - retainedLength);
        this.pending = this.pending.slice(this.pending.length - retainedLength);
        break;
      }

      markdown += this.pending.slice(0, markerIndex);
      this.pending = this.pending.slice(markerIndex);
      const markerEnd = this.pending.indexOf(MARKER_END, MARKER_START.length);
      if (markerEnd < 0) {
        if (this.pending.length > MAX_OPEN_MARKER_LENGTH) {
          throw new GddDialogueSceneValidationError('KECO dialogue scene marker exceeds the 20,000 character limit.');
        }
        break;
      }

      const rawEvent = this.pending.slice(MARKER_START.length, markerEnd).trim();
      let event: DialogueSceneEvent;
      try {
        event = dialogueSceneEventSchema.parse(JSON.parse(rawEvent));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'invalid event';
        throw new GddDialogueSceneValidationError(`Invalid KECO dialogue scene marker: ${message}`);
      }
      const chapterKey = event.chapterKey.toLocaleLowerCase();
      if (this.chapterKeys.has(chapterKey)) {
        throw new GddDialogueSceneValidationError(`Duplicate dialogue scene chapter key: ${event.chapterKey}`);
      }
      this.chapterKeys.add(chapterKey);
      events.push(event);
      this.pending = this.pending.slice(markerEnd + MARKER_END.length);
    }

    return { markdown, events };
  }

  finish(): string {
    if (
      this.pending.startsWith(MARKER_START)
      || (this.pending.length > 0 && MARKER_START.startsWith(this.pending))
    ) {
      throw new GddDialogueSceneValidationError('Unterminated KECO dialogue scene marker.');
    }
    const markdown = this.pending;
    this.pending = '';
    return markdown;
  }
}
