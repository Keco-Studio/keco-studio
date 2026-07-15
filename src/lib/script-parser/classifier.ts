/**
 * Script Parser - Line Classifier
 *
 * Classifies one source line into a structured parser node.
 */

import type { Node, RoleMap } from './types';
import { findDialogueColon } from './colon';

// Basic regexes
const SEPARATOR_RE = /^[-*+]{3,}$/;
const LABEL_RE = /^\[Label:\s*(.+?)\]$/;
const SYSTEM_RE = /^【(.+?)】(.*)$/; // Supports bracketed text followed by trailing content.

// Structured-format regexes
const STRUCT_TYPED_RE = /^（Type(\d+)・(.+?)）(.*)$/;
const STRUCT_LABEL_RE = /^【(.+?)】$/;
const STRUCT_INNER_LABEL_RE = /【(.+?)】/;
const STRUCT_OPTION_RE = /^O(\d+)[：:]\s*(.+?)（([^）]+)）$/;
const STRUCT_JUMP_RE = /^（Jump\s*(.+?)\s*）/i;
const STRUCT_BRANCH_RE = /^(O\d+|Oend)\s+(branch|merge)【.+?】$/i;

// Variable-format regexes
const VAR_ASSIGN_RE = /^\$([a-zA-Z_]\w*)\s*([+\-\*/]?=)\s*(.+)$/;

// Simple options
const SIMPLE_OPTION_RE = /^-\s*(.+)$/;
const NESTED_OPTION_RE = /^-\s*-\s*(.+)$/;

// Chapter headings
const CHAPTER_RE = /^\d+\.\s*(\S+.*)$/;

// Stage directions
const STAGE_DIR_RE = /^（([^）]+)）$/;

// Scene labels: "Location Name [XXX]" or "[XXX] Location Name" or just "[XXX]"
const SCENE_LABEL_RE = /^(.+?)\s*\[(\w+)\]\s*$/;
const SCENE_LABEL_START_RE = /^\[(\w+)\]\s*(.+?)\s*$/; // [XXX] Location Name
const SCENE_ID_RE = /^\[(\w+)\]\s*$/;

const QUOTES = '"\'“”‘’';

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
 * Classify the content inside parentheses.
 */
function classifyBracketContent(inner: string): Node {
  // Variable annotation
  if (inner.includes('$') || inner.includes('+=') || inner.includes('-=')) {
    return { _type: 'variable', command: inner };
  }

  // Short text that looks like an instruction.
  if (inner.length < 20 && !inner.includes(',')) {
    return { _type: 'system', type: 2, content: inner };
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
    const optionNum = structOptMatch[1];
    const optionIndex = parseInt(optionNum, 10) - 1;
    const optionText = structOptMatch[2];
    let optCond = structOptMatch[3];

    // Clean up escape characters: \( → (, \) → )
    optCond = optCond.replace(/\\\(/g, '(').replace(/\\\)/g, ')');

    // Parse condition and jump metadata.
    let jumpTarget = '';
    let varChange = '';
    const optParts = optCond.split(',');
    for (const part of optParts) {
      const trimmed = part.trim();
      if (/jump/i.test(trimmed)) {
        jumpTarget = trimmed.replace(/jump|branch/gi, '').trim();
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

  // Simple option
  const simpleOptMatch = SIMPLE_OPTION_RE.exec(stripped);
  if (simpleOptMatch) {
    return {
      _type: 'option',
      option_index: -1,
      option_text: simpleOptMatch[1].trim(),
    };
  }

  // Nested option, flattened.
  const nestedOptMatch = NESTED_OPTION_RE.exec(stripped);
  if (nestedOptMatch) {
    return {
      _type: 'option',
      option_index: -1,
      option_text: nestedOptMatch[1].trim(),
    };
  }

  // 4. System prompt with optional trailing content.
  const sysMatch = SYSTEM_RE.exec(stripped);
  if (sysMatch) {
    const title = sysMatch[1];
    const rest = sysMatch[2] ? sysMatch[2].trim() : '';
    const content = rest ? `${title}】${rest}` : title;
    return { _type: 'system', type: 2, content };
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
    const rawType = parseInt(typedMatch[1], 10);
    const name = typedMatch[2];
    const content = typedMatch[3];
    // Output Type: 1=character dialogue, 2=scene/narration
    // Structured Type1/Type2 are both characters; Type3+ are scene/narration
    if (rawType === 1 || rawType === 2) {
      return { _type: 'dialogue', name, type: 1, content };
    }
    return { _type: 'dialogue', name: '', type: 2, content };
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

  // 9. Plain dialogue
  const colonPos = findDialogueColon(stripped);
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

  // 9.3 Quoted environment description: "..." or a merged multi-line quoted block
  if (/^["'""]/.test(stripped)) {
    return { _type: 'narration', content: stripQuotes(stripped), type: 2 };
  }

  // 9.4 Environment description: [English bracket narration with spaces/punctuation]
  const envDescMatch = /^\[(.+)\]$/.exec(stripped);
  if (envDescMatch && !/^\w+$/.test(envDescMatch[1])) {
    return { _type: 'narration', content: envDescMatch[1].trim(), type: 2 };
  }

  // 9.5 Scene label: "Location Name [XXX]" → label=id, content=scene name
  const sceneLabelMatch = SCENE_LABEL_RE.exec(stripped);
  if (sceneLabelMatch) {
    return { _type: 'scene_label', label: sceneLabelMatch[2], content: sceneLabelMatch[1].trim() };
  }

  // 9.5.1 Scene label with leading id: "[XXX] Location Name" → label=id, content=scene description
  const sceneLabelStartMatch = SCENE_LABEL_START_RE.exec(stripped);
  if (sceneLabelStartMatch) {
    return { _type: 'scene_label', label: sceneLabelStartMatch[1], content: sceneLabelStartMatch[2].trim() };
  }

  // 9.6 Scene id: "[XXX]" — merged with the previous line at the parser layer
  const sceneIdMatch = SCENE_ID_RE.exec(stripped);
  if (sceneIdMatch) {
    return { _type: 'scene_id', id: sceneIdMatch[1] };
  }

  // 10. Fallback to narration
  return { _type: 'narration', content: stripped, type: 2 };
}
