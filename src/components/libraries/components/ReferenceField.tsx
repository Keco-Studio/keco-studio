'use client';

import React, { useCallback } from 'react';
import Image from 'next/image';
import type { PropertyConfig } from '@/lib/types/libraryAssets';
import {
  normalizeReferenceSelections,
  resolveReferenceSelectionLabel,
} from '@/lib/utils/referenceValue';
import referenceAddIcon from '@/assets/images/referenceAdd.svg';
import styles from '@/components/libraries/LibraryAssetsTable.module.css';

export type ReferenceFieldProps = {
  property: PropertyConfig;
  assetIds: string[];
  currentValue?: unknown;
  rowId: string;
  assetNamesCache: Record<string, string>;
  isCellSelected: boolean;
  avatarRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  onAvatarMouseEnter: (
    assetId: string,
    element: HTMLDivElement,
    selections?: Array<{ fieldLabel?: string | null; displayValue?: string | null }>
  ) => void;
  onAvatarMouseLeave: () => void;
  onOpenReferenceModal: (property: PropertyConfig, currentValue: unknown, rowId: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** When true (e.g. in AddNewRowForm), the empty '+' button has no border-radius to match table cells */
  inTableForm?: boolean;
};

export const ReferenceField = React.memo<ReferenceFieldProps>(function ReferenceField({
  property,
  assetIds,
  currentValue,
  rowId,
  assetNamesCache,
  isCellSelected,
  avatarRefs,
  onAvatarMouseEnter,
  onAvatarMouseLeave,
  onOpenReferenceModal,
  onFocus,
  onBlur,
  inTableForm = false,
}) {
  const selections = normalizeReferenceSelections(currentValue);
  type DisplaySelection = {
    assetId: string;
    fieldId?: string | null;
    fieldLabel?: string | null;
    displayValue?: string | null;
  };
  // Keep per-selection granularity so the same asset chosen in different columns
  // is rendered independently in the cell UI.
  const displaySelections: DisplaySelection[] =
    selections.length > 0
      ? selections.filter((s) => s.assetId && s.assetId.trim() !== '')
      : assetIds.map((assetId) => ({ assetId, fieldId: null, fieldLabel: null, displayValue: null }));
  const hasValues = displaySelections.length > 0;
  const visibleSelections = displaySelections.slice(0, 5);
  const extraCount = Math.max(0, displaySelections.length - visibleSelections.length);

  const getSelectionLabel = (selection: {
    assetId: string;
    fieldId?: string | null;
    displayValue?: string | null;
  }) => resolveReferenceSelectionLabel(selection, assetNamesCache);

  const setAvatarRef = useCallback(
    (assetId: string) => (el: HTMLDivElement | null) => {
      if (el) {
        avatarRefs.current.set(assetId, el);
        return;
      }
      const existing = avatarRefs.current.get(assetId);
      if (existing) avatarRefs.current.delete(assetId);
    },
    [avatarRefs]
  );

  const handleClick = (e: React.MouseEvent) => {
    if (isCellSelected) {
      e.stopPropagation();
      e.preventDefault();
      // Call onFocus when opening reference modal
      onFocus?.();
      onOpenReferenceModal(property, currentValue ?? null, rowId);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isCellSelected) e.stopPropagation();
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className={styles.referenceFieldWrapper}
    >
      {hasValues ? (
        <div
          className={styles.referenceValueList}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
        >
          {visibleSelections.map((selection, idx) => {
            const id = selection.assetId;
            const label = getSelectionLabel(selection);
            return (
              <div
                key={`${id}-${selection.fieldId || 'legacy'}-${idx}`}
                ref={setAvatarRef(id)}
                data-reference-background="true"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onFocus?.();
                  onAvatarMouseEnter(
                    id,
                    e.currentTarget,
                    [
                      {
                        fieldLabel: selection.fieldLabel,
                        displayValue: selection.displayValue,
                      },
                    ]
                  );
                }}
                className={styles.referenceValuePill}
                title={label}
              >
                <span className={styles.referenceValueText}>{label}</span>
                {idx === visibleSelections.length - 1 && extraCount > 0 ? (
                  <span className={styles.referenceValueExtraCount}>+{extraCount}</span>
                ) : null}
              </div>
            );
          })}
          <div className={`${styles.referenceIconTile} ${styles.referenceArrowTile}`}>
            <Image
              src={referenceAddIcon}
              alt=""
              width={16}
              height={16}
              className={styles.referenceExpandIcon}
            />
          </div>
        </div>
      ) : (
        <div
          className={`${styles.referenceIconTile} ${styles.referenceArrowTile} ${styles.referenceSingleIcon}${inTableForm ? ` ${styles.referenceSingleIconNoRadius}` : ''}`}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
        >
          <Image
            src={referenceAddIcon}
            alt=""
            width={16}
            height={16}
            className={styles.referenceArrowIcon}
          />
        </div>
      )}
    </div>
  );
});

export default ReferenceField;
