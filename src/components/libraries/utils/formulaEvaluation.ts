import type { AssetRow, PropertyConfig } from '@/lib/types/libraryAssets';

type FormulaToken =
  | { type: 'number'; value: number }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: '+' | '-' | '*' | '/' }
  | { type: 'paren'; value: '(' | ')' };

const FORMULA_DECIMAL_DIGITS = 4;
const FORMULA_REF_ERROR = '#REF!';
const FORMULA_DIV0_ERROR = '#DIV/0!';

const roundFormulaNumber = (n: number): number => {
  if (!Number.isFinite(n)) return n;
  const factor = 10 ** FORMULA_DECIMAL_DIGITS;
  return Math.round(n * factor) / factor;
};

const tokenizeFormula = (expr: string): FormulaToken[] => {
  const tokens: FormulaToken[] = [];
  let i = 0;
  const s = expr.trim();

  const isWhitespace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
  const isDigit = (ch: string) => ch >= '0' && ch <= '9';
  const isIdentStart = (ch: string) =>
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    ch === '_' ||
    ch === '$';
  const isIdentPart = (ch: string) =>
    isIdentStart(ch) || isDigit(ch);

  while (i < s.length) {
    const ch = s[i];
    if (isWhitespace(ch)) {
      i += 1;
      continue;
    }
    if (ch === '[') {
      const start = i + 1;
      let end = start;
      while (end < s.length && s[end] !== ']') {
        end += 1;
      }
      const inside = s.slice(start, end).trim();
      if (inside) {
        tokens.push({ type: 'identifier', value: inside });
      }
      i = end < s.length ? end + 1 : end;
      continue;
    }
    if (isDigit(ch) || (ch === '.' && i + 1 < s.length && isDigit(s[i + 1]))) {
      const start = i;
      i += 1;
      while (i < s.length && (isDigit(s[i]) || s[i] === '.')) {
        i += 1;
      }
      const num = Number(s.slice(start, i));
      if (!Number.isNaN(num)) {
        tokens.push({ type: 'number', value: num });
      }
      continue;
    }
    if (isIdentStart(ch)) {
      const start = i;
      i += 1;
      while (i < s.length && isIdentPart(s[i])) {
        i += 1;
      }
      const ident = s.slice(start, i);
      tokens.push({ type: 'identifier', value: ident });
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'operator', value: ch });
      i += 1;
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch });
      i += 1;
      continue;
    }
    i += 1;
  }

  return tokens;
};

const toRpn = (tokens: FormulaToken[]): FormulaToken[] => {
  const output: FormulaToken[] = [];
  const opStack: FormulaToken[] = [];

  const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

  for (const token of tokens) {
    if (token.type === 'number' || token.type === 'identifier') {
      output.push(token);
    } else if (token.type === 'operator') {
      while (
        opStack.length > 0 &&
        opStack[opStack.length - 1].type === 'operator' &&
        precedence[opStack[opStack.length - 1].value] >= precedence[token.value]
      ) {
        output.push(opStack.pop() as FormulaToken);
      }
      opStack.push(token);
    } else if (token.type === 'paren' && token.value === '(') {
      opStack.push(token);
    } else if (token.type === 'paren' && token.value === ')') {
      while (opStack.length > 0 && !(opStack[opStack.length - 1].type === 'paren' && opStack[opStack.length - 1].value === '(')) {
        output.push(opStack.pop() as FormulaToken);
      }
      if (opStack.length > 0 && opStack[opStack.length - 1].type === 'paren' && opStack[opStack.length - 1].value === '(') {
        opStack.pop();
      }
    }
  }

  while (opStack.length > 0) {
    const t = opStack.pop() as FormulaToken;
    if (t.type !== 'paren') {
      output.push(t);
    }
  }

  return output;
};

