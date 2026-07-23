'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckOutlined, CopyOutlined } from '@ant-design/icons';
import { Tooltip } from 'antd';
import { MCP_COMMANDS, type McpCommandClient } from './mcpCommands';
import styles from '@/app/(dashboard)/mcp/page.module.css';

export function McpConnectionCommands() {
  const [client, setClient] = useState<McpCommandClient>('codex');
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const copyCommand = async (command: string) => {
    await navigator.clipboard.writeText(command);
    setCopiedCommand(command);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopiedCommand(null), 1600);
  };

  return (
    <section className={styles.section} aria-labelledby="connect-client-title">
      <div className={styles.sectionHeading}>
        <h2 id="connect-client-title">Connect a client</h2>
        <p>Run these commands in your terminal, then complete sign-in in the browser.</p>
      </div>
      <div className={styles.segmented} role="tablist" aria-label="AI coding client">
        <button type="button" role="tab" aria-selected={client === 'codex'} className={client === 'codex' ? styles.segmentActive : ''} onClick={() => setClient('codex')}>Codex</button>
        <button type="button" role="tab" aria-selected={client === 'claude'} className={client === 'claude' ? styles.segmentActive : ''} onClick={() => setClient('claude')}>Claude Code</button>
      </div>
      <div className={styles.commands} role="tabpanel">
        {MCP_COMMANDS[client].map(({ label, copyLabel, command }) => {
          const copied = copiedCommand === command;
          return (
            <div className={styles.commandGroup} key={command}>
              <div className={styles.commandLabel}>{label}</div>
              <div className={styles.commandField}>
                <code>{command}</code>
                <Tooltip title={copied ? 'Copied' : 'Copy command'}>
                  <button type="button" className={styles.copyButton} aria-label={copyLabel} onClick={() => void copyCommand(command)}>
                    {copied ? <CheckOutlined /> : <CopyOutlined />}
                  </button>
                </Tooltip>
              </div>
            </div>
          );
        })}
      </div>
      <span className={styles.srOnly} role="status" aria-live="polite">{copiedCommand ? 'Command copied' : ''}</span>
    </section>
  );
}
