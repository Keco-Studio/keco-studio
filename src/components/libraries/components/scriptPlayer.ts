import type { AssetRow } from '@/lib/types/libraryAssets';
import {
  applyStoryCommands,
  interpolateVariables,
  parseNumericCommand,
  type VariableState,
} from '@/lib/story-ir/commands';
import type { StoryCommand } from '@/lib/story-ir/schema';

export interface ScriptOptionColumns {
  index: number;
  textKey: string;
  nextKey: string;
  commandsKey?: string;
}

export interface ScriptPlayerColumns {
  labelKey?: string;
  commandsKey?: string;
  options?: ScriptOptionColumns[];
  option0Key?: string;
  option0NextKey?: string;
  option0CommandsKey?: string;
  option1Key?: string;
  option1NextKey?: string;
  option1CommandsKey?: string;
  option2Key?: string;
  option2NextKey?: string;
  option2CommandsKey?: string;
}

export interface ScriptPlayerOption {
  index: number;
  text: string;
  targetLabel?: string;
  commands: string;
}

export interface ScriptPlayerState {
  currentIndex: number;
  revealed: number[];
  atChoice: boolean;
  options: ScriptPlayerOption[];
  variables: VariableState;
  done: boolean;
  warning?: string;
  error?: string;
  automaticTrail: number[];
}

export function createScriptPlayerState(
  rows: AssetRow[],
  columns: ScriptPlayerColumns
): ScriptPlayerState {
  const state: ScriptPlayerState = {
    currentIndex: 0,
    revealed: [],
    atChoice: false,
    options: [],
    variables: {},
    done: rows.length === 0,
    automaticTrail: [],
  };
  return rows.length > 0 ? nextPosition(state, rows, columns) : state;
}

export function buildBranchIndex(
  rows: AssetRow[],
  columns: ScriptPlayerColumns
): Map<string, number> {
  const index = new Map<string, number>();
  if (!columns.labelKey) return index;

  rows.forEach((row, rowIndex) => {
    const label = readString(row, columns.labelKey).trim();
    if (label && !index.has(label)) index.set(label, rowIndex);
  });
  return index;
}

export function nextPosition(
  state: ScriptPlayerState,
  rows: AssetRow[],
  columns: ScriptPlayerColumns,
  choice?: number
): ScriptPlayerState {
  if (choice !== undefined) return chooseBranch(state, rows, columns, choice);
  if (state.done || state.error || state.atChoice) return state;
  if (state.currentIndex < 0 || state.currentIndex >= rows.length) {
    return { ...state, atChoice: false, options: [], done: true, warning: undefined };
  }

  const row = rows[state.currentIndex];
  const revealed = revealRow(state.revealed, state.currentIndex);
  const commandText = readString(row, columns.commandsKey);
  let variables: VariableState;
  try {
    variables = executeCommandText(state.variables, commandText);
  } catch (error) {
    return stopWithError(state, revealed, error);
  }

  if (hasEndCommand(commandText)) {
    return {
      ...state,
      revealed,
      variables,
      atChoice: false,
      options: [],
      done: true,
      warning: undefined,
      automaticTrail: [],
    };
  }

  const options = readOptions(row, columns);
  if (options.length > 0) {
    return {
      ...state,
      revealed,
      variables,
      atChoice: true,
      options,
      done: false,
      warning: undefined,
      automaticTrail: [],
    };
  }

  const jumpTarget = parseJumpTarget(readString(row, columns.commandsKey));
  if (jumpTarget) {
    const targetIndex = buildBranchIndex(rows, columns).get(jumpTarget);
    if (targetIndex === undefined) {
      return {
        ...state,
        revealed,
        variables,
        atChoice: false,
        options: [],
        done: false,
        warning: `Could not resolve jump target "${jumpTarget}"`,
      };
    }

    const automaticTrail = [...state.automaticTrail, state.currentIndex];
    if (automaticTrail.includes(targetIndex)) {
      return stopWithError(
        { ...state, variables },
        revealed,
        new Error(`Automatic jump cycle detected at "${jumpTarget}"`)
      );
    }

    return {
      ...state,
      currentIndex: targetIndex,
      revealed,
      variables,
      atChoice: false,
      options: [],
      done: false,
      warning: undefined,
      automaticTrail,
    };
  }

  const nextIndex = state.currentIndex + 1;
  return {
    ...state,
    currentIndex: nextIndex,
    revealed,
    variables,
    atChoice: false,
    options: [],
    done: nextIndex >= rows.length,
    warning: undefined,
    automaticTrail: [],
  };
}