const evalRpn = (
  rpn: FormulaToken[],
  getIdentifierValue: (name: string) => number | null,
  errorInfo?: { divByZero?: boolean },
): number | null => {
  const stack: number[] = [];

  for (const token of rpn) {
    if (token.type === 'number') {
      stack.push(token.value);
    } else if (token.type === 'identifier') {
      const v = getIdentifierValue(token.value);
      if (v === null || Number.isNaN(v)) {
        return null;
      }
      stack.push(v);
    } else if (token.type === 'operator') {
      if (stack.length < 2) return null;
      const b = stack.pop() as number;
      const a = stack.pop() as number;
      let result: number;
      switch (token.value) {
        case '+':
          result = a + b;
          break;
        case '-':
          result = a - b;
          break;
        case '*':
          result = a * b;
          break;
        case '/':
          if (b === 0) {
            if (errorInfo) {
              errorInfo.divByZero = true;
            }
            return null;
          }
          result = a / b;
          break;
        default:
          return null;
      }
      if (Number.isNaN(result) || !Number.isFinite(result)) {
        return null;
      }
      stack.push(roundFormulaNumber(result));
    }
  }

  if (stack.length !== 1) return null;
  const final = stack[0];
  if (Number.isNaN(final) || !Number.isFinite(final)) {
    return null;
  }
  return roundFormulaNumber(final);
};

