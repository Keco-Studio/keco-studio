'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CodeOutlined, RobotOutlined } from '@ant-design/icons';
import { Modal } from 'antd';
import { showErrorToast, showSuccessToast } from '@/lib/utils/toast';
import styles from '@/app/(dashboard)/mcp/page.module.css';

export interface McpConnectionView {
  id: string;
  client: 'codex' | 'claude' | 'unknown';
  clientName: 'Codex' | 'Claude Code' | 'MCP Client';
  connectedAt: string;
}

function clientIcon(client: McpConnectionView['client']) {
  return client === 'unknown' ? <RobotOutlined /> : <CodeOutlined />;
}

export function McpConnectionsList() {
  const [connections, setConnections] = useState<McpConnectionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<McpConnectionView | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const requestRef = useRef(0);

  const loadConnections = useCallback(async (showLoading = false) => {
    const requestId = ++requestRef.current;
    if (showLoading) setLoading(true);
    try {
      const response = await fetch('/api/mcp/connections', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('Unable to load MCP connections.');
      const body = await response.json() as { connections?: McpConnectionView[] };
      if (!Array.isArray(body.connections)) throw new Error('Unable to load MCP connections.');
      if (requestRef.current === requestId) {
        setConnections(body.connections);
        setError(null);
      }
    } catch {
      if (requestRef.current === requestId) {
        setError('Unable to load connected clients.');
      }
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConnections(true);
    const handleFocus = () => void loadConnections(false);
    window.addEventListener('focus', handleFocus);
    return () => {
      requestRef.current += 1;
      window.removeEventListener('focus', handleFocus);
    };
  }, [loadConnections]);

  const disconnect = async () => {
    if (!selected) return;
    const connection = selected;
    setDisconnectingId(connection.id);
    try {
      const response = await fetch(`/api/mcp/connections/${encodeURIComponent(connection.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
      });
      if (!response.ok) throw new Error('Unable to disconnect client.');
      setConnections((current) => current.filter((item) => item.id !== connection.id));
      setSelected(null);
      showSuccessToast(`${connection.clientName} disconnected`);
      await loadConnections(false);
    } catch {
      showErrorToast('Unable to disconnect client. Please try again.');
    } finally {
      setDisconnectingId(null);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="connected-clients-title">
      <div className={styles.sectionHeading}>
        <h2 id="connected-clients-title">Connected clients</h2>
        <p>Clients authorized to access Keco through this account.</p>
      </div>

      {error ? (
        <div className={styles.errorBanner} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void loadConnections(true)}>Retry</button>
        </div>
      ) : (
        <div className={styles.table} aria-busy={loading}>
          <div className={styles.tableHeader}>
            <div>CLIENT</div>
            <div className={styles.connectedColumn}>CONNECTED</div>
            <div aria-hidden="true" />
          </div>
          {loading ? (
            <div aria-label="Loading connected clients" role="status">
              {[0, 1].map((row) => (
                <div className={styles.skeletonRow} key={row}>
                  <span className={styles.skeletonName} />
                  <span className={`${styles.skeletonTime} ${styles.connectedColumn}`} />
                  <span className={styles.skeletonButton} />
                </div>
              ))}
            </div>
          ) : connections.length === 0 ? (
            <div className={styles.emptyState}>No MCP clients connected.</div>
          ) : (
            <div className={styles.tableBody}>
              {connections.map((connection) => {
                const pending = disconnectingId === connection.id;
                return (
                  <div className={`${styles.connectionRow} ${pending ? styles.connectionRowPending : ''}`} key={connection.id} data-testid="mcp-connection-row">
                    <div className={styles.clientCell}>
                      <span className={styles.clientIcon} aria-hidden="true">{clientIcon(connection.client)}</span>
                      <span>{connection.clientName}</span>
                    </div>
                    <time className={styles.connectedColumn} dateTime={connection.connectedAt}>{new Date(connection.connectedAt).toLocaleString()}</time>
                    <div className={styles.actionCell}>
                      <button type="button" className={styles.disconnectButton} disabled={pending} aria-label={`Disconnect ${connection.clientName}`} onClick={() => setSelected(connection)}>Disconnect</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <Modal
        title={selected ? `Disconnect ${selected.clientName}?` : 'Disconnect client?'}
        open={selected !== null}
        onCancel={() => { if (!disconnectingId) setSelected(null); }}
        onOk={() => void disconnect()}
        okText="Disconnect"
        cancelText="Cancel"
        confirmLoading={disconnectingId !== null}
        okButtonProps={{ danger: true, disabled: disconnectingId !== null }}
        cancelButtonProps={{ disabled: disconnectingId !== null }}
        centered
        destroyOnHidden
      >
        <p>This client will no longer be able to access Keco.</p>
      </Modal>
    </section>
  );
}
