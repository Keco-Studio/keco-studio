'use client';

import { useState } from 'react';
import styles from './ChatPanel.module.css';
import type { ToolCallView } from './types';

interface Props {
  toolCall: ToolCallView;
}

interface TableData {
  columns: string[];
  rows: Array<{ name: string; values: Record<string, unknown> }>;
  rowCount?: number;
  libraryName?: string;
}

function isTableData(data: unknown): data is TableData {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as TableData).columns) &&
    Array.isArray((data as TableData).rows)
  );
}

function renderValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function ToolCallCard({ toolCall }: Props) {
  const [open, setOpen] = useState(false);
  const statusClass =
    toolCall.status === 'running'
      ? styles.statusRunning
      : toolCall.status === 'success'
        ? styles.statusSuccess
        : styles.statusFailure;

  const data = toolCall.data;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader} onClick={() => setOpen((v) => !v)}>
        <span>
          <span className={`${styles.statusDot} ${statusClass}`} />
          {toolCall.tool || 'tool'} · {toolCall.status}
        </span>
        <span>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div className={styles.cardBody}>
          {toolCall.status === 'failure' && toolCall.error && (
            <div style={{ color: '#b91c1c', marginTop: 8 }}>{toolCall.error}</div>
          )}
          {toolCall.args && (
            <pre className={styles.pre} style={{ marginBottom: 8 }}>
              {toolCall.args}
            </pre>
          )}
          {data != null && isTableData(data) ? (
            <div className={styles.tableWrap}>
              <div className={styles.previewStats}>
                {data.libraryName ? `${data.libraryName} · ` : ''}
                {data.rowCount ?? data.rows.length} rows
              </div>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>name</th>
                    {data.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.slice(0, 50).map((row, i) => (
                    <tr key={i}>
                      <td title={row.name}>{row.name}</td>
                      {data.columns.map((c) => (
                        <td key={c} title={renderValue(row.values[c])}>
                          {renderValue(row.values[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : data != null ? (
            <pre className={styles.pre}>{JSON.stringify(data, null, 2)}</pre>
          ) : (
            <span style={{ color: '#9ca3af' }}>No result data.</span>
          )}
        </div>
      )}
    </div>
  );
}

export default ToolCallCard;