export const evaluateFormulaForRow = (
  expression: string | undefined,
  row: AssetRow,
  allProperties: PropertyConfig[],
  visited: Set<string> = new Set(),
): any | null => {
  if (!expression || !expression.trim()) return null;

  const trimmedExpr = expression.trim().startsWith('=')
    ? expression.trim().slice(1)
    : expression.trim();

  const tokens = tokenizeFormula(trimmedExpr);
  if (tokens.length === 0) return null;

  const FUNCTION_NAMES = new Set(['SUM', 'IF', 'AVERAGE', 'MIN', 'MAX', 'ROUND']);
  const hasFunctionIdentifier = tokens.some(
    (t) => t.type === 'identifier' && FUNCTION_NAMES.has(t.value.toUpperCase())
  );

  const propertyByName = new Map<string, PropertyConfig>();
  allProperties.forEach((p) => {
    if (p.name) {
      propertyByName.set(p.name, p);
    }
  });

  if (!hasFunctionIdentifier) {
    for (const token of tokens) {
      if (token.type !== 'identifier') continue;
      const upper = token.value.toUpperCase();
      if (FUNCTION_NAMES.has(upper)) continue;
      if (!propertyByName.has(token.value)) {
        return FORMULA_REF_ERROR;
      }
    }
  }

  const rpn = hasFunctionIdentifier ? [] : toRpn(tokens);

  const resolvePropertyValue = (prop: PropertyConfig): any | null => {
    if (visited.has(prop.id)) return null;

    if (prop.dataType === 'formula') {
      const anyProp = prop as any;
      if (!anyProp.formulaExpression || typeof anyProp.formulaExpression !== 'string') {
        return null;
      }
      const nextVisited = new Set(visited);
      nextVisited.add(prop.id);
      return evaluateFormulaForRow(anyProp.formulaExpression, row, allProperties, nextVisited);
    }

    const raw = row.propertyValues[prop.key];
    if (raw === null || raw === undefined || raw === '') return null;
    return raw;
  };

  if (rpn.length > 0) {
    let hasRefError = false;
    const errorInfo: { divByZero?: boolean } = {};
    const numericValue = evalRpn(rpn, (name) => {
      const prop = propertyByName.get(name);
      if (!prop) {
        hasRefError = true;
        return null;
      }
      const raw = resolvePropertyValue(prop);
      if (raw === null || raw === undefined || raw === '') return null;
      if (typeof raw === 'number') {
        return Number.isNaN(raw) ? null : raw;
      }
      const num = Number(raw);
      return Number.isNaN(num) ? null : num;
    }, errorInfo);

    if (errorInfo.divByZero) {
      return FORMULA_DIV0_ERROR;
    }

    if (hasRefError) {
      return FORMULA_REF_ERROR;
    }

    if (numericValue !== null) {
      return roundFormulaNumber(numericValue);
    }
  }

  try {
    const helper = {
      IF: (condition: any, whenTrue: any, whenFalse: any) =>
        condition ? whenTrue : whenFalse,
      SUM: (...args: any[]) =>
        args.reduce((acc, v) => {
          const n = Number(v);
          return acc + (Number.isFinite(n) ? n : 0);
        }, 0),
      AVERAGE: (...args: any[]) => {
        const nums = args
          .map((v) => Number(v))
          .filter((n) => Number.isFinite(n));
        if (nums.length === 0) return null;
        return nums.reduce((a, b) => a + b, 0) / nums.length;
      },
      MIN: (...args: any[]) => {
        const nums = args
          .map((v) => Number(v))
          .filter((n) => Number.isFinite(n));
        return nums.length ? Math.min(...nums) : null;
      },
      MAX: (...args: any[]) => {
        const nums = args
          .map((v) => Number(v))
          .filter((n) => Number.isFinite(n));
        return nums.length ? Math.max(...nums) : null;
      },
      ROUND: (value: any, digits: any) => {
        const n = Number(value);
        const d = Number(digits);
        if (!Number.isFinite(n) || !Number.isFinite(d)) return null;
        const factor = 10 ** d;
        return Math.round(n * factor) / factor;
      },
      COL: (name: string) => {
        const prop = propertyByName.get(name);
        if (!prop) {
          throw new Error(FORMULA_REF_ERROR);
        }
        const raw = resolvePropertyValue(prop);
        if (raw === null || raw === undefined || raw === '') return null;
        if (typeof raw === 'number') {
          return Number.isNaN(raw) ? null : raw;
        }
        const num = Number(raw);
        return Number.isNaN(num) ? raw : num;
      },
    } as const;

    const columnNames = Array.from(propertyByName.keys()).sort(
      (a, b) => b.length - a.length,
    );

    const stringLiterals: string[] = [];
    let jsExpr = trimmedExpr.replace(
      /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/g,
      (match) => {
        const idx = stringLiterals.length;
        stringLiterals.push(match);
        return `__STR_LITERAL_${idx}__`;
      },
    );

    for (const name of columnNames) {
      const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${safeName}\\b`, 'g');
      jsExpr = jsExpr.replace(re, `COL(${JSON.stringify(name)})`);
    }

    jsExpr = jsExpr
      .replace(/\bIF\s*\(/g, 'IF(')
      .replace(/\bSUM\s*\(/g, 'SUM(')
      .replace(/\bAVERAGE\s*\(/g, 'AVERAGE(')
      .replace(/\bMIN\s*\(/g, 'MIN(')
      .replace(/\bMAX\s*\(/g, 'MAX(')
      .replace(/\bROUND\s*\(/g, 'ROUND(');

    jsExpr = jsExpr
      .replace(/>=/g, '__GTE__')
      .replace(/<=/g, '__LTE__')
      .replace(/=/g, '==')
      .replace(/__GTE__/g, '>=')
      .replace(/__LTE__/g, '<=');

    jsExpr = jsExpr.replace(/__STR_LITERAL_(\d+)__/g, (_, indexStr) => {
      const index = Number(indexStr);
      return Number.isFinite(index) && stringLiterals[index] !== undefined
        ? stringLiterals[index]
        : '';
    });

    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'helper',
      `const { IF, SUM, AVERAGE, MIN, MAX, ROUND, COL } = helper; return (${jsExpr});`,
    );
    const result = fn(helper);
    if (result === undefined) return null;
    if (typeof result === 'number') {
      if (!Number.isFinite(result)) {
        return FORMULA_DIV0_ERROR;
      }
      return roundFormulaNumber(result);
    }
    return result;
  } catch (err) {
    if (err instanceof Error && err.message === FORMULA_REF_ERROR) {
      return FORMULA_REF_ERROR;
    }
    return null;
  }
};

export const getCustomFormulaExpressionFromCellValue = (rawValue: unknown): string | null => {
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    return trimmed.startsWith('=') ? trimmed : null;
  }
  if (rawValue && typeof rawValue === 'object') {
    const maybeObj = rawValue as { expression?: unknown; customExpression?: unknown };
    const expression = typeof maybeObj.customExpression === 'string'
      ? maybeObj.customExpression
      : typeof maybeObj.expression === 'string'
        ? maybeObj.expression
        : null;
    if (expression) {
      const trimmed = expression.trim();
      return trimmed.startsWith('=') ? trimmed : `=${trimmed}`;
    }
  }
  return null;
};

