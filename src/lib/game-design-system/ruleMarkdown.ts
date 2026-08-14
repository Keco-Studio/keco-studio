import type { GameDesignRuleSet } from './ruleSchema';

const headings: Record<GameDesignRuleSet['rules'][number]['kind'], string> = {
  principle: 'Principles',
  constraint: 'Constraints',
  pattern: 'Patterns',
  anti_pattern: 'Anti-patterns',
  check: 'Checks',
};

export const GAME_DESIGN_SYSTEM_VERSION_PLACEHOLDER = '__KECO_ATOMIC_VERSION_LINE__';

export function renderRuleSetMarkdown(
  ruleSet: GameDesignRuleSet,
  metadata: { title: string; version: number | typeof GAME_DESIGN_SYSTEM_VERSION_PLACEHOLDER },
): string {
  const title = metadata.title
    .trim()
    .replace(/[\r\n\u2028\u2029]+/gu, ' ')
    .replace(/[ \t]+/g, ' ');
  const lines = [
    `# ${title}`,
    '',
    `> Version: ${metadata.version}`,
    `> Genre: ${ruleSet.genres.join(', ') || 'Unspecified'}`,
    `> Design Philosophy: ${ruleSet.philosophies.join(', ') || 'Unspecified'}`,
    `> Suitable For: ${ruleSet.suitableFor}`,
  ];

  (Object.keys(headings) as Array<keyof typeof headings>).forEach((kind) => {
    const rules = ruleSet.rules.filter((rule) => rule.kind === kind);
    if (rules.length === 0) return;
    lines.push('', `## ${headings[kind]}`);
    rules.forEach((rule) => {
      lines.push(
        '',
        `### ${rule.id} - ${rule.title}`,
        '',
        rule.statement,
        '',
        `- Severity: ${rule.severity}`,
        `- Applies when: ${rule.appliesWhen}`,
      );
      if (rule.rationale) lines.push(`- Rationale: ${rule.rationale}`);
      if (rule.evidence) lines.push(`- Evidence: ${rule.evidence}`);
    });
  });

  lines.push('', '## Keco Table Guidance');
  if (ruleSet.tableGuidance.length === 0) {
    lines.push('', 'No table guidance specified.');
  } else {
    ruleSet.tableGuidance.forEach((guidance) => {
      lines.push('', `### ${guidance.table}`, '', guidance.purpose, '', `- Fields: ${guidance.fields.join(', ') || 'None specified'}`);
    });
  }
  return `${lines.join('\n')}\n`;
}
