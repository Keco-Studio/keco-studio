'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Input, Select, Spin } from 'antd';
import { CloseOutlined, SearchOutlined } from '@ant-design/icons';
import Image from 'next/image';
import { useSupabase } from '@/lib/SupabaseContext';
import {
  getLibraryAssetsWithProperties,
  getLibrarySchema,
} from '@/lib/services/libraryAssetsService';
import assetRefBookIcon from '@/assets/images/assetRefBookIcon.svg';
import {
  normalizeReferenceSelections,
  referenceSelectionsToValue,
  type ReferenceSelection,
} from '@/lib/utils/referenceValue';
import {
  assetHasAnyNonEmptyDisplayValue,
  cellDisplayString,
} from '@/lib/utils/assetEmptiness';
import styles from './AssetReferenceModal.module.css';

type Library = {
  id: string;
  name: string;
};

type FieldDefinition = {
  id: string;
  library_id: string;
  label: string;
  order_index: number;
};

type AssetRow = {
  id: string;
  name: string;
  library_id: string;
  library_name?: string;
};

type CellPosition = {
  rowIndex: number;
  columnIndex: number;
};

type DragSelection = {
  start: CellPosition;
  baseSelections: ReferenceSelection[];
  additive: boolean;
  moved: boolean;
};

const AUTO_SCROLL_EDGE_PX = 48;
const AUTO_SCROLL_MAX_SPEED_PX = 18;

const selectionKey = (selection: Pick<ReferenceSelection, 'assetId' | 'fieldId'>) =>
  `${selection.assetId}::${selection.fieldId || ''}`;

function cellPositionFromElement(element: Element | null): CellPosition | null {
  const cell = element?.closest('td[role="gridcell"]');
  const row = cell?.parentElement;
  const body = row?.parentElement;
  if (!cell || !row || !body) return null;

  const rowIndex = Array.from(body.children).indexOf(row);
  const columnIndex = Array.from(row.children).indexOf(cell);
  return rowIndex >= 0 && columnIndex >= 0 ? { rowIndex, columnIndex } : null;
}

