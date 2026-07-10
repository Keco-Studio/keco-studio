import type { NumericOperator, StoryCommand } from './schema';

export type VariableState = Record<string, number>;

export interface ParsedNumericCommand {
  variable: string;
  operator: NumericOperator;
  value: number;
}

const COMMAND_PATTERN = /^\$([A-Za-z_]\w*)\s*(=|\+=|-=|\*=|\/=)\s*(-?(?:\d+\.?\d*|\.\d+))$/;

export function parseNumericCommand(source: string): ParsedNumericCommand {
  const match = COMMAND_PATTERN.exec(source.trim());
  if (!match) throw new Error(`Invalid numeric command: ${source}`);

  const value = Number(match[3]);
  if (!Number.isFinite(value)) throw new Error(`Invalid numeric value: ${match[3]}`);
  return {
    variable: match[1],
    operator: match[2] as NumericOperator,
    value,
  };
}

export function applyStoryCommands(
  variables: VariableState,
  commands: StoryCommand[]
): VariableState {
  const next = { ...variables };

  for (const command of commands) {
    const current = next[command.variable] ?? 0;
    let value: number;

    switch (command.operator) {
      case '=':
        value = command.value;
        break;
      case '+=':
        value = current + command.value;
        break;
      case '-=':
        value = current - command.value;
        break;
      case '*=':
        value = current * command.value;
        break;
      case '/=':
        if (command.value === 0) throw new Error(`Cannot divide $${command.variable} by zero`);
        value = current / command.value;
        break;
    }

    if (!Number.isFinite(value)) {
      throw new Error(`Command produced a non-finite value for $${command.variable}`);
    }
    next[command.variable] = value;
  }

  return next;
}

export function interpolateVariables(content: string, variables: VariableState): string {
  return content.replace(/\[([A-Za-z_]\w*)\]/g, (_match, variable: string) => {
    return String(variables[variable] ?? 0);
  });
}
