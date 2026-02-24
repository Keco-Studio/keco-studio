import type { FieldType } from './types';
import predefineTypeStrIcon from '@/assets/images/predefineTypeStrIcon.svg';
import predefineTypeIntIcon from '@/assets/images/predefineTypeIntIcon.svg';
import predefineTypeOptIcon from '@/assets/images/predefineTypeOptIcon.svg';
import predefineTypeRefIcon from '@/assets/images/predefineTypeRefIcon.svg';
import predefineTypeMediaIcon from '@/assets/images/predefineTypeMediaIcon.svg';
import predefineTypeBoolenIcon from '@/assets/images/predefineTypeBoolenIcon.svg';
import predefineTypeFloatIcon from '@/assets/images/predefineTypeFloatIcon.svg';
import predefineTypeFileIcon from '@/assets/images/predefineTypeFileIcon.svg';

export const getFieldTypeIcon = (dataType: FieldType) => {
  switch (dataType) {
    case 'string':
      return predefineTypeStrIcon;
    case 'int':
      return predefineTypeIntIcon;
    case 'float':
      return predefineTypeFloatIcon;
    case 'enum':
      return predefineTypeOptIcon;
    case 'reference':
      return predefineTypeRefIcon;
    case 'image':
      return predefineTypeMediaIcon;
    case 'file':
      return predefineTypeFileIcon;
    case 'boolean':
      return predefineTypeBoolenIcon;
    default:
      return predefineTypeRefIcon;
  }
};

export const FIELD_TYPE_OPTIONS = [
  { label: 'String', value: 'string' },
  { label: 'Option', value: 'enum' },
  { label: 'Image', value: 'image' },
  { label: 'File', value: 'file' },
  { label: 'Boolean', value: 'boolean' },
  { label: 'Reference', value: 'reference' },
  { label: 'Int', value: 'int' },
  { label: 'Float', value: 'float' },
] as const;

