/** @jest-environment jsdom */

import {
  peekMapAgentHandoff,
  queueMapAgentHandoff,
  takeMapAgentHandoff,
} from '@/lib/map-agent-handoff';

const handoff = {
  projectId: '10000000-0000-4000-8000-000000000001',
  agentConversationId: '10000000-0000-4000-8000-000000000002',
  planNodeId: '10000000-0000-4000-8000-000000000003',
  message: 'Add an island clinic',
};

describe('map-to-agent handoff', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('keeps a map revision request until the GDS Agent consumes it once', () => {
    queueMapAgentHandoff(handoff);

    expect(peekMapAgentHandoff()).toEqual(handoff);
    expect(takeMapAgentHandoff()).toEqual(handoff);
    expect(peekMapAgentHandoff()).toBeNull();
  });

  it('ignores malformed stored values', () => {
    window.sessionStorage.setItem('keco:map-agent-handoff:v1', '{"message":true}');

    expect(takeMapAgentHandoff()).toBeNull();
  });
});
