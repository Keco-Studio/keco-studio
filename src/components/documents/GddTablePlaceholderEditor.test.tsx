/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { GddTablePlaceholderEditor } from './GddTablePlaceholderEditor';

jest.mock('./MdxDocumentEditor.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));

function node(tableName: string) {
  return {
    type: 'mdxJsxFlowElement' as const,
    name: 'GddTablePlaceholder',
    attributes: [{ type: 'mdxJsxAttribute' as const, name: 'tableName', value: tableName }],
    children: [],
  };
}

describe('GddTablePlaceholderEditor', () => {
  it('shows only a neutral table name while async materialization is pending', () => {
    render(<GddTablePlaceholderEditor mdastNode={node('Skills')} />);

    expect(screen.getByLabelText('Table pending: Skills')).toBeTruthy();
    expect(screen.getByText('Skills')).toBeTruthy();
    expect(screen.queryByText('Reference unavailable')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
