import { renderToStaticMarkup } from 'react-dom/server';
import {
  SanctionedMdxPropertyEditor,
  type SanctionedMdxPropertyEditorControlProps,
} from '@/components/documents/SanctionedMdxPropertyEditor';

function renderPropertyEdit(
  title: string,
  values: Record<string, string>
) {
  const downstream = jest.fn();
  const PropertyEditorComponent = ({
    onChange,
  }: SanctionedMdxPropertyEditorControlProps) => {
    onChange(values);
    return <span>property editor</span>;
  };

  renderToStaticMarkup(
    <SanctionedMdxPropertyEditor
      properties={
        title === 'Callout'
          ? { type: 'note', title: 'Original' }
          : { summary: 'Original' }
      }
      title={title}
      onChange={downstream}
      PropertyEditorComponent={PropertyEditorComponent}
    />
  );
  return downstream;
}

describe('SanctionedMdxPropertyEditor', () => {
  it.each([
    ['Callout', { type: 'danger', title: 'Changed' }],
    ['Callout', { type: '', title: 'Changed' }],
    ['Details', { summary: '' }],
  ] as const)('does not emit invalid %s property edits', (title, values) => {
    expect(renderPropertyEdit(title, values)).not.toHaveBeenCalled();
  });

  it('omits empty optional properties from valid Callout edits', () => {
    expect(renderPropertyEdit('Callout', { type: 'success', title: '' })).toHaveBeenCalledWith({
      type: 'success',
    });
  });

  it('emits valid required Details properties', () => {
    expect(renderPropertyEdit('Details', { summary: 'Changed' })).toHaveBeenCalledWith({
      summary: 'Changed',
    });
  });
});
