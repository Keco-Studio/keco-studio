export type VisualNovelDialogColor = 'blue' | 'pink' | 'gray';

export type VisualNovelPresentation =
  | { kind: 'dialogue'; color: VisualNovelDialogColor; alignment: 'left' }
  | { kind: 'plain'; color: null; alignment: 'left' }
  | { kind: 'fullscreen'; color: null; alignment: 'center' };

export function resolveVisualNovelPresentation(
  typeValue: string | number | undefined | null,
  nameValue: string | undefined | null,
): VisualNovelPresentation {
  switch (String(typeValue ?? '').trim()) {
    case '1':
      return { kind: 'dialogue', color: 'blue', alignment: 'left' };
    case '2':
      return { kind: 'dialogue', color: 'pink', alignment: 'left' };
    case '3':
      return { kind: 'dialogue', color: 'gray', alignment: 'left' };
    case '4':
      return { kind: 'plain', color: null, alignment: 'left' };
    case '5':
      return { kind: 'fullscreen', color: null, alignment: 'center' };
    default: {
      const name = String(nameValue ?? '').trim();
      return {
        kind: 'dialogue',
        color: name && name !== 'Speaker' ? 'blue' : 'gray',
        alignment: 'left',
      };
    }
  }
}
