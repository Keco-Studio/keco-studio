import { describe, expect, it } from '@jest/globals';
import {
  DialogueSceneStreamParser,
  GddDialogueSceneValidationError,
} from './dialogueSceneStream';

const arrivalEvent = {
  chapterKey: 'arrival',
  title: 'Arrival',
  scene: 'The guide blocks the gate and asks the hero for proof.',
  participants: ['Guide', 'Hero'],
  choices: ['Show the letter', 'Leave'],
  consequences: 'Showing the letter opens the gate; leaving postpones entry.',
};

function marker(event: typeof arrivalEvent): string {
  return `<!-- KECO_DIALOGUE_SCENE ${JSON.stringify(event)} -->`;
}

describe('DialogueSceneStreamParser', () => {
  it('extracts a scene event split across chunks and keeps only visible Markdown', () => {
    const parser = new DialogueSceneStreamParser();

    expect(parser.push('## Arrival\nThe guide blocks the gate.\n<!-- KECO_DIAL')).toEqual({
      markdown: '## Arrival\nThe guide blocks the gate.\n',
      events: [],
    });
    expect(parser.push(`OGUE_SCENE ${JSON.stringify(arrivalEvent).slice(0, 45)}`)).toEqual({
      markdown: '',
      events: [],
    });
    expect(parser.push(`${JSON.stringify(arrivalEvent).slice(45)} -->\nNext section.`)).toEqual({
      markdown: '\nNext section.',
      events: [arrivalEvent],
    });
    expect(parser.finish()).toBe('');
  });

  it('streams ordinary Markdown while retaining only a possible marker prefix', () => {
    const parser = new DialogueSceneStreamParser();

    expect(parser.push('# GDD\n\nOrdinary content.')).toEqual({
      markdown: '# GDD\n\nOrdinary content.',
      events: [],
    });
    expect(parser.push('\n<!-- KEC')).toEqual({ markdown: '\n', events: [] });
    expect(parser.push('O_NOT_A_DIALOGUE_MARKER -->')).toEqual({
      markdown: '<!-- KECO_NOT_A_DIALOGUE_MARKER -->',
      events: [],
    });
    expect(parser.finish()).toBe('');
  });

  it('extracts unique scene events in encounter order', () => {
    const parser = new DialogueSceneStreamParser();
    const departure = { ...arrivalEvent, chapterKey: 'departure', title: 'Departure' };

    expect(parser.push(`${marker(arrivalEvent)}\n${marker(departure)}`)).toEqual({
      markdown: '\n',
      events: [arrivalEvent, departure],
    });
  });

  it('rejects duplicate chapter keys before a second task can start', () => {
    const parser = new DialogueSceneStreamParser();
    parser.push(marker(arrivalEvent));

    expect(() => parser.push(marker({ ...arrivalEvent, title: 'Arrival again' })))
      .toThrow(/duplicate dialogue scene chapter key/i);
  });

  it('rejects malformed event JSON', () => {
    const parser = new DialogueSceneStreamParser();

    expect(() => parser.push('<!-- KECO_DIALOGUE_SCENE {bad json} -->'))
      .toThrow(GddDialogueSceneValidationError);
  });

  it('rejects an unterminated event when the stream finishes', () => {
    const parser = new DialogueSceneStreamParser();
    parser.push('Body\n<!-- KECO_DIALOGUE_SCENE {"chapterKey":"arrival"');

    expect(() => parser.finish()).toThrow(/unterminated KECO dialogue scene marker/i);
  });

  it('rejects a partial dialogue marker prefix when the stream finishes', () => {
    const parser = new DialogueSceneStreamParser();
    parser.push('Body\n<!-- KECO_DIALOGUE_SCEN');

    expect(() => parser.finish()).toThrow(/unterminated KECO dialogue scene marker/i);
  });
});
