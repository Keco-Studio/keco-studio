import type { ComponentType } from 'react';
import {
  SANCTIONED_MDX_REGISTRY,
  type SanctionedComponentName,
  validateSanctionedMdxPropertyEdit,
} from './sanctionedMdx';

type SanctionedMdxEditorProps = {
  mdastNode: { name: string | null };
  descriptor: unknown;
};

type SanctionedMdxDescriptor = {
  name: string;
  kind: 'flow';
  props: Array<{
    name: string;
    type: 'string';
    required: boolean;
    allowedValues?: readonly string[];
  }>;
  hasChildren: boolean;
  Editor: ComponentType<SanctionedMdxEditorProps>;
  validateProperties: (
    values: Record<string, string>,
    previous: Record<string, string>
  ) => Record<string, string> | null;
};

const descriptor = (
  name: SanctionedComponentName,
  props: SanctionedMdxDescriptor['props'],
  Editor: ComponentType<SanctionedMdxEditorProps>,
  hasChildren = true
): SanctionedMdxDescriptor => ({
  name,
  kind: 'flow',
  props,
  hasChildren,
  Editor,
  validateProperties: (values) => validateSanctionedMdxPropertyEdit(name, values),
});

export function createSanctionedMdxDescriptors(
  Editor: ComponentType<SanctionedMdxEditorProps>
): SanctionedMdxDescriptor[] {
  return Object.entries(SANCTIONED_MDX_REGISTRY).map(([name, rule]) =>
    descriptor(
      name as SanctionedComponentName,
      rule.props.map((property) => ({
        name: property.name,
        type: 'string' as const,
        required: property.required,
        ...('allowedValues' in property
          ? { allowedValues: property.allowedValues }
          : {}),
      })),
      Editor,
      rule.hasChildren
    )
  );
}

export type { SanctionedMdxEditorProps };
