import type { Shot, Storyboard } from './shotScript';

// Shared by single-shot redraws and whole-scene illustration.
export const characterGuidePrompt = `Create a reusable character guide for a pixel artist.
Use one line per visible named character in the exact format OriginalName — English appearance, including role, silhouette or build, hair shape, distinctive clothing and permanent accessories. Write the appearance in English.
Use the author's descriptions and director notes first. Supply missing visual traits only. Choose features that read at sprite scale: distinguish similar characters by both silhouette and a second cue such as hairstyle or clothing. Color alone is insufficient.
Separate permanent identity from temporary poses, expressions and current prop ownership. Never define a character by one shot's action. Exclude narration and plot events. Return None if the story has no visible characters.`;

export const shotStagingPrompt = `Plan a layered pixel-art shot. Return JSON with "background" (English location description without people) and "characters" (an ordered array of exact original cast-guide names visible from left to right, no duplicates).
Use only events on the selected branch. Set props and doors to their current state. Retain the setting, architecture and lighting in the same location, but establish a new setting on a location change.
The background is an EMPTY set for separate character layers: no people, silhouettes, reflections of people, or captions. Leave space for characters.
Only list characters physically present. Omit a narrator, offscreen speakers and people who already left. Keep screen order consistent with the preceding beat unless the action requires a change. Do not redesign costumes.`;

export function characterGuideInput(board: Storyboard, brief: string) {
  return JSON.stringify({
    direction: brief,
    castSource: board.shots.map(s => [s.speaker, s.line.slice(0, 350)].filter(Boolean).join(': ')).join('\n').slice(0, 12000),
  });
}

export function shotStagingInput(board: Storyboard, shot: Shot, brief: string, guide: string,
  beats: string[], reference?: Shot) {
  return JSON.stringify({
    story: board.name,
    branchHistory: beats,
    referenceScene: reference?.scene,
    currentFrame: { scene: shot.scene, speaker: shot.speaker, line: shot.line.slice(0, 3500) },
    directorNotes: brief,
    characterGuide: guide,
  });
}
