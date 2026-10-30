'use client';

import type {
  ScriptStructureKind,
  ScriptWorkspaceStructure,
} from '@/lib/script-system/scriptWorkspaceStructure';
import styles from './ScriptStructurePanel.module.css';

const TYPE_LABELS: Record<ScriptStructureKind, string> = {
  entry: '入口',
  scene: '场景',
  choice: '选择',
  branch: '分支',
  merge: '汇合',
  ending: '结局',
};

export type ScriptStructurePanelProps = {
  structure: ScriptWorkspaceStructure;
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
};

export function ScriptStructurePanel({
  structure,
  selectedNodeId,
  onSelectNode,
}: ScriptStructurePanelProps) {
  const { counts } = structure;
  return (
    <aside className={styles.panel} aria-label="剧情结构">
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>剧情结构</h2>
          <p className={styles.summary}>
            {counts.nodes} 个节点 · {counts.choices} 个选择 · {counts.endings} 个结局
          </p>
        </div>
      </header>

      {structure.items.length > 0 ? (
        <ol className={styles.list}>
          {structure.items.map((item, index) => {
            const selected = item.nodeId === selectedNodeId;
            return (
              <li key={item.nodeId} className={styles.listItem}>
                <button
                  type="button"
                  className={`${styles.nodeButton} ${selected ? styles.nodeButtonSelected : ''}`}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelectNode(item.nodeId)}
                >
                  <span className={styles.connector} aria-hidden="true">
                    <span className={styles.index}>{index + 1}</span>
                  </span>
                  <span className={styles.nodeContent}>
                    <span className={styles.nodeTopline}>
                      <span className={`${styles.typeBadge} ${styles[`type_${item.kind}`]}`}>
                        {TYPE_LABELS[item.kind]}
                      </span>
                      <span className={styles.nodeTitle}>{item.title}</span>
                    </span>
                    <span className={styles.nodeSummary}>{item.summary}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={styles.empty}>当前 Script 还没有剧情节点。</p>
      )}
    </aside>
  );
}
