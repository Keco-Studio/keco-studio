import type { ReactElement, ReactNode } from 'react';
import { act, useEffect } from 'react';
import type { Root } from 'react-dom/client';
import {
  resourceReferenceKey,
  type ResourceReferenceTarget,
} from '@/lib/documents/resourceReferenceTypes';

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OPEN_DOCUMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LIBRARY_A = '11111111-1111-4111-8111-111111111111';
const LIBRARY_B = '22222222-2222-4222-8222-222222222222';
const ASSET_A = '33333333-3333-4333-8333-333333333333';
const ASSET_B = '44444444-4444-4444-8444-444444444444';
const FIELD_STATUS = '55555555-5555-4555-8555-555555555555';
const FIELD_EMPTY = '66666666-6666-4666-8666-666666666666';
const DOCUMENT_A = '77777777-7777-4777-8777-777777777777';
const DOCUMENT_B = '88888888-8888-4888-8888-888888888888';
const HEADING_BLOCK = '99999999-9999-4999-8999-999999999999';
const PARAGRAPH_BLOCK = 'abababab-abab-4bab-8bab-abababababab';

const listTableReferenceSources = jest.fn();
const listTableReferenceRows = jest.fn();
const listDocumentReferenceSources = jest.fn();
const listDocumentReferenceBlocks = jest.fn();
const resolveResourceReferences = jest.fn();
const supabase = { from: jest.fn() };
const insertJsx = jest.fn();
let toolbarButtonProps: AnyProps | undefined;

type AnyProps = Record<string, any>;
const ui: {
  modal?: AnyProps;
  tabs?: AnyProps;
  selects: Map<string, AnyProps>;
  inputs: Map<string, AnyProps>;
  lists: Map<string, AnyProps>;
  rows: Map<string, ReactElement<AnyProps>[]>;
  alerts: AnyProps[];
  spins: AnyProps[];
  preview?: AnyProps;
} = {
  selects: new Map(),
  inputs: new Map(),
  lists: new Map(),
  rows: new Map(),
  alerts: [],
  spins: [],
};

jest.mock('@/lib/SupabaseContext', () => ({ useSupabase: () => supabase }));
jest.mock('next/image', () => {
  function MockImage(props: AnyProps) {
    return null;
  }
  return MockImage;
});
jest.mock('@/assets/images/reference.svg', () => 'reference.svg', { virtual: true });
jest.mock('@mdxeditor/editor', () => ({
  ButtonWithTooltip: (props: AnyProps) => {
    toolbarButtonProps = props;
    return null;
  },
  activeEditor$: {},
  insertJsx$: {},
  useCellValue: () => null,
  usePublisher: () => insertJsx,
}));
jest.mock('@/components/documents/ResourceReferencePickerModal.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));
jest.mock('@/components/documents/ResourceReferenceTableRowList', () => ({
  ResourceReferenceTableRowList: (props: AnyProps) => {
    const React = jest.requireActual<typeof import('react')>('react');
    ui.lists.set(props.ariaLabel, props);
    ui.rows.set(props.ariaLabel, props.items.map((item: { id: string; label: string }) => {
      const selected = props.selectedIds.has(item.id);
      return React.createElement(
        'div',
        {
          id: `${props.idPrefix}-${item.id}`,
          role: 'option',
          tabIndex: -1,
          'aria-label': `Row: ${item.label}`,
          'aria-selected': selected,
          'aria-checked': selected,
          'data-label': item.label,
          onClick: () => props.onToggle(item.id),
        },
        item.label
      );
    }));
    return null;
  },
}));
jest.mock('@/components/documents/DocumentReferencePreview', () => ({
  DocumentReferencePreview: (props: AnyProps) => {
    ui.preview = props;
    return null;
  },
}));
jest.mock('@/lib/documents/resourceReferenceService', () => ({
  listTableReferenceSources: (...args: unknown[]) => listTableReferenceSources(...args),
  listTableReferenceRows: (...args: unknown[]) => listTableReferenceRows(...args),
  listDocumentReferenceSources: (...args: unknown[]) => listDocumentReferenceSources(...args),
  listDocumentReferenceBlocks: (...args: unknown[]) => listDocumentReferenceBlocks(...args),
  resolveResourceReferences: (...args: unknown[]) => resolveResourceReferences(...args),
}));
jest.mock('@ant-design/icons', () => ({
  FileTextOutlined: () => null,
  LinkOutlined: () => null,
  TableOutlined: () => null,
  PaperClipOutlined: function PaperClipOutlined() {
    return null;
  },
}));
jest.mock('antd', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const List = (props: AnyProps) => {
    const label = props['aria-label'];
    ui.lists.set(label, props);
    ui.rows.set(
      label,
      (props.dataSource ?? []).map((item: unknown) => props.renderItem(item))
    );
    return null;
  };
  function ListItem(_props: AnyProps) { return null; }
  function ListItemMeta(_props: AnyProps) { return null; }
  List.Item = ListItem;
  List.Item.Meta = ListItemMeta;
  return {
    Alert: (props: AnyProps) => { ui.alerts.push(props); return null; },
    Input: (props: AnyProps) => { ui.inputs.set(props['aria-label'], props); return null; },
    List,
    Modal: (props: AnyProps) => {
      ui.modal = props;
      return props.open ? React.createElement(React.Fragment, null, props.children) : null;
    },
    Select: (props: AnyProps) => { ui.selects.set(props['aria-label'], props); return null; },
    Spin: (props: AnyProps) => {
      ui.spins.push(props);
      return React.createElement(React.Fragment, null, props.children);
    },
    Tabs: (props: AnyProps) => {
      ui.tabs = props;
      const item = props.items.find((candidate: AnyProps) => candidate.key === props.activeKey);
      return React.createElement(React.Fragment, null, item?.children);
    },
  };
});

