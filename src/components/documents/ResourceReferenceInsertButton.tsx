'use client';

import {
  ButtonWithTooltip,
  iconComponentFor$,
  insertJsx$,
  useCellValue,
  usePublisher,
} from '@mdxeditor/editor';
import { resourceReferenceAttributes, type ResourceReferenceTarget } from '@/lib/documents/resourceReferenceTypes';

export type ResourceReferenceInsertButtonProps = {
  readOnly: boolean;
  onOpen: (apply: (target: ResourceReferenceTarget) => void) => void;
};

export function ResourceReferenceInsertButton({
  readOnly,
  onOpen,
}: ResourceReferenceInsertButtonProps) {
  const iconComponentFor = useCellValue(iconComponentFor$);
  const insertJsx = usePublisher(insertJsx$);
  if (readOnly) return null;

  return (
    <ButtonWithTooltip
      type="button"
      title="Insert reference"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        onOpen((target) => {
          insertJsx({
            kind: 'text',
            name: 'ResourceReference',
            props: resourceReferenceAttributes(target),
          });
        });
      }}
    >
      {iconComponentFor('link')}
    </ButtonWithTooltip>
  );
}
