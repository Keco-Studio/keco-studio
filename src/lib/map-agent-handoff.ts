export type MapAgentHandoff = {
  projectId: string;
  agentConversationId: string;
  planNodeId: string;
  message: string;
};

const MAP_AGENT_HANDOFF_KEY = 'keco:map-agent-handoff:v1';

function isMapAgentHandoff(value: unknown): value is MapAgentHandoff {
  if (!value || typeof value !== 'object') return false;
  const handoff = value as Partial<MapAgentHandoff>;
  return [
    handoff.projectId,
    handoff.agentConversationId,
    handoff.planNodeId,
    handoff.message,
  ].every((field) => typeof field === 'string' && field.trim().length > 0);
}

function readMapAgentHandoff(): MapAgentHandoff | null {
  if (typeof window === 'undefined') return null;
  const stored = window.sessionStorage.getItem(MAP_AGENT_HANDOFF_KEY);
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    return isMapAgentHandoff(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function queueMapAgentHandoff(handoff: MapAgentHandoff): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(MAP_AGENT_HANDOFF_KEY, JSON.stringify(handoff));
}

export function peekMapAgentHandoff(): MapAgentHandoff | null {
  return readMapAgentHandoff();
}

export function takeMapAgentHandoff(): MapAgentHandoff | null {
  const handoff = readMapAgentHandoff();
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(MAP_AGENT_HANDOFF_KEY);
  }
  return handoff;
}
