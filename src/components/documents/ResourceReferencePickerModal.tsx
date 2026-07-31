'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Select, Spin, Tabs } from 'antd';
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
import { createDocumentRangeTarget } from '@/lib/documents/documentRangeReference';
import { joinTableRowDisplayValues } from '@/lib/documents/tableRowDisplayLabel';
import styles from './ResourceReferencePickerModal.module.css';
import { ResourceReferenceTableRowList } from './ResourceReferenceTableRowList';
import {
  DocumentReferencePreview,
  type DocumentPreviewSelection,
} from './DocumentReferencePreview';

type ReferenceKind = 'table' | 'document';

export type ResourceReferencePickerModalProps = {
  open: boolean;
  projectId: string;
  documentId: string;
  initialTarget?: ResourceReferenceTarget;
  onCancel: () => void;
  onConfirm: (targets: ResourceReferenceTarget[]) => void;
};

const EMPTY_TABLE_ROWS: TableReferenceRows = { fields: [], rows: [] };
const LOAD_ERROR = 'References could not be loaded. Try again.';
const UNAVAILABLE_ERROR = 'The selected reference is no longer available.';

export function ResourceReferencePickerModal({
  open,
  projectId,
  documentId,
  initialTarget,
  onCancel,
  onConfirm,
}: ResourceReferencePickerModalProps) {
  const supabase = useSupabase();
  const replaceMode = Boolean(initialTarget);
  const initialKind: ReferenceKind = initialTarget && initialTarget.kind !== 'table-row'
    ? 'document'
    : 'table';
  const [activeKind, setActiveKind] = useState<ReferenceKind>(initialKind);
  const [tableSources, setTableSources] = useState<TableReferenceSource[]>([]);
  const [tableRows, setTableRows] = useState<TableReferenceRows>(EMPTY_TABLE_ROWS);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<ReadonlySet<string>>(new Set());
  const [documentSources, setDocumentSources] = useState<DocumentReferenceSource[]>([]);
  const [documentBlocks, setDocumentBlocks] = useState<DocumentReferenceBlock[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedDocumentRange, setSelectedDocumentRange] = useState<
    Extract<ResourceReferenceTarget, { kind: 'document-range' }> | null
  >(null);
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
    const kind: ReferenceKind = initialTarget && initialTarget.kind !== 'table-row'
      ? 'document'
      : 'table';
    setActiveKind(kind);
    setSelectedLibraryId(initialTarget?.kind === 'table-row' ? initialTarget.libraryId : null);
    setSelectedAssetIds(
      initialTarget?.kind === 'table-row' ? new Set([initialTarget.assetId]) : new Set()
    );
    setSelectedDocumentId(
      initialTarget && initialTarget.kind !== 'table-row' ? initialTarget.documentId : null
    );
    setSelectedDocumentRange(initialTarget?.kind === 'document-range' ? initialTarget : null);
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

  const displayFieldId = tableRows.fields[0]?.id ?? null;

  const tableTargets = useMemo<ResourceReferenceTarget[]>(() => {
    if (activeKind !== 'table' || !selectedLibraryId || !displayFieldId) return [];
    return tableRows.rows
      .filter((row) => selectedAssetIds.has(row.id))
      .map((row) => ({
        kind: 'table-row' as const,
        libraryId: selectedLibraryId,
        assetId: row.id,
        displayFieldId,
        fallbackLabel: joinTableRowDisplayValues(tableRows.fields, row.values),
      }));
  }, [
    activeKind,
    displayFieldId,
    selectedAssetIds,
    selectedLibraryId,
    tableRows.fields,
    tableRows.rows,
  ]);

  const targets = useMemo<ResourceReferenceTarget[]>(() => {
    if (activeKind === 'table') return tableTargets;
    return selectedDocumentRange ? [selectedDocumentRange] : [];
  }, [activeKind, selectedDocumentRange, tableTargets]);

  const targetSignature = targets.length > 0 ? JSON.stringify(targets) : null;
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

  const changeLibrary = useCallback((libraryId: string) => {
    invalidateValidation();
    setSelectedLibraryId(libraryId);
    setSelectedAssetIds(new Set());
    setTableRows(EMPTY_TABLE_ROWS);
    setRowsError(null);
    setValidationError(null);
  }, [invalidateValidation]);

  const changeDocument = useCallback((nextDocumentId: string) => {
    invalidateValidation();
    setSelectedDocumentId(nextDocumentId);
    setSelectedDocumentRange(null);
    setDocumentBlocks([]);
    setBlocksError(null);
    setValidationError(null);
  }, [invalidateValidation]);

  const toggleAsset = useCallback((assetId: string) => {
    invalidateValidation();
    setValidationError(null);
    setSelectedAssetIds((previous) => {
      if (replaceMode) return new Set([assetId]);
      const next = new Set(previous);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }, [invalidateValidation, replaceMode]);

  const toggleAllAssets = useCallback((selectAll: boolean) => {
    if (replaceMode) return;
    invalidateValidation();
    setValidationError(null);
    setSelectedAssetIds(
      selectAll ? new Set(tableRows.rows.map((row) => row.id)) : new Set()
    );
  }, [invalidateValidation, replaceMode, tableRows.rows]);

  const selectDocumentText = useCallback((selection: DocumentPreviewSelection | null) => {
    invalidateValidation();
    setValidationError(null);
    if (!selectedDocumentId || !selection) {
      setSelectedDocumentRange(null);
      return;
    }
    setSelectedDocumentRange(createDocumentRangeTarget({
      documentId: selectedDocumentId,
      blocks: documentBlocks,
      anchor: selection.anchor,
      focus: selection.focus,
    }));
  }, [documentBlocks, invalidateValidation, selectedDocumentId]);

  const confirm = useCallback(async () => {
    if (!open || targets.length === 0 || !targetSignature || activeValidation.current !== null) {
      return;
    }
    const request = ++validationRequest.current;
    const generation = openGeneration.current;
    activeValidation.current = request;
    setValidating(true);
    setValidationError(null);
    try {
      const resolved = await resolveResourceReferences(supabase, projectId, targets);
      if (
        request !== validationRequest.current ||
        generation !== openGeneration.current ||
        targetSignature !== targetSignatureRef.current
      ) {
        return;
      }
      if (targets.some((target) =>
        resolved.get(resourceReferenceKey(target))?.status !== 'available'
      )) {
        setValidationError(UNAVAILABLE_ERROR);
        return;
      }
      onConfirm(targets);
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
  }, [onConfirm, open, projectId, supabase, targetSignature, targets]);

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
        classNames={{ popup: { root: styles.sourceSelectPopup } }}
        placeholder="Choose a table"
        showSearch
        optionFilterProp="label"
        value={selectedLibraryId ?? undefined}
        options={tableSources.map((source) => ({ label: source.name, value: source.id }))}
        onChange={changeLibrary}
      />
      <Spin aria-label="Loading table rows" spinning={loadingRows}>
        <ResourceReferenceTableRowList
          ariaLabel="Table rows"
          idPrefix="table-reference-row"
          fields={tableRows.fields}
          rows={tableRows.rows}
          selectedIds={selectedAssetIds}
          singleSelect={replaceMode}
          emptyText={selectedLibraryId ? 'No matching rows' : 'Choose a table'}
          onToggle={toggleAsset}
          onToggleAll={toggleAllAssets}
        />
      </Spin>
    </div>
  );

  const documentPanel = (
    <div className={styles.panel}>
      <Select
        aria-label="Document"
        className={styles.sourceSelect}
        classNames={{ popup: { root: styles.sourceSelectPopup } }}
        placeholder="Choose a document"
        showSearch
        optionFilterProp="label"
        value={selectedDocumentId ?? undefined}
        options={documentSources.map((source) => ({ label: source.name, value: source.id }))}
        onChange={changeDocument}
      />
      <Spin aria-label="Loading document blocks" spinning={loadingBlocks}>
        <DocumentReferencePreview
          blocks={documentBlocks}
          emptyText={selectedDocumentId ? 'No matching content' : 'Choose a document'}
          onSelection={selectDocumentText}
        />
      </Spin>
    </div>
  );

  return (
    <Modal
      open={open}
      title="Insert reference"
      className={styles.modal}
      rootClassName={styles.modalRoot}
      centered
      width={560}
      okText={replaceMode ? 'Replace' : 'Insert'}
      cancelText="Cancel"
      confirmLoading={validating}
      okButtonProps={{
        disabled: targets.length === 0 || loadingSources || loadingTargets || validating,
      }}
      onCancel={cancel}
      onOk={confirm}
      destroyOnHidden
      styles={{
        body: { overflow: 'hidden', maxWidth: '100%' },
        content: { overflow: 'hidden', maxWidth: '100%' },
      }}
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
