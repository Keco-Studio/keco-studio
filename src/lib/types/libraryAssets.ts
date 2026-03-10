export type LibrarySummary = {
  id: string;
  projectId: string;
  name: string;
  description?: string | null;
};

export type SectionConfig = {
  id: string;
  libraryId: string;
  name: string;
  orderIndex: number;
};

export type PropertyConfig = {
  id: string;
  sectionId: string;
  key: string;
  name: string;
  description?: string | null;
  valueType: 'string' | 'number' | 'boolean' | 'enum' | 'tag' | 'other';
  dataType?: 'string' | 'string_array' | 'int' | 'int_array' | 'float' | 'float_array' | 'boolean' | 'enum' | 'date' | 'image' | 'file' | 'reference' | 'multimedia' | 'audio' | 'formula';
  referenceLibraries?: string[]; // For reference type: which libraries can be referenced
  enumOptions?: string[]; // For enum type: available option values
  /** For formula type: raw expression text using column names and operators */
  formulaExpression?: string;
  orderIndex: number;
};

export type AssetRow = {
  id: string;
  libraryId: string;
  name: string;
  slug?: string | null;
  figmaNodeId?: string | null;
  propertyValues: Record<string, string | number | boolean | null>;
  created_at?: string; // ISO timestamp for ordering assets
  rowIndex?: number; // explicit row order per library
};


