import { z } from 'zod';

function codePointLengthUpTo(value: string, maximum: number): number {
  let length = 0;
  for (const _codePoint of value) {
    length += 1;
    if (length > maximum) break;
  }
  return length;
}

export function codePointBoundedString(minimum: number, maximum: number) {
  return z.string().superRefine((value, refinement) => {
    const length = codePointLengthUpTo(value, maximum);
    if (length < minimum) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: `String must contain at least ${minimum} character(s).`,
      });
    }
    if (length > maximum) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: `String must contain at most ${maximum} character(s).`,
      });
    }
  });
}
