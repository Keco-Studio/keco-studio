/**
 * Script Parser - Line Classifier
 *
 * Classifies one source line into a structured parser node.
 */

import type { Node, RoleMap } from './types';

// Basic regexes
const SEPARATOR_RE = /^[-*]{3,}$/;
const LABEL_RE = /^\[(?:Label|标签):\s*(.+?)\]$/;
const OPTION_RE = /^【选项\s*(\d+)\s*[：:]\s*(.+?)】$/;
const SYSTEM_RE = /^【(.+?)】(.*)$/; // Supports bracketed text followed by trailing content.

// Structured-format regexes
const STRUCT_TYPED_RE = /^（(?:Type|类型)(\d+)・(.+?)）(.*)$/;
const STRUCT_LABEL_RE = /^【(.+?)】$/;
const STRUCT_INNER_LABEL_RE = /【(.+?)】/;
const STRUCT_OPTION_RE = /^(?:O(\d+)|选项(\d+))[：:]\s*(.+?)（([^）]+)）$/;
const STRUCT_JUMP_RE = /^（(?:跳转|Jump)\s*(.+?)\s*）/i;
const STRUCT_BRANCH_RE = /^(O\d+|选项\d+|Oend|结尾)\s+(分支|统一收尾|branch|merge)【.+?】$/i;

// Variable-format regexes
const VAR_ASSIGN_RE = /^\$([a-zA-Z_]\w*)\s*([+\-\*/]?=)\s*(.+)$/;

// Simple options
const SIMPLE_OPTION_RE = /^-\s*(.+)$/;
const NESTED_OPTION_RE = /^-\s*-\s*(.+)$/;

// Chapter headings
const CHAPTER_RE = /^\d+[\.\、．]\s*(\S+.*)$/;

// Stage directions
const STAGE_DIR_RE = /^（([^）]+)）$/;
const STAGE_KEYWORDS = [
  '切屏', '黑屏', '淡入', '淡出', '转场', '渐隐', '渐显',
  '清晨', '黄昏', '夜晚', '傍晚', '午后', '深夜',
  '场景', '镜头', '画面', '背景', '特效',
];

// Variable annotations
const VAR_CN_RE = /^（([^）]*[线值分好感][^）]*[+\-\d][^）]*)）$/;

const QUOTES = '"\'“”‘’「」';

/**
 * Find a colon position, supporting full-width and half-width colons.
 */
function findColon(line: string): number {
  const cPos = line.indexOf('：');
  const ePos = line.indexOf(':');
  if (cPos === -1) {
    if (ePos > 0 && /\d/.test(line[ePos - 1]) && /\d/.test(line[ePos + 1] ?? '')) {
      return -1;
    }
    return ePos;
  }
  if (ePos === -1) return cPos;
  if (ePos > 0 && /\d/.test(line[ePos - 1]) && /\d/.test(line[ePos + 1] ?? '')) {
    return cPos;
  }
  return Math.min(cPos, ePos);
}

/**
 * Strip wrapping quote characters.
 */
function stripQuotes(s: string): string {
  s = s.trim();
  while (s.length > 0 && QUOTES.includes(s[0])) {
    s = s.slice(1);
  }
  while (s.length > 0 && QUOTES.includes(s[s.length - 1])) {
    s = s.slice(0, -1);
  }
  return s.trim();
}

/**
 * Extract a leading condition annotation from text.
 */
function extractCondition(text: string): { text: string; condition: string } {
  const m = text.match(/^（([^）]*(?:周目|解锁|结局|条件|路线)[^）]*)）\s*(.*)$/);
  if (m) {
    return { text: m[2].trim(), condition: m[1].trim() };
  }
  return { text: text.trim(), condition: '' };
}

/**
 * Extract a variable or affinity annotation from text.
 */
function extractVariable(text: string): { text: string; variable: string } {
  const m = text.match(/（([^）]*[线值分好感][^）]*[+\-\d][^）]*)）/);
  if (m) {
    const varText = text.replace(m[0], '').trim();
    return { text: varText, variable: m[1].trim() };
  }
  return { text: text.trim(), variable: '' };
}

