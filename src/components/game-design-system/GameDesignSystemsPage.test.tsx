/** @jest-environment jsdom */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextEncoder } from 'util';
import { GameDesignSystemsPage } from './GameDesignSystemsPage';

global.TextEncoder = TextEncoder as typeof global.TextEncoder;

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children),
}));

const updateMetadata = jest.fn();
const applyVersion = jest.fn();
const clearBinding = jest.fn();
const createVersion = jest.fn();
const fetchSystems = jest.fn();
const fetchDetail = jest.fn();
const fetchBinding = jest.fn();
const push = jest.fn();
const system = {
  id: 'system-1', owner_id: 'user-1', source: 'user', title: 'Tactical Rules', summary: 'Old summary',
  genres: ['Strategy'], philosophies: ['Readable Systems'], suitable_for: 'Tactical games', body: '', provenance: {}, status: 'draft',
  current_version_id: 'version-1', migration_status: 'ready', generation_job_id: null, created_at: '', updated_at: '',
};
const designDocument = {
  designIntent: 'Make every tactical choice legible before commitment.',
  playerFantasy: 'Lead a compact squad through risky, recoverable decisions.',
  coreLoop: 'Scout, commit, resolve consequences, then adapt the squad plan.',
  decisionStructure: 'Trade immediate safety for positional advantage.',
  systemBoundaries: 'Uncertainty may hide outcomes but never action costs.',
  progressionEconomy: 'New tools widen options without invalidating old ones.',
  contentModel: 'Combine objectives, terrain pressure, and enemy roles.',
  difficultyBalance: 'Increase decision pressure instead of inflating stats.',
  experiencePresentation: 'Show intent, costs, and state changes at the point of action.',
};
const artStyleSnapshot = {
  schemaVersion: 1 as const,
  presetId: 'pixel-art' as const,
  presetVersion: 1 as const,
  title: 'Pixel Art' as const,
  previewAssetSet: {
    id: 'pixel-art-v1' as const,
    map: {
      sourcePath: 'public/game-art-styles/pixel-art/v1/map.png',
      publicPath: '/game-art-styles/pixel-art/v1/map.png',
      width: 168,
      height: 96,
      alt: 'A bright pixel art riverside village map with branching paths, gardens, workshops, and a wooden bridge.',
      sha256: 'a'.repeat(64),
      bytes: 18174,
      alpha: 'opaque' as const,
    },
    character: {
      sourcePath: 'public/game-art-styles/pixel-art/v1/character.png',
      publicPath: '/game-art-styles/pixel-art/v1/character.png',
      width: 96,
      height: 96,
      alt: 'A full-body pixel art field cartographer with a satchel and practical exploration gear.',
      sha256: 'b'.repeat(64),
      bytes: 2514,
      alpha: 'transparent' as const,
    },
    supporting: [],
  },
  specification: {
    visualIdentity: 'Welcoming top-down adventure pixel art with practical landmarks, open routes, and calm exploration as the dominant visual read.',
    pixelTechnique: 'Use crisp native-resolution pixel clusters without antialiasing, one-pixel material-colored contours, selective internal outlines, and two or three deliberate shade steps per material.',
    shapeLanguage: 'Favor clear asymmetrical silhouettes, breathable clusters, broad primary paths, compact secondary details, and off-center landmarks over perfect symmetry or enclosed arenas.',
    paletteAndLighting: 'Use fresh greens, clear blues, honey and walnut timber, warm gray stone, restrained terracotta, and pale golden daylight with short readable shadows cast down-right.',
    characterDirection: 'Build clearly adult characters with natural anatomy, grounded practical poses, readable equipment, friendly neutral expressions, and silhouettes that remain distinct at thumbnail size.',
    environmentDirection: 'Compose maps around immediately legible traversal hierarchy, multiple routes continuing beyond the frame, recognizable material zones, and useful landmarks with generous walkable space.',
    propDirection: 'Construct props from simple readable masses, limited material palettes, and restrained highlights; each prop should communicate one gameplay purpose without decorative clutter.',
    effectsDirection: 'Keep effects compact and rhythmic with a strong core shape, a limited frame-to-frame palette, and brief readable accents that do not obscure characters or traversal.',
    uiHudDirection: 'Use compact pixel-aligned panels, high-contrast icons, plain readable labels, and restrained ornament; UI must remain legible without relying on the preview images.',
    animationDirection: 'Animate with economical key poses, stable silhouettes, intentional holds, and consistent pixel volumes; avoid subpixel movement and automatic smoothing.',
    accessibility: 'Maintain clear value separation between walkable terrain, obstacles, characters, and interaction targets; never rely on hue alone, and avoid flicker, generated text, horror, gore, or uncanny anatomy.',
  },
  customization: {
    direction: 'Keep route markers warm and immediately readable.',
    referenceGames: [{ name: 'Eastward', borrow: 'Compact material clusters and practical props.' }],
    avoid: 'Avoid muddy silhouettes and decorative clutter.',
  },
};
const version = {
  id: 'version-1', system_id: 'system-1', version_number: 1, parent_version_id: null,
  document: designDocument,
  rules: { schemaVersion: 1, genres: ['Strategy'], philosophies: ['Readable Systems'], suitableFor: 'Tactical games', rules: [{ id: 'readable-state', kind: 'principle', title: 'Readable state', statement: 'Show inputs.', appliesWhen: 'Choosing.', severity: 'required' }], tableGuidance: [] },
  artStyle: artStyleSnapshot,
  rendered_markdown: '# Tactical Rules', source_snapshots: [], diff: { added: ['readable-state'], removed: [], changed: [], conflicts: [] }, conflicts: [], content_hash: 'a'.repeat(64), created_by: 'user-1', created_at: '',
};

jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/lib/contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: { id: 'user-1' } }),
}));
jest.mock('./GameDesignSystemsPage.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));
jest.mock('@/lib/services/gameDesignSystemClient', () => ({
  fetchGameDesignSystems: (...args: unknown[]) => fetchSystems(...args),
  fetchGameDesignSystem: (...args: unknown[]) => fetchDetail(...args),
  updateGameDesignSystemDraft: (...args: unknown[]) => updateMetadata(...args),
  createGameDesignSystemVersion: (...args: unknown[]) => createVersion(...args),
  copyGameDesignSystemDraft: jest.fn(),
  deleteGameDesignSystem: jest.fn(),
  applyProjectGameDesignSystem: (...args: unknown[]) => applyVersion(...args),
  clearProjectGameDesignSystem: (...args: unknown[]) => clearBinding(...args),
  fetchProjectGameDesignSystem: (...args: unknown[]) => fetchBinding(...args),
}));

describe('GameDesignSystemsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.confirm = jest.fn(() => true);
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [] })) as jest.Mock;
    updateMetadata.mockResolvedValue({ ...system, summary: 'New summary' });
    applyVersion.mockResolvedValue(null);
    clearBinding.mockResolvedValue(undefined);
    createVersion.mockResolvedValue({ ...version, id: 'version-2', version_number: 2, parent_version_id: 'version-1' });
    fetchBinding.mockResolvedValue(null);
    fetchSystems.mockResolvedValue([system]);
    fetchDetail.mockResolvedValue({ ...system, current_version: version, versions: [version] });
  });

  it('keeps Official visible as a real empty library state', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByText('Tactical Rules');
    await user.click(screen.getByRole('tab', { name: /Official/ }));

    expect(screen.getByText('No official systems yet.')).toBeTruthy();
    expect(screen.queryByText('Tactical Rules')).toBeNull();
  });

  it('keeps official presets read-only', async () => {
    const user = userEvent.setup();
    const official = {
      ...system,
      id: 'official-system',
      owner_id: null,
      source: 'official',
      title: 'Official Tactical Rules',
    };
    const officialVersion = { ...version, system_id: official.id };
    fetchSystems.mockResolvedValue([official]);
    fetchDetail.mockResolvedValue({
      ...official,
      current_version: officialVersion,
      versions: [officialVersion],
    });

    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);
    await user.click(await screen.findByRole('tab', { name: /Official/ }));
    expect(await screen.findByRole('heading', { name: 'Design document' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit details' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit document' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy and edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete system' })).toBeNull();
  });

  it('switches selected-system views without routing', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    expect(await screen.findByRole('heading', { name: 'Design document' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText(designDocument.designIntent)).toBeTruthy();
    expect(screen.queryByText(JSON.stringify(designDocument))).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Rules' }));

    expect(screen.getByText('readable-state')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('shows the current immutable art style snapshot between Overview and Rules', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    const viewTabs = within(screen.getByRole('tablist', { name: 'Game Design System views' })).getAllByRole('tab');
    expect(viewTabs.map((tab) => tab.textContent)).toEqual(['Overview', 'Art Style', 'Rules', 'Versions', 'Sources', 'Projects']);
    await user.click(screen.getByRole('tab', { name: 'Art Style' }));

    expect(screen.getByRole('img', { name: artStyleSnapshot.previewAssetSet.map.alt })).toBeTruthy();
    expect(screen.getByRole('img', { name: artStyleSnapshot.previewAssetSet.character.alt })).toBeTruthy();
    expect(screen.getByText('Revision 1')).toBeTruthy();
    for (const value of Object.values(artStyleSnapshot.specification)) expect(screen.getByText(value)).toBeTruthy();
    expect(screen.getByText(artStyleSnapshot.customization.direction)).toBeTruthy();
    expect(screen.getByText(artStyleSnapshot.customization.referenceGames[0].name)).toBeTruthy();
    expect(screen.getByText(artStyleSnapshot.customization.referenceGames[0].borrow)).toBeTruthy();
    expect(screen.getByText(artStyleSnapshot.customization.avoid)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /edit art style/i })).toBeNull();
  });

  it('shows the stored historical art style snapshot after switching versions', async () => {
    const user = userEvent.setup();
    const historicalArtStyle = {
      ...artStyleSnapshot,
      specification: {
        ...artStyleSnapshot.specification,
        visualIdentity: 'Historical stored identity independent from the current preset registry.',
      },
      customization: {
        direction: 'Historical amber route markers.',
        referenceGames: [{ name: 'Chrono Trigger', borrow: 'Historical landmark grouping.' }],
        avoid: 'Historical avoid guidance.',
      },
    };
    const current = { ...version, id: 'version-2', version_number: 2, parent_version_id: 'version-1' };
    const historical = { ...version, artStyle: historicalArtStyle };
    fetchDetail.mockResolvedValue({ ...system, current_version_id: current.id, current_version: current, versions: [current, historical] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('tab', { name: 'Art Style' }));
    expect(screen.getByText(artStyleSnapshot.specification.visualIdentity)).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Version' }), historical.id);

    expect(screen.getByText(historicalArtStyle.specification.visualIdentity)).toBeTruthy();
    expect(screen.getByText(historicalArtStyle.customization.direction)).toBeTruthy();
    expect(screen.queryByText(artStyleSnapshot.specification.visualIdentity)).toBeNull();
  });

  it('shows the exact legacy art style empty state without affecting other views', async () => {
    const user = userEvent.setup();
    const legacyVersion = { ...version, artStyle: null };
    fetchDetail.mockResolvedValue({ ...system, current_version: legacyVersion, versions: [legacyVersion] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('tab', { name: 'Art Style' }));
    expect(screen.getByText('No art style specified').textContent).toBe('No art style specified');
    await user.click(screen.getByRole('tab', { name: 'Rules' }));
    expect(screen.getByText('readable-state')).toBeTruthy();
  });

  it('isolates a failed art style image while keeping the other image and text readable', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('tab', { name: 'Art Style' }));
    fireEvent.error(screen.getByRole('img', { name: artStyleSnapshot.previewAssetSet.map.alt }));

    expect(screen.getByRole('status', { name: `Map preview unavailable. ${artStyleSnapshot.previewAssetSet.map.alt}` })).toBeTruthy();
    expect(screen.getByRole('img', { name: artStyleSnapshot.previewAssetSet.character.alt })).toBeTruthy();
    expect(screen.getByText(artStyleSnapshot.specification.visualIdentity)).toBeTruthy();
    expect(screen.getByText(artStyleSnapshot.customization.direction)).toBeTruthy();
  });

  it('renders every selected-system view from loaded data', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [{ id: 'project-1', name: 'Project A' }] })) as jest.Mock;
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('tab', { name: 'Versions' }));
    expect(screen.getByRole('heading', { name: 'Version 1' })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Sources' }));
    expect(screen.getByText('No source snapshots for this version.')).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Projects' }));
    expect((await screen.findAllByText('Project A')).length).toBeGreaterThan(0);
    expect(push).not.toHaveBeenCalled();
  });

  it('opens creation in the workspace without routing', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('button', { name: 'Create Game Design System' }));
    expect(screen.getByRole('heading', { name: 'Create Game Design System' })).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('creates a version only after reviewing a structured rule draft', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('tab', { name: 'Rules' }));
    await user.click(screen.getByRole('button', { name: 'New version' }));
    await user.click(screen.getByRole('button', { name: 'Readable state' }));
    const statement = screen.getByLabelText('Rule statement');
    await user.clear(statement);
    await user.type(statement, 'Show all decision inputs.');
    expect(createVersion).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    await user.click(screen.getByRole('button', { name: 'Create version' }));
    await waitFor(() => expect(createVersion).toHaveBeenCalledWith(
      'system-1',
      expect.objectContaining({ rules: expect.arrayContaining([expect.objectContaining({ statement: 'Show all decision inputs.' })]) }),
      'version-1',
    ));
  });

  it('creates a new immutable version after reviewing document edits', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('tab', { name: 'Rules' }));
    await user.click(screen.getByRole('button', { name: 'Edit document' }));
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Copy and edit' })).toBeNull();
    const intent = screen.getByLabelText('Design intent');
    await user.clear(intent);
    await user.type(intent, 'Make every consequence readable.');
    expect(createVersion).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Review document' }));
    expect(screen.getByText('Make every consequence readable.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create version' }));

    await waitFor(() => expect(createVersion).toHaveBeenCalledWith(
      'system-1',
      version.rules,
      'version-1',
      expect.objectContaining({ designIntent: 'Make every consequence readable.' }),
    ));
  });

  it('keeps a dirty document draft when navigation is not confirmed', async () => {
    const confirm = jest.fn(() => false);
    window.confirm = confirm;
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('button', { name: 'Edit document' }));
    const intent = screen.getByLabelText('Design intent');
    await user.clear(intent);
    await user.type(intent, 'Keep this unsaved draft.');
    await user.click(screen.getByRole('tab', { name: 'Rules' }));

    expect(confirm).toHaveBeenCalledWith('Discard unsaved Game Design System changes?');
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText('Design intent') as HTMLTextAreaElement).value).toBe('Keep this unsaved draft.');
  });

  it('keeps the current scope and draft when a dirty scope change is rejected', async () => {
    const confirm = jest.fn(() => false);
    window.confirm = confirm;
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('button', { name: 'Edit document' }));
    await user.type(screen.getByLabelText('Design intent'), ' Unsaved.');
    await user.click(screen.getByRole('tab', { name: /Official/ }));

    expect(confirm).toHaveBeenCalledWith('Discard unsaved Game Design System changes?');
    expect(screen.getByRole('tab', { name: /My Systems/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Design intent')).toBeTruthy();
  });

  it('resets metadata after a confirmed discard', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    const summary = screen.getByLabelText('System summary');
    await user.clear(summary);
    await user.type(summary, 'Discarded summary');
    await user.click(screen.getByRole('button', { name: 'Cancel editing details' }));
    await user.click(screen.getByRole('button', { name: 'Edit details' }));

    expect((screen.getByLabelText('System summary') as HTMLTextAreaElement).value).toBe('Old summary');
  });

  it('renders structured version rules and edits metadata rather than Markdown body', async () => {
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);
    expect(await screen.findByRole('heading', { name: 'Design document' })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Rules' }));
    expect(await screen.findByText('readable-state')).toBeTruthy();
    expect(screen.getByRole('option', { name: /Version 1/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    const summary = screen.getByLabelText('System summary');
    await user.clear(summary);
    await user.type(summary, 'New summary');
    await user.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(updateMetadata).toHaveBeenCalledWith('system-1', expect.objectContaining({ summary: 'New summary' })));
    expect(screen.queryByLabelText('Edit GAME_DESIGN_SYSTEM.md')).toBeNull();
  });

  it('binds the explicitly selected version to a project', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => [{ id: 'project-1', name: 'Project A' }] })) as jest.Mock;
    const user = userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);
    await screen.findByRole('heading', { name: 'Design document' });
    await user.click(screen.getByRole('tab', { name: 'Projects' }));
    await screen.findByRole('option', { name: 'Project A' });
    await user.selectOptions(screen.getByLabelText('Select project'), 'project-1');
    await user.click(screen.getByRole('button', { name: 'Use version 1' }));
    await waitFor(() => expect(applyVersion).toHaveBeenCalledWith('project-1', 'system-1', 'version-1'));
  });

  it('does not classify another user\'s readable system as mine', async () => {
    fetchSystems.mockResolvedValue([{ ...system, id: 'foreign-system', owner_id: 'user-2', title: 'Foreign Rules' }]);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);
    expect(await screen.findByText('No personal systems yet.')).toBeTruthy();
    expect(screen.queryByText('Foreign Rules')).toBeNull();
  });

  it('shows the parent version, changed IDs, and conflict reasons', async () => {
    const parent = { ...version, id: 'version-1', version_number: 1 };
    const current = {
      ...version,
      id: 'version-2',
      version_number: 2,
      parent_version_id: 'version-1',
      diff: { added: ['visible-costs'], removed: [], changed: ['readable-state'], conflicts: [{ ruleId: 'readable-state', reason: 'Rule kind changed from principle to constraint.' }] },
      conflicts: [{ ruleId: 'readable-state', reason: 'Rule kind changed from principle to constraint.' }],
    };
    fetchDetail.mockResolvedValue({ ...system, current_version_id: 'version-2', current_version: current, versions: [current, parent] });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><GameDesignSystemsPage /></QueryClientProvider>);
    await screen.findByRole('heading', { name: 'Design document' });
    await userEvent.click(screen.getByRole('tab', { name: 'Rules' }));
    expect(await screen.findByText('Based on version 1')).toBeTruthy();
    expect(screen.getByText('Changed: readable-state')).toBeTruthy();
    expect(screen.getByText('readable-state: Rule kind changed from principle to constraint.')).toBeTruthy();
  });
});
