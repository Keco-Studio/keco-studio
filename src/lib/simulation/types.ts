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
  cls: string;
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
export type FieldMapping = Partial<Record<string, string>>;
export type FieldMappings = Record<LibraryRole, FieldMapping>;

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
  catalog: SimulationCatalog;
  levelRules: LevelRule[];
  skillCostRules: SkillCostRule[];
  sourceLibraryIds: Record<LibraryRole, string>;
  fieldMappings: FieldMappings;
  importedAt: string;
}

export interface SimulationImportError {
  role: LibraryRole;
  code:
    | 'missing_mapping'
    | 'missing_value'
    | 'invalid_number'
    | 'duplicate_id'
    | 'invalid_enum'
    | 'unresolved_reference';
  field: string;
  message: string;
  assetId?: string;
  assetName?: string;
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
