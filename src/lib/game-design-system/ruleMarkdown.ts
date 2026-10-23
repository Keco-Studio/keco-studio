import {
  GAME_RULE_DOMAINS,
  isGameRulesKernel,
  type GameDesignDocument,
  type GameDesignRule,
  type GameDesignRuleSet,
} from './ruleSchema';

const headings: Record<GameDesignRuleSet['rules'][number]['kind'], string> = {
  principle: 'Principles',
  constraint: 'Constraints',
  pattern: 'Patterns',
  anti_pattern: 'Anti-patterns',
  check: 'Checks',
};

const domainHeadings: Record<typeof GAME_RULE_DOMAINS[number], string> = {
  player: 'Players',
  objective: 'Objectives',
  action: 'Actions',
  object_state: 'Object States',
  sequence: 'Sequences',
  resource_cost: 'Resource Costs',
  resolution_feedback: 'Resolution & Feedback',
  spatiotemporal: 'Spatiotemporal Rules',
  randomness: 'Randomness',
  fallback: 'Fallbacks',
};

export const GAME_DESIGN_SYSTEM_VERSION_PLACEHOLDER = '__KECO_ATOMIC_VERSION_LINE__';

function appendRule(lines: string[], rule: GameDesignRule, headingLevel: 3 | 4 = 3): void {
  lines.push(
    '',
    `${'#'.repeat(headingLevel)} ${rule.id} - ${rule.title}`,
    '',
    rule.statement,
    '',
    `- Severity: ${rule.severity}`,
    `- Applies when: ${rule.appliesWhen}`,
  );
  if (rule.rationale) lines.push(`- Rationale: ${rule.rationale}`);
  if (rule.evidence) lines.push(`- Evidence: ${rule.evidence}`);
}

export function renderRuleSetMarkdown(
  ruleSet: GameDesignRuleSet,
  metadata: {
    title: string;
    version: number | typeof GAME_DESIGN_SYSTEM_VERSION_PLACEHOLDER;
    document?: GameDesignDocument | null;
  },
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

  if (metadata.document) {
    const document = metadata.document;
    if (document.gameBackground) {
      lines.push(
        '',
        '## Game Background & Setting',
        '',
        document.gameBackground,
      );
    }
    lines.push(
      '',
      '## Design Intent & Player Fantasy',
      '',
      '### Design Intent',
      '',
      document.designIntent,
      '',
      '### Player Fantasy',
      '',
      document.playerFantasy,
      '',
      '## Core Loop',
      '',
      document.coreLoop,
      '',
      '## Decision Structure',
      '',
      document.decisionStructure,
      '',
      '## Rules & System Boundaries',
      '',
      document.systemBoundaries,
      '',
      '## Progression & Economy',
      '',
      document.progressionEconomy,
      '',
      '## Content Model',
      '',
      document.contentModel,
      '',
      '## Difficulty & Balance',
      '',
      document.difficultyBalance,
      '',
      '## Experience & Presentation',
      '',
      document.experiencePresentation,
    );
  }

  if (isGameRulesKernel(ruleSet)) {
    GAME_RULE_DOMAINS.forEach((domain) => {
      const domainRules = ruleSet.rules.filter((rule) => rule.domain === domain);
      if (domainRules.length === 0) return;
      lines.push('', `## ${domainHeadings[domain]}`);
      (Object.keys(headings) as Array<keyof typeof headings>).forEach((kind) => {
        const kindRules = domainRules.filter((rule) => rule.kind === kind);
        if (kindRules.length === 0) return;
        lines.push('', `### ${headings[kind]}`);
        kindRules.forEach((rule) => appendRule(lines, rule, 4));
      });
    });
  } else {
    (Object.keys(headings) as Array<keyof typeof headings>).forEach((kind) => {
      const rules = ruleSet.rules.filter((rule) => rule.kind === kind);
      if (rules.length === 0) return;
      lines.push('', `## ${headings[kind]}`);
      rules.forEach((rule) => appendRule(lines, rule));
    });
  }

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
