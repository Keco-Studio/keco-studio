export const SCRIPT_FLOW_CHART_TOGGLE_EVENT = 'script-flow-chart-toggle-request';
export const SCRIPT_FLOW_CHART_STATE_EVENT = 'script-flow-chart-state';

export type ScriptFlowChartStateDetail = {
  libraryId: string;
  collapsed: boolean;
};

export function requestScriptFlowChartToggle(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SCRIPT_FLOW_CHART_TOGGLE_EVENT));
}

export function broadcastScriptFlowChartState(
  detail: ScriptFlowChartStateDetail
): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(SCRIPT_FLOW_CHART_STATE_EVENT, { detail })
  );
}
