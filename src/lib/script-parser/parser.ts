/**
 * Script Parser - Main Parser
 *
 * General story-script parser that detects several narrative text formats.
 *
 * Supported formats:
 * - Dialogue with speaker-name prefixes, quoted content, or typed markers.
 * - Narration as plain text.
 * - Options as dashed lines or bracketed option syntax.
 * - Stage directions as parenthesized scene or transition notes.
 * - Variables and affinity changes as assignments or parenthesized notes.
 * - Condition notes as parenthesized route or unlock requirements.
 * - Chapter headings as numbered headings.
 * - System prompts as bracketed fullscreen text.
 */

import type { Node, RoleMap, Script } from './types';
import { classifyLine } from './classifier';
import { postProcess } from './postProcess';

const QUOTES = '"\'“”‘’「」';

// Regex for splitting multiple typed dialogues on one line
const STRUCT_TYPED_SPLIT_RE = /（(?:Type|类型)(\d+)・(.+?)）/g;

/**
 * Split multiple typed-dialogue markers from one line.
 * Example: two typed dialogue markers become two dialogue segments.
 */
function splitTypedDialogues(line: string): string[] {
  // Check if line contains multiple typed dialogue patterns
  const matches = Array.from(line.matchAll(STRUCT_TYPED_SPLIT_RE));

  if (matches.length <= 1) {
    // Check for mixed patterns (jump + branch)
    return splitMixedPatterns(line);
  }

  // Check if line starts with the pattern
  if (!/^（(?:Type|类型)/.test(line)) {
    // Pattern not at start, check for mixed patterns
    return splitMixedPatterns(line);
  }

  // Split the line at each pattern boundary
  const results: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const startIdx = match.index!;
    const endIdx = i < matches.length - 1 ? matches[i + 1].index! : line.length;
    const segment = line.slice(startIdx, endIdx).trim();
    if (segment) {
      results.push(...splitMixedPatterns(segment));
    }
  }

  return results;
}

/**
 * Split mixed patterns when a jump instruction and branch declaration share one line.
 * Example: a jump followed by a branch declaration becomes two segments.
 */
function splitMixedPatterns(line: string): string[] {
  // Pattern: full-width jump marker followed by a branch declaration.
  const jumpBranchRe = /^（(?:跳转|Jump)\s*(.+?)\s*）((?:O\d+|选项\d+|Oend|结尾)\s+(?:分支|统一收尾|branch|merge)【.+?】)$/i;
  const match = jumpBranchRe.exec(line.trim());

  if (match) {
    const jumpTarget = match[1];
    const branchDecl = match[2];
    return [`（Jump ${jumpTarget}）`, branchDecl];
  }

  // No mixed pattern found, return as is
  return [line];
}

/**
 * Find the first dialogue colon position.
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
 * Detect option, system, label, or separator lines.
 */
function isSpecialLine(line: string): boolean {
  const stripped = line.trim();
  if (!stripped) return false;

  // Separator
  if (/^[-*]{3,}$/.test(stripped)) return true;

  // Label
  if (/^\[(?:Label|标签):\s*(.+?)\]$/.test(stripped)) return true;

  // Option
  if (/^【选项\s*\d+\s*[：:].+?】$/.test(stripped)) return true;

  // Simple option
  if (/^-\s*.+$/.test(stripped)) return true;

  // System prompt
  if (/^【.+?】/.test(stripped)) return true;

  // Structured option marker
  if (/^(?:O\d+|选项\d+)[：:].+/.test(stripped)) return true;

  return false;
}

/**
 * Preprocess by merging quoted text across lines.
 */
