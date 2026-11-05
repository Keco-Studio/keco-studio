import { example } from './shotScript';
import { castIsReady } from './shotCast';

it('requires the exact approved outfit for each named character before staging a scene', () => {
  const appearance = 'Lin — navy coat';
  const board = { ...example, characterGuide: appearance, castSprites: [{ name: 'Lin', appearance, image: 'sprite' }] };
  expect(castIsReady(board)).toBe(true);
  expect(castIsReady({ ...board, characterGuide: 'Lin — white shirt' })).toBe(false);
  expect(castIsReady({ ...board, characterGuide: appearance + '\nMei — yellow hood' })).toBe(false);
  expect(castIsReady({ ...board, castSprites: [] })).toBe(false);
});

it('allows an explicitly prepared scene without people and requires preparation for legacy boards', () => {
  expect(castIsReady(example)).toBe(false);
  expect(castIsReady({ ...example, characterGuide: 'None', castSprites: [] })).toBe(true);
});
