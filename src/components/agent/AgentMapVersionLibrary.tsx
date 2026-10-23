'use client';

import { FileTextOutlined, UnorderedListOutlined } from '@ant-design/icons';
import Image from 'next/image';
import { useState } from 'react';
import mapPlanIcon from '@/assets/images/simulator/map-plan.svg';
import type { MapConversationSnapshot } from '@/features/create-map/model/mapConversation';
import styles from './ChatPanel.module.css';

export function AgentMapVersionLibrary({
  snapshot,
  basePlanNodeId,
  onBasePlanChange,
  onOpenMap,
}: {
  snapshot: MapConversationSnapshot | null;
  basePlanNodeId: string | null;
  onBasePlanChange: (planNodeId: string | null) => void;
  onOpenMap: (target: { mapProjectId: string; mapRevisionId: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!snapshot || snapshot.planNodes.length === 0) return null;

  return (
    <div className={styles.agentMapVersionLibrary}>
      <button
        type="button"
        aria-label="Map assets"
        title="Map assets"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <UnorderedListOutlined aria-hidden="true" />
        <span>Map assets</span>
      </button>
      {open ? <div className={styles.agentMapVersionMenu} role="menu" aria-label="Map assets">
        <label>
          <span>Base Plan</span>
          <select
            aria-label="Base Plan"
            value={basePlanNodeId ?? ''}
            onChange={(event) => onBasePlanChange(event.target.value || null)}
          >
            <option value="">Select a base Plan</option>
            {snapshot.planNodes.map((plan) => (
              <option key={plan.id} value={plan.id}>{plan.displayLabel}</option>
            ))}
          </select>
        </label>
        {snapshot.planNodes.map((plan) => (
          <div key={plan.id} className={styles.agentMapVersionGroup}>
            <button
              type="button"
              role="menuitem"
              onClick={() => onBasePlanChange(plan.id)}
              aria-current={basePlanNodeId === plan.id || undefined}
            >
              <FileTextOutlined aria-hidden="true" />
              <span>{plan.displayLabel}</span>
            </button>
            {plan.maps.map((map) => (
              <button
                key={map.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  onBasePlanChange(plan.id);
                  onOpenMap({ mapProjectId: plan.mapProjectId, mapRevisionId: map.revisionId });
                }}
              >
                <Image src={mapPlanIcon} alt="" width={16} height={16} aria-hidden="true" />
                <span>{map.displayLabel} {map.status}</span>
              </button>
            ))}
          </div>
        ))}
      </div> : null}
    </div>
  );
}
