/**
 * Script Parser - Post Processor
 *
 * 选项关联、分支处理、生成最终 Script
 */

import type { Node, NodeWithOptions, Script, ScriptLine } from './types';
import { createEmptyScriptLine, DEFAULT_START_LABEL, JUMP_PREFIX } from './types';

/**
 * 创建指令行（表头说明）
 */
function makeInstructionRow(): ScriptLine {
  return {
    label: 'Story jump node',
    type: 0,
    name: 'Speaker',
    content: 'Dialogue and options',
    if: 'Trigger condition',
    commands: 'Story commands',
    fg: 'Left portrait',
    fg1: 'Right portrait',
    cg: 'CG asset',
    option0: '',
    option0_next: '',
    option1: '',
    option1_next: '',
    option2: '',
    option2_next: '',
    voice: 'Voice path',
    bg: 'Background',
  };
}

/**
 * 将节点转换为 ScriptLine
 */
function makeScriptLine(
  node: NodeWithOptions,
  isFirst: boolean,
  warnings: string[],
  labelOverride?: string
): ScriptLine {
  const sl = createEmptyScriptLine();

  // Priority: labelOverride > node.label > default start label for first line
  if (labelOverride) {
    sl.label = labelOverride;
  } else if (node.label) {
    sl.label = node.label;
  } else if (isFirst) {
    sl.label = DEFAULT_START_LABEL;
  }

  sl.type = node.type ?? 3;
  sl.name = node.name ?? '';
  sl.content = node.content ?? '';

  // 处理条件和变量
  const conditions: string[] = [];
  const variables: string[] = [];

  if (node.condition) {
    conditions.push(node.condition);
  }
  if (node.command) {
    variables.push(node.command);
  }

  // 处理选项
  const opts = node._options || [];
  const optLabels = node._option_labels || [];
  if (opts.length > 3) {
    const nodeName = node.label || node.name || node.content || 'unlabeled node';
    const dropped = opts.slice(3).map((opt) => opt.option_text).join(' / ');
    warnings.push(
      `Node "${nodeName}" has ${opts.length} options but the ScriptLine schema supports 3; extra options not exported: ${dropped}`
    );
  }

  for (let idx = 0; idx < Math.min(opts.length, 3); idx++) {
    const opt = opts[idx];
    const label = optLabels[idx] || `O${idx + 1}`;

    // 收集选项条件和变量
    if (opt.condition) {
      conditions.push(opt.condition);
    }
    if (opt.variable) {
      variables.push(opt.variable);
    }

    if (idx === 0) {
      sl.option0 = opt.option_text;
      sl.option0_next = `${JUMP_PREFIX} ${label}`;
    } else if (idx === 1) {
      sl.option1 = opt.option_text;
      sl.option1_next = `${JUMP_PREFIX} ${label}`;
    } else if (idx === 2) {
      sl.option2 = opt.option_text;
      sl.option2_next = `${JUMP_PREFIX} ${label}`;
    }
  }

  // 写入条件和变量
  if (conditions.length > 0) {
    sl.if = conditions.join('; ');
  }
  if (variables.length > 0) {
    sl.commands = variables.join('; ');
  }

  return sl;
}

interface BranchSet {
  labels: string[];
  contents: NodeWithOptions[][];
}

/**
 * 后处理：选项关联、分支处理、生成 Script
 */
