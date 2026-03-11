/**
 * Library Assets Table Modals
 * 
 * Encapsulated modal components for LibraryAssetsTable
 */

'use client';

import React from 'react';
import { Modal } from 'antd';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import batchEditingCloseIcon from '@/assets/images/BatchEditingCloseIcon.svg';
import styles from './LibraryAssetsTable.module.css';

interface DeleteAssetModalProps {
  open: boolean;
  onOk: () => void;
  onCancel: () => void;
}

export function DeleteAssetModal({ open, onOk, onCancel }: DeleteAssetModalProps) {
  return (
    <Modal
      open={open}
      title="Confirm Delete"
      onOk={onOk}
      onCancel={onCancel}
      okText="Delete"
      cancelText="Cancel"
      okButtonProps={{ danger: true }}
    >
      <p>Are you sure you want to delete this asset? This action cannot be undone.</p>
    </Modal>
  );
}

interface ClearContentsModalProps {
  open: boolean;
  onOk: () => void;
  onCancel: () => void;
}

export function ClearContentsModal({ open, onOk, onCancel }: ClearContentsModalProps) {
  return (
    <Modal
      open={open}
      title="Clear content"
      onOk={onOk}
      onCancel={onCancel}
      okText="Delete"
      cancelText="Cancel"
      okButtonProps={{ 
        danger: true,
        style: {
          backgroundColor: 'rgba(170, 5, 44, 1)',
          borderColor: 'rgba(170, 5, 44, 1)',
          borderRadius: '12px',
        }
      }}
      width={616}
      centered
      className={styles.confirmModal}
      wrapClassName={styles.confirmModalWrap}
      closeIcon={
        <Image src={batchEditingCloseIcon}
          alt="Close"
          width={32} height={32} className="icon-32"
        />
      }
    >
      <p>Are you sure you want to clear these content?</p>
    </Modal>
  );
}

interface DeleteRowModalProps {
  open: boolean;
  onOk: () => void;
  onCancel: () => void;
}

export function DeleteRowModal({ open, onOk, onCancel }: DeleteRowModalProps) {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className={styles.confirmOverlay}>
      <div
        className={styles.confirmDialog}
        style={{ height: '15.5rem' }}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-row-confirm-title"
        aria-describedby="delete-row-confirm-description"
      >
        <div className={styles.confirmHeader}>
          <h3 id="delete-row-confirm-title" className={styles.confirmTitle}>
            Alert
          </h3>
          <button
            type="button"
            className={styles.confirmCloseBtn}
            aria-label="Close"
            onClick={onCancel}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <div id="delete-row-confirm-description" className={styles.confirmBody}>
          Are you sure you want to delete these row?
        </div>
        <div className={styles.confirmActions}>
          <button type="button" className={styles.confirmCancelBtn} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={styles.confirmDiscardBtn} onClick={onOk}>
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