function preprocessLines(rawLines: string[]): string[] {
  const result: string[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i].trim();
    if (!line) {
      i++;
      continue;
    }

    const colonPos = findColon(line);
    if (colonPos <= 0) {
      result.push(line);
      i++;
      continue;
    }

    // Leave special lines unchanged.
    if (isSpecialLine(line)) {
      result.push(line);
      i++;
      continue;
    }

    const rest = line.slice(colonPos + 1).trim();

    // Check whether quoted content starts but has not closed.
    if (rest.length > 0 && QUOTES.includes(rest[0])) {
      const quoteChar = rest[0];
      const hasClosing = rest.length > 1 && rest[rest.length - 1] === quoteChar;

      if (!hasClosing) {
        const speaker = line.slice(0, colonPos).trim();
        const collected = [rest];
        i++;

        // Continue collecting lines until the quote closes.
        while (i < rawLines.length) {
          const nl = rawLines[i].trim();
          if (!nl) {
            i++;
            continue;
          }

          // Stop at a special line.
          if (isSpecialLine(nl)) break;

          // Stop at a new dialogue line.
          const nlColonPos = findColon(nl);
          if (nlColonPos > 0 && !QUOTES.includes(nl[0])) break;

          collected.push(nl);
          i++;

          // Stop when the closing quote appears.
          if (nl.includes(quoteChar)) break;
        }

        const merged = collected.join('\n');
        result.push(`${speaker}：${merged}`);
        continue;
      }
    }

    result.push(line);
    i++;
  }

  return result;
}

/**
 * Main parser entry point.
 */
export function parseText(text: string, roleMap: RoleMap = {}): Script {
  const rawLines = text.trim().split('\n');

  // Preprocess quoted multiline dialogue.
  const mergedLines = preprocessLines(rawLines);

  // Preprocess multiline options.
  const optionMergedLines = mergeMultiLineOptions(mergedLines);

  // Split multiple typed-dialogue markers from one line.
  const splitLines: string[] = [];
  for (const line of optionMergedLines) {
    const split = splitTypedDialogues(line);
    splitLines.push(...split);
  }

  // Classify lines.
  const rawNodes: Node[] = [];
  for (const line of splitLines) {
    const node = classifyLine(line, roleMap);
    if (node._type !== 'empty') {
      rawNodes.push(node);
    }
  }

  // Post-process nodes.
  return postProcess(rawNodes);
}

/**
 * Check whether a structured option continues across lines.
 */
function isMultiLineOption(line: string): boolean {
  // Check whether the option marker ends with an unclosed full-width parenthesis.
  if (!/^(?:O\d+|选项\d+)[：:]/.test(line)) {
    return false;
  }

  // Count only full-width parentheses
  let parenCount = 0;
  for (const char of line) {
    if (char === '（') parenCount++;
    if (char === '）') parenCount--;
  }

  // If unclosed, it's a multi-line option
  return parenCount > 0;
}

/**
 * Merge one multiline option.
 */
function mergeMultiLineOption(lines: string[], startIndex: number): { line: string; nextIndex: number } {
  let merged = lines[startIndex].trim();
  let i = startIndex + 1;

  // Count parentheses in the first line
  let parenCount = 0;
  for (const char of merged) {
    if (char === '（') parenCount++;
    if (char === '）') parenCount--;
  }

  // Continue merging until parentheses are balanced OR we hit a new option line
  while (i < lines.length && parenCount > 0) {
    const nextLine = lines[i].trim();
    if (!nextLine) {
      i++;
      continue;
    }

    // Check if this is a new option line (O1：, O2：, etc.)
    if (/^(?:O\d+|选项\d+)[：:]/.test(nextLine)) {
      break;
    }

    merged += nextLine;

    // Update parenthesis count
    for (const char of nextLine) {
      if (char === '（') parenCount++;
      if (char === '）') parenCount--;
    }

    i++;
  }

  return { line: merged, nextIndex: i };
}

/**
 * Preprocess by merging multiline options.
 */
function mergeMultiLineOptions(rawLines: string[]): string[] {
  const result: string[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i].trim();
    if (!line) {
      i++;
      continue;
    }

    // Check if this is a multi-line option
    if (isMultiLineOption(line)) {
      const merged = mergeMultiLineOption(rawLines, i);
      result.push(merged.line);
      i = merged.nextIndex;
    } else {
      result.push(line);
      i++;
    }
  }

  return result;
}
