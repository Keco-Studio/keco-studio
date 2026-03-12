import type { FieldType } from './types';
import predefineTypeStrIcon from '@/assets/images/predefineTypeStrIcon.svg';
import predefineTypeIntIcon from '@/assets/images/predefineTypeIntIcon.svg';
import predefineTypeOptIcon from '@/assets/images/predefineTypeOptIcon.svg';
import predefineTypeRefIcon from '@/assets/images/predefineTypeRefIcon.svg';
import predefineTypeMediaIcon from '@/assets/images/predefineTypeMediaIcon.svg';
import predefineTypeBoolenIcon from '@/assets/images/predefineTypeBoolenIcon.svg';
import predefineTypeFloatIcon from '@/assets/images/predefineTypeFloatIcon_2.svg';
import predefineTypeFileIcon from '@/assets/images/predefineTypeFileIcon.svg';
import predefineTypeIntArrayIcon from '@/assets/images/predefineTypeIntArrayIcon.svg';
import predefineTypeFloatArrayIcon from '@/assets/images/predefineTypeFloatArrayIcon.svg';
import predefineTypeStringArrayIcon from '@/assets/images/predefineTypeStringArrayIcon.svg';
import predefineTypeMultimediaIcon from '@/assets/images/predefineTypeMultimediaIcon.svg';
import predefineTypeAudioIcon from '@/assets/images/predefineTypeAudioIcon.svg';
import predefineTypeFormulaIcon from '@/assets/images/predefineTypeFormulaIcon.svg';

export const getFieldTypeIcon = (dataType: FieldType) => {
  switch (dataType) {
    case 'string':
      return predefineTypeStrIcon;
    case 'string_array':
      return predefineTypeStringArrayIcon;
    case 'int':
      return predefineTypeIntIcon;
    case 'int_array':
      return predefineTypeIntArrayIcon;
    case 'float':
      return predefineTypeFloatIcon;
    case 'float_array':
      return predefineTypeFloatArrayIcon;
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
    case 'multimedia':
      return predefineTypeMultimediaIcon;
    case 'audio':
      return predefineTypeAudioIcon;
    case 'formula':
      return predefineTypeFormulaIcon;
    default:
      return predefineTypeRefIcon;
  }
};

export const FIELD_TYPE_OPTIONS = [
  { label: 'String', value: 'string' },
  { label: 'Int', value: 'int' },
  { label: 'Float', value: 'float' },
  { label: 'Formula', value: 'formula' },
  { label: 'Image', value: 'image' },
  { label: 'Reference', value: 'reference' },
  { label: 'Boolean', value: 'boolean' },
  { label: 'Option', value: 'enum' },
  { label: 'Int Array', value: 'int_array' },
  { label: 'Float Array', value: 'float_array' },
  { label: 'String Array', value: 'string_array' },
  { label: 'Audio', value: 'audio' },
  { label: 'Multimedia', value: 'multimedia' },
  { label: 'File', value: 'file' },
] as const;

