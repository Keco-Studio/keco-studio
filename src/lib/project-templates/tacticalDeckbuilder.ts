import { HAND_PAINTED_2D_V1_PRESET, parseRetainedGameArtStyleSnapshot } from '@/lib/game-art-style/presets';
import { parseProjectTemplateManifest } from './schema';

const rules = {
  schemaVersion: 2 as const,
  genres: ['Deckbuilder', 'Strategy', 'Roguelike'],
  philosophies: ['Readable Systems', 'Meaningful Tradeoffs', 'Controlled Variance'],
  suitableFor: 'A single-player tactical deckbuilder built around short encounters and compact deck growth.',
  rules: [
    { id: 'hero-as-player', domain: 'player' as const, kind: 'constraint' as const, title: 'One visible hero state', statement: 'The player controls one hero with a visible draw pile, hand, discard pile, exhaust pile, health, block, energy, and statuses.', appliesWhen: 'Presenting or resolving combat state.', severity: 'required' as const },
    { id: 'win-before-collapse', domain: 'objective' as const, kind: 'constraint' as const, title: 'Defeat the encounter', statement: 'Win by reducing every enemy to zero health before the hero reaches zero health.', appliesWhen: 'Checking encounter completion.', severity: 'required' as const },
    { id: 'cards-are-actions', domain: 'action' as const, kind: 'constraint' as const, title: 'Cards are the action vocabulary', statement: 'The player acts by playing affordable cards, choosing required targets, and resolving their rules text in order.', appliesWhen: 'The player takes an action during the action phase.', severity: 'required' as const },
    { id: 'state-is-explicit', domain: 'object_state' as const, kind: 'principle' as const, title: 'State remains explicit', statement: 'Health, block, energy, card zones, status stacks, and enemy intent remain visible and update atomically.', appliesWhen: 'Any card, status, or intent changes combat state.', severity: 'required' as const },
    { id: 'turn-sequence', domain: 'sequence' as const, kind: 'constraint' as const, title: 'Turns follow one sequence', statement: 'Start the hero turn by refreshing energy and drawing, allow card play, then resolve end-turn statuses and telegraphed enemy intents.', appliesWhen: 'Advancing combat from one turn to the next.', severity: 'required' as const },
    { id: 'energy-pays-costs', domain: 'resource_cost' as const, kind: 'constraint' as const, title: 'Energy pays printed costs', statement: 'A card can be played only when the hero can pay its printed energy cost; payment occurs before its effects resolve.', appliesWhen: 'Attempting to play a card.', severity: 'required' as const },
    { id: 'preview-consequences', domain: 'resolution_feedback' as const, kind: 'principle' as const, title: 'Preview consequences', statement: 'Show targets, damage, block, statuses, and triggered keyword changes before confirmation and report the resolved delta afterward.', appliesWhen: 'Hovering, targeting, or resolving a card or enemy intent.', severity: 'required' as const },
    { id: 'empty-draw-fallback', domain: 'fallback' as const, kind: 'constraint' as const, title: 'Empty draw fallback', statement: 'When a draw is required and the draw pile is empty, shuffle the discard pile once; if both are empty, that draw produces no card.', appliesWhen: 'Resolving any draw effect.', severity: 'required' as const },
    { id: 'bounded-randomness', domain: 'randomness' as const, kind: 'principle' as const, title: 'Bounded randomness', statement: 'Random rewards draw from visible rarity pools and never invalidate a required progression path.', appliesWhen: 'Rolling card rewards or encounter rewards.', severity: 'recommended' as const },
  ],
  tableGuidance: [
    { table: 'Cards', purpose: 'Define playable actions and their keyword interactions.', fields: ['Name', 'Type', 'Cost', 'Rarity', 'Rules Text', 'Damage', 'Block', 'Keywords'] },
    { table: 'Keywords', purpose: 'Define reusable combat vocabulary and stacking behavior.', fields: ['Name', 'Category', 'Description', 'Stacking Rule'] },
    { table: 'Heroes', purpose: 'Define hero identity, durability, passive, and starting deck.', fields: ['Name', 'Archetype', 'Starting HP', 'Passive', 'Starting Deck'] },
    { table: 'Enemies', purpose: 'Define enemy role, durability, intent cadence, and traits.', fields: ['Name', 'Role', 'Max HP', 'Intent Pattern', 'Traits'] },
    { table: 'Encounters', purpose: 'Compose enemies and reward pools into an ordered run.', fields: ['Name', 'Act', 'Difficulty', 'Enemies', 'Reward Pool'] },
    { table: 'Rewards', purpose: 'Define post-encounter choices and candidate cards.', fields: ['Name', 'Reward Type', 'Rarity', 'Value', 'Candidate Cards'] },
  ],
};

