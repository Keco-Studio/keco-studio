import {
  add as mathAdd,
  subtract as mathSubtract,
  multiply as mathMultiply,
  divide as mathDivide,
  sum as mathSum,
  mean as mathMean,
  min as mathMin,
  max as mathMax,
  round as mathRound,
} from 'mathjs';

export type FormulaEvaluableField = {
  id: string;
  name: string;
  dataType?: string | null;
  formulaExpression?: string | null;
};

type FormulaToken =
  | { type: 'number'; value: number }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: '+' | '-' | '*' | '/' }
  | { type: 'paren'; value: '(' | ')' };

const OP_PRECEDENCE: Record<'+' | '-' | '*' | '/', number> = {
  '+': 1,
  '-': 1,
  '*': 2,
  '/': 2,
};

const FORMULA_DECIMAL_DIGITS = 4;

function roundFormulaNumber(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Number(mathRound(n, FORMULA_DECIMAL_DIGITS));
}

function isIdentStart(ch: string): boolean {
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    ch === '_' ||
    ch === '$'
  );
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}

function tokenizeFormula(expr: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  const s = expr.trim();
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    // [Column Name]
    if (ch === '[') {
      const end = s.indexOf(']', i + 1);
      if (end === -1) return [];
      const inside = s.slice(i + 1, end).trim();
      if (!inside) return [];
      tokens.push({ type: 'identifier', value: inside });
      i = end + 1;
      continue;
    }

    // 123 / 12.3 / .5
    if ((ch >= '0' && ch <= '9') || (ch === '.' && i + 1 < s.length && s[i + 1] >= '0' && s[i + 1] <= '9')) {
      const start = i;
      i += 1;
      while (i < s.length && ((s[i] >= '0' && s[i] <= '9') || s[i] === '.')) i += 1;
      const num = Number(s.slice(start, i));
      if (Number.isNaN(num)) return [];
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // bare identifier: amount + tax
    if (isIdentStart(ch)) {
      const start = i;
      i += 1;
      while (i < s.length && isIdentPart(s[i])) i += 1;
      tokens.push({ type: 'identifier', value: s.slice(start, i) });
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

    return [];
  }

  return tokens;
}

function toRpn(tokens: FormulaToken[]): FormulaToken[] {
  const output: FormulaToken[] = [];
  const stack: FormulaToken[] = [];

  for (const token of tokens) {
    if (token.type === 'number' || token.type === 'identifier') {
      output.push(token);
      continue;
    }

    if (token.type === 'operator') {
      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (
          top.type === 'operator' &&
          OP_PRECEDENCE[top.value] >= OP_PRECEDENCE[token.value]
        ) {
          output.push(stack.pop() as FormulaToken);
        } else {
          break;
        }
      }
      stack.push(token);
      continue;
    }

    if (token.type === 'paren' && token.value === '(') {
      stack.push(token);
      continue;
    }

    if (token.type === 'paren' && token.value === ')') {
      let foundLeft = false;
      while (stack.length > 0) {
        const top = stack.pop() as FormulaToken;
        if (top.type === 'paren' && top.value === '(') {
          foundLeft = true;
          break;
        }
        output.push(top);
      }
      if (!foundLeft) return [];
    }
  }

  while (stack.length > 0) {
    const top = stack.pop() as FormulaToken;
    if (top.type === 'paren') return [];
    output.push(top);
  }

  return output;
}

function evalRpn(
  rpn: FormulaToken[],
  resolveIdentifier: (name: string) => number | null
): number | null {
  const stack: number[] = [];

  for (const token of rpn) {
    if (token.type === 'number') {
      stack.push(token.value);
      continue;
    }

    if (token.type === 'identifier') {
      const v = resolveIdentifier(token.value);
      if (v === null || Number.isNaN(v) || !Number.isFinite(v)) return null;
      stack.push(v);
      continue;
    }

    if (token.type === 'operator') {
      if (stack.length < 2) return null;
      const b = stack.pop() as number;
      const a = stack.pop() as number;

      let result: number;
      if (token.value === '+') result = Number(mathAdd(a, b));
      else if (token.value === '-') result = Number(mathSubtract(a, b));
      else if (token.value === '*') result = Number(mathMultiply(a, b));
      else {
        if (b === 0) return null;
        result = Number(mathDivide(a, b));
      }

      if (Number.isNaN(result) || !Number.isFinite(result)) return null;
      stack.push(roundFormulaNumber(result));
    }
  }

  if (stack.length !== 1) return null;
  return stack[0];
}

/**
 * 在一行数据上计算单个公式字段的值。
 *
 * 规则：
 * 1. 先尝试使用简单的加减乘除解析器（tokenizeFormula + toRpn + evalRpn），兼容纯算术表达式；
 * 2. 如果算不出结果，再使用“高级公式引擎”：
 *    - 支持列名直接书写或 [Column Name] 形式；
 *    - 支持 IF、SUM、AVERAGE、MIN、MAX、ROUND、比较运算符等；
 *    - 支持公式列之间的相互引用，并避免循环引用。
 */
