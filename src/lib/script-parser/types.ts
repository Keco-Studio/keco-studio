/**
 * Script Parser Types
 *
 * Converts natural-language story text into structured script rows.
 */

// Excel template fields
export interface ScriptLine {
  // Core fields
  label: string;           // A: node id or jump label
  type: number;            // B: 1=dialogue, 2=narration/scene/stage/system
  name: string;            // C: speaker
  content: string;         // D: dialogue content
  if: string;              // E: trigger condition
  commands: string;        // F: story commands

  // Asset fields
  fg: string;              // G: left portrait
  fg1: string;             // H: right portrait
  cg: string;              // I: CG asset

  // Option fields
  option0: string;         // J: option 0
  option0_next: string;    // K: option 0 jump target
  option1: string;         // L: option 1
  option1_next: string;    // M: option 1 jump target
  option2: string;         // N: option 2
  option2_next: string;    // O: option 2 jump target

  // Other assets
  voice: string;           // P: voice path
  bg: string;              // Q: background image
}

export const SCRIPT_COLUMNS = [
  'Label', 'Type', 'Name', 'Content', 'If', 'Commands',
  'Fg', 'Fg1', 'Cg',
  'Option0', 'Option0_Next', 'Option1', 'Option1_Next', 'Option2', 'Option2_Next',
  'Voice', 'Bg',
] as const;

/** Default node label when the first line has no explicit label */
export const DEFAULT_START_LABEL = 'Start';

/** Prefix for option and jump commands in the Commands column */
export const JUMP_PREFIX = 'Jump';

export interface Script {
  lines: ScriptLine[];
  warnings?: string[];
}

// Intermediate parser node types
export type Node =
  | { _type: 'empty' }
  | { _type: 'separator' }
  | { _type: 'label'; label: string }
  | { _type: 'chapter'; label: string }
  | { _type: 'dialogue'; name: string; type: number; content: string }
  | { _type: 'narration'; content: string; condition?: string; type?: number }
  | { _type: 'system'; type: number; content: string }
  | { _type: 'variable'; command: string }
  | { _type: 'condition'; condition: string }
  | {
      _type: 'option';
      option_index: number;
      option_text: string;
      condition?: string;
      variable?: string;
    }
  // Structured format nodes
  | { _type: 'struct_label'; label: string; content: string }
  | { _type: 'struct_option'; option_index: number; option_text: string; var_change: string; jump_target: string }
  | { _type: 'struct_branch'; label: string; content: string }
  | { _type: 'struct_jump'; target: string }
  // Natural format scene labels
  | { _type: 'scene_label'; label: string; content: string }
  | { _type: 'scene_id'; id: string };

// Node with attached option metadata
export interface NodeWithOptions {
  _type: string;
  type?: number;
  name?: string;
  content?: string;
  label?: string;
  command?: string;
  condition?: string;
  option_index?: number;
  option_text?: string;
  variable?: string;
  _options?: Array<{ option_index: number; option_text: string; condition?: string; variable?: string }>;
  _option_labels?: string[];
}

// Speaker role mapping
export interface RoleInfo {
  id: string;
  type: number;
}

export type RoleMap = Record<string, RoleInfo>;

// Create an empty ScriptLine.
export function createEmptyScriptLine(): ScriptLine {
  return {
    label: '',
    type: 0,
    name: '',
    content: '',
    if: '',
    commands: '',
    fg: '',
    fg1: '',
    cg: '',
    option0: '',
    option0_next: '',
    option1: '',
    option1_next: '',
    option2: '',
    option2_next: '',
    voice: '',
    bg: '',
  };
}

// Convert a ScriptLine to a row array.
export function scriptLineToRow(line: ScriptLine): string[] {
  return [
    line.label,
    line.type === 0 ? '' : String(line.type),
    line.name,
    line.content,
    line.if,
    line.commands,
    line.fg,
    line.fg1,
    line.cg,
    line.option0,
    line.option0_next,
    line.option1,
    line.option1_next,
    line.option2,
    line.option2_next,
    line.voice,
    line.bg,
  ];
}