const document = {
  gameBackground: 'Ashfall Tactics follows two survivors crossing a kingdom whose sacred furnaces now produce living ash. Each encounter trades immediate safety against a leaner, more coherent deck.',
  designIntent: 'Create compact tactical turns where enemy intent is legible and card sequencing matters more than raw collection size.',
  playerFantasy: 'Outthink a doomed procession by turning ash, wards, marks, and echoes into deliberate combinations.',
  coreLoop: 'Choose a route, inspect the encounter, draw and sequence cards, survive telegraphed intents, select one constrained reward, and refine the deck before the next fight.',
  decisionStructure: 'Every turn asks whether to spend energy on immediate damage, persistent defense, or setup that becomes valuable only through a later card.',
  systemBoundaries: 'All combat state is visible. Enemy actions are telegraphed. No effect may silently alter energy, card zones, health, block, status stacks, or reward odds.',
  progressionEconomy: 'Runs grow through small card drafts, upgrades, and rare relic caches while deck removal prevents automatic bloat.',
  contentModel: 'Cards reference Keywords; Heroes reference starting Cards; Enemies reference traits; Encounters reference Enemies and Rewards; Rewards reference candidate Cards.',
  difficultyBalance: 'Difficulty rises through intent combinations, timing pressure, and status interaction rather than hidden bonuses or opaque stat inflation.',
  experiencePresentation: 'Card costs, targets, damage, block, status stacks, enemy intent, and all resulting deltas remain readable at card-thumbnail and combat-board sizes.',
};

const gddMarkdown = `# Ashfall Tactics Starter GDD

## Game Overview
Ashfall Tactics is a single-player tactical deckbuilder about crossing a furnace kingdom consumed by living ash. The starter demonstrates one short run arc with two heroes, four enemies, three encounters, and a compact reward economy.

## Player Fantasy
The player is a precise survivor who reads enemy intent and converts danger into a controlled card sequence. Victory should feel earned through planning rather than hidden numbers.

## Core Loop
Inspect the next encounter, enter combat, draw and sequence cards, resolve the enemy's telegraphed intent, claim one constrained reward, then refine the deck before advancing.

## Combat Rules
The hero refreshes to three energy and draws five cards at turn start. Cards pay energy before resolving. Block absorbs damage and normally expires at the next hero turn. When the draw pile is empty, shuffle the discard pile once. Exhausted cards stay out for the encounter.

## Deckbuilding
Starting decks establish a clear defensive or setup identity. Rewards present a small visible pool. Card removal and upgrades are as valuable as adding cards, so a coherent deck remains preferable to a large one.

## Heroes
Cinder Warden uses Guard and Burn to survive long enough for damage-over-time pressure. Veil Seer uses Mark and Echo to prepare decisive card sequences.

## Enemies and Encounters
Ashling teaches direct intent reading. Iron Husk tests setup against defense. Veil Cultist pressures status management. Cinder Tyrant combines the learned patterns in a boss cadence.

## Progression and Rewards
Normal encounters offer common drafts. Focused upgrades improve an owned card. Elite rewards introduce rarer build-defining cards or relic-like effects. Reward odds remain explicit.

## UI and Readability
Always show energy, card cost, targets, predicted damage and block, status stacks, card zones, and enemy intent. Use icons with tooltips; color alone never carries rule meaning.

## Art Direction
Use original hand-painted dark fantasy with charcoal silhouettes, bone neutrals, ember-orange focal light, and restrained muted teal for occult effects. Preserve clear silhouettes and avoid ornamental text inside art.

## Content Production Checklist
- Every card has one primary purpose and bounded rules text.
- Every keyword defines stacking or consumption behavior.
- Every enemy intent is previewable before resolution.
- Every encounter has a named learning or mastery goal.
- Every reward points to a valid card pool.
- Every art resource has an original subject, readable silhouette, and matching table display name.
`;

const artStyle = parseRetainedGameArtStyleSnapshot({
  ...HAND_PAINTED_2D_V1_PRESET,
  customization: {
    direction: 'Dark fantasy card illustrations with charcoal silhouettes, ember orange focal light, and readable iconography at small sizes.',
    referenceGames: [],
    avoid: 'No copied characters, logos, interface layouts, muddy silhouettes, photorealism, or illegible ornamental text.',
  },
});

