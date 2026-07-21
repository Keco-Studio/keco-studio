export type Team = 'A' | 'B';

export type ElementName =
  | 'Fire'
  | 'Ice'
  | 'Lightning'
  | 'Earth'
  | 'Light'
  | 'Shadow'
  | 'Physical';

export type SkillKind = 'dmg' | 'heal' | 'buff';
export type SkillStatus = 'burn' | 'dot' | 'freeze' | 'stun' | '' | null;

export interface CharacterTemplate {
  id: string;
  name: string;
  cls?: string;
  el: ElementName;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  mp: number;
}

export interface CharacterSnapshot extends Omit<CharacterTemplate, 'id'> {
  lv: number;
}

export interface SkillDefinition {
  id: string;
  name: string;
  el: ElementName;
  mp: number;
  power: number;
  cd: number;
  kind: SkillKind;
  status?: SkillStatus;
  fx?: string;
}

export interface RosterEntry {
  uid: string;
  tmplId: string;
  team: Team;
  snapshot?: CharacterSnapshot | null;
}

export type Loadout = Record<string, string[]>;
export type SkillLevels = Record<string, Record<string, number>>;

export interface ProgressionState {
  exp: Record<string, number>;
  lv: Record<string, number>;
  sp: Record<string, number>;
}

export type LibraryRole = 'characters' | 'skills' | 'level' | 'skillc';
export type FieldMapping = Readonly<Partial<Record<string, string>>>;
export type FieldMappings = Readonly<Record<LibraryRole, FieldMapping>>;

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export interface SimulationCatalog {
  characters: readonly CharacterTemplate[];
  skills: readonly SkillDefinition[];
  basic: SkillDefinition;
}

export interface LevelRule {
  level: number;
  exp: number;
  sp: number;
}

export interface SkillCostRule {
  lv: number;
  cost: number;
}

export interface SimulationFieldDefinition {
  id: string;
  label: string;
  required?: boolean;
  allowedValues?: readonly string[];
}

export interface StudioColumnDefinition {
  id: string;
  label: string;
}

export interface ImportedSimulationSnapshot {
  readonly sourceProjectId: string;
  readonly catalog: DeepReadonly<SimulationCatalog>;
  readonly levelRules: readonly DeepReadonly<LevelRule>[];
  readonly skillCostRules: readonly DeepReadonly<SkillCostRule>[];
  readonly sourceLibraryIds: Readonly<Record<LibraryRole, string>>;
  readonly fieldMappings: DeepReadonly<FieldMappings>;
  readonly importedAt: string;
}

export interface SimulationImportError {
  readonly role: LibraryRole;
  readonly code:
    | 'missing_mapping'
    | 'missing_value'
    | 'invalid_type'
    | 'invalid_number'
    | 'invalid_range'
    | 'duplicate_id'
    | 'duplicate_mapping'
    | 'reserved_id'
    | 'empty_source'
    | 'invalid_sequence'
    | 'invalid_enum'
    | 'unresolved_field'
    | 'unresolved_reference';
  readonly libraryId: string;
  readonly libraryName: string;
  readonly assetId: string | null;
  readonly assetName: string | null;
  readonly field: string;
  readonly reason: string;
  readonly message: string;
}

export type SimulationImportResult =
  | { ok: true; snapshot: ImportedSimulationSnapshot }
  | { ok: false; errors: SimulationImportError[] };

export interface FighterSnapshot {
  uid: string;
  hp: number;
  mp: number;
  alive: boolean;
}

export type BattleEventType = 'dot' | 'ko' | 'status' | 'heal' | 'buff' | 'dmg';

export interface BattleEvent {
  actor: string;
  target: string;
  type: BattleEventType;
  text: string;
  tag: string;
  amount?: number;
  snap: FighterSnapshot[];
}

export interface BattleFighter {
  uid: string;
  name: string;
  team: Team;
  el: ElementName;
  cls: string;
  initial: string;
  maxHp: number;
  hp: number;
  maxMp: number;
  mp: number;
  atk: number;
  def: number;
  spd: number;
  skills: Array<SkillDefinition & { lv: number }>;
  cd: Record<string, number>;
  alive: boolean;
  burn: number;
  dot: number;
  freeze: number;
  defBuff: number;
}

export interface BattleResult {
  winner: Team;
  events: BattleEvent[];
  fs: BattleFighter[];
}