export function renderPlayerContent(
  row: AssetRow,
  contentKey: string | undefined,
  variables: VariableState
): string {
  return interpolateVariables(readString(row, contentKey).trim(), variables);
}

function chooseBranch(
  state: ScriptPlayerState,
  rows: AssetRow[],
  columns: ScriptPlayerColumns,
  choice: number
): ScriptPlayerState {
  const selected = state.options.find((option) => option.index === choice);
  if (!state.atChoice || !selected) {
    return { ...state, warning: 'Choose one of the available options' };
  }
  if (!selected.targetLabel) {
    return { ...state, warning: `Option "${selected.text}" does not define a jump target` };
  }

  let variables: VariableState;
  try {
    variables = executeCommandText(state.variables, selected.commands);
  } catch (error) {
    return stopWithError(state, state.revealed, error);
  }

  const targetIndex = buildBranchIndex(rows, columns).get(selected.targetLabel);
  if (targetIndex === undefined) {
    return {
      ...state,
      variables,
      warning: `Could not resolve jump target "${selected.targetLabel}"`,
    };
  }

  return nextPosition({
    ...state,
    currentIndex: targetIndex,
    variables,
    atChoice: false,
    options: [],
    done: false,
    warning: undefined,
    automaticTrail: [],
  }, rows, columns);
}

function readOptions(row: AssetRow, columns: ScriptPlayerColumns): ScriptPlayerOption[] {
  const optionColumns = columns.options ?? legacyOptionColumns(columns);
  return optionColumns.flatMap(({ index, textKey, nextKey, commandsKey }) => {
    const text = readString(row, textKey).trim();
    if (!text) return [];
    return [{
      index,
      text,
      targetLabel: parseJumpTarget(readString(row, nextKey)),
      commands: readString(row, commandsKey),
    }];
  });
}

function legacyOptionColumns(columns: ScriptPlayerColumns): ScriptOptionColumns[] {
  return [
    [0, columns.option0Key, columns.option0NextKey, columns.option0CommandsKey],
    [1, columns.option1Key, columns.option1NextKey, columns.option1CommandsKey],
    [2, columns.option2Key, columns.option2NextKey, columns.option2CommandsKey],
  ].flatMap(([index, textKey, nextKey, commandsKey]) =>
    typeof index === 'number' && typeof textKey === 'string'
      ? [{ index, textKey, nextKey: typeof nextKey === 'string' ? nextKey : '', commandsKey: typeof commandsKey === 'string' ? commandsKey : undefined }]
      : []
  );
}

function executeCommandText(variables: VariableState, value: string): VariableState {
  const commands = value
    .split(';')
    .map((command) => command.trim())
    .filter((command) => command && !isStructuralCommand(command))
    .map((source): StoryCommand => ({
      source,
      ...parseNumericCommand(source),
      sourceRefs: [],
    }));
  return applyStoryCommands(variables, commands);
}

function isStructuralCommand(source: string): boolean {
  return /^Jump\s+\S+$/i.test(source) || /^End$/i.test(source);
}

function hasEndCommand(value: string): boolean {
  return value.split(';').some((source) => /^End$/i.test(source.trim()));
}

function stopWithError(
  state: ScriptPlayerState,
  revealed: number[],
  error: unknown
): ScriptPlayerState {
  return {
    ...state,
    revealed,
    atChoice: false,
    options: [],
    done: true,
    warning: undefined,
    error: error instanceof Error ? error.message : 'Script command failed',
  };
}

function readString(row: AssetRow, key: string | undefined): string {
  if (!key) return '';
  const value = row.propertyValues[key];
  return value === undefined || value === null ? '' : String(value);
}

function revealRow(revealed: number[], index: number): number[] {
  return revealed.includes(index) ? revealed : [...revealed, index];
}

function parseJumpTarget(value: string): string | undefined {
  return value.match(/\bJump\s+([A-Za-z][A-Za-z0-9_-]*)\b/i)?.[1];
}
