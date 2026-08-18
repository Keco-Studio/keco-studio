import type { DocumentV2, SectionV2, TypedBlock } from './contracts';

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderTable(columns: string[], rows: string[][]): string {
  const header = `| ${columns.map(escapeCell).join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`);
  return [header, divider, ...body].join('\n');
}

function renderBlock(block: TypedBlock): string {
  switch (block.kind) {
    case 'paragraph':
      return block.text;
    case 'bullet-list':
      return block.items.map((item) => `- ${item}`).join('\n');
    case 'data-table':
      return renderTable(block.columns, block.rows);
    case 'formula':
      return ['```text', block.expression, '```'].join('\n');
    case 'flow':
      return ['```text', block.steps.map((step) => step.text).join(' -> '), '```'].join('\n');
    case 'example':
      return `**${block.title}**\n\n${block.body}`;
    case 'quote':
      return block.text.split(/\r?\n/).map((line) => `> ${line}`).concat(`> —— ${block.cite}`).join('\n');
  }
}

function sectionNumbers(sections: SectionV2[]): Map<string, string> {
  const counters = [0, 0, 0];
  const numbers = new Map<string, string>();
  for (const section of sections) {
    const depth = Math.min(2, Math.max(0, section.depth));
    counters[depth] += 1;
    for (let index = depth + 1; index < counters.length; index += 1) counters[index] = 0;
    const parts = counters.slice(0, depth + 1);
    numbers.set(section.id, parts.join('.'));
  }
  return numbers;
}

export function renderGddV2Markdown(document: DocumentV2): string {
  const numbers = sectionNumbers(document.sections);
  const lines: string[] = [`# ${document.title}`, ''];
  if (document.versionLabel) lines.push(`**文档版本：** ${document.versionLabel}`);
  if (document.gameType) lines.push(`**类型：** ${document.gameType}`);
  if (document.targetPlatforms?.length) lines.push(`**目标平台：** ${document.targetPlatforms.join(' / ')}`);
  if (document.versionLabel || document.gameType || document.targetPlatforms?.length) lines.push('');
  lines.push(document.premise, '');

  for (const section of document.sections) {
    const headingLevel = Math.min(4, section.depth + 2);
    const heading = `${'#'.repeat(headingLevel)} ${numbers.get(section.id) ?? ''}. ${section.title}`.replace(/\. /, '. ');
    lines.push(heading, '');
    for (const block of section.blocks) lines.push(renderBlock(block), '');
  }

  if (document.assumptions.length > 0) {
    lines.push('## 待确认事项', '', ...document.assumptions.map((item) => `- ${item}`), '');
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
