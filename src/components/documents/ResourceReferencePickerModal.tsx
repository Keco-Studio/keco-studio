'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Input, List, Modal, Select, Spin, Tabs } from 'antd';
import { useSupabase } from '@/lib/SupabaseContext';
import {
  listDocumentReferenceBlocks,
  listDocumentReferenceSources,
  listTableReferenceRows,
  listTableReferenceSources,
  resolveResourceReferences,
  type DocumentReferenceSource,
  type TableReferenceRows,
  type TableReferenceSource,
} from '@/lib/documents/resourceReferenceService';
import {
  resourceReferenceKey,
  type ResourceReferenceTarget,
} from '@/lib/documents/resourceReferenceTypes';
import type { DocumentReferenceBlock } from '@/lib/documents/documentBlockIdentity';
import { cellDisplayString } from '@/lib/utils/assetEmptiness';
import styles from './ResourceReferencePickerModal.module.css';

type ReferenceKind = 'table' | 'document';

export type ResourceReferencePickerModalProps = {
  open: boolean;
  projectId: string;
  documentId: string;
  initialTarget?: ResourceReferenceTarget;
  onCancel: () => void;
  onConfirm: (target: ResourceReferenceTarget) => void;
};

const EMPTY_TABLE_ROWS: TableReferenceRows = { fields: [], rows: [] };
const LOAD_ERROR = 'References could not be loaded. Try again.';
const UNAVAILABLE_ERROR = 'The selected reference is no longer available.';

