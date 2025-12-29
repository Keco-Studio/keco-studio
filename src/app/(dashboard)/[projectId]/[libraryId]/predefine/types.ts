export type FieldType = 'string' | 'int' | 'float' | 'boolean' | 'enum' | 'date' | 'image' | 'file' | 'reference';

export type FieldConfig = {
  id: string;
  label: string;
  dataType: FieldType;
  required: boolean;
  enumOptions?: string[];
  referenceLibraries?: string[]; // For reference type: which libraries can be referenced
};

export type SectionConfig = {
  id: string;
  name: string;
  fields: FieldConfig[];
};

export function uid() {
  return Math.random().toString(16).slice(2, 10);
}

