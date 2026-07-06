/**
 * Pure helpers for the import_script LLM pipeline: output sanitation and
 * structural validation. Kept dependency-free so they are trivially testable.
 */

export interface ValidatableLine {
  label: string;
  option0_next?: string;
  option1_next?: string;
  option2_next?: string;
}

export interface ValidatableScript {
  lines: ValidatableLine[];
}

/** Strip markdown code fences the LLM may wrap around the script. */
export function sanitizeLlmOutput(raw: string): string {
  return raw
    .replace(/^```[a-zA-Z]*\s*\n/m, '')
    .replace(/\n```\s*$/m, '')
    .trim();
}

/** Returns a list of human-readable structural errors (empty when valid). */
export function validateScriptStructure(script: ValidatableScript): string[] {
  const errors: string[] = [];
  const labels = new Set<string>();
  for (const line of script.lines) {
    if (line.label) labels.add(line.label.trim());
  }
  // Branch labels must use letter O + digit, never 0 + digit (e.g. 01 vs O1).
  // Pure numeric scene IDs (004, 003) are allowed.
  for (const line of script.lines) {
    const label = (line.label ?? '').trim();
    if (/^0\d/.test(label) && !/^\d{3,}$/.test(label)) {
      errors.push(`Label "${line.label}" looks like it uses zero (0) instead of letter O.`);
    }
  }
  // Option jump targets must reference an existing label.
  for (const line of script.lines) {
    for (const next of [line.option0_next, line.option1_next, line.option2_next]) {
      const target = (next || '').trim();
      if (target && !labels.has(target)) {
        errors.push(`Option jump target "${target}" has no matching label.`);
      }
    }
  }
  return errors;
}