/**
 * Classify the content inside parentheses.
 */
function classifyBracketContent(inner: string): Node {
  // Variable annotation
  if (inner.includes('$') || inner.includes('+=') || inner.includes('-=')) {
    return { _type: 'variable', command: inner };
  }

  // Affinity annotation
  if (/[线值分好感].*[+\-\d]/.test(inner)) {
    return { _type: 'variable', command: inner };
  }

  // Condition annotation
  if (/[周目解锁结局条件路线]/.test(inner)) {
    return { _type: 'condition', condition: inner };
  }

  // Stage direction
  for (const kw of STAGE_KEYWORDS) {
    if (inner.includes(kw)) {
      return { _type: 'system', type: 5, content: inner };
    }
  }

  // Short text that looks like an instruction.
  if (inner.length < 20 && !inner.includes('，') && !inner.includes(',')) {
    return { _type: 'system', type: 5, content: inner };
  }

  // Fallback to narration.
  return { _type: 'narration', content: `（${inner}）` };
}

/**
 * Classify one source line.
 */
export function classifyLine(line: string, roleMap: RoleMap = {}): Node {
  const stripped = line.trim();
  if (!stripped) {
    return { _type: 'empty' };
  }

  // Prefer structured-format detection.

  // Jump instruction.
  const jumpMatch = STRUCT_JUMP_RE.exec(stripped);
  if (jumpMatch) {
    const target = jumpMatch[1].split(/\s+/)[0].trim();
    return { _type: 'struct_jump', target };
  }

  // Branch declaration.
  const branchMatch = STRUCT_BRANCH_RE.exec(stripped);
  if (branchMatch) {
    const branchLabel = branchMatch[1]; // Branch label token.
    const innerMatch = STRUCT_INNER_LABEL_RE.exec(stripped);
    let content = '';
    if (innerMatch) {
      const branchParts = innerMatch[1].split('｜');
      if (branchParts.length > 1) {
        content = branchParts[1];
      }
    }
    return { _type: 'struct_branch', label: branchLabel, content };
  }

  // Label plus scene description.
  const labelMatch = STRUCT_LABEL_RE.exec(stripped);
  if (labelMatch && labelMatch[1].includes('｜')) {
    const labelParts = labelMatch[1].split('｜');
    const sceneLabel = labelParts[0];
    const content = labelParts.length > 1 ? labelParts[1] : '';
    return { _type: 'struct_label', label: sceneLabel, content };
  }

  // Structured option with condition and jump metadata.
  const structOptMatch = STRUCT_OPTION_RE.exec(stripped);
  if (structOptMatch) {
    const optionNum = structOptMatch[1] || structOptMatch[2];
    const optionIndex = parseInt(optionNum, 10) - 1;
    const optionText = structOptMatch[3];
    let optCond = structOptMatch[4];

    // Clean up escape characters: \( → (, \) → )
    optCond = optCond.replace(/\\\(/g, '(').replace(/\\\)/g, ')');

    // Parse condition and jump metadata.
    let jumpTarget = '';
    let varChange = '';
    const optParts = optCond.replace(/，/g, ',').split(',');
    for (const part of optParts) {
      const trimmed = part.trim();
      if (/跳转|jump/i.test(trimmed)) {
        jumpTarget = trimmed.replace(/跳转|jump|分支|branch/gi, '').trim();
      } else if (trimmed) {
        varChange = trimmed;
        // Clean up stray parentheses in variable
        varChange = varChange.replace(/[(（]/g, '').replace(/[)）]/g, '');
      }
    }

    return {
      _type: 'struct_option',
      option_index: optionIndex,
      option_text: optionText,
      var_change: varChange,
      jump_target: jumpTarget,
    };
  }

  // General-format detection.

  // 1. Separator
  if (SEPARATOR_RE.test(stripped)) {
    return { _type: 'separator' };
  }

  // 2. Label
  const labelMatch2 = LABEL_RE.exec(stripped);
  if (labelMatch2) {
    return { _type: 'label', label: labelMatch2[1] };
  }

  // 3. Option in bracketed form
  const optMatch = OPTION_RE.exec(stripped);
  if (optMatch) {
    const { text, condition } = extractCondition(optMatch[2]);
    const result: Node = {
      _type: 'option',
      option_index: parseInt(optMatch[1], 10),
      option_text: text,
    };
    if (condition) {
      (result as { condition?: string }).condition = condition;
    }
    return result;
  }

  // Simple option
  const simpleOptMatch = SIMPLE_OPTION_RE.exec(stripped);
  if (simpleOptMatch) {
    let text = simpleOptMatch[1];
    let condition = '';
    let variable = '';

    // Extract condition.
    const condResult = extractCondition(text);
    text = condResult.text;
    condition = condResult.condition;

    // Extract variable.
    const varResult = extractVariable(text);
    text = varResult.text;
    variable = varResult.variable;

    const result: Node = {
      _type: 'option',
      option_index: -1,
      option_text: text,
    };
    if (condition) {
      (result as { condition?: string }).condition = condition;
    }
    if (variable) {
      (result as { variable?: string }).variable = variable;
    }
    return result;
  }

  // Nested option, flattened.
  const nestedOptMatch = NESTED_OPTION_RE.exec(stripped);
  if (nestedOptMatch) {
    const { text, condition } = extractCondition(nestedOptMatch[1]);
    const result: Node = {
      _type: 'option',
      option_index: -1,
      option_text: text,
    };
    if (condition) {
      (result as { condition?: string }).condition = condition;
    }
    return result;
  }

  // 4. System prompt with optional trailing content.
  const sysMatch = SYSTEM_RE.exec(stripped);
  if (sysMatch) {
    const title = sysMatch[1];
    const rest = sysMatch[2] ? sysMatch[2].trim() : '';
    const content = rest ? `${title}】${rest}` : title;
    return { _type: 'system', type: 5, content };
  }

  // 4.5 Variable assignment syntax.
  const varAssignMatch = VAR_ASSIGN_RE.exec(stripped);
  if (varAssignMatch) {
    const varName = varAssignMatch[1];
    const operator = varAssignMatch[2];
    const value = varAssignMatch[3].trim();
    return { _type: 'variable', command: `$${varName}${operator}${value}` };
  }

  // 5. Structured dialogue
  const typedMatch = STRUCT_TYPED_RE.exec(stripped);
  if (typedMatch) {
    const type = parseInt(typedMatch[1], 10);
    const name = type === 3 ? '' : typedMatch[2];
    return { _type: 'dialogue', name, type, content: typedMatch[3] };
  }

  // 6. Chapter heading
  const chapterMatch = CHAPTER_RE.exec(stripped);
  if (chapterMatch) {
    return { _type: 'chapter', label: chapterMatch[1] };
  }

  // 7. Parenthesized content
  const stageDirMatch = STAGE_DIR_RE.exec(stripped);
  if (stageDirMatch) {
    return classifyBracketContent(stageDirMatch[1].trim());
  }

  // 8. Standalone variable annotation
  const varCnMatch = VAR_CN_RE.exec(stripped);
  if (varCnMatch) {
    return { _type: 'variable', command: varCnMatch[1] };
  }

  // 8.5 Line that starts with a condition annotation
  const condMatch = stripped.match(/^（([^）]*(?:周目|解锁|结局|条件|路线)[^）]*)）\s*(.*)$/);
  if (condMatch && condMatch[2]) {
    // Condition annotation plus trailing content becomes conditional narration.
    return {
      _type: 'narration',
      content: condMatch[2],
      condition: condMatch[1],
    } as Node;
  }

  // 9. Plain dialogue
  const colonPos = findColon(stripped);
  if (colonPos > 0) {
    const speaker = stripped.slice(0, colonPos).trim();
    const content = stripQuotes(stripped.slice(colonPos + 1).trim());
    const roleInfo = roleMap[speaker] || { id: speaker, type: 1 };
    return {
      _type: 'dialogue',
      name: String(roleInfo.id || speaker),
      type: roleInfo.type || 1,
      content,
    };
  }

  // 10. Fallback to narration
  return { _type: 'narration', content: stripped };
}
