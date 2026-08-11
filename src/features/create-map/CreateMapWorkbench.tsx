'use client';

import { useState } from 'react';
import { DirectMapWorkbench } from './DirectMapWorkbench';
import { LegacyCreateMapV2Workbench } from './LegacyCreateMapV2Workbench';

export { getPlanReviewActions } from './LegacyCreateMapV2Workbench';
export type { CreateMapWorkbenchMode, PlanReviewActionState } from './LegacyCreateMapV2Workbench';

export function CreateMapWorkbench() {
  const [legacyMapId, setLegacyMapId] = useState<string | null>(null);
  return legacyMapId
    ? <LegacyCreateMapV2Workbench initialMapId={legacyMapId} readOnly onBack={() => setLegacyMapId(null)} />
    : <DirectMapWorkbench onOpenLegacyMap={setLegacyMapId} />;
}
