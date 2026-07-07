/**
 * Script Parser - Main Parser
 *
 * 通用剧本解析器 - 自动识别各种格式的剧情文本
 *
 * 支持的格式：
 * - 对话：角色名：内容、角色名："内容"、（TypeX・角色名）内容
 * - 旁白：纯文本
 * - 选项：- 文本、【选项N：文本】
 * - 舞台指示：（切屏）、（黄昏，场景）
 * - 变量/好感度：$var+=2、（恋爱线+1）
 * - 条件标注：（多周目，未解锁…）
 * - 章节标题：1.乱世
 * - 系统提示：【全屏文字】
 */

import type { Node, RoleMap, Script } from './types';
import { classifyLine } from './classifier';
import { postProcess } from './postProcess';

const QUOTES = '"\'“”‘’「」';

// Regex for splitting multiple typed dialogues on one line
const STRUCT_TYPED_SPLIT_RE = /（(?:Type|类型)(\d+)・(.+?)）/g;

/**
 * 拆分一行中的多个（TypeX・name）模式
 * 例如：（Type1・A）对话1（Type2・B）对话2 → ['（Type1・A）对话1', '（Type2・B）对话2']
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
 * 拆分混合模式：跳转指令 + 分支声明在同一行
 * 例如：（跳转 Oend）O2 分支【O2｜场景】 → ['（跳转 Oend）', 'O2 分支【O2｜场景】']
 */
function splitMixedPatterns(line: string): string[] {
  // Pattern: （跳转 xxx）O\d+ 分支【...】
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
 * 查找冒号位置
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
 * 判断是否是选项/系统/Label/分隔符
 */
function isSpecialLine(line: string): boolean {
  const stripped = line.trim();
  if (!stripped) return false;

  // 分隔符
  if (/^[-*]{3,}$/.test(stripped)) return true;

  // Label
  if (/^\[(?:Label|标签):\s*(.+?)\]$/.test(stripped)) return true;

  // 选项
  if (/^【选项\s*\d+\s*[：:].+?】$/.test(stripped)) return true;

  // 简洁选项
  if (/^-\s*.+$/.test(stripped)) return true;

  // 系统提示
  if (/^【.+?】/.test(stripped)) return true;

  // 结构化选项 O1： / 选项1：
  if (/^(?:O\d+|选项\d+)[：:].+/.test(stripped)) return true;

  return false;
}

/**
 * 预处理：合并引号跨行
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

    // 特殊行不处理
    if (isSpecialLine(line)) {
      result.push(line);
      i++;
      continue;
    }

    const rest = line.slice(colonPos + 1).trim();

    // 检查是否以引号开头但未闭合
    if (rest.length > 0 && QUOTES.includes(rest[0])) {
      const quoteChar = rest[0];
      const hasClosing = rest.length > 1 && rest[rest.length - 1] === quoteChar;

      if (!hasClosing) {
        const speaker = line.slice(0, colonPos).trim();
        const collected = [rest];
        i++;

        // 继续收集直到引号闭合
        while (i < rawLines.length) {
          const nl = rawLines[i].trim();
          if (!nl) {
            i++;
            continue;
          }

          // 遇到特殊行则停止
          if (isSpecialLine(nl)) break;

          // 遇到新的对话行则停止
          const nlColonPos = findColon(nl);
          if (nlColonPos > 0 && !QUOTES.includes(nl[0])) break;

          collected.push(nl);
          i++;

          // 如果包含闭合引号则停止
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
 * 通用解析器主函数
 */
export function parseText(text: string, roleMap: RoleMap = {}): Script {
  const rawLines = text.trim().split('\n');

  // 预处理：合并引号跨行
  const mergedLines = preprocessLines(rawLines);

  // 预处理：合并跨行选项
  const optionMergedLines = mergeMultiLineOptions(mergedLines);

  // 拆分一行中的多个（TypeX・name）模式
  const splitLines: string[] = [];
  for (const line of optionMergedLines) {
    const split = splitTypedDialogues(line);
    splitLines.push(...split);
  }

  // 行分类
  const rawNodes: Node[] = [];
  for (const line of splitLines) {
    const node = classifyLine(line, roleMap);
    if (node._type !== 'empty') {
      rawNodes.push(node);
    }
  }

  // 后处理
  return postProcess(rawNodes);
}

/**
 * 检查是否是跨行选项（以未闭合的全角括号结尾）
 */
function isMultiLineOption(line: string): boolean {
  // Check if line starts with O\d+：/ 选项\d+： and ends with unclosed parenthesis
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
 * 合并跨行选项
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
 * 预处理：合并跨行选项
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