import { ResourceReferencePickerModal } from '@/components/documents/ResourceReferencePickerModal';
import { ResourceReferenceInsertButton } from '@/components/documents/ResourceReferenceInsertButton';
import {
  useResourceReferencePickerController,
  type ResourceReferencePickerController,
} from '@/components/documents/useResourceReferencePickerController';

function createNullContainer() {
  const documentLike: any = {
    nodeType: 9,
    activeElement: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    documentElement: { namespaceURI: 'http://www.w3.org/1999/xhtml' },
    defaultView: {
      document: undefined,
      HTMLIFrameElement: function HTMLIFrameElement() {},
      event: undefined,
    },
  };
  documentLike.defaultView.document = documentLike;
  const createElement = (tagName: string) => {
    const element: any = {
      nodeType: 1,
      tagName: tagName.toUpperCase(),
      nodeName: tagName.toUpperCase(),
      namespaceURI: 'http://www.w3.org/1999/xhtml',
      ownerDocument: documentLike,
      parentNode: null,
      childNodes: [],
      style: {},
      textContent: '',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      setAttribute: () => undefined,
      removeAttribute: () => undefined,
      appendChild(child: any) {
        child.parentNode = element;
        element.childNodes.push(child);
        return child;
      },
      insertBefore(child: any, before: any) {
        child.parentNode = element;
        const index = element.childNodes.indexOf(before);
        element.childNodes.splice(index < 0 ? element.childNodes.length : index, 0, child);
        return child;
      },
      removeChild(child: any) {
        const index = element.childNodes.indexOf(child);
        if (index >= 0) element.childNodes.splice(index, 1);
        child.parentNode = null;
        return child;
      },
    };
    return element;
  };
  documentLike.createElement = createElement;
  documentLike.createTextNode = (value: string) => ({
    nodeType: 3,
    nodeValue: value,
    ownerDocument: documentLike,
    parentNode: null,
  });
  const container = createElement('div');
  return {
    documentLike,
    container,
  };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (check()) return;
    await settle();
  }
  expect(check()).toBe(true);
}

function available(targets: ResourceReferenceTarget | ResourceReferenceTarget[]) {
  const list = Array.isArray(targets) ? targets : [targets];
  return new Map(list.map((target) => [
    resourceReferenceKey(target),
    {
      key: resourceReferenceKey(target),
      status: 'available',
      label: target.fallbackLabel,
    },
  ]));
}

function latestSpin(label: string) {
  return ui.spins.filter((spin) => spin['aria-label'] === label).at(-1);
}

