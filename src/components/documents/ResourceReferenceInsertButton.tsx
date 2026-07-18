'use client';

import { PaperClipOutlined } from '@ant-design/icons';
import {
  ButtonWithTooltip,
  activeEditor$,
  insertJsx$,
  useCellValue,
  usePublisher,
} from '@mdxeditor/editor';
import { resourceReferenceAttributes, type ResourceReferenceTarget } from '@/lib/documents/resourceReferenceTypes';
import {
  captureRangeSelection,
  restoreRangeSelection,
} from './resourceReferenceSelection';

export type ResourceReferenceInsertButtonProps = {
  readOnly: boolean;
  onOpen: (apply: (target: ResourceReferenceTarget) => void) => void;
};

export function ResourceReferenceInsertButton({
  readOnly,
  onOpen,
}: ResourceReferenceInsertButtonProps) {
  const insertJsx = usePublisher(insertJsx$);
  const activeEditor = useCellValue(activeEditor$);
  if (readOnly) return null;

  return (
    <ButtonWithTooltip
      type="button"
      title="Insert reference"
      aria-label="Insert reference"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        const selection = captureRangeSelection(activeEditor);
        onOpen((target) => {
          restoreRangeSelection(activeEditor, selection);
          insertJsx({
            kind: 'text',
            name: 'ResourceReference',
            props: resourceReferenceAttributes(target),
          });
        });
      }}
    >
      <PaperClipOutlined aria-hidden />
    </ButtonWithTooltip>
  );
}
