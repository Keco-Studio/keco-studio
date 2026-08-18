/** @jest-environment jsdom */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextEncoder } from 'util';
import { PIXEL_ART_V1_PRESET } from '@/lib/game-art-style/presets';
import type { GameArtStyleSnapshot } from '@/lib/game-art-style/schema';
import type { GameDesignSystemVersion } from '@/lib/services/gameDesignSystemService';
import { GameDesignSystemVersionEditor } from './GameDesignSystemVersionEditor';

global.TextEncoder = TextEncoder as typeof global.TextEncoder;

jest.mock('./GameDesignSystemsPage.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));

const designDocument = {
  gameBackground: 'A rain-bound archipelago rebuilt around tidal routes.',
  designIntent: 'Make tactical intent legible before commitment.',
  playerFantasy: 'Lead a compact expedition.',
  coreLoop: 'Scout, commit, resolve, and adapt.',
  decisionStructure: 'Trade safety for position.',
  systemBoundaries: 'Hide outcomes, never costs.',
  progressionEconomy: 'Widen options without invalidating old tools.',
  contentModel: 'Combine objectives, terrain, and enemy roles.',
  difficultyBalance: 'Increase pressure instead of stats.',
  experiencePresentation: 'Show intent at the point of action.',
};

const rules = {
  schemaVersion: 1 as const,
  genres: ['Strategy'],
  philosophies: ['Readable Systems'],
  suitableFor: 'Turn-based tactical games',
  rules: [{
    id: 'readable-state',
    kind: 'principle' as const,
    title: 'Readable state',
    statement: 'Show action inputs.',
    rationale: 'Players need confidence.',
    appliesWhen: 'Choosing an action.',
    severity: 'required' as const,
    evidence: 'Observed in playtests.',
  }, {
    id: 'bounded-randomness',
    kind: 'constraint' as const,
    title: 'Bounded randomness',
    statement: 'Keep outcome ranges visible.',
    appliesWhen: 'Resolving uncertain actions.',
    severity: 'recommended' as const,
  }],
  tableGuidance: [{ table: 'Units', purpose: 'Track combatants.', fields: ['Name', 'Role'] }],
};

const artStyle: GameArtStyleSnapshot = {
  ...(JSON.parse(JSON.stringify(PIXEL_ART_V1_PRESET)) as GameArtStyleSnapshot),
  customization: {
    direction: 'Warm route markers.',
    referenceGames: [{ name: 'Eastward', borrow: 'Compact material clusters.' }],
    avoid: 'Muddy silhouettes.',
  },
};

function version(overrides: Partial<GameDesignSystemVersion> = {}): GameDesignSystemVersion {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    system_id: 'system-1',
    version_number: 2,
    parent_version_id: '00000000-0000-4000-8000-000000000000',
    document: designDocument,
    rules,
    artStyle,
    artStyleReadError: null,
    rendered_markdown: '# Tactical Rules',
    source_snapshots: [],
    diff: { added: [], removed: [], changed: [], conflicts: [] },
    conflicts: [],
    content_hash: 'a'.repeat(64),
    created_by: 'user-1',
    created_at: '2026-08-18T00:00:00.000Z',
    ...overrides,
  };
}

function setup(overrides: Partial<React.ComponentProps<typeof GameDesignSystemVersionEditor>> = {}) {
  const props: React.ComponentProps<typeof GameDesignSystemVersionEditor> = {
    baseVersion: version(),
    currentVersionId: '11111111-1111-4111-8111-111111111111',
    pending: false,
    onCancel: jest.fn(),
    onCreate: jest.fn().mockResolvedValue(undefined),
    onRefreshLatest: jest.fn().mockResolvedValue(version()),
    ...overrides,
  };
  return { ...render(<GameDesignSystemVersionEditor {...props} />), props };
}

async function openSection(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('tab', { name }));
}