describe('ResourceReferencePickerModal', () => {
  let root: Root;
  let originalWindow: typeof globalThis.window | undefined;
  let originalDocument: typeof globalThis.document | undefined;
  const onCancel = jest.fn();
  const onConfirm = jest.fn();

  beforeAll(async () => {
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    const { documentLike, container } = createNullContainer();
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      navigator: { userAgent: 'Node.js Jest' },
      window: documentLike.defaultView,
      document: documentLike,
    });
    const { createRoot } = await import('react-dom/client');
    root = createRoot(container as never);
  });

  beforeEach(async () => {
    ui.modal = undefined;
    ui.tabs = undefined;
    ui.selects.clear();
    ui.inputs.clear();
    ui.lists.clear();
    ui.rows.clear();
    ui.alerts.length = 0;
    ui.spins.length = 0;
    ui.preview = undefined;
    onCancel.mockReset();
    onConfirm.mockReset();
    listTableReferenceSources.mockReset().mockResolvedValue([
      { id: LIBRARY_A, projectId: PROJECT_ID, name: 'Archive' },
      { id: LIBRARY_B, projectId: PROJECT_ID, name: 'Characters' },
    ]);
    listTableReferenceRows.mockReset();
    listDocumentReferenceSources.mockReset().mockResolvedValue([
      { id: DOCUMENT_A, projectId: PROJECT_ID, name: 'Outline' },
      { id: DOCUMENT_B, projectId: PROJECT_ID, name: 'World bible' },
    ]);
    listDocumentReferenceBlocks.mockReset();
    resolveResourceReferences.mockReset().mockImplementation(
      async (_client, _projectId, targets: ResourceReferenceTarget[]) => available(targets)
    );
    insertJsx.mockReset();
    toolbarButtonProps = undefined;
    await act(async () => root.render(null));
  });

  afterAll(async () => {
    await act(async () => root.unmount());
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else globalThis.document = originalDocument;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  async function renderPicker(initialTarget?: ResourceReferenceTarget) {
    await renderPickerState(true, initialTarget);
  }

  async function renderPickerState(open: boolean, initialTarget?: ResourceReferenceTarget) {
    await act(async () => {
      root.render(
        <ResourceReferencePickerModal
          open={open}
          projectId={PROJECT_ID}
          documentId={OPEN_DOCUMENT_ID}
          initialTarget={initialTarget}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      );
    });
    await settle();
  }

  async function selectTableRows(libraryId = LIBRARY_A, assetIndexes: number[] = [0]) {
    await act(async () => ui.selects.get('Table')?.onChange(libraryId));
    await waitFor(() => (ui.rows.get('Table rows')?.length ?? 0) > Math.max(...assetIndexes, -1));
    for (const index of assetIndexes) {
      await act(async () => ui.rows.get('Table rows')?.[index].props.onClick());
    }
  }

  it('multi-selects whole-row table labels without a display field control', async () => {
    let resolveArchive!: (value: unknown) => void;
    listTableReferenceRows.mockImplementation((_client, _projectId, libraryId) => {
      if (libraryId === LIBRARY_A) {
        return new Promise((resolve) => { resolveArchive = resolve; });
      }
      return Promise.resolve({
        fields: [
          { id: FIELD_STATUS, label: 'Status', orderIndex: 0 },
          { id: FIELD_EMPTY, label: 'Notes', orderIndex: 1 },
        ],
        rows: [
          { id: ASSET_A, name: 'Ada', values: { [FIELD_STATUS]: 'Active' } },
          { id: ASSET_B, name: 'Byron', values: { [FIELD_STATUS]: 'Pending' } },
        ],
      });
    });
    await renderPicker();

    expect(listTableReferenceSources).toHaveBeenCalledWith(supabase, PROJECT_ID);
    expect(ui.modal?.okButtonProps.disabled).toBe(true);
    expect(ui.selects.get('Table')?.options).toEqual([
      { label: 'Archive', value: LIBRARY_A },
      { label: 'Characters', value: LIBRARY_B },
    ]);
    expect(ui.selects.get('Display field')).toBeUndefined();

    await act(async () => ui.selects.get('Table')?.onChange(LIBRARY_A));
    await waitFor(() => listTableReferenceRows.mock.calls.length === 1);
    await act(async () => ui.selects.get('Table')?.onChange(LIBRARY_B));
    await waitFor(() => ui.rows.get('Table rows')?.length === 2);
    expect(ui.modal?.okButtonProps.disabled).toBe(true);

    await act(async () => resolveArchive({
      fields: [{ id: FIELD_STATUS, label: 'Stale', orderIndex: 0 }],
      rows: [{ id: ASSET_A, name: 'Stale row', values: {} }],
    }));
    await settle();
    expect(ui.rows.get('Table rows')?.map((row) => row.props['aria-label'])).toEqual([
      'Row: Active',
      'Row: Pending',
    ]);

    await act(async () => ui.inputs.get('Search table rows')?.onChange({ target: { value: 'active' } }));
    expect(ui.rows.get('Table rows')).toHaveLength(1);
    await act(async () => ui.rows.get('Table rows')?.[0].props.onClick());
    expect(ui.rows.get('Table rows')?.[0].props['data-label']).toBe('Active');

    await act(async () => ui.inputs.get('Search table rows')?.onChange({ target: { value: '' } }));
    await waitFor(() => ui.rows.get('Table rows')?.length === 2);
    await act(async () => ui.rows.get('Table rows')?.[1].props.onClick());
    expect(ui.modal?.okButtonProps.disabled).toBe(false);
    await act(async () => ui.modal?.onOk());

    const expected: ResourceReferenceTarget[] = [
      {
        kind: 'table-row',
        libraryId: LIBRARY_B,
        assetId: ASSET_A,
        displayFieldId: FIELD_STATUS,
        fallbackLabel: 'Active',
      },
      {
        kind: 'table-row',
        libraryId: LIBRARY_B,
        assetId: ASSET_B,
        displayFieldId: FIELD_STATUS,
        fallbackLabel: 'Pending',
      },
    ];
    expect(resolveResourceReferences).toHaveBeenCalledWith(supabase, PROJECT_ID, expected);
    expect(onConfirm).toHaveBeenCalledWith(expected);
  });

  it('excludes the open document, resets selection, and emits a cross-block range target', async () => {
    listDocumentReferenceBlocks.mockResolvedValue([
      {
        blockId: HEADING_BLOCK,
        blockType: 'heading',
        headingLevel: 2,
        text: 'Conflict',
      },
      {
        blockId: PARAGRAPH_BLOCK,
        blockType: 'paragraph',
        text: 'The city closes its gates',
        nearestHeading: 'Conflict',
      },
    ]);
    await renderPicker();
    await act(async () => ui.tabs?.onChange('document'));
    await waitFor(() => listDocumentReferenceSources.mock.calls.length === 1);

    expect(listDocumentReferenceSources).toHaveBeenCalledWith(
      supabase,
      PROJECT_ID,
      OPEN_DOCUMENT_ID
    );
    await act(async () => ui.selects.get('Document')?.onChange(DOCUMENT_A));
    await waitFor(() => ui.preview?.blocks.length === 2);
    expect(ui.preview?.blocks.map((block: AnyProps) => block.text)).toEqual([
      'Conflict',
      'The city closes its gates',
    ]);
    await act(async () => ui.preview?.onSelection({
      anchor: { blockId: HEADING_BLOCK, offset: 3 },
      focus: { blockId: PARAGRAPH_BLOCK, offset: 8 },
    }));
    expect(ui.modal?.okButtonProps.disabled).toBe(false);

    await act(async () => ui.selects.get('Document')?.onChange(DOCUMENT_B));
    expect(ui.modal?.okButtonProps.disabled).toBe(true);
    await waitFor(() => listDocumentReferenceBlocks.mock.calls.length === 2);
    await act(async () => ui.preview?.onSelection({
      anchor: { blockId: HEADING_BLOCK, offset: 3 },
      focus: { blockId: PARAGRAPH_BLOCK, offset: 8 },
    }));
    await act(async () => ui.modal?.onOk());

    expect(onConfirm).toHaveBeenCalledWith([{
      kind: 'document-range',
      documentId: DOCUMENT_B,
      startBlockId: HEADING_BLOCK,
      startOffset: 3,
      startBefore: 'Con',
      startAfter: 'flict',
      endBlockId: PARAGRAPH_BLOCK,
      endOffset: 8,
      endBefore: 'The city',
      endAfter: ' closes its gates',
      fallbackLabel: 'flict The city',
    }]);
  });

  it('keeps the modal open with an exact validation error and exposes labelled keyboard controls', async () => {
    listTableReferenceRows.mockResolvedValue({
      fields: [{ id: FIELD_STATUS, label: 'Status', orderIndex: 0 }],
      rows: [{ id: ASSET_A, name: 'Ada', values: { [FIELD_STATUS]: 'Active' } }],
    });
    resolveResourceReferences.mockImplementation(async (_client, _projectId, targets) => new Map([
      [resourceReferenceKey(targets[0]), {
        key: resourceReferenceKey(targets[0]),
        status: 'unavailable',
        label: 'Reference unavailable',
      }],
    ]));
    await renderPicker();

    expect(ui.tabs?.items.map((item: AnyProps) => item.label)).toEqual(['Table', 'Document']);
    expect(ui.inputs.get('Search table rows')).toBeDefined();
    await act(async () => ui.selects.get('Table')?.onChange(LIBRARY_A));
    await waitFor(() => ui.rows.get('Table rows')?.length === 1);
    await act(async () => ui.rows.get('Table rows')?.[0].props.onClick());
    await act(async () => ui.modal?.onOk());

    expect(onConfirm).not.toHaveBeenCalled();
    expect(ui.modal?.open).toBe(true);
    expect(ui.alerts.at(-1)?.message).toBe(
      'The selected reference is no longer available.'
    );
    expect(ui.rows.get('Table rows')?.[0].props).toMatchObject({
      role: 'option',
      tabIndex: -1,
      'aria-selected': true,
    });
    await act(async () => ui.modal?.onCancel());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('invalidates a deferred confirmation across cancel and a new open', async () => {
    let resolveOldValidation!: (value: Map<string, unknown>) => void;
    listTableReferenceRows.mockResolvedValue({
      fields: [{ id: FIELD_STATUS, label: 'Status', orderIndex: 0 }],
      rows: [
        { id: ASSET_A, name: 'Ada', values: { [FIELD_STATUS]: 'Active' } },
        { id: ASSET_B, name: 'Byron', values: { [FIELD_STATUS]: 'Pending' } },
      ],
    });
    resolveResourceReferences
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldValidation = resolve; }))
      .mockImplementation(async (_client, _projectId, targets) => available(targets));

    await renderPicker();
    await selectTableRows(LIBRARY_A, [0]);
    await act(async () => { void ui.modal?.onOk(); });
    await act(async () => ui.modal?.onCancel());
    await renderPickerState(false);
    await renderPicker();
    await selectTableRows(LIBRARY_A, [1]);

    await act(async () => resolveOldValidation(available({
      kind: 'table-row',
      libraryId: LIBRARY_A,
      assetId: ASSET_A,
      displayFieldId: FIELD_STATUS,
      fallbackLabel: 'Active',
    })));
    expect(onConfirm).not.toHaveBeenCalled();

    await act(async () => ui.modal?.onOk());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toMatchObject([{ assetId: ASSET_B }]);
  });

  it('clears an invalidated row load when closed and reopened', async () => {
    let resolveRows!: (value: unknown) => void;
    listTableReferenceRows.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRows = resolve; })
    ).mockResolvedValue({
      fields: [{ id: FIELD_STATUS, label: 'Status', orderIndex: 0 }],
      rows: [{ id: ASSET_B, name: 'Byron', values: { [FIELD_STATUS]: 'Pending' } }],
    });

    await renderPicker();
    await act(async () => ui.selects.get('Table')?.onChange(LIBRARY_A));
    await waitFor(() => ui.spins.some(
      (spin) => spin['aria-label'] === 'Loading table rows' && spin.spinning
    ));
    await renderPickerState(false);
    ui.spins.length = 0;
    await renderPicker();
    expect(latestSpin('Loading table rows')?.spinning)
      .toBe(false);

    await selectTableRows(LIBRARY_B);
    expect(ui.modal?.okButtonProps.disabled).toBe(false);
    await act(async () => resolveRows({ fields: [], rows: [] }));
  });

  it('isolates inactive table work from active document loading and errors', async () => {
    let rejectRows!: (error: Error) => void;
    let resolveBlocks!: (value: unknown) => void;
    listTableReferenceRows.mockImplementation(
      () => new Promise((_resolve, reject) => { rejectRows = reject; })
    );
    listDocumentReferenceBlocks.mockImplementation(
      () => new Promise((resolve) => { resolveBlocks = resolve; })
    );

    await renderPicker();
    await act(async () => ui.selects.get('Table')?.onChange(LIBRARY_A));
    await act(async () => ui.tabs?.onChange('document'));
    await waitFor(() => ui.selects.get('Document') !== undefined);
    await act(async () => ui.selects.get('Document')?.onChange(DOCUMENT_A));
    await waitFor(() => ui.spins.some(
      (spin) => spin['aria-label'] === 'Loading document blocks' && spin.spinning
    ));

    await act(async () => rejectRows(new Error('stale table failure')));
    expect(latestSpin('Loading document blocks')?.spinning).toBe(true);
    expect(ui.alerts.at(-1)?.message).not.toBe('References could not be loaded. Try again.');

    await act(async () => resolveBlocks([]));
    expect(latestSpin('Loading document blocks')?.spinning).toBe(false);
  });

});