export function postProcess(rawNodes: Node[]): Script {
  let branchCounter = 0;

  const nextLabel = (): string => {
    branchCounter++;
    return `O${branchCounter}`;
  };

  // 第1层：合并章节标题为 Label，处理结构化格式节点
  let merged: NodeWithOptions[] = [];
  const branchVars: Map<string, string> = new Map(); // label -> var command

  for (const node of rawNodes) {
    if (node._type === 'empty') continue;

    if (node._type === 'chapter') {
      merged.push({ _type: 'label', label: node.label } as NodeWithOptions);
      continue;
    }

    // Handle structured format nodes
    if (node._type === 'struct_label') {
      // Label with scene description: 【Start｜场景描述】
      merged.push({
        _type: 'dialogue',
        label: node.label,
        type: 3,
        content: node.content,
      } as NodeWithOptions);
      continue;
    }

    if (node._type === 'struct_branch') {
      // Branch declaration: O1 分支【O1｜场景】
      merged.push({
        _type: 'dialogue',
        label: node.label,
        type: 3,
        content: node.content,
      } as NodeWithOptions);
      continue;
    }

    if (node._type === 'struct_jump') {
      // Jump instruction: （跳转 Oend）
      // Add as command to the previous line
      if (merged.length > 0) {
        const lastNode = merged[merged.length - 1];
        const jumpCmd = `${JUMP_PREFIX} ${node.target}`;
        lastNode.command = lastNode.command
          ? `${lastNode.command}; ${jumpCmd}`
          : jumpCmd;
      }
      continue;
    }

    if (node._type === 'struct_option') {
      // Structured option: O1：选项文本（变量，跳转）
      // Attach to previous dialogue/narration
      if (merged.length > 0) {
        const lastNode = merged[merged.length - 1];
        if (!lastNode._options) {
          lastNode._options = [];
          lastNode._option_labels = [];
        }

        // Generate label for this option
        const optLabel = node.jump_target || nextLabel();
        lastNode._options.push({
          option_index: node.option_index,
          option_text: node.option_text,
          variable: node.var_change || undefined,
        });
        lastNode._option_labels.push(optLabel);

        // Store var change for branch if needed
        if (node.var_change && node.jump_target) {
          branchVars.set(node.jump_target, node.var_change);
        }
      }
      continue;
    }

    merged.push(node as NodeWithOptions);
  }

  // 第2层：收集连续选项组，附加到前面的节点
  const processed: NodeWithOptions[] = [];
  let i = 0;
  while (i < merged.length) {
    const node = merged[i];

    if (node._type === 'option') {
      // 收集连续选项
      const optGroup: Array<{
        option_index: number;
        option_text: string;
        condition?: string;
        variable?: string;
      }> = [];

      while (i < merged.length && merged[i]._type === 'option') {
        const opt = merged[i] as Node;
        if (opt._type === 'option') {
          optGroup.push({
            option_index: opt.option_index,
            option_text: opt.option_text,
            condition: opt.condition,
            variable: opt.variable,
          });
        }
        i++;
      }

      // 重新编号
      for (let idx = 0; idx < optGroup.length; idx++) {
        optGroup[idx].option_index = idx;
      }

      // 生成标签
      const labels = optGroup.map(() => nextLabel());

      // 附加到前面的节点
      if (processed.length > 0) {
        const lastNode = processed[processed.length - 1];
        if (
          lastNode._type === 'dialogue' ||
          lastNode._type === 'narration' ||
          lastNode._type === 'system'
        ) {
          lastNode._options = optGroup;
          lastNode._option_labels = labels;
        }
      }
    } else {
      processed.push(node);
      i++;
    }
  }

  // 过滤选项节点
  const filtered = processed.filter((n) => n._type !== 'option');

  // 第3层：处理分支
  const trunk: NodeWithOptions[] = [];
  let pendingOptLabels: string[] = [];
  let branchLabels: string[] = [];
  let branchContents: NodeWithOptions[][] = [];
  const branchSets: BranchSet[] = [];
  let inBranch = false;
  let currentBi = 0;

  for (const node of filtered) {
    if (node._type === 'separator') {
      if (pendingOptLabels.length > 0 && !inBranch) {
        inBranch = true;
        branchLabels = [...pendingOptLabels];
        branchContents = pendingOptLabels.map(() => []);
        currentBi = 0;
        pendingOptLabels = [];
      } else if (inBranch) {
        currentBi++;
        if (currentBi >= branchLabels.length) {
          branchSets.push({
            labels: [...branchLabels],
            contents: branchContents.map((bc) => [...bc]),
          });
          branchLabels = [];
          branchContents = [];
          inBranch = false;
        }
      } else {
        trunk.push({ _type: 'separator' } as NodeWithOptions);
      }
      continue;
    }

    if (node._options) {
      pendingOptLabels = [...(node._option_labels || [])];
    }

    if (inBranch && currentBi < branchContents.length) {
      branchContents[currentBi].push(node);
    } else {
      trunk.push(node);
    }
  }

  if (branchContents.length > 0 && branchLabels.length > 0) {
    branchSets.push({
      labels: [...branchLabels],
      contents: branchContents.map((bc) => [...bc]),
    });
  }

  // 第4层：输出
  const warnings: string[] = [];
  const script: Script = { lines: [], warnings };
  script.lines.push(makeInstructionRow());

  // 主干
  let isFirst = true;
  for (const node of trunk) {
    if (node._type === 'separator') {
      script.lines.push(createEmptyScriptLine());
      continue;
    }
    const sl = makeScriptLine(node, isFirst, warnings);
    isFirst = false;
    script.lines.push(sl);
  }

  // 分支
  for (const bs of branchSets) {
    for (let bi = 0; bi < bs.labels.length; bi++) {
      const bl = bs.labels[bi];
      const content = bs.contents[bi];
      if (!content || content.length === 0) continue;

      script.lines.push(createEmptyScriptLine());
      for (let ci = 0; ci < content.length; ci++) {
        const bn = content[ci];
        const bsl = makeScriptLine(bn, false, warnings, ci === 0 ? bl : undefined);
        script.lines.push(bsl);
      }
    }
    script.lines.push(createEmptyScriptLine());
  }

  // 后处理：为分支起始行添加变量指令
  if (branchVars.size > 0) {
    for (const sl of script.lines) {
      if (sl.label && branchVars.has(sl.label)) {
        let varCmd = branchVars.get(sl.label)!;
        if (!varCmd.startsWith('$')) {
          varCmd = '$' + varCmd;
        }
        sl.commands = sl.commands ? `${sl.commands}; ${varCmd}` : varCmd;
      }
    }
  }

  if (warnings.length === 0) {
    delete script.warnings;
  }

  return script;
}
