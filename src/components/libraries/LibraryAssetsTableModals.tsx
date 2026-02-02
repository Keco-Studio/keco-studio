/**
 * Library Assets Table Modals
 * 
 * Encapsulated modal components for LibraryAssetsTable
 */

'use client';

import React from 'react';
import { Modal } from 'antd';
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
        <Image
          src={batchEditingCloseIcon}
          alt="Close"
          width={32}
          height={32}
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
  return (
    <Modal
      open={open}
      title="Delete row"
      onOk={onOk}
      onCancel={onCancel}
      okText="Delete"
      cancelText="Cancel"
      okButtonProps={{ danger: true }}
      width={616}
      centered
      className={styles.confirmModal}
      wrapClassName={styles.confirmModalWrap}
    >
      <p>Are you sure you want to delete these row?</p>
    </Modal>
  );
}