describe('document editor reference controls', () => {
  let root: Root;
  let originalWindow: typeof globalThis.window | undefined;
  let originalDocument: typeof globalThis.document | undefined;
  let controller: ResourceReferencePickerController;
  const restoreFocus = jest.fn();

  function captureController(next: ResourceReferencePickerController) {
    controller = next;
  }

  function ControllerHarness() {
    const current = useResourceReferencePickerController(restoreFocus);
    useEffect(() => captureController(current), [current]);
    return null;
  }

  beforeAll(async () => {
    originalWindow = globalThis.window;
    originalDocument = globalThis.document;
    const { documentLike, container } = createNullContainer();
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      navigator: { userAgent: 'Node.js Jest' },
      window: documentLike.defaultView,
      document: documentLike,
    });
    const { createRoot } = await import('react-dom/client');
    root = createRoot(container as never);
  });

  beforeEach(async () => {
    restoreFocus.mockReset();
    restoreFocus.mockImplementation((after?: () => void) => {
      after?.();
    });
    insertJsx.mockReset();
    toolbarButtonProps = undefined;
    await act(async () => root.render(<ControllerHarness />));
  });

  afterAll(async () => {
    await act(async () => root.unmount());
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete (globalThis as { document?: unknown }).document;
    else globalThis.document = originalDocument;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('preserves the toolbar selection, inserts sanctioned JSX, and hides the read-only trigger', async () => {
    const onOpen = jest.fn();
    await act(async () => root.render(
      <ResourceReferenceInsertButton readOnly={false} onOpen={onOpen} />
    ));
    expect(toolbarButtonProps?.title).toBe('Insert reference');
    expect(toolbarButtonProps?.['aria-label']).toBe('Insert reference');
    expect(toolbarButtonProps?.children?.type?.name).toBe('ReferenceToolbarIcon');
    const preventDefault = jest.fn();
    toolbarButtonProps?.onMouseDown({ preventDefault });
    toolbarButtonProps?.onClick();
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);

    const target: ResourceReferenceTarget = {
      kind: 'table-row',
      libraryId: LIBRARY_A,
      assetId: ASSET_A,
      displayFieldId: FIELD_STATUS,
      fallbackLabel: 'Active',
    };
    onOpen.mock.calls[0][0]([target]);
    expect(insertJsx).toHaveBeenCalledWith({
      kind: 'text',
      name: 'ResourceReference',
      props: target,
    });

    toolbarButtonProps = undefined;
    await act(async () => root.render(
      <ResourceReferenceInsertButton readOnly onOpen={onOpen} />
    ));
    expect(toolbarButtonProps).toBeUndefined();
  });

  it('uses one controller for insertion, cancel, and focus restoration', async () => {
    const insert = jest.fn();
    await act(async () => controller.openInsertion(insert));
    expect(controller.open).toBe(true);
    const tableTarget: ResourceReferenceTarget = {
      kind: 'table-row',
      libraryId: LIBRARY_A,
      assetId: ASSET_A,
      displayFieldId: FIELD_STATUS,
      fallbackLabel: 'Active',
    };
    await act(async () => controller.confirm([tableTarget]));
    expect(controller.open).toBe(false);
    expect(restoreFocus).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith([tableTarget]);
    // MDXEditor only inserts when a RangeSelection exists after focus — apply after restore.
    expect(restoreFocus.mock.invocationCallOrder[0]).toBeLessThan(
      insert.mock.invocationCallOrder[0]
    );

    await act(async () => controller.openInsertion(insert));
    await act(async () => controller.cancel());
    expect(controller.open).toBe(false);
    expect(restoreFocus).toHaveBeenCalledTimes(2);
  });
});
