/**
 * Connection Status Indicator
 * 
 * Shows the real-time connection status for collaborative editing
 */

'use client';

import React from 'react';
import { Tooltip } from 'antd';
import { getConnectionStatusColor, getConnectionStatusLabel } from '@/lib/services/realtimeService';
import type { ConnectionStatus } from '@/lib/hooks/useRealtimeSubscription';
import styles from './ConnectionStatusIndicator.module.css';

export type ConnectionStatusIndicatorProps = {
  status: ConnectionStatus;
  queuedUpdatesCount?: number;
};

export function ConnectionStatusIndicator({ 
  status,
  queuedUpdatesCount = 0,
}: ConnectionStatusIndicatorProps) {
  const color = getConnectionStatusColor(status);
  const label = getConnectionStatusLabel(status);
  
  const tooltipContent = (
    <div>
      <div>{label}</div>
      {queuedUpdatesCount > 0 && (
        <div style={{ marginTop: 4, fontSize: 12 }}>
          {queuedUpdatesCount} update{queuedUpdatesCount > 1 ? 's' : ''} queued
        </div>
      )}
    </div>
  );

  return (
    <Tooltip title={tooltipContent} placement="bottom">
      <div className={styles.container}>
        <div 
          className={styles.dot} 
          style={{ backgroundColor: color }}
          aria-label={label}
        />
        <span className={styles.label}>{label}</span>
        {queuedUpdatesCount > 0 && (
          <span className={styles.badge}>{queuedUpdatesCount}</span>
        )}
      </div>
    </Tooltip>
  );
}

