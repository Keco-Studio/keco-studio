/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { AgentMapVersionLibrary } from '@/components/agent/AgentMapVersionLibrary';

const id = (suffix: string) => `10000000-0000-4000-8000-0000000000${suffix}`;

describe('AgentMapVersionLibrary', () => {
  it('keeps Plan-only entries selectable and opens each Map under its owning Plan', () => {
    const onBasePlanChange = jest.fn();
    const onOpenMap = jest.fn();
    render(
      <AgentMapVersionLibrary
        snapshot={{
          id: id('01'), projectId: id('02'), title: 'Island delivery', messages: [], nodes: [],
          planNodes: [{
            id: id('03'), type: 'plan', displayVersion: 1, displayLabel: 'Plan V1', parentPlanNodeId: null,
            mapProjectId: id('04'), mapPlanVersionId: id('05'), createdAt: '2026-10-23T01:00:00.000Z',
            maps: [{
              id: id('06'), type: 'map', planNodeId: id('03'), revisionId: id('07'), assetId: id('08'),
              mapVersionNumber: 1, status: 'ready', displayLabel: 'Map V1.1', createdAt: '2026-10-23T01:01:00.000Z',
            }],
          }],
        }}
        basePlanNodeId={null}
        onBasePlanChange={onBasePlanChange}
        onOpenMap={onOpenMap}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Map assets' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Plan V1' }));
    expect(onBasePlanChange).toHaveBeenCalledWith(id('03'));

    fireEvent.click(screen.getByRole('menuitem', { name: /Map V1.1 ready/i }));
    expect(onOpenMap).toHaveBeenCalledWith({ mapProjectId: id('04'), mapRevisionId: id('07') });
    expect(onBasePlanChange).toHaveBeenLastCalledWith(id('03'));
  });
});