export function autoScrollDelta(container: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = container.getBoundingClientRect();
  const topProximity = Math.max(0, Math.min(AUTO_SCROLL_EDGE_PX, rect.top + AUTO_SCROLL_EDGE_PX - clientY));
  const bottomProximity = Math.max(0, Math.min(AUTO_SCROLL_EDGE_PX, clientY - (rect.bottom - AUTO_SCROLL_EDGE_PX)));
  const leftProximity = Math.max(0, Math.min(AUTO_SCROLL_EDGE_PX, rect.left + AUTO_SCROLL_EDGE_PX - clientX));
  const rightProximity = Math.max(0, Math.min(AUTO_SCROLL_EDGE_PX, clientX - (rect.right - AUTO_SCROLL_EDGE_PX)));

  let y = 0;
  if (topProximity > 0) {
    y = -Math.ceil((topProximity / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_SPEED_PX);
  } else if (bottomProximity > 0) {
    y = Math.ceil((bottomProximity / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_SPEED_PX);
  }

  let x = 0;
  if (leftProximity > 0) {
    x = -Math.ceil((leftProximity / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_SPEED_PX);
  } else if (rightProximity > 0) {
    x = Math.ceil((rightProximity / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_SPEED_PX);
  }

  return { x, y };
}

interface AssetReferenceModalProps {
  open: boolean;
  value?: unknown;
  referenceLibraries?: string[];
  onClose: () => void;
  onApply: (selections: ReferenceSelection[] | null) => void;
}

export function AssetReferenceModal({
  open,
  value,
  referenceLibraries = [],
  onClose,
  onApply,
}: AssetReferenceModalProps) {
  const supabase = useSupabase();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [libraryFields, setLibraryFields] = useState<FieldDefinition[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [assetRows, setAssetRows] = useState<AssetRow[]>([]);
  const [valuesByAsset, setValuesByAsset] = useState<Record<string, Record<string, unknown>>>({});
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [selectedSelections, setSelectedSelections] = useState<ReferenceSelection[]>([]);
  const selectedSelectionsRef = useRef(selectedSelections);
  const dragSelectionRef = useRef<DragSelection | null>(null);
  const suppressNextClickRef = useRef(false);
  const dragPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);

  const updateSelectedSelections = useCallback((
    next: ReferenceSelection[] | ((prev: ReferenceSelection[]) => ReferenceSelection[])
  ) => {
    const valueNext = typeof next === 'function' ? next(selectedSelectionsRef.current) : next;
    selectedSelectionsRef.current = valueNext;
    setSelectedSelections(valueNext);
  }, []);

  useEffect(() => {
    if (!open || referenceLibraries.length === 0) return;

    updateSelectedSelections([]);

    const loadLibraries = async () => {
      try {
        const { data, error } = await supabase
          .from('libraries')
          .select('id, name')
          .in('id', referenceLibraries);

        if (error) throw error;
        setLibraries(data || []);
        if (data && data.length > 0) {
          setSelectedLibraryId(data[0].id);
        }
      } catch (error) {
        console.error('[AssetReferenceModal] Failed to load libraries:', error);
      }
    };

    loadLibraries();
  }, [open, referenceLibraries, supabase, updateSelectedSelections]);

  useEffect(() => {
    if (!open || !selectedLibraryId) {
      setLibraryFields([]);
      setAssetRows([]);
      setValuesByAsset({});
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const [{ properties }, assets] = await Promise.all([
          getLibrarySchema(supabase, selectedLibraryId),
          getLibraryAssetsWithProperties(supabase, selectedLibraryId),
        ]);

        const fields: FieldDefinition[] = properties.map((property) => ({
          id: property.id,
          library_id: selectedLibraryId,
          label: property.name,
          order_index: property.orderIndex,
        }));
        setLibraryFields(fields);

        if (assets.length === 0) {
          setAssetRows([]);
          setValuesByAsset({});
          return;
        }

        const libName = libraries.find((lib) => lib.id === selectedLibraryId)?.name;

        const flatValues: Record<string, Record<string, unknown>> = {};
        for (const asset of assets) {
          flatValues[asset.id] = asset.propertyValues;
        }

        const rows = assets
          .filter((asset) => assetHasAnyNonEmptyDisplayValue(asset.propertyValues))
          .map((asset) => ({
            id: asset.id,
            name: asset.name,
            library_id: asset.libraryId,
            library_name: libName,
          }));

        setAssetRows(rows);
        setValuesByAsset(flatValues);
      } catch (error) {
        console.error('Failed to load reference modal data:', error);
        setLibraryFields([]);
        setAssetRows([]);
        setValuesByAsset({});
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [open, selectedLibraryId, supabase, libraries]);

  const primaryFieldId = libraryFields[0]?.id ?? null;
  const resolvedSelectionKey = useCallback((selection: ReferenceSelection) => selectionKey({
    ...selection,
    fieldId: selection.fieldId || primaryFieldId,
  }), [primaryFieldId]);

  const filteredRows = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return assetRows;
    return assetRows.filter((row) => {
      const vals = valuesByAsset[row.id] || {};
      if (row.name.toLowerCase().includes(q)) return true;
      return Object.values(vals).some((v) => cellDisplayString(v).toLowerCase().includes(q));
    });
  }, [assetRows, valuesByAsset, searchText]);

  const selectedKeys = useMemo(
    () => new Set(selectedSelections.map(resolvedSelectionKey)),
    [resolvedSelectionKey, selectedSelections]
  );

  useEffect(() => {
    if (!open) return;
    const normalizedSelections = normalizeReferenceSelections(value);
    updateSelectedSelections(normalizedSelections.filter((selection) => selection.assetId));
    setSearchText('');
  }, [open, updateSelectedSelections, value]);

  const handleCellClick = (selection: ReferenceSelection) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    updateSelectedSelections((current) => {
      const key = resolvedSelectionKey(selection);
      return current.some((item) => resolvedSelectionKey(item) === key)
        ? current.filter((item) => resolvedSelectionKey(item) !== key)
        : [...current, selection];
    });
  };

  const selectionAt = useCallback((rowIndex: number, columnIndex: number): ReferenceSelection | null => {
    const row = filteredRows[rowIndex];
    const field = libraryFields[columnIndex];
    if (!row || !field) return null;
    const displayValue = cellDisplayString(valuesByAsset[row.id]?.[field.id]);
    if (displayValue.trim() === '') return null;
    return {
      assetId: row.id,
      fieldId: field.id,
      fieldLabel: field.label || 'Column',
      displayValue,
    };
  }, [filteredRows, libraryFields, valuesByAsset]);

  const selectionsInRectangle = useCallback((start: CellPosition, end: CellPosition) => {
    const rowStart = Math.min(start.rowIndex, end.rowIndex);
    const rowEnd = Math.max(start.rowIndex, end.rowIndex);
    const columnStart = Math.min(start.columnIndex, end.columnIndex);
    const columnEnd = Math.max(start.columnIndex, end.columnIndex);
    const selections: ReferenceSelection[] = [];

    for (let rowIndex = rowStart; rowIndex <= rowEnd; rowIndex += 1) {
      for (let columnIndex = columnStart; columnIndex <= columnEnd; columnIndex += 1) {
        const selection = selectionAt(rowIndex, columnIndex);
        if (selection) selections.push(selection);
      }
    }
    return selections;
  }, [selectionAt]);

  const updateDragSelection = useCallback((position: CellPosition) => {
    const drag = dragSelectionRef.current;
    if (!drag) return;
    if (
      position.rowIndex === drag.start.rowIndex
      && position.columnIndex === drag.start.columnIndex
    ) return;

    drag.moved = true;
    const rectangleSelections = selectionsInRectangle(drag.start, position);
    if (!drag.additive) {
      updateSelectedSelections(rectangleSelections);
      return;
    }

    const merged = new Map(
      drag.baseSelections.map((selection) => [resolvedSelectionKey(selection), selection])
    );
    rectangleSelections.forEach((selection) => {
      merged.set(resolvedSelectionKey(selection), selection);
    });
    updateSelectedSelections([...merged.values()]);
  }, [resolvedSelectionKey, selectionsInRectangle, updateSelectedSelections]);

  const handleCellMouseDown = (
    event: React.MouseEvent<HTMLTableCellElement>,
    position: CellPosition
  ) => {
    if (event.button !== 0) return;
    dragSelectionRef.current = {
      start: position,
      baseSelections: selectedSelectionsRef.current,
      additive: event.ctrlKey || event.metaKey,
      moved: false,
    };
    suppressNextClickRef.current = false;
    event.preventDefault();
  };

  const handleCellMouseEnter = (
    event: React.MouseEvent<HTMLTableCellElement>,
    position: CellPosition
  ) => {
    if (!dragSelectionRef.current || event.buttons !== 1) return;
    updateDragSelection(position);
  };

  const handleCellMouseUp = (hasClickHandler: boolean) => {
    if (dragSelectionRef.current?.moved && hasClickHandler) {
      suppressNextClickRef.current = true;
    }
    dragSelectionRef.current = null;
  };

  useEffect(() => {
    const stopAutoScroll = () => {
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
    };

    const updateSelectionAtPointer = (pointer: { clientX: number; clientY: number }) => {
      const position = cellPositionFromElement(
        document.elementFromPoint(pointer.clientX, pointer.clientY)
      );
      if (position) updateDragSelection(position);
    };

    const scrollAtPointer = () => {
      autoScrollFrameRef.current = null;
      const pointer = dragPointerRef.current;
      const container = tableWrapRef.current;
      if (!pointer || !container || !dragSelectionRef.current) return;

      const delta = autoScrollDelta(container, pointer.clientX, pointer.clientY);
      const previousTop = container.scrollTop;
      const previousLeft = container.scrollLeft;
      container.scrollTop += delta.y;
      container.scrollLeft += delta.x;
      if (container.scrollTop === previousTop && container.scrollLeft === previousLeft) return;

      updateSelectionAtPointer(pointer);
      autoScrollFrameRef.current = window.requestAnimationFrame(scrollAtPointer);
    };

    const handleDragMove = (event: MouseEvent) => {
      if (!dragSelectionRef.current || event.buttons !== 1) {
        stopAutoScroll();
        return;
      }
      dragPointerRef.current = { clientX: event.clientX, clientY: event.clientY };
      updateSelectionAtPointer(dragPointerRef.current);
      const container = tableWrapRef.current;
      if (
        container
        && (() => {
          const delta = autoScrollDelta(container, event.clientX, event.clientY);
          return delta.x !== 0 || delta.y !== 0;
        })()
        && autoScrollFrameRef.current === null
      ) {
        autoScrollFrameRef.current = window.requestAnimationFrame(scrollAtPointer);
      }
    };

    const finishDrag = () => {
      stopAutoScroll();
      dragPointerRef.current = null;
      dragSelectionRef.current = null;
    };

    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', finishDrag);
    return () => {
      stopAutoScroll();
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', finishDrag);
    };
  }, [updateDragSelection]);

  const handleApply = () => {
    const currentSelections = selectedSelectionsRef.current.map((selection) => {
      const fieldId = selection.fieldId || primaryFieldId;
      const field = libraryFields.find((candidate) => candidate.id === fieldId);
      const values = valuesByAsset[selection.assetId];
      if (!fieldId || !field || !values) return selection;

      return {
        ...selection,
        fieldId,
        fieldLabel: field.label || 'Column',
        displayValue: cellDisplayString(values[fieldId]),
      };
    });
    onApply(referenceSelectionsToValue(currentSelections));
    onClose();
  };

  const handleCancel = () => {
    onClose();
  };

  if (!open) return null;

  return createPortal(
    <div className={styles.backdrop} data-testid="apply-reference-modal">
      <div className={styles.modalContainer}>
        <div ref={modalRef} className={styles.modal}>
          <div className={styles.header}>
            <div className={styles.title}>Apply Reference</div>
            <button
              type="button"
              className={styles.closeButton}
              aria-label="Close reference picker"
              onClick={handleCancel}
            >
              <CloseOutlined />
            </button>
          </div>

          <div className={styles.content}>
            <Input
              prefix={<SearchOutlined />}
              placeholder="Search"
              aria-label="Search reference cells"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className={styles.searchInput}
            />

            <Select
              value={selectedLibraryId}
              onChange={setSelectedLibraryId}
              className={styles.librarySelect}
              placeholder={libraries.length === 0 ? 'No libraries' : 'Select library'}
              disabled={libraries.length === 0}
              getPopupContainer={() => modalRef.current || document.body}
              popupMatchSelectWidth
              optionLabelProp="label"
            >
              {libraries.map((lib) => (
                <Select.Option key={lib.id} value={lib.id} label={lib.name}>
                  <div className={styles.selectOptionRow}>
                    <Image src={assetRefBookIcon} alt="" width={16} height={16} className="icon-16" />
                    <span className={styles.selectOptionText}>{lib.name}</span>
                  </div>
                </Select.Option>
              ))}
            </Select>

            <p className={styles.selectionHint}>Select cells by clicking or dragging.</p>

            <div ref={tableWrapRef} className={styles.tableWrap}>
              {loading ? (
                <div className={styles.loading}>
                  <Spin />
                </div>
              ) : filteredRows.length === 0 ? (
                <div className={styles.emptyMessage}>No assets found</div>
              ) : (
                <table className={styles.refTable} role="grid" aria-label="Reference cells">
                  <thead>
                    <tr>
                      {libraryFields.map((field) => (
                        <th key={field.id} className={styles.fieldCol} scope="col">
                          <span className={styles.fieldHeaderLabel}>{field.label}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, rowIndex) => {
                      const vals = valuesByAsset[row.id] || {};
                      const rowLabel = primaryFieldId
                        ? cellDisplayString(vals[primaryFieldId]) || row.name
                        : row.name;
                      return (
                        <tr key={row.id}>
                          {libraryFields.map((field, fieldIndex) => {
                            const text = cellDisplayString(vals[field.id]);
                            const selection: ReferenceSelection = {
                              assetId: row.id,
                              fieldId: field.id,
                              fieldLabel: field.label || 'Column',
                              displayValue: text,
                            };
                            const selected = selectedKeys.has(selectionKey(selection));
                            const selectable = text.trim() !== '';
                            return (
                              <td
                                key={field.id}
                                role="gridcell"
                                aria-label={`${rowLabel}, ${field.label}: ${text || 'Empty'}`}
                                aria-selected={selected}
                                aria-disabled={!selectable}
                                className={`${styles.fieldCol} ${selected ? styles.cellSelected : ''} ${!selectable ? styles.cellDisabled : ''}`}
                                onClick={selectable ? () => handleCellClick(selection) : undefined}
                                onMouseDown={selectable
                                  ? (event) => handleCellMouseDown(event, {
                                    rowIndex,
                                    columnIndex: fieldIndex,
                                  })
                                  : undefined}
                                onMouseEnter={(event) => handleCellMouseEnter(event, {
                                  rowIndex,
                                  columnIndex: fieldIndex,
                                })}
                                onMouseUp={() => handleCellMouseUp(selectable)}
                              >
                                <span className={styles.cellText} title={text || row.name}>
                                  {text || '—'}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className={styles.footer}>
            <button className={styles.cancelButton} onClick={handleCancel}>
              Cancel
            </button>
            <button className={styles.applyButton} onClick={handleApply}>
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
