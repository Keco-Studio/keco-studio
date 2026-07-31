'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { useSidebarDocuments } from '@/components/layout/hooks/useSidebarDocuments';
import closeIcon from '@/assets/images/closeIcon32.svg';
import dialog from '@/components/shared/FormDialog.module.css';

export type SelectDocumentModalProps = {
  open: boolean;
  projectId: string;
  selectedDocumentId?: string | null;
  onClose: () => void;
  onSelect: (document: { id: string; name: string }) => void;
};

export function SelectDocumentModal({
  open,
  projectId,
  selectedDocumentId = null,
  onClose,
  onSelect,
}: SelectDocumentModalProps) {
  const { documents, isLoading } = useSidebarDocuments(projectId);
  const [query, setQuery] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(selectedDocumentId);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    setPickedId(selectedDocumentId);
    setQuery('');
  }, [open, selectedDocumentId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return documents;
    return documents.filter((doc) => doc.name.toLowerCase().includes(needle));
  }, [documents, query]);

  if (!open || !mounted) return null;

  const handleConfirm = () => {
    const doc = documents.find((item) => item.id === pickedId);
    if (!doc) return;
    onSelect({ id: doc.id, name: doc.name });
    onClose();
  };

  return createPortal(
    <div className={dialog.backdrop}>
      <div className={`${dialog.modal} ${dialog.modalCompact}`}>
        <div className={dialog.header}>
          <div className={dialog.title}>Select form</div>
          <button
            type="button"
            className={dialog.close}
            onClick={onClose}
            aria-label="Close"
          >
            <Image
              src={closeIcon}
              alt="Close"
              width={32}
              height={32}
              className="icon-32"
            />
          </button>
        </div>

        <div className={dialog.divider} />

        <div className={dialog.field}>
          <label className={dialog.nameLabel} htmlFor="script-select-doc-search">
            Studio documents
          </label>
          <input
            id="script-select-doc-search"
            className={dialog.nameInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search documents"
            autoFocus
          />
        </div>

        <div
          role="listbox"
          aria-label="Studio documents"
          style={{
            maxHeight: 260,
            overflowY: 'auto',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: 4,
          }}
        >
          {isLoading ? (
            <div style={{ padding: 12, color: '#64748b', fontSize: 13 }}>
              Loading documents…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 12, color: '#64748b', fontSize: 13 }}>
              No documents found
            </div>
          ) : (
            filtered.map((doc) => {
              const selected = doc.id === pickedId;
              return (
                <button
                  key={doc.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => setPickedId(doc.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    border: 'none',
                    borderRadius: 8,
                    padding: '10px 12px',
                    cursor: 'pointer',
                    background: selected ? '#e6f4ff' : 'transparent',
                    color: selected ? '#0b99ff' : '#334155',
                    fontWeight: selected ? 600 : 500,
                    fontSize: 13,
                  }}
                >
                  {doc.name}
                </button>
              );
            })
          )}
        </div>

        <div className={dialog.footer}>
          <button
            type="button"
            className={`${dialog.button} ${dialog.buttonAuto} ${dialog.secondary}`}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${dialog.button} ${dialog.buttonAuto} ${dialog.primary}`}
            disabled={!pickedId}
            onClick={handleConfirm}
          >
            Select
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
