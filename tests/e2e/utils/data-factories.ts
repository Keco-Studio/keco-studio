export function uniqueEmail(prefix: string = 'e2e'): string {
  const ts = Date.now();
  const rand = Math.random().toString(16).slice(2);
  return `${prefix}-${ts}-${rand}@example.com`;
}

export function uniqueName(prefix: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(16).slice(2, 8);
  return `${prefix}-${ts}-${rand}`;
}