function searchable(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function keyboardSelect(event: React.KeyboardEvent, select: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  select();
}

export function ResourceReferencePickerModal({
  open,
  projectId,
  documentId,
  initialTarget,
  onCancel,
  onConfirm,
}: ResourceReferencePickerModalProps) {
  const supabase = useSupabase();
  const initialKind: ReferenceKind = initialTarget?.kind === 'document-block'
    ? 'document'
    : 'table';
  const [activeKind, setActiveKind] = useState<ReferenceKind>(initialKind);
  const [tableSources, setTableSources] = useState<TableReferenceSource[]>([]);
  const [tableRows, setTableRows] = useState<TableReferenceRows>(EMPTY_TABLE_ROWS);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [tableSearch, setTableSearch] = useState('');
  const [documentSources, setDocumentSources] = useState<DocumentReferenceSource[]>([]);
  const [documentBlocks, setDocumentBlocks] = useState<DocumentReferenceBlock[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [documentSearch, setDocumentSearch] = useState('');
  const [loadingSources, setLoadingSources] = useState(false);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tableRequest = useRef(0);
  const documentRequest = useRef(0);

  useEffect(() => {
    if (!open) return;
    const kind: ReferenceKind = initialTarget?.kind === 'document-block'
      ? 'document'
      : 'table';
    setActiveKind(kind);
    setSelectedLibraryId(initialTarget?.kind === 'table-row' ? initialTarget.libraryId : null);
    setSelectedAssetId(initialTarget?.kind === 'table-row' ? initialTarget.assetId : null);
    setSelectedFieldId(initialTarget?.kind === 'table-row' ? initialTarget.displayFieldId : null);
    setSelectedDocumentId(
      initialTarget?.kind === 'document-block' ? initialTarget.documentId : null
    );
    setSelectedBlockId(initialTarget?.kind === 'document-block' ? initialTarget.blockId : null);
    setTableSearch('');
    setDocumentSearch('');
    setTableRows(EMPTY_TABLE_ROWS);
    setDocumentBlocks([]);
    setError(null);
  }, [initialTarget, open]);

  useEffect(() => {
    if (!open || activeKind !== 'table') return;
    let current = true;
    setLoadingSources(true);
    setError(null);
    void listTableReferenceSources(supabase, projectId)
      .then((sources) => {
        if (current) setTableSources(sources);
      })
      .catch(() => {
        if (current) setError(LOAD_ERROR);
      })
      .finally(() => {
        if (current) setLoadingSources(false);
      });
    return () => { current = false; };
  }, [activeKind, open, projectId, supabase]);

  useEffect(() => {
    if (!open || activeKind !== 'document') return;
    let current = true;
    setLoadingSources(true);
    setError(null);
    void listDocumentReferenceSources(supabase, projectId, documentId)
      .then((sources) => {
        if (current) setDocumentSources(sources);
      })
      .catch(() => {
        if (current) setError(LOAD_ERROR);
      })
      .finally(() => {
        if (current) setLoadingSources(false);
      });
    return () => { current = false; };
  }, [activeKind, documentId, open, projectId, supabase]);

  useEffect(() => {
    const request = ++tableRequest.current;
    if (!open || !selectedLibraryId) {
      setTableRows(EMPTY_TABLE_ROWS);
      return;
    }
    setLoadingTargets(true);
    setError(null);
    void listTableReferenceRows(supabase, projectId, selectedLibraryId)
      .then((result) => {
        if (request === tableRequest.current) setTableRows(result);
      })
      .catch(() => {
        if (request === tableRequest.current) {
          setTableRows(EMPTY_TABLE_ROWS);
          setError(LOAD_ERROR);
        }
      })
      .finally(() => {
        if (request === tableRequest.current) setLoadingTargets(false);
      });
  }, [open, projectId, selectedLibraryId, supabase]);

  useEffect(() => {
    const request = ++documentRequest.current;
    if (!open || !selectedDocumentId) {
      setDocumentBlocks([]);
      return;
    }
    setLoadingTargets(true);
    setError(null);
    void listDocumentReferenceBlocks(supabase, projectId, selectedDocumentId)
      .then((blocks) => {
        if (request === documentRequest.current) setDocumentBlocks(blocks);
      })
      .catch(() => {
        if (request === documentRequest.current) {
          setDocumentBlocks([]);
          setError(LOAD_ERROR);
        }
      })
      .finally(() => {
        if (request === documentRequest.current) setLoadingTargets(false);
      });
  }, [open, projectId, selectedDocumentId, supabase]);

  const selectedLibrary = tableSources.find((source) => source.id === selectedLibraryId);
  const selectedRow = tableRows.rows.find((row) => row.id === selectedAssetId);
  const selectedField = tableRows.fields.find((field) => field.id === selectedFieldId);
  const selectedDocument = documentSources.find((source) => source.id === selectedDocumentId);
  const selectedBlock = documentBlocks.find((block) => block.blockId === selectedBlockId);

  const target = useMemo<ResourceReferenceTarget | null>(() => {
    if (activeKind === 'table') {
      if (!selectedLibraryId || !selectedRow || !selectedField) return null;
      return {
        kind: 'table-row',
        libraryId: selectedLibraryId,
        assetId: selectedRow.id,
        displayFieldId: selectedField.id,
        fallbackLabel: cellDisplayString(selectedRow.values[selectedField.id]) || '(empty)',
      };
    }
    if (!selectedDocumentId || !selectedBlock) return null;
    return {
      kind: 'document-block',
      documentId: selectedDocumentId,
      blockId: selectedBlock.blockId,
      blockType: selectedBlock.blockType,
      fallbackLabel: selectedBlock.text,
    };
  }, [
    activeKind,
    selectedDocumentId,
    selectedBlock,
    selectedField,
    selectedLibraryId,
    selectedRow,
  ]);

  const filteredRows = useMemo(() => {
    const query = searchable(tableSearch);
    if (!query) return tableRows.rows;
    return tableRows.rows.filter((row) =>
      [row.name, ...Object.values(row.values).map(cellDisplayString)]
        .join(' ')
        .toLocaleLowerCase()
        .includes(query)
    );
  }, [tableRows.rows, tableSearch]);

  const filteredBlocks = useMemo(() => {
    const query = searchable(documentSearch);
    if (!query) return documentBlocks;
    return documentBlocks.filter((block) =>
      `${block.text} ${block.nearestHeading ?? ''}`.toLocaleLowerCase().includes(query)
    );
  }, [documentBlocks, documentSearch]);

  const changeLibrary = useCallback((libraryId: string) => {
    setSelectedLibraryId(libraryId);
    setSelectedAssetId(null);
    setSelectedFieldId(null);
    setTableRows(EMPTY_TABLE_ROWS);
    setError(null);
  }, []);

  const changeDocument = useCallback((nextDocumentId: string) => {
    setSelectedDocumentId(nextDocumentId);
    setSelectedBlockId(null);
    setDocumentBlocks([]);
    setError(null);
  }, []);

  const confirm = useCallback(async () => {
    if (!target || validating) return;
    setValidating(true);
    setError(null);
    try {
      const resolved = await resolveResourceReferences(supabase, projectId, [target]);
      if (resolved.get(resourceReferenceKey(target))?.status !== 'available') {
        setError(UNAVAILABLE_ERROR);
        return;
      }
      onConfirm(target);
    } catch {
      setError(UNAVAILABLE_ERROR);
    } finally {
      setValidating(false);
    }
  }, [onConfirm, projectId, supabase, target, validating]);

  const tablePanel = (
    <div className={styles.panel}>
      <Select
        aria-label="Table"
        className={styles.sourceSelect}
        placeholder="Choose a table"
        showSearch
        optionFilterProp="label"
        value={selectedLibraryId ?? undefined}
        options={tableSources.map((source) => ({ label: source.name, value: source.id }))}
        onChange={changeLibrary}
      />
      <div className={styles.rowToolbar}>
        <Input
          aria-label="Search table rows"
          placeholder="Search rows"
          allowClear
          value={tableSearch}
          onChange={(event) => setTableSearch(event.target.value)}
        />
        <Select
          aria-label="Display field"
          placeholder="Display field"
          value={selectedFieldId ?? undefined}
          disabled={!selectedAssetId}
          options={tableRows.fields.map((field) => ({ label: field.label, value: field.id }))}
          onChange={setSelectedFieldId}
        />
      </div>
      <Spin spinning={loadingTargets}>
        <List
          aria-label="Table rows"
          className={styles.resultList}
          dataSource={filteredRows}
          locale={{ emptyText: selectedLibraryId ? 'No matching rows' : 'Choose a table' }}
          renderItem={(row) => (
            <List.Item
              className={row.id === selectedAssetId ? styles.selectedRow : styles.resultRow}
              role="option"
              tabIndex={0}
              aria-label={`Row: ${row.name}`}
              aria-selected={row.id === selectedAssetId}
              onClick={() => setSelectedAssetId(row.id)}
              onKeyDown={(event) => keyboardSelect(event, () => setSelectedAssetId(row.id))}
            >
              <List.Item.Meta
                title={row.name}
                description={`${selectedLibrary?.name ?? 'Table'} / ${row.name}${
                  selectedField ? ` / ${selectedField.label}` : ''
                }`}
              />
            </List.Item>
          )}
        />
      </Spin>
    </div>
  );

  const documentPanel = (
    <div className={styles.panel}>
      <Select
        aria-label="Document"
        className={styles.sourceSelect}
        placeholder="Choose a document"
        showSearch
        optionFilterProp="label"
        value={selectedDocumentId ?? undefined}
        options={documentSources.map((source) => ({ label: source.name, value: source.id }))}
        onChange={changeDocument}
      />
      <Input
        aria-label="Search document blocks"
        placeholder="Search headings and paragraphs"
        allowClear
        value={documentSearch}
        onChange={(event) => setDocumentSearch(event.target.value)}
      />
      <Spin spinning={loadingTargets}>
        <List
          aria-label="Document blocks"
          className={styles.resultList}
          dataSource={filteredBlocks}
          locale={{ emptyText: selectedDocumentId ? 'No matching content' : 'Choose a document' }}
          renderItem={(block) => (
            <List.Item
              className={block.blockId === selectedBlockId ? styles.selectedRow : styles.resultRow}
              role="option"
              tabIndex={0}
              aria-label={`${block.blockType === 'heading' ? 'Heading' : 'Paragraph'}: ${block.text}`}
              aria-selected={block.blockId === selectedBlockId}
              onClick={() => setSelectedBlockId(block.blockId)}
              onKeyDown={(event) => keyboardSelect(event, () => setSelectedBlockId(block.blockId))}
            >
              <List.Item.Meta
                title={block.text}
                description={`${selectedDocument?.name ?? 'Document'} / ${
                  block.nearestHeading ?? block.text
                } / ${block.blockType}`}
              />
            </List.Item>
          )}
        />
      </Spin>
    </div>
  );

  return (
    <Modal
      open={open}
      title={initialTarget ? 'Replace reference' : 'Insert reference'}
      className={styles.modal}
      width={560}
      okText={initialTarget ? 'Replace' : 'Insert'}
      cancelText="Cancel"
      confirmLoading={validating}
      okButtonProps={{ disabled: !target || loadingSources || loadingTargets }}
      onCancel={onCancel}
      onOk={confirm}
      destroyOnHidden
    >
      {error && <Alert className={styles.alert} type="error" showIcon message={error} />}
      <Spin spinning={loadingSources}>
        <Tabs
          activeKey={activeKind}
          onChange={(key) => {
            setActiveKind(key as ReferenceKind);
            setError(null);
          }}
          items={[
            { key: 'table', label: 'Table', children: tablePanel },
            { key: 'document', label: 'Document', children: documentPanel },
          ]}
        />
      </Spin>
    </Modal>
  );
}
