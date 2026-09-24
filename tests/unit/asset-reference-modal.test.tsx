/** @jest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssetReferenceModal } from '@/components/asset/AssetReferenceModal';

const getLibrarySchema = jest.fn();
const getLibraryAssetsWithProperties = jest.fn();

const librariesQuery = {
  in: jest.fn().mockResolvedValue({
    data: [{ id: 'library-1', name: 'Pokemon' }],
    error: null,
  }),
};
const supabase = {
  from: jest.fn(() => ({
    select: jest.fn(() => librariesQuery),
  })),
};

jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => supabase }));
jest.mock('@/lib/services/libraryAssetsService', () => ({
  getLibrarySchema: (...args: unknown[]) => getLibrarySchema(...args),
  getLibraryAssetsWithProperties: (...args: unknown[]) => getLibraryAssetsWithProperties(...args),
}));
jest.mock('next/image', () => function MockImage() {
  return null;
});
jest.mock('@ant-design/icons', () => ({
  CloseOutlined: () => <span aria-hidden="true">x</span>,
  SearchOutlined: () => <span aria-hidden="true">search</span>,
}));
jest.mock('antd', () => {
  const Select = ({ value, onChange, children, ...props }: Record<string, any>) => (
    <select
      aria-label="Reference table"
      value={value ?? ''}
      onChange={(event) => onChange?.(event.target.value)}
      disabled={props.disabled}
    >
      {children}
    </select>
  );
  const SelectOption = ({ value, label }: Record<string, any>) => (
    <option value={value}>{label}</option>
  );
  Select.Option = SelectOption;

  return {
    Checkbox: (props: Record<string, any>) => (
      <input
        type="checkbox"
        checked={Boolean(props.checked)}
        onChange={props.onChange}
      />
    ),
    Input: ({ prefix: _prefix, ...props }: Record<string, any>) => <input {...props} />,
    Select,
    Spin: () => <span>Loading</span>,
  };
});

const fields = [
  { id: 'field-name', name: 'Name', orderIndex: 0 },
  { id: 'field-status', name: 'Status', orderIndex: 1 },
  { id: 'field-notes', name: 'Notes', orderIndex: 2 },
];
const rows = [
  {
    id: 'asset-1',
    name: 'Fallback one',
    libraryId: 'library-1',
    propertyValues: { 'field-name': 'Bulbasaur', 'field-status': 'Ready', 'field-notes': '' },
  },
  {
    id: 'asset-2',
    name: 'Fallback two',
    libraryId: 'library-1',
    propertyValues: {
      'field-name': 'Charmander',
      'field-status': 'Blocked',
      'field-notes': 'Fire type',
    },
  },
];

describe('AssetReferenceModal cell selection', () => {
  beforeEach(() => {
    getLibrarySchema.mockReset().mockResolvedValue({ properties: fields });
    getLibraryAssetsWithProperties.mockReset().mockResolvedValue(rows);
  });

  afterEach(() => {
    cleanup();
  });

  it('applies the exact source cell selected by click', async () => {
    const onApply = jest.fn();

    render(
      <AssetReferenceModal
        open
        referenceLibraries={['library-1']}
        onClose={jest.fn()}
        onApply={onApply}
      />
    );

    const statusCell = await screen.findByRole('gridcell', {
      name: 'Charmander, Status: Blocked',
    });
    fireEvent.click(statusCell);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith([
      {
        assetId: 'asset-2',
        fieldId: 'field-status',
        fieldLabel: 'Status',
        displayValue: 'Blocked',
      },
    ]));
  });

  it('selects a cell through the full pointer event sequence', async () => {
    const user = userEvent.setup();
    render(
      <AssetReferenceModal
        open
        referenceLibraries={['library-1']}
        onClose={jest.fn()}
        onApply={jest.fn()}
      />
    );

    const statusCell = await screen.findByRole('gridcell', {
      name: 'Charmander, Status: Blocked',
    });
    await user.click(statusCell);

    expect(statusCell.getAttribute('aria-selected')).toBe('true');
  });

  it('toggles multiple cells through ordinary point selection', async () => {
    const user = userEvent.setup();
    const onApply = jest.fn();
    render(
      <AssetReferenceModal
        open
        referenceLibraries={['library-1']}
        onClose={jest.fn()}
        onApply={onApply}
      />
    );

    const nameCell = await screen.findByRole('gridcell', {
      name: 'Bulbasaur, Name: Bulbasaur',
    });
    const statusCell = screen.getByRole('gridcell', {
      name: 'Charmander, Status: Blocked',
    });

    await user.click(nameCell);
    await user.click(statusCell);
    expect(nameCell.getAttribute('aria-selected')).toBe('true');
    expect(statusCell.getAttribute('aria-selected')).toBe('true');

    await user.click(nameCell);
    expect(nameCell.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith([{
      assetId: 'asset-2',
      fieldId: 'field-status',
      fieldLabel: 'Status',
      displayValue: 'Blocked',
    }]);
  });

  it('applies every non-empty cell in a dragged rectangle', async () => {
    const onApply = jest.fn();

    render(
      <AssetReferenceModal
        open
        referenceLibraries={['library-1']}
        onClose={jest.fn()}
        onApply={onApply}
      />
    );

    const startCell = await screen.findByRole('gridcell', {
      name: 'Bulbasaur, Name: Bulbasaur',
    });
    const endCell = screen.getByRole('gridcell', {
      name: 'Charmander, Status: Blocked',
    });

    fireEvent.mouseDown(startCell, { button: 0 });
    fireEvent.mouseEnter(endCell, { buttons: 1 });
    fireEvent.mouseUp(endCell, { button: 0 });
    fireEvent.click(endCell);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(onApply).toHaveBeenCalledWith([
      {
        assetId: 'asset-1',
        fieldId: 'field-name',
        fieldLabel: 'Name',
        displayValue: 'Bulbasaur',
      },
      {
        assetId: 'asset-1',
        fieldId: 'field-status',
        fieldLabel: 'Status',
        displayValue: 'Ready',
      },
      {
        assetId: 'asset-2',
        fieldId: 'field-name',
        fieldLabel: 'Name',
        displayValue: 'Charmander',
      },
      {
        assetId: 'asset-2',
        fieldId: 'field-status',
        fieldLabel: 'Status',
        displayValue: 'Blocked',
      },
    ]));
  });

  it('presents cell-only selection affordances', async () => {
    render(
      <AssetReferenceModal
        open
        referenceLibraries={['library-1']}
        onClose={jest.fn()}
        onApply={jest.fn()}
      />
    );

    await screen.findByRole('grid', { name: 'Reference cells' });
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('Select cells by clicking or dragging.')).toBeTruthy();
    expect(screen.getByRole('gridcell', {
      name: 'Bulbasaur, Name: Bulbasaur',
    }).textContent).toBe('Bulbasaur');
  });

  it('closes from the header close button', async () => {
    const onClose = jest.fn();
    render(
      <AssetReferenceModal
        open
        referenceLibraries={['library-1']}
        onClose={onClose}
        onApply={jest.fn()}
      />
    );

    await screen.findByRole('grid', { name: 'Reference cells' });
    fireEvent.click(screen.getByRole('button', { name: 'Close reference picker' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('refreshes an existing cell reference with its current source value on apply', async () => {
    const onApply = jest.fn();
    render(
      <AssetReferenceModal
        open
        value={[{
          assetId: 'asset-2',
          fieldId: 'field-status',
          fieldLabel: 'Status',
          displayValue: 'Old status',
        }]}
        referenceLibraries={['library-1']}
        onClose={jest.fn()}
        onApply={onApply}
      />
    );

    const statusCell = await screen.findByRole('gridcell', {
      name: 'Charmander, Status: Blocked',
    });
    expect(statusCell.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith([{
      assetId: 'asset-2',
      fieldId: 'field-status',
      fieldLabel: 'Status',
      displayValue: 'Blocked',
    }]);
  });

  it('maps a legacy asset-only reference to the first field cell', async () => {
    const onApply = jest.fn();
    render(
      <AssetReferenceModal
        open
        value={['asset-1']}
        referenceLibraries={['library-1']}
        onClose={jest.fn()}
        onApply={onApply}
      />
    );

    const nameCell = await screen.findByRole('gridcell', {
      name: 'Bulbasaur, Name: Bulbasaur',
    });
    expect(nameCell.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith([{
      assetId: 'asset-1',
      fieldId: 'field-name',
      fieldLabel: 'Name',
      displayValue: 'Bulbasaur',
    }]);
  });

  it('adds and removes individual cells with a modifier click', async () => {
    const onApply = jest.fn();
    render(
      <AssetReferenceModal
        open
        referenceLibraries={['library-1']}
        onClose={jest.fn()}
        onApply={onApply}
      />
    );

    const nameCell = await screen.findByRole('gridcell', {
      name: 'Bulbasaur, Name: Bulbasaur',
    });
    const statusCell = screen.getByRole('gridcell', {
      name: 'Charmander, Status: Blocked',
    });

    fireEvent.click(nameCell);
    fireEvent.click(statusCell, { ctrlKey: true });
    fireEvent.click(nameCell, { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith([{
      assetId: 'asset-2',
      fieldId: 'field-status',
      fieldLabel: 'Status',
      displayValue: 'Blocked',
    }]);
  });

  it('does not select an empty source cell', async () => {
    const onApply = jest.fn();
    render(
      <AssetReferenceModal
        open
        referenceLibraries={['library-1']}
        onClose={jest.fn()}
        onApply={onApply}
      />
    );

    const emptyCell = await screen.findByRole('gridcell', {
      name: 'Bulbasaur, Notes: Empty',
    });
    expect(emptyCell.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(emptyCell);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('modifier-click removes a legacy reference from its resolved first-field cell', async () => {
    const onApply = jest.fn();
    render(
      <AssetReferenceModal
        open
        value={['asset-1']}
        referenceLibraries={['library-1']}
        onClose={jest.fn()}
        onApply={onApply}
      />
    );

    const nameCell = await screen.findByRole('gridcell', {
      name: 'Bulbasaur, Name: Bulbasaur',
    });
    fireEvent.click(nameCell, { ctrlKey: true });
    expect(nameCell.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('uses an empty cell as a drag boundary without selecting the empty value', async () => {
    const onApply = jest.fn();
    render(
      <AssetReferenceModal
        open
        referenceLibraries={['library-1']}
        onClose={jest.fn()}
        onApply={onApply}
      />
    );

    const startCell = await screen.findByRole('gridcell', {
      name: 'Bulbasaur, Name: Bulbasaur',
    });
    const emptyEndCell = screen.getByRole('gridcell', {
      name: 'Bulbasaur, Notes: Empty',
    });

    fireEvent.mouseDown(startCell, { button: 0 });
    fireEvent.mouseEnter(emptyEndCell, { buttons: 1 });
    fireEvent.mouseUp(emptyEndCell, { button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith([
      {
        assetId: 'asset-1',
        fieldId: 'field-name',
        fieldLabel: 'Name',
        displayValue: 'Bulbasaur',
      },
      {
        assetId: 'asset-1',
        fieldId: 'field-status',
        fieldLabel: 'Status',
        displayValue: 'Ready',
      },
    ]);
  });

  it('continues a drag selection by scrolling when the pointer reaches the table edge', async () => {
    const onApply = jest.fn();
    const requestAnimationFrame = jest.spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => window.setTimeout(callback, 0));
    const cancelAnimationFrame = jest.spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((frame) => window.clearTimeout(frame));
    const originalElementFromPoint = document.elementFromPoint;
    const elementFromPoint = jest.fn();
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: elementFromPoint,
    });

    render(
      <AssetReferenceModal
        open
        referenceLibraries={['library-1']}
        onClose={jest.fn()}
        onApply={onApply}
      />
    );

    const startCell = await screen.findByRole('gridcell', {
      name: 'Bulbasaur, Name: Bulbasaur',
    });
    const endCell = screen.getByRole('gridcell', {
      name: 'Charmander, Status: Blocked',
    });
    const tableWrap = startCell.closest('table')?.parentElement;
    expect(tableWrap).not.toBeNull();
    Object.defineProperties(tableWrap!, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 600 },
    });
    jest.spyOn(tableWrap!, 'getBoundingClientRect').mockReturnValue({
      bottom: 200,
      height: 200,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    elementFromPoint.mockReturnValue(endCell);

    fireEvent.mouseDown(startCell, { button: 0 });
    fireEvent.mouseMove(document, { buttons: 1, clientX: 80, clientY: 199 });

    await waitFor(() => expect(tableWrap!.scrollTop).toBeGreaterThan(0));
    fireEvent.mouseUp(document, { button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ assetId: 'asset-2', fieldId: 'field-status' }),
    ]));

    requestAnimationFrame.mockRestore();
    cancelAnimationFrame.mockRestore();
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: originalElementFromPoint,
    });
  });
});
