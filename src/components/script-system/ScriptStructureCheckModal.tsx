'use client';

import { Modal } from 'antd';
import type { ScriptStructureValidation } from '@/lib/script-system/scriptWorkspaceStructure';
import styles from './ScriptTemplateModal.module.css';

export type ScriptStructureCheckModalProps = {
  open: boolean;
  validation: ScriptStructureValidation;
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
};

export function ScriptStructureCheckModal({
  open,
  validation,
  onClose,
  onSelectNode,
}: ScriptStructureCheckModalProps) {
  const healthy = validation.issues.length === 0;
  return (
    <Modal
      open={open}
      title="结构检查"
      width={560}
      footer={null}
      onCancel={onClose}
      destroyOnHidden
    >
      <div className={styles.checkSummary}>
        {healthy
          ? '结构清晰，未发现问题。'
          : `${validation.errorCount} 个错误 · ${validation.warningCount} 个提醒`}
      </div>
      {healthy ? (
        <div className={styles.healthyState}>当前分支均可从入口到达，并且存在可到达的结局。</div>
      ) : (
        <ul className={styles.issueList}>
          {validation.issues.map((issue) => (
            <li key={issue.id} className={styles.issueItem}>
              {issue.nodeId ? (
                <button
                  type="button"
                  className={styles.issueButton}
                  onClick={() => {
                    onSelectNode(issue.nodeId!);
                    onClose();
                  }}
                >
                  <span className={`${styles.severity} ${styles[issue.severity]}`}>
                    {issue.severity === 'error' ? '错误' : '提醒'}
                  </span>
                  <span>{issue.message}</span>
                  <span className={styles.locate}>定位</span>
                </button>
              ) : (
                <div className={styles.issueStatic}>
                  <span className={`${styles.severity} ${styles[issue.severity]}`}>
                    {issue.severity === 'error' ? '错误' : '提醒'}
                  </span>
                  <span>{issue.message}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
