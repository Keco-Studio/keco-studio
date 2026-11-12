export type ProjectTemplateKey =
  | 'blank'
  | 'tactical-deckbuilder'
  | 'narrative-adventure'
  | 'survival-builder'
  | 'management-simulation'
  | 'action-roguelike'
  | 'cooperative-puzzle';

export type ProjectTemplateDefinition = {
  key: ProjectTemplateKey;
  name: string;
  description: string;
  icon: 'blank' | 'cards' | 'story' | 'survival' | 'management' | 'action' | 'cooperative';
};

export const DEFAULT_PROJECT_TEMPLATE_KEY: ProjectTemplateKey = 'blank';

export const PROJECT_TEMPLATES: readonly ProjectTemplateDefinition[] = [
  { key: 'blank', name: 'Blank project', description: 'An empty workspace for a custom structure.', icon: 'blank' },
  { key: 'tactical-deckbuilder', name: 'Tactical deckbuilder', description: 'Card synergies, encounter pacing, and progression.', icon: 'cards' },
  { key: 'narrative-adventure', name: 'Narrative adventure', description: 'Characters, branching choices, and consequences.', icon: 'story' },
  { key: 'survival-builder', name: 'Survival builder', description: 'Gathering, crafting, survival pressure, and base growth.', icon: 'survival' },
  { key: 'management-simulation', name: 'Management simulation', description: 'Resources, production chains, and long-term tradeoffs.', icon: 'management' },
  { key: 'action-roguelike', name: 'Action roguelike', description: 'Responsive combat, run variation, and meta progression.', icon: 'action' },
  { key: 'cooperative-puzzle', name: 'Cooperative puzzle', description: 'Shared information, complementary roles, and communication.', icon: 'cooperative' },
] as const;
