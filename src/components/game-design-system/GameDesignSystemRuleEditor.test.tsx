/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameDesignRuleSet, GameRulesKernel, LegacyGameDesignRuleSet } from '@/lib/game-design-system/ruleSchema';
import { GameDesignSystemRuleEditor } from './GameDesignSystemRuleEditor';

jest.mock('./GameDesignSystemsPage.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));

const requiredDomains = [
  'player',
  'objective',
  'action',
  'object_state',
  'sequence',
  'resource_cost',
  'resolution_feedback',
  'fallback',
] as const;

const kernel: GameRulesKernel = {
  schemaVersion: 2,
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  suitableFor: 'Tactical games',
  rules: requiredDomains.map((domain) => ({
    id: `${domain.replaceAll('_', '-')}-rule`,
    domain,
    kind: domain === 'action' || domain === 'resource_cost' ? 'constraint' : 'principle',
    title: `${domain} rule`,
    statement: `Define ${domain}.`,
    appliesWhen: 'Resolving gameplay.',
    severity: 'required',
  })),
  tableGuidance: [],
};

const legacy: LegacyGameDesignRuleSet = {
  schemaVersion: 1,
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  suitableFor: 'Tactical games',
  rules: [{
    id: 'legacy-rule',
    kind: 'principle',
    title: 'Legacy rule',
    statement: 'Keep its legacy shape.',
    appliesWhen: 'Reviewing legacy systems.',
    severity: 'recommended',
  }],
  tableGuidance: [],
};

describe('GameDesignSystemRuleEditor', () => {
  it('shows a v2 domain selector and filters rules by gameplay domain', async () => {
    const user = userEvent.setup();
    render(<GameDesignSystemRuleEditor value={kernel} onChange={() => undefined} />);

    expect((screen.getByLabelText('Domain') as HTMLSelectElement).value).toBe('player');
    await user.selectOptions(screen.getByLabelText('Filter by gameplay domain'), 'action');

    expect((screen.getByLabelText('Rule title') as HTMLInputElement).value).toBe('action rule');
    expect(screen.queryByRole('button', { name: 'player rule' })).toBeNull();
  });

  it('adds v2 rules with the explicit player domain default', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<GameDesignSystemRuleEditor value={kernel} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /Add rule/ }));

    const next = onChange.mock.calls.at(-1)?.[0] as GameDesignRuleSet;
    expect(next.rules.at(-1)).toEqual(expect.objectContaining({ domain: 'player' }));
  });

  it('keeps v1 draft payloads domain-free when adding rules', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<GameDesignSystemRuleEditor value={legacy} onChange={onChange} />);

    expect(screen.queryByLabelText('Domain')).toBeNull();
    expect(screen.queryByLabelText('Filter by gameplay domain')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Add rule/ }));

    const next = onChange.mock.calls.at(-1)?.[0] as GameDesignRuleSet;
    expect(next.rules.at(-1)).not.toHaveProperty('domain');
  });
});