describe('GameDesignSystemVersionEditor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.confirm = jest.fn(() => true);
  });

  it('preserves a cross-domain draft, reviews concrete before/after values, and creates one partial replacement', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    const review = screen.getByRole('button', { name: 'Review changes' });
    expect((review as HTMLButtonElement).disabled).toBe(true);

    await user.clear(screen.getByLabelText('Game background & setting'));
    await user.type(screen.getByLabelText('Game background & setting'), 'A sunlit floating city linked by glider routes.');

    await openSection(user, 'Rules');
    await user.click(screen.getByRole('button', { name: 'System settings' }));
    await user.clear(screen.getByLabelText('Genres'));
    await user.type(screen.getByLabelText('Genres'), 'Strategy, Roguelike');
    await user.clear(screen.getByLabelText('Philosophies'));
    await user.type(screen.getByLabelText('Philosophies'), 'Readable Systems, Player Agency');
    await user.clear(screen.getByLabelText('Suitable for'));
    await user.type(screen.getByLabelText('Suitable for'), 'Tactical expeditions');
    await user.clear(screen.getByLabelText('Table 1 name'));
    await user.type(screen.getByLabelText('Table 1 name'), 'Expeditions');
    await user.clear(screen.getByLabelText('Table 1 purpose'));
    await user.type(screen.getByLabelText('Table 1 purpose'), 'Track routes and crews.');
    await user.clear(screen.getByLabelText('Table 1 fields'));
    await user.type(screen.getByLabelText('Table 1 fields'), 'Route, Crew, Risk');

    await user.click(screen.getByRole('button', { name: 'Readable state' }));
    await user.clear(screen.getByLabelText('Rule ID'));
    await user.type(screen.getByLabelText('Rule ID'), 'visible-intent');
    await user.selectOptions(screen.getByLabelText('Kind'), 'pattern');
    await user.clear(screen.getByLabelText('Rule title'));
    await user.type(screen.getByLabelText('Rule title'), 'Visible intent');
    await user.selectOptions(screen.getByLabelText('Severity'), 'warning');
    await user.clear(screen.getByLabelText('Rule statement'));
    await user.type(screen.getByLabelText('Rule statement'), 'Preview action costs and outcomes.');
    await user.clear(screen.getByLabelText('Applies when'));
    await user.type(screen.getByLabelText('Applies when'), 'Committing a crew action.');
    await user.clear(screen.getByLabelText('Rationale'));
    await user.type(screen.getByLabelText('Rationale'), 'Commitment should be informed.');
    await user.clear(screen.getByLabelText('Evidence'));
    await user.type(screen.getByLabelText('Evidence'), 'Validated in expedition tests.');

    await openSection(user, 'Art Style');
    await user.clear(screen.getByLabelText('Custom art direction'));
    await user.type(screen.getByLabelText('Custom art direction'), 'Bright aerial landmarks.');
    await user.clear(screen.getByLabelText('Visual reference game 1'));
    await user.type(screen.getByLabelText('Visual reference game 1'), 'Skies of Arcadia');
    await user.clear(screen.getByLabelText('What to borrow 1'));
    await user.type(screen.getByLabelText('What to borrow 1'), 'Readable airborne silhouettes.');
    await user.clear(screen.getByLabelText('Visual avoid guidance'));
    await user.type(screen.getByLabelText('Visual avoid guidance'), 'Dense ground clutter.');

    await openSection(user, 'Document');
    expect((screen.getByLabelText('Game background & setting') as HTMLTextAreaElement).value).toBe('A sunlit floating city linked by glider routes.');
    await openSection(user, 'Rules');
    expect((screen.getByLabelText('Rule title') as HTMLInputElement).value).toBe('Visible intent');
    await openSection(user, 'Art Style');
    expect((screen.getByLabelText('Custom art direction') as HTMLTextAreaElement).value).toBe('Bright aerial landmarks.');

    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(screen.getByRole('tab', { name: 'Review' }).getAttribute('aria-selected')).toBe('true');
    const summary = screen.getByRole('tabpanel', { name: 'Review' });
    for (const concreteValue of [
      designDocument.gameBackground,
      'A sunlit floating city linked by glider routes.',
      'Strategy',
      'Roguelike',
      'Readable Systems',
      'Player Agency',
      'Turn-based tactical games',
      'Tactical expeditions',
      'readable-state',
      'visible-intent',
      'principle',
      'pattern',
      'Readable state',
      'Visible intent',
      'Show action inputs.',
      'Preview action costs and outcomes.',
      'Players need confidence.',
      'Commitment should be informed.',
      'Choosing an action.',
      'Committing a crew action.',
      'required',
      'warning',
      'Observed in playtests.',
      'Validated in expedition tests.',
      'Units',
      'Expeditions',
      'Track combatants.',
      'Track routes and crews.',
      'Name, Role',
      'Route, Crew, Risk',
      'Warm route markers.',
      'Bright aerial landmarks.',
      'Eastward: Compact material clusters.',
      'Skies of Arcadia: Readable airborne silhouettes.',
      'Muddy silhouettes.',
      'Dense ground clutter.',
    ]) expect(within(summary).queryAllByText(concreteValue, { exact: false }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Create version' }));
    await waitFor(() => expect(props.onCreate).toHaveBeenCalledTimes(1));
    expect(props.onCreate).toHaveBeenCalledWith({
      parentVersionId: '11111111-1111-4111-8111-111111111111',
      expectedCurrentVersionId: '11111111-1111-4111-8111-111111111111',
      document: { ...designDocument, gameBackground: 'A sunlit floating city linked by glider routes.' },
      rules: {
        schemaVersion: 1,
        genres: ['Strategy', 'Roguelike'],
        philosophies: ['Readable Systems', 'Player Agency'],
        suitableFor: 'Tactical expeditions',
        rules: [{
          id: 'visible-intent',
          kind: 'pattern',
          title: 'Visible intent',
          statement: 'Preview action costs and outcomes.',
          rationale: 'Commitment should be informed.',
          appliesWhen: 'Committing a crew action.',
          severity: 'warning',
          evidence: 'Validated in expedition tests.',
        }, rules.rules[1]],
        tableGuidance: [{ table: 'Expeditions', purpose: 'Track routes and crews.', fields: ['Route', 'Crew', 'Risk'] }],
      },
      artStyle: {
        presetId: 'pixel-art',
        presetVersion: 1,
        customization: {
          direction: 'Bright aerial landmarks.',
          referenceGames: [{ name: 'Skies of Arcadia', borrow: 'Readable airborne silhouettes.' }],
          avoid: 'Dense ground clutter.',
        },
      },
    });
  });

  it('restores the no-op state when a value is changed back to its original', async () => {
    const user = userEvent.setup();
    setup();
    const field = screen.getByLabelText('Game background & setting');
    await user.type(field, ' changed');
    expect((screen.getByRole('button', { name: 'Review changes' }) as HTMLButtonElement).disabled).toBe(false);
    await user.clear(field);
    await user.type(field, designDocument.gameBackground);
    expect((screen.getByRole('button', { name: 'Review changes' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('restores no-op when an originally absent background is changed and cleared', async () => {
    const user = userEvent.setup();
    setup({ baseVersion: version({ document: { ...designDocument, gameBackground: undefined } }) });
    const field = screen.getByLabelText('Game background & setting');
    await user.type(field, 'Temporary setting');
    expect((screen.getByRole('button', { name: 'Review changes' }) as HTMLButtonElement).disabled).toBe(false);
    await user.clear(field);
    expect((screen.getByRole('button', { name: 'Review changes' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('returns to and focuses an invalid field without losing the draft', async () => {
    const user = userEvent.setup();
    setup();
    await user.clear(screen.getByLabelText('Design intent'));
    await openSection(user, 'Art Style');
    await user.clear(screen.getByLabelText('Custom art direction'));
    await user.type(screen.getByLabelText('Custom art direction'), 'Preserved art draft');
    await user.click(screen.getByRole('button', { name: 'Review changes' }));

    expect(screen.getByRole('tab', { name: 'Document' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain('Complete every required document section.');
    await waitFor(() => expect(globalThis.document.activeElement).toBe(screen.getByLabelText('Design intent')));
    await openSection(user, 'Art Style');
    expect((screen.getByLabelText('Custom art direction') as HTMLTextAreaElement).value).toBe('Preserved art draft');
  });

  it('confirms dirty cancellation and leaves a declined draft open', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.type(screen.getByLabelText('Design intent'), ' changed');
    (window.confirm as jest.Mock).mockReturnValueOnce(false).mockReturnValueOnce(true);

    await user.click(screen.getByRole('button', { name: 'Cancel version draft' }));
    expect(window.confirm).toHaveBeenCalledWith('Discard this version draft?');
    expect(props.onCancel).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel version draft' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('retains the reviewed draft after a failed save', async () => {
    const onCreate = jest.fn().mockRejectedValue(new Error('Network unavailable'));
    const user = userEvent.setup();
    setup({ onCreate });
    await user.type(screen.getByLabelText('Game background & setting'), ' with sky ferries');
    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    await user.click(screen.getByRole('button', { name: 'Create version' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Network unavailable');
    expect(screen.getByText(/with sky ferries/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create version' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Retry latest version' })).toBeNull();
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('invalidates a reviewed request when the draft is edited again', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.type(screen.getByLabelText('Game background & setting'), ' with sky ferries');
    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    await user.click(screen.getByRole('button', { name: 'Back to editor' }));
    await user.type(screen.getByLabelText('Game background & setting'), ' and signal towers');
    await openSection(user, 'Review');

    expect(screen.getByText(/No reviewed draft yet/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create version' }) as HTMLButtonElement).disabled).toBe(true);
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it('supports roving keyboard section navigation', async () => {
    const user = userEvent.setup();
    setup();
    const documentTab = screen.getByRole('tab', { name: 'Document' });
    const rulesTab = screen.getByRole('tab', { name: 'Rules' });
    const reviewTab = screen.getByRole('tab', { name: 'Review' });

    documentTab.focus();
    await user.keyboard('{ArrowRight}');
    expect(globalThis.document.activeElement).toBe(rulesTab);
    expect(rulesTab.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{End}');
    expect(globalThis.document.activeElement).toBe(reviewTab);
    await user.keyboard('{Home}');
    expect(globalThis.document.activeElement).toBe(documentTab);
    await user.keyboard('{ArrowLeft}');
    expect(globalThis.document.activeElement).toBe(reviewTab);
  });

  it('warns when editing from a historical base', () => {
    setup({ currentVersionId: '22222222-2222-4222-8222-222222222222' });
    expect(screen.getByRole('status').textContent).toContain('Version 2 is historical');
    expect(screen.getByRole('status').textContent).toContain('current version');
  });

  it('inherits an unsupported Art Style exactly unless replacement is explicit', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    setup({
      baseVersion: version({ artStyle: null, artStyleReadError: { code: 'UNSUPPORTED_SNAPSHOT' } }),
      onCreate,
    });
    await openSection(user, 'Art Style');
    expect(screen.getByRole('status').textContent).toContain('unsupported Art Style snapshot');
    expect(screen.queryByLabelText('Custom art direction')).toBeNull();

    await openSection(user, 'Document');
    await user.type(screen.getByLabelText('Design intent'), ' Updated.');
    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    await user.click(screen.getByRole('button', { name: 'Create version' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).not.toHaveProperty('artStyle');
  });

  it('can undo an explicit unsupported Art Style replacement without losing other domains', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    setup({ baseVersion: version({ artStyle: null, artStyleReadError: { code: 'UNSUPPORTED_SNAPSHOT' } }), onCreate });
    await user.type(screen.getByLabelText('Design intent'), ' Updated.');
    await openSection(user, 'Art Style');
    await user.click(screen.getByRole('button', { name: 'Replace with Pixel Art' }));
    expect(screen.getByRole('button', { name: 'Undo Art Style changes' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Undo Art Style changes' }));
    expect(screen.getByRole('status').textContent).toContain('unsupported Art Style snapshot');
    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    await user.click(screen.getByRole('button', { name: 'Create version' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0].document.designIntent).toContain('Updated.');
    expect(onCreate.mock.calls[0][0]).not.toHaveProperty('artStyle');
  });

  it('focuses the concrete invalid Rule and Art Style fields', async () => {
    const user = userEvent.setup();
    setup();
    await openSection(user, 'Rules');
    await user.clear(screen.getByLabelText('Rule title'));
    await openSection(user, 'Art Style');
    await user.click(screen.getByRole('button', { name: 'Add visual reference' }));
    await user.type(screen.getByLabelText('Visual reference game 2'), 'Incomplete reference');
    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    await waitFor(() => expect(globalThis.document.activeElement).toBe(screen.getByLabelText('Rule title')));
    await user.type(screen.getByLabelText('Rule title'), 'Restored title');
    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    await waitFor(() => expect(globalThis.document.activeElement).toBe(screen.getByLabelText('What to borrow 2')));
  });

  it('keeps compact filtered rule selection consistent and can leave settings', async () => {
    const user = userEvent.setup();
    setup();
    await openSection(user, 'Rules');
    await user.type(screen.getByLabelText('Search rules'), 'bounded');
    await waitFor(() => expect((screen.getByLabelText('Selected rule') as HTMLSelectElement).selectedOptions[0]?.text).toBe('Bounded randomness'));
    await user.click(screen.getByRole('button', { name: 'System settings' }));
    await user.selectOptions(screen.getByLabelText('Selected rule'), 'Bounded randomness');
    expect((screen.getByLabelText('Rule title') as HTMLInputElement).value).toBe('Bounded randomness');
  });

  it('keeps duplicate-ID validation focused on the rule that introduced it', async () => {
    const user = userEvent.setup();
    setup();
    await openSection(user, 'Rules');
    await user.selectOptions(screen.getByLabelText('Selected rule'), 'Bounded randomness');
    await user.clear(screen.getByLabelText('Rule ID'));
    await user.type(screen.getByLabelText('Rule ID'), 'readable-state');
    await user.click(screen.getByRole('button', { name: 'Review changes' }));

    await waitFor(() => expect(globalThis.document.activeElement).toBe(screen.getByLabelText('Rule ID')));
    expect((screen.getByLabelText('Rule title') as HTMLInputElement).value).toBe('Bounded randomness');
    expect(screen.getByRole('alert').textContent).toContain('Duplicate rule ID');
  });

  it('keeps a stale draft, refreshes explicitly, and copies selected domains onto the latest version', async () => {
    const stale = Object.assign(new Error('The Game Design System changed.'), { code: 'VERSION_STALE' });
    const latest = version({
      id: '33333333-3333-4333-8333-333333333333',
      version_number: 3,
      document: { ...designDocument, gameBackground: 'A newly current desert setting.' },
    });
    const onCreate = jest.fn().mockRejectedValueOnce(stale).mockResolvedValueOnce(undefined);
    const onRefreshLatest = jest.fn().mockResolvedValue(latest);
    const user = userEvent.setup();
    setup({ onCreate, onRefreshLatest });
    await user.clear(screen.getByLabelText('Game background & setting'));
    await user.type(screen.getByLabelText('Game background & setting'), 'Keep this island draft.');
    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    await user.click(screen.getByRole('button', { name: 'Create version' }));

    await waitFor(() => expect(onRefreshLatest).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('alert').textContent).toContain('Version 3 is now current');
    expect((screen.getByRole('checkbox', { name: 'Copy Document changes' }) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Start fresh draft' }));
    expect((screen.getByLabelText('Game background & setting') as HTMLTextAreaElement).value).toBe('Keep this island draft.');
    expect(screen.getByText('Based on current version 3')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    await user.click(screen.getByRole('button', { name: 'Create version' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
    expect(onCreate.mock.calls[1][0]).toEqual(expect.objectContaining({
      parentVersionId: latest.id,
      expectedCurrentVersionId: latest.id,
      document: { ...latest.document, gameBackground: 'Keep this island draft.' },
    }));
  });

  it('retains the original stale draft and offers refresh retry when latest loading fails', async () => {
    const stale = Object.assign(new Error('stale'), { code: 'VERSION_STALE' });
    const onRefreshLatest = jest.fn().mockRejectedValue(new Error('Refresh unavailable'));
    const user = userEvent.setup();
    setup({ onCreate: jest.fn().mockRejectedValue(stale), onRefreshLatest });
    await user.type(screen.getByLabelText('Game background & setting'), ' retained');
    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    await user.click(screen.getByRole('button', { name: 'Create version' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Refresh unavailable');
    expect(screen.getByRole('button', { name: 'Retry latest version' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back to editor' }));
    expect((screen.getByLabelText('Game background & setting') as HTMLTextAreaElement).value).toBe(designDocument.gameBackground + ' retained');
  });
});
