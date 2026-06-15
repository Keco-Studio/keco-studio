'use client';

import { LoadingOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import styles from './ChatPanel.module.css';
import { formatElapsedSeconds, streamActivityLabel, type StreamActivity } from './streamActivity';

interface Props {
  activity: StreamActivity;
  startedAt: number;
}

export function AgentActivityBar({ activity, startedAt }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={styles.activityBar} role="status" aria-live="polite">
      <LoadingOutlined className={styles.activitySpinner} spin />
      <span className={styles.activityText}>{streamActivityLabel(activity)}</span>
      <span className={styles.activityElapsed}>{formatElapsedSeconds(startedAt, now)}</span>
    </div>
  );
}

export default AgentActivityBar;
