import { z } from 'zod';
import { SUPPORTED_FIELD_DATA_TYPES } from '@/lib/agent/field-data-type';

export const fieldSchema = z.object({
  label: z.string().trim().min(1, 'Label is required'),
  dataType: z.enum(SUPPORTED_FIELD_DATA_TYPES as unknown as [string, ...string[]]),
  required: z.boolean(),
  enumOptions: z.array(z.string().trim().min(1)).optional(),
  referenceLibraries: z.array(z.string()).optional(),
});

export const sectionSchema = z.object({
  name: z.string().trim().min(1, 'Section name is required'),
  fields: z.array(fieldSchema).min(1, 'At least one field'),
});