function evaluateFormulaForRowInternal(
  expression: string | null | undefined,
  fields: FormulaEvaluableField[],
  propertyValues: Record<string, any>,
  visited: Set<string> = new Set()
): any | null {
  if (!expression || !expression.trim()) return null;

  const trimmedExpr = expression.trim().startsWith('=')
    ? expression.trim().slice(1)
    : expression.trim();

  const propertyByName = new Map<string, FormulaEvaluableField>();
  for (const field of fields) {
    if (field.name) propertyByName.set(field.name, field);
  }

  const resolveFieldValue = (field: FormulaEvaluableField): any | null => {
    if (!field.id) return null;

    if (field.dataType === 'formula') {
      if (visited.has(field.id)) return null;
      const nextVisited = new Set(visited);
      nextVisited.add(field.id);
      if (!field.formulaExpression || typeof field.formulaExpression !== 'string') {
        return null;
      }
      return evaluateFormulaForRowInternal(
        field.formulaExpression,
        fields,
        propertyValues,
        nextVisited
      );
    }

    const raw = propertyValues[field.id];
    if (raw === null || raw === undefined || raw === '') return null;
    return raw;
  };

  // 1) 优先尝试简单四则运算解析（仅在 tokenize 成功时使用）
  const tokens = tokenizeFormula(trimmedExpr);
  if (tokens.length > 0) {
    const rpn = toRpn(tokens);
    if (rpn.length > 0) {
      const numericValue = evalRpn(rpn, (name) => {
        const field = propertyByName.get(name);
        if (!field) return null;
        const raw = resolveFieldValue(field);
        if (raw === null || raw === undefined || raw === '') return null;
        if (typeof raw === 'number') {
          return Number.isNaN(raw) ? null : raw;
        }
        const num = Number(raw);
        return Number.isNaN(num) ? null : num;
      });
      if (numericValue !== null) {
        return roundFormulaNumber(numericValue);
      }
    }
  }

  // 2) 回退到高级公式引擎（支持 IF/SUM/比较等）
  try {
    const helper = {
      IF: (condition: any, whenTrue: any, whenFalse: any) =>
        condition ? whenTrue : whenFalse,
      SUM: (...args: any[]) =>
        (() => {
          const nums = args
            .map((v) => Number(v))
            .filter((n) => Number.isFinite(n));
          if (nums.length === 0) return 0;
          return Number(mathSum(nums));
        })(),
      AVERAGE: (...args: any[]) => {
        const nums = args
          .map((v) => Number(v))
          .filter((n) => Number.isFinite(n));
        if (nums.length === 0) return null;
        return Number(mathMean(nums));
      },
      MIN: (...args: any[]) => {
        const nums = args
          .map((v) => Number(v))
          .filter((n) => Number.isFinite(n));
        return nums.length ? Number(mathMin(nums)) : null;
      },
      MAX: (...args: any[]) => {
        const nums = args
          .map((v) => Number(v))
          .filter((n) => Number.isFinite(n));
        return nums.length ? Number(mathMax(nums)) : null;
      },
      ROUND: (value: any, digits: any) => {
        const n = Number(value);
        const d = Number(digits);
        if (!Number.isFinite(n) || !Number.isFinite(d)) return null;
        return Number(mathRound(n, d));
      },
      COL: (name: string) => {
        const field = propertyByName.get(name);
        if (!field) return null;
        const raw = resolveFieldValue(field);
        if (raw === null || raw === undefined || raw === '') return null;
        if (typeof raw === 'number') {
          return Number.isNaN(raw) ? null : raw;
        }
        const num = Number(raw);
        return Number.isNaN(num) ? raw : num;
      },
    } as const;

    const columnNames = Array.from(propertyByName.keys()).sort(
      (a, b) => b.length - a.length
    );

    let jsExpr = trimmedExpr;
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

    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'helper',
      `const { IF, SUM, AVERAGE, MIN, MAX, ROUND, COL } = helper; return (${jsExpr});`
    );
    const result = fn(helper);
    if (result === undefined) return null;
    if (typeof result === 'number') {
      return roundFormulaNumber(result);
    }
    return result;
  } catch {
    return null;
  }
}

export function computeFormulaValuesForRow(
  fields: FormulaEvaluableField[],
  propertyValues: Record<string, any>
): Record<string, any | null> {
  const byName = new Map<string, FormulaEvaluableField>();
  for (const field of fields) {
    if (field.name) byName.set(field.name, field);
  }

  const result: Record<string, any | null> = {};
  const formulaFields = fields.filter((f) => f.dataType === 'formula');

  for (const formulaField of formulaFields) {
    const computed = evaluateFormulaForRowInternal(
      formulaField.formulaExpression ?? null,
      fields,
      propertyValues
    );
    result[formulaField.id] = computed;
  }

  return result;
}
