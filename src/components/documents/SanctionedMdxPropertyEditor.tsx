import type { ComponentType } from 'react';
import { validateSanctionedMdxPropertyEdit } from '@/lib/documents/sanctionedMdx';

export type SanctionedMdxPropertyEditorControlProps = {
  properties: Record<string, string>;
  title: string;
  onChange: (values: Record<string, string>) => void;
};

type SanctionedMdxPropertyEditorProps =
  SanctionedMdxPropertyEditorControlProps & {
    PropertyEditorComponent: ComponentType<SanctionedMdxPropertyEditorControlProps>;
  };

export function SanctionedMdxPropertyEditor({
  properties,
  title,
  onChange,
  PropertyEditorComponent,
}: SanctionedMdxPropertyEditorProps) {
  return (
    <PropertyEditorComponent
      properties={properties}
      title={title}
      onChange={(values) => {
        const validated = validateSanctionedMdxPropertyEdit(title, values);
        if (validated) onChange(validated);
      }}
    />
  );
}