export const tacticalDeckbuilderTemplate = parseProjectTemplateManifest({
  key: 'tactical-deckbuilder',
  version: 1,
  theme: 'Ashfall Tactics',
  folders: [
    { key: 'game-design', name: 'Game Design', description: 'Rules, design intent, and the editable game design document.' },
    { key: 'cards-combat', name: 'Cards & Combat', description: 'Cards, combat keywords, and encounter composition.' },
    { key: 'content', name: 'Content', description: 'Heroes, enemies, and progression rewards.' },
  ],
  tables: [
    {
      key: 'cards', folderKey: 'cards-combat', name: 'Cards', description: 'Playable actions and build-defining powers.',
      fields: [
        { key: 'type', label: 'Type', dataType: 'enum', required: true, enumOptions: ['Attack', 'Skill', 'Power'] },
        { key: 'cost', label: 'Cost', dataType: 'int', required: true },
        { key: 'rarity', label: 'Rarity', dataType: 'enum', required: true, enumOptions: ['Starter', 'Common', 'Uncommon', 'Rare'] },
        { key: 'rulesText', label: 'Rules Text', dataType: 'string', required: true },
        { key: 'damage', label: 'Damage', dataType: 'int' },
        { key: 'block', label: 'Block', dataType: 'int' },
        { key: 'keywords', label: 'Keywords', dataType: 'reference', referenceTableKeys: ['keywords'] },
      ],
      rows: [
        { key: 'card.ember-lance', name: 'Ember Lance', values: { type: 'Attack', cost: 1, rarity: 'Starter', rulesText: 'Deal 7 damage. Apply 2 Burn.', damage: 7, block: 0, keywords: { rowRefs: ['keyword.burn'] } } },
        { key: 'card.ash-guard', name: 'Ash Guard', values: { type: 'Skill', cost: 1, rarity: 'Starter', rulesText: 'Gain 8 Block.', damage: 0, block: 8, keywords: { rowRefs: ['keyword.guard'] } } },
        { key: 'card.kindle', name: 'Kindle', values: { type: 'Attack', cost: 0, rarity: 'Starter', rulesText: 'Deal 3 damage. If the target has Burn, draw 1.', damage: 3, block: 0, keywords: { rowRefs: ['keyword.burn'] } } },
        { key: 'card.scorching-brand', name: 'Scorching Brand', values: { type: 'Skill', cost: 1, rarity: 'Common', rulesText: 'Apply 4 Burn and 1 Mark.', damage: 0, block: 0, keywords: { rowRefs: ['keyword.burn', 'keyword.mark'] } } },
        { key: 'card.bastion-oath', name: 'Bastion Oath', values: { type: 'Power', cost: 2, rarity: 'Uncommon', rulesText: 'The first time you gain Block each turn, gain 3 more.', damage: 0, block: 3, keywords: { rowRefs: ['keyword.guard'] } } },
        { key: 'card.reprisal', name: 'Reprisal', values: { type: 'Attack', cost: 1, rarity: 'Uncommon', rulesText: 'Deal 5 damage plus your current Guard stacks.', damage: 5, block: 0, keywords: { rowRefs: ['keyword.guard'] } } },
        { key: 'card.veil-step', name: 'Veil Step', values: { type: 'Skill', cost: 0, rarity: 'Starter', rulesText: 'Gain 4 Block. Apply 1 Mark.', damage: 0, block: 4, keywords: { rowRefs: ['keyword.guard', 'keyword.mark'] } } },
        { key: 'card.echoing-hex', name: 'Echoing Hex', values: { type: 'Skill', cost: 1, rarity: 'Rare', rulesText: 'The next Skill you play this turn resolves twice. Exhaust.', damage: 0, block: 0, keywords: { rowRefs: ['keyword.echo', 'keyword.exhaust'] } } },
        { key: 'card.cull-the-mark', name: 'Cull the Mark', values: { type: 'Attack', cost: 2, rarity: 'Uncommon', rulesText: 'Deal 10 damage. Consume Mark to deal 8 more.', damage: 10, block: 0, keywords: { rowRefs: ['keyword.mark'] } } },
        { key: 'card.cinder-storm', name: 'Cinder Storm', values: { type: 'Attack', cost: 3, rarity: 'Rare', rulesText: 'Deal 4 damage to all enemies twice. Apply 1 Burn.', damage: 8, block: 0, keywords: { rowRefs: ['keyword.burn'] } } },
        { key: 'card.purging-flame', name: 'Purging Flame', values: { type: 'Skill', cost: 1, rarity: 'Common', rulesText: 'Remove one negative status. Draw 2. Exhaust.', damage: 0, block: 0, keywords: { rowRefs: ['keyword.exhaust'] } } },
        { key: 'card.last-ember', name: 'Last Ember', values: { type: 'Power', cost: 2, rarity: 'Rare', rulesText: 'Once per combat, lethal damage leaves you at 1 health and applies 5 Burn to all enemies.', damage: 0, block: 0, keywords: { rowRefs: ['keyword.burn', 'keyword.exhaust'] } } },
      ],
    },
    {
      key: 'keywords', folderKey: 'cards-combat', name: 'Keywords', description: 'Reusable combat vocabulary and stacking rules.',
      fields: [
        { key: 'category', label: 'Category', dataType: 'enum', required: true, enumOptions: ['Damage', 'Defense', 'Setup', 'Zone', 'Repeat'] },
        { key: 'description', label: 'Description', dataType: 'string', required: true },
        { key: 'stackingRule', label: 'Stacking Rule', dataType: 'enum', required: true, enumOptions: ['Additive', 'Refresh', 'Consume', 'Unique'] },
      ],
      rows: [
        { key: 'keyword.burn', name: 'Burn', values: { category: 'Damage', description: 'At end of turn, take damage equal to Burn, then reduce Burn by 1.', stackingRule: 'Additive' } },
        { key: 'keyword.guard', name: 'Guard', values: { category: 'Defense', description: 'Persistent defensive stacks used by cards; Guard is not the same as temporary Block.', stackingRule: 'Additive' } },
        { key: 'keyword.mark', name: 'Mark', values: { category: 'Setup', description: 'The next effect that consumes Mark gains its printed bonus.', stackingRule: 'Consume' } },
        { key: 'keyword.exhaust', name: 'Exhaust', values: { category: 'Zone', description: 'Move this card out of the deck for the remainder of combat after it resolves.', stackingRule: 'Unique' } },
        { key: 'keyword.echo', name: 'Echo', values: { category: 'Repeat', description: 'Repeat the next eligible Skill, including targets and state checks.', stackingRule: 'Consume' } },
      ],
    },
    {
      key: 'heroes', folderKey: 'content', name: 'Heroes', description: 'Playable hero identities and starting decks.',
      fields: [
        { key: 'archetype', label: 'Archetype', dataType: 'enum', required: true, enumOptions: ['Guardian', 'Occultist'] },
        { key: 'startingHp', label: 'Starting HP', dataType: 'int', required: true },
        { key: 'passive', label: 'Passive', dataType: 'string', required: true },
        { key: 'startingDeck', label: 'Starting Deck', dataType: 'reference', required: true, referenceTableKeys: ['cards'] },
        { key: 'artResourceName', label: 'Art Resource Name', dataType: 'string', required: true },
      ],
      rows: [
        { key: 'hero.cinder-warden', name: 'Cinder Warden', values: { archetype: 'Guardian', startingHp: 78, passive: 'The first Burn applied each turn also grants 2 Block.', startingDeck: { rowRefs: ['card.ember-lance', 'card.ash-guard', 'card.kindle'] }, artResourceName: 'Cinder Warden Portrait' } },
        { key: 'hero.veil-seer', name: 'Veil Seer', values: { archetype: 'Occultist', startingHp: 62, passive: 'The first Mark consumed each turn draws 1 card.', startingDeck: { rowRefs: ['card.veil-step', 'card.scorching-brand', 'card.cull-the-mark'] }, artResourceName: 'Veil Seer Portrait' } },
      ],
    },
    {
      key: 'enemies', folderKey: 'content', name: 'Enemies', description: 'Enemy roles, intent cadence, and keyword traits.',
      fields: [
        { key: 'role', label: 'Role', dataType: 'enum', required: true, enumOptions: ['Skirmisher', 'Defender', 'Caster', 'Boss'] },
        { key: 'maxHp', label: 'Max HP', dataType: 'int', required: true },
        { key: 'intentPattern', label: 'Intent Pattern', dataType: 'string_array', required: true },
        { key: 'traits', label: 'Traits', dataType: 'reference', referenceTableKeys: ['keywords'] },
        { key: 'artResourceName', label: 'Art Resource Name', dataType: 'string', required: true },
      ],
      rows: [
        { key: 'enemy.ashling', name: 'Ashling', values: { role: 'Skirmisher', maxHp: 24, intentPattern: ['Strike 6', 'Kindle: gain 2 Burn', 'Strike 8'], traits: { rowRefs: ['keyword.burn'] }, artResourceName: 'Ashling Portrait' } },
        { key: 'enemy.iron-husk', name: 'Iron Husk', values: { role: 'Defender', maxHp: 48, intentPattern: ['Guard 10', 'Crush 12', 'Guard 6 + Crush 6'], traits: { rowRefs: ['keyword.guard'] }, artResourceName: 'Iron Husk Portrait' } },
        { key: 'enemy.veil-cultist', name: 'Veil Cultist', values: { role: 'Caster', maxHp: 34, intentPattern: ['Apply 2 Mark', 'Hex 9', 'Echo Hex 6 twice'], traits: { rowRefs: ['keyword.mark', 'keyword.echo'] }, artResourceName: 'Veil Cultist Portrait' } },
        { key: 'enemy.cinder-tyrant', name: 'Cinder Tyrant', values: { role: 'Boss', maxHp: 120, intentPattern: ['Crownfire 10 + 2 Burn', 'Iron Decree: Guard 14', 'Tyrant Sweep 8 all', 'Last Pyre 18'], traits: { rowRefs: ['keyword.burn', 'keyword.guard'] }, artResourceName: 'Cinder Tyrant Portrait' } },
      ],
    },
    {
      key: 'encounters', folderKey: 'cards-combat', name: 'Encounters', description: 'Ordered encounter compositions and reward pools.',
      fields: [
        { key: 'act', label: 'Act', dataType: 'int', required: true },
        { key: 'difficulty', label: 'Difficulty', dataType: 'enum', required: true, enumOptions: ['Normal', 'Elite', 'Boss'] },
        { key: 'enemies', label: 'Enemies', dataType: 'reference', required: true, referenceTableKeys: ['enemies'] },
        { key: 'rewardPool', label: 'Reward Pool', dataType: 'reference', required: true, referenceTableKeys: ['rewards'] },
      ],
      rows: [
        { key: 'encounter.charred-crossing', name: 'Charred Crossing', values: { act: 1, difficulty: 'Normal', enemies: { rowRefs: ['enemy.ashling', 'enemy.ashling'] }, rewardPool: { rowRefs: ['reward.common-draft'] } } },
        { key: 'encounter.iron-chapel', name: 'Iron Chapel', values: { act: 1, difficulty: 'Elite', enemies: { rowRefs: ['enemy.iron-husk', 'enemy.veil-cultist'] }, rewardPool: { rowRefs: ['reward.focused-upgrade', 'reward.elite-bounty'] } } },
        { key: 'encounter.tyrants-pyre', name: "Tyrant's Pyre", values: { act: 1, difficulty: 'Boss', enemies: { rowRefs: ['enemy.cinder-tyrant'] }, rewardPool: { rowRefs: ['reward.relic-cache'] } } },
      ],
    },
    {
      key: 'rewards', folderKey: 'content', name: 'Rewards', description: 'Post-encounter choices and candidate card pools.',
      fields: [
        { key: 'rewardType', label: 'Reward Type', dataType: 'enum', required: true, enumOptions: ['Card Draft', 'Upgrade', 'Relic'] },
        { key: 'rarity', label: 'Rarity', dataType: 'enum', required: true, enumOptions: ['Common', 'Uncommon', 'Rare'] },
        { key: 'value', label: 'Value', dataType: 'string', required: true },
        { key: 'candidateCards', label: 'Candidate Cards', dataType: 'reference', referenceTableKeys: ['cards'] },
      ],
      rows: [
        { key: 'reward.common-draft', name: 'Common Draft', values: { rewardType: 'Card Draft', rarity: 'Common', value: 'Choose 1 of 3 common cards.', candidateCards: { rowRefs: ['card.scorching-brand', 'card.veil-step', 'card.purging-flame'] } } },
        { key: 'reward.focused-upgrade', name: 'Focused Upgrade', values: { rewardType: 'Upgrade', rarity: 'Uncommon', value: 'Upgrade one card already in the deck.', candidateCards: { rowRefs: ['card.ember-lance', 'card.ash-guard', 'card.kindle'] } } },
        { key: 'reward.relic-cache', name: 'Relic Cache', values: { rewardType: 'Relic', rarity: 'Rare', value: 'Choose one run-defining passive reward.', candidateCards: { rowRefs: ['card.last-ember', 'card.echoing-hex'] } } },
        { key: 'reward.elite-bounty', name: 'Elite Bounty', values: { rewardType: 'Card Draft', rarity: 'Uncommon', value: 'Choose 1 uncommon card and gain one removal token.', candidateCards: { rowRefs: ['card.bastion-oath', 'card.reprisal', 'card.cull-the-mark'] } } },
      ],
    },
  ],
  gdd: { description: 'Editable starter Game Design Document for the Ashfall Tactics example.', markdown: gddMarkdown },
  gds: { summary: 'Readable, systems-driven rules for a compact tactical deckbuilder.', rules, document, artStyle },
  // Bundled art is intentionally deferred; descriptors can be added without changing the instantiator.
  assets: [],
});
