export type FieldType = 'string' | 'int' | 'float' | 'boolean' | 'enum' | 'date';

export type FieldConfig = {
  id: string;
  label: string;
  dataType: FieldType;
  required: boolean;
  enumOptions?: string[];
};

export type SectionConfig = {
  id: string;
  name: string;
  fields: FieldConfig[];
};

export function uid() {
  return Math.random().toString(16).slice(2, 10);
}

