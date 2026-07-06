/**
 * Script Parser Types
 *
 * 通用剧本解析器 - 将自然语言剧本转换为结构化脚本
 */

// Excel 29 列模板字段
export interface ScriptLine {
  // 核心字段
  label: string;           // A: 节点 ID / 跳转标签
  type: number;            // B: 1=对话, 2=旁白/场景/舞台/系统
  name: string;            // C: 说话人
  content: string;         // D: 对话内容
  if: string;              // E: 触发条件
  commands: string;        // F: 剧情指令

  // 资源字段
  fg: string;              // G: 左侧立绘
  fg1: string;             // H: 右侧立绘
  cg: string;              // I: CG 资源

  // 选项字段
  option0: string;         // J: 选项0
  option0_next: string;    // K: 选项0 跳转
  option1: string;         // L: 选项1
  option1_next: string;    // M: 选项1 跳转
  option2: string;         // N: 选项2
  option2_next: string;    // O: 选项2 跳转

  // 其他资源
  voice: string;           // P: 配音路径
  bg: string;              // Q: 背景图
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
}

// 解析中间节点类型
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

// 带选项附加信息的节点
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

// 角色映射
export interface RoleInfo {
  id: string;
  type: number;
}

export type RoleMap = Record<string, RoleInfo>;

// 创建空的 ScriptLine
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

// 将 ScriptLine 转换为行数组
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
