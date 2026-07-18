'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Input, Modal, Select, Spin, Tabs } from 'antd';
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
import { ResourceReferenceResultList } from './ResourceReferenceResultList';

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
  const [loadingTableSources, setLoadingTableSources] = useState(false);
  const [loadingDocumentSources, setLoadingDocumentSources] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [loadingBlocks, setLoadingBlocks] = useState(false);
  const [validating, setValidating] = useState(false);
  const [tableSourcesError, setTableSourcesError] = useState<string | null>(null);
  const [documentSourcesError, setDocumentSourcesError] = useState<string | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [blocksError, setBlocksError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const tableSourcesRequest = useRef(0);
  const documentSourcesRequest = useRef(0);
  const rowsRequest = useRef(0);
  const blocksRequest = useRef(0);
  const validationRequest = useRef(0);
  const activeValidation = useRef<number | null>(null);
  const openGeneration = useRef(0);

  const invalidateValidation = useCallback(() => {
    validationRequest.current += 1;
    activeValidation.current = null;
    setValidating(false);
  }, []);

  useEffect(() => {
    openGeneration.current += 1;
    tableSourcesRequest.current += 1;
    documentSourcesRequest.current += 1;
    rowsRequest.current += 1;
    blocksRequest.current += 1;
    invalidateValidation();
    setLoadingTableSources(false);
    setLoadingDocumentSources(false);
    setLoadingRows(false);
    setLoadingBlocks(false);
    setTableSourcesError(null);
    setDocumentSourcesError(null);
    setRowsError(null);
    setBlocksError(null);
    setValidationError(null);
    if (!open) {
      setTableRows(EMPTY_TABLE_ROWS);
      setDocumentBlocks([]);
      return;
    }
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
  }, [initialTarget, invalidateValidation, open]);

  useEffect(() => () => {
    openGeneration.current += 1;
    validationRequest.current += 1;
    activeValidation.current = null;
  }, []);

  useEffect(() => {
    if (!open || activeKind !== 'table') return;
    const request = ++tableSourcesRequest.current;
    setLoadingTableSources(true);
    setTableSourcesError(null);
    void listTableReferenceSources(supabase, projectId)
      .then((sources) => {
        if (request === tableSourcesRequest.current) setTableSources(sources);
      })
      .catch(() => {
        if (request === tableSourcesRequest.current) setTableSourcesError(LOAD_ERROR);
      })
      .finally(() => {
        if (request === tableSourcesRequest.current) setLoadingTableSources(false);
      });
  }, [activeKind, open, projectId, supabase]);

  useEffect(() => {
    if (!open || activeKind !== 'document') return;
    const request = ++documentSourcesRequest.current;
    setLoadingDocumentSources(true);
    setDocumentSourcesError(null);
    void listDocumentReferenceSources(supabase, projectId, documentId)
      .then((sources) => {
        if (request === documentSourcesRequest.current) setDocumentSources(sources);
      })
      .catch(() => {
        if (request === documentSourcesRequest.current) setDocumentSourcesError(LOAD_ERROR);
      })
      .finally(() => {
        if (request === documentSourcesRequest.current) setLoadingDocumentSources(false);
      });
  }, [activeKind, documentId, open, projectId, supabase]);

  useEffect(() => {
    const request = ++rowsRequest.current;
    if (!open || !selectedLibraryId) {
      setTableRows(EMPTY_TABLE_ROWS);
      setLoadingRows(false);
      setRowsError(null);
      return;
    }
    setLoadingRows(true);
    setRowsError(null);
    void listTableReferenceRows(supabase, projectId, selectedLibraryId)
      .then((result) => {
        if (request === rowsRequest.current) setTableRows(result);
      })
      .catch(() => {
        if (request === rowsRequest.current) {
          setTableRows(EMPTY_TABLE_ROWS);
          setRowsError(LOAD_ERROR);
        }
      })
      .finally(() => {
        if (request === rowsRequest.current) setLoadingRows(false);
      });
  }, [open, projectId, selectedLibraryId, supabase]);

  useEffect(() => {
    const request = ++blocksRequest.current;
    if (!open || !selectedDocumentId) {
      setDocumentBlocks([]);
      setLoadingBlocks(false);
      setBlocksError(null);
      return;
    }
    setLoadingBlocks(true);
    setBlocksError(null);
    void listDocumentReferenceBlocks(supabase, projectId, selectedDocumentId)
      .then((blocks) => {
        if (request === blocksRequest.current) setDocumentBlocks(blocks);
      })
      .catch(() => {
        if (request === blocksRequest.current) {
          setDocumentBlocks([]);
          setBlocksError(LOAD_ERROR);
        }
      })
      .finally(() => {
        if (request === blocksRequest.current) setLoadingBlocks(false);
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
  const targetSignature = target ? JSON.stringify(target) : null;
  const targetSignatureRef = useRef<string | null>(targetSignature);

  useEffect(() => {
    targetSignatureRef.current = targetSignature;
  }, [targetSignature]);

  const loadingSources = activeKind === 'table'
    ? loadingTableSources
    : loadingDocumentSources;
  const loadingTargets = activeKind === 'table' ? loadingRows : loadingBlocks;
  const visibleError = validationError ?? (activeKind === 'table'
    ? rowsError ?? tableSourcesError
    : blocksError ?? documentSourcesError);

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
    invalidateValidation();
    setSelectedLibraryId(libraryId);
    setSelectedAssetId(null);
    setSelectedFieldId(null);
    setTableRows(EMPTY_TABLE_ROWS);
    setRowsError(null);
    setValidationError(null);
  }, [invalidateValidation]);

  const changeDocument = useCallback((nextDocumentId: string) => {
    invalidateValidation();
    setSelectedDocumentId(nextDocumentId);
    setSelectedBlockId(null);
    setDocumentBlocks([]);
    setBlocksError(null);
    setValidationError(null);
  }, [invalidateValidation]);

  const selectAsset = useCallback((assetId: string) => {
    invalidateValidation();
    setSelectedAssetId(assetId);
    setValidationError(null);
  }, [invalidateValidation]);

  const selectField = useCallback((fieldId: string) => {
    invalidateValidation();
    setSelectedFieldId(fieldId);
    setValidationError(null);
  }, [invalidateValidation]);

  const selectBlock = useCallback((blockId: string) => {
    invalidateValidation();
    setSelectedBlockId(blockId);
    setValidationError(null);
  }, [invalidateValidation]);

  const confirm = useCallback(async () => {
    if (!open || !target || !targetSignature || activeValidation.current !== null) return;
    const request = ++validationRequest.current;
    const generation = openGeneration.current;
    activeValidation.current = request;
    setValidating(true);
    setValidationError(null);
    try {
      const resolved = await resolveResourceReferences(supabase, projectId, [target]);
      if (
        request !== validationRequest.current ||
        generation !== openGeneration.current ||
        targetSignature !== targetSignatureRef.current
      ) {
        return;
      }
      if (resolved.get(resourceReferenceKey(target))?.status !== 'available') {
        setValidationError(UNAVAILABLE_ERROR);
        return;
      }
      onConfirm(target);
    } catch {
      if (
        request === validationRequest.current &&
        generation === openGeneration.current &&
        targetSignature === targetSignatureRef.current
      ) {
        setValidationError(UNAVAILABLE_ERROR);
      }
    } finally {
      if (request === validationRequest.current) {
        activeValidation.current = null;
        setValidating(false);
      }
    }
  }, [onConfirm, open, projectId, supabase, target, targetSignature]);

  const cancel = useCallback(() => {
    openGeneration.current += 1;
    invalidateValidation();
    onCancel();
  }, [invalidateValidation, onCancel]);

  const tablePanel = (
    <div className={styles.panel}>
      <Select
        aria-label="Table"
        className={styles.sourceSelect}
        popupClassName={styles.sourceSelectPopup}
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
          showSearch
          optionFilterProp="label"
          value={selectedFieldId ?? undefined}
          disabled={!selectedAssetId}
          options={tableRows.fields.map((field) => ({ label: field.label, value: field.id }))}
          onChange={selectField}
        />
      </div>
      <Spin aria-label="Loading table rows" spinning={loadingRows}>
        <ResourceReferenceResultList
          ariaLabel="Table rows"
          idPrefix="table-reference-row"
          items={filteredRows}
          selectedId={selectedAssetId}
          emptyText={selectedLibraryId ? 'No matching rows' : 'Choose a table'}
          getId={(row) => row.id}
          getTitle={(row) => row.name}
          getDescription={(row) => `${selectedLibrary?.name ?? 'Table'} / ${row.name}${
            selectedField ? ` / ${selectedField.label}` : ''
          }`}
          getAriaLabel={(row) => `Row: ${row.name}`}
          onSelect={(row) => selectAsset(row.id)}
        />
      </Spin>
    </div>
  );

  const documentPanel = (
    <div className={styles.panel}>
      <Select
        aria-label="Document"
        className={styles.sourceSelect}
        popupClassName={styles.sourceSelectPopup}
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
      <Spin aria-label="Loading document blocks" spinning={loadingBlocks}>
        <ResourceReferenceResultList
          ariaLabel="Document blocks"
          idPrefix="document-reference-block"
          items={filteredBlocks}
          selectedId={selectedBlockId}
          emptyText={selectedDocumentId ? 'No matching content' : 'Choose a document'}
          getId={(block) => block.blockId}
          getTitle={(block) => block.text}
          getDescription={(block) => `${selectedDocument?.name ?? 'Document'} / ${
            block.nearestHeading ?? block.text
          } / ${block.blockType}`}
          getAriaLabel={(block) => `${
            block.blockType === 'heading' ? 'Heading' : 'Paragraph'
          }: ${block.text}`}
          onSelect={(block) => selectBlock(block.blockId)}
        />
      </Spin>
    </div>
  );

  return (
    <Modal
      open={open}
      title="Insert reference"
      className={styles.modal}
      width={560}
      okText={initialTarget ? 'Replace' : 'Insert'}
      cancelText="Cancel"
      confirmLoading={validating}
      okButtonProps={{ disabled: !target || loadingSources || loadingTargets || validating }}
      onCancel={cancel}
      onOk={confirm}
      destroyOnHidden
    >
      {visibleError && (
        <Alert className={styles.alert} type="error" showIcon message={visibleError} />
      )}
      <Spin aria-label="Loading reference sources" spinning={loadingSources}>
        <Tabs
          activeKey={activeKind}
          onChange={(key) => {
            invalidateValidation();
            setActiveKind(key as ReferenceKind);
            setValidationError(null);
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
