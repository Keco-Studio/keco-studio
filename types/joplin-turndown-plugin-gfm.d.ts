declare module '@joplin/turndown-plugin-gfm' {
  type TurndownPlugin = (turndown: unknown) => void;

  export const gfm: TurndownPlugin;
  export const tables: TurndownPlugin;
  export const strikethrough: TurndownPlugin;
  export const taskListItems: TurndownPlugin;
  export const highlightedCodeBlock: TurndownPlugin;

  const pluginBundle: {
    gfm: TurndownPlugin;
    tables: TurndownPlugin;
    strikethrough: TurndownPlugin;
    taskListItems: TurndownPlugin;
    highlightedCodeBlock: TurndownPlugin;
  };

  export default pluginBundle;
}

export {};
