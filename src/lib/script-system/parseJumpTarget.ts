/** Extract Jump label from a Next/Commands cell (aligned with scriptPlayer). */
export function parseJumpTarget(value: string): string | undefined {
  return value.match(/\bJump\s+([A-Za-z][A-Za-z0-9_-]*)\b/i)?.[1];
}
