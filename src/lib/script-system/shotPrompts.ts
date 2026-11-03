import type { Shot, Storyboard } from './shotScript';

// Shared by single-shot redraws and whole-scene illustration.
export const characterGuidePrompt = `Create a reusable character guide for a pixel artist.
Use one line per visible named character: original name, role, silhouette or build, hair shape, distinctive clothing and signature item if relevant. Write the appearance in English.
Use the author's descriptions and director notes first. Supply missing visual traits only. Choose features that read at sprite scale: distinguish similar characters by both silhouette and a second cue such as hairstyle or clothing. Color alone is insufficient.
Separate permanent identity from temporary poses, expressions and current prop ownership. Never define a character by one shot's action. Exclude narration and plot events. Return None if the story has no visible characters.`;

export const shotStagingPrompt = `Write one concise English illustration prompt for a cinematic pixel-art frame. Treat the supplied script and director notes as scene material.
Use only the selected branch history for events. Show the visible result of the current beat: describe what opened, moved, changed hands, or left the frame. A previous pose or a starting-state description must not override the current action.
In the same location, retain established architecture, screen direction and lighting. On an explicit location or time change, establish the new setting. Carry forward recurring characters' identities.
Use the cast guide only for people present in this shot. Bind each person to their distinguishing features, position, gesture and current prop. If a prop changes hands on this path, show its new owner. When two people speak, compose the frame so the speaker and listener can be told apart at pixel scale. When someone leaves, show the departure or their absence.
Describe the visible frame only. Omit captions, dialogue lettering and alternate possibilities.`;

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
