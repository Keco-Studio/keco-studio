'use client';

import {
  ButtonWithTooltip,
  activeEditor$,
  insertJsx$,
  useCellValue,
  usePublisher,
} from '@mdxeditor/editor';
import { $getSelection, $isRangeSelection } from 'lexical';
import { resourceReferenceAttributes, type ResourceReferenceTarget } from '@/lib/documents/resourceReferenceTypes';
import { DocumentReferenceIcon } from './DocumentReferenceIcon';
import {
  captureRangeSelection,
  restoreRangeSelection,
} from './resourceReferenceSelection';

export type ResourceReferenceInsertButtonProps = {
  readOnly: boolean;
  onOpen: (apply: (targets: ResourceReferenceTarget[]) => void) => void;
};

export function ResourceReferenceInsertButton({
  readOnly,
  onOpen,
}: ResourceReferenceInsertButtonProps) {
  const insertJsx = usePublisher(insertJsx$);
  const activeEditor = useCellValue(activeEditor$);

  return (
    <ButtonWithTooltip
      type="button"
      title="Insert reference"
      aria-label="Insert reference"
      disabled={readOnly}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (readOnly) return;
        const selection = captureRangeSelection(activeEditor);
        onOpen((targets) => {
          restoreRangeSelection(activeEditor, selection);
          targets.forEach((target, index) => {
            if (index > 0) {
              activeEditor?.update(() => {
                const current = $getSelection();
                if ($isRangeSelection(current)) current.insertText(' ');
              });
            }
            insertJsx({
              kind: 'text',
              name: 'ResourceReference',
              props: resourceReferenceAttributes(target),
            });
          });
        });
      }}
    >
      <DocumentReferenceIcon size={24} />
    </ButtonWithTooltip>
  );
}
