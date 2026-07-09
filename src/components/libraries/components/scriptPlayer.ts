import type { AssetRow } from '@/lib/types/libraryAssets';

export interface ScriptPlayerColumns {
  labelKey?: string;
  option0Key?: string;
  option0NextKey?: string;
  option1Key?: string;
  option1NextKey?: string;
  option2Key?: string;
  option2NextKey?: string;
  commandsKey?: string;
}

export interface ScriptPlayerOption {
  index: 0 | 1 | 2;
  text: string;
  targetLabel?: string;
}

export interface ScriptPlayerState {
  currentIndex: number;
  revealed: number[];
  atChoice: boolean;
  options: ScriptPlayerOption[];
  done: boolean;
  warning?: string;
}

export function buildBranchIndex(
  rows: AssetRow[],
  columns: ScriptPlayerColumns
): Map<string, number> {
  const index = new Map<string, number>();
  if (!columns.labelKey) return index;

  rows.forEach((row, rowIndex) => {
    const label = readString(row, columns.labelKey).trim();
    if (label && !index.has(label)) {
      index.set(label, rowIndex);
    }
  });

  return index;
}

export function nextPosition(
  state: ScriptPlayerState,
  rows: AssetRow[],
  columns: ScriptPlayerColumns,
  choice?: number
): ScriptPlayerState {
  if (choice !== undefined) {
    return chooseBranch(state, rows, columns, choice);
  }

  if (state.done) return state;
  if (state.currentIndex < 0 || state.currentIndex >= rows.length) {
    return {
      ...state,
      atChoice: false,
      options: [],
      done: true,
      warning: undefined,
    };
  }

  const row = rows[state.currentIndex];
  const revealed = revealRow(state.revealed, state.currentIndex);
  const options = readOptions(row, columns);
  if (options.length > 0) {
    return {
      ...state,
      revealed,
      atChoice: true,
      options,
      done: false,
      warning: undefined,
    };
  }

  const jumpTarget = parseJumpTarget(readString(row, columns.commandsKey));
  if (jumpTarget) {
    const targetIndex = buildBranchIndex(rows, columns).get(jumpTarget);
    if (targetIndex === undefined) {
      return {
        ...state,
        revealed,
        atChoice: false,
        options: [],
        done: false,
        warning: `Could not resolve jump target "${jumpTarget}"`,
      };
    }

    return {
      ...state,
      currentIndex: targetIndex,
      revealed,
      atChoice: false,
      options: [],
      done: false,
      warning: undefined,
    };
  }

  const nextIndex = state.currentIndex + 1;
  return {
    ...state,
    currentIndex: nextIndex,
    revealed,
    atChoice: false,
    options: [],
    done: nextIndex >= rows.length,
    warning: undefined,
  };
}

function chooseBranch(
  state: ScriptPlayerState,
  rows: AssetRow[],
  columns: ScriptPlayerColumns,
  choice: number
): ScriptPlayerState {
  const selected = state.options.find((option) => option.index === choice);
  if (!state.atChoice || !selected) {
    return {
      ...state,
      warning: 'Choose one of the available options',
    };
  }

  if (!selected.targetLabel) {
    return {
      ...state,
      warning: `Option "${selected.text}" does not define a jump target`,
    };
  }

  const targetIndex = buildBranchIndex(rows, columns).get(selected.targetLabel);
  if (targetIndex === undefined) {
    return {
      ...state,
      warning: `Could not resolve jump target "${selected.targetLabel}"`,
    };
  }

  return nextPosition({
    ...state,
    currentIndex: targetIndex,
    atChoice: false,
    options: [],
    done: false,
    warning: undefined,
  }, rows, columns);
}

function readOptions(row: AssetRow, columns: ScriptPlayerColumns): ScriptPlayerOption[] {
  const pairs = [
    [0, columns.option0Key, columns.option0NextKey],
    [1, columns.option1Key, columns.option1NextKey],
    [2, columns.option2Key, columns.option2NextKey],
  ] as const;

  return pairs.flatMap(([index, textKey, nextKey]) => {
    const text = readString(row, textKey).trim();
    if (!text) return [];

    return [{
      index,
      text,
      targetLabel: parseJumpTarget(readString(row, nextKey)),
    }];
  });
}

function readString(row: AssetRow, key: string | undefined): string {
  if (!key) return '';
  const value = row.propertyValues[key];
  if (value === undefined || value === null) return '';
  return String(value);
}

function revealRow(revealed: number[], index: number): number[] {
  if (revealed.includes(index)) return revealed;
  return [...revealed, index];
}

function parseJumpTarget(value: string): string | undefined {
  const match = value.match(/\bJump\s+([A-Za-z][A-Za-z0-9_-]*)\b/i);
  return match?.[1];
}
