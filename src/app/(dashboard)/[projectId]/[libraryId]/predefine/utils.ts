import type { FieldType } from './types';
import predefineTypeStrIcon from '@/app/assets/images/predefineTypeStrIcon.svg';
import predefineTypeIntIcon from '@/app/assets/images/predefineTypeIntIcon.svg';
import predefineTypeOptIcon from '@/app/assets/images/predefineTypeOptIcon.svg';
import predefineTypeRefIcon from '@/app/assets/images/predefineTypeRefIcon.svg';

export const getFieldTypeIcon = (dataType: FieldType) => {
  switch (dataType) {
    case 'string':
      return predefineTypeStrIcon;
    case 'int':
    case 'float':
      return predefineTypeIntIcon;
    case 'enum':
      return predefineTypeOptIcon;
    default:
      return predefineTypeRefIcon;
  }
};

export const FIELD_TYPE_OPTIONS = [
  { label: 'String', value: 'string' },
  { label: 'Int', value: 'int' },
  { label: 'Float', value: 'float' },
  { label: 'Boolean', value: 'boolean' },
  { label: 'Enum', value: 'enum' },
  { label: 'Date', value: 'date' },
] as const;

