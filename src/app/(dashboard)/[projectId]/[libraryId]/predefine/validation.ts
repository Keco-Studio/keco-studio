import { z } from 'zod';

export const fieldSchema = z.object({
  label: z.string().trim().min(1, 'Label is required'),
  dataType: z.enum(['string', 'int', 'float', 'boolean', 'enum', 'date', 'image', 'file', 'reference']),
  required: z.boolean(),
  enumOptions: z.array(z.string().trim().min(1)).optional(),
});

export const sectionSchema = z.object({
  name: z.string().trim().min(1, 'Section name is required'),
  fields: z.array(fieldSchema).min(1, 'At least one field'),
});

