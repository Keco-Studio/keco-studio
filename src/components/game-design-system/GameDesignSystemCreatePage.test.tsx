/** @jest-environment jsdom */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PIXEL_ART_V2_PRESET } from '@/lib/game-art-style/presets';
import { GDS_GENERATION_RECOVERY_KEY } from '@/lib/game-design-system/generationRecovery';
import { GameDesignSystemCreatePage } from './GameDesignSystemCreatePage';

const push = jest.fn();
const start = jest.fn();
const fetchOptions = jest.fn();
const fetchSystems = jest.fn();
const retry = jest.fn();
const fetchJob = jest.fn();

jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/lib/contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: { id: 'viewer-1' } }),
}));
jest.mock('./GameDesignSystemsPage.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));
jest.mock('@/lib/services/gameDesignSystemClient', () => ({
  fetchGameDesignSystems: (...args: unknown[]) => fetchSystems(...args),
  fetchGameDesignReferenceOptions: (...args: unknown[]) => fetchOptions(...args),
  fetchGameDesignSystemGenerationJob: (...args: unknown[]) => fetchJob(...args),
  retryGameDesignSystemGeneration: (...args: unknown[]) => retry(...args),
  startGameDesignSystemGeneration: (...args: unknown[]) => start(...args),
}));

function renderPage(props: React.ComponentProps<typeof GameDesignSystemCreatePage> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GameDesignSystemCreatePage {...props} />
    </QueryClientProvider>,
  );
}

async function enterRequiredFoundation(user: ReturnType<typeof userEvent.setup>, title = 'Tactical Rules') {
  await user.type(screen.getByLabelText('System name'), title);
  await user.click(screen.getByRole('button', { name: 'RPG' }));
  await user.click(screen.getByRole('button', { name: 'Continue to art style' }));
}

async function continueToReview(user: ReturnType<typeof userEvent.setup>, { fillArtStyle = true } = {}) {
  const artDirection = screen.getByLabelText('Custom art direction') as HTMLTextAreaElement;
  if (fillArtStyle && !artDirection.value) await user.type(artDirection, 'Readable visual hierarchy.');
  await user.click(screen.getByRole('button', { name: 'Continue to sources' }));
  await user.click(screen.getByRole('button', { name: 'Review input' }));
}

describe('GameDesignSystemCreatePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => [{ id: '11111111-1111-4111-8111-111111111111', name: 'Project A' }],
    })) as jest.Mock;
    fetchOptions.mockResolvedValue([
      { kind: 'document', projectId: '11111111-1111-4111-8111-111111111111', resourceId: '22222222-2222-4222-8222-222222222222', label: 'Combat GDD', updatedAt: '2026-08-14' },
      { kind: 'table', projectId: '11111111-1111-4111-8111-111111111111', resourceId: '33333333-3333-4333-8333-333333333333', label: 'Skills', updatedAt: '2026-08-14' },
    ]);
    fetchSystems.mockResolvedValue([]);
    start.mockResolvedValue({ id: 'job-1', status: 'queued', phase: 'collecting', attempt_count: 0, max_attempts: 3 });
    fetchJob.mockResolvedValue({ id: 'job-1', status: 'queued', phase: 'collecting', attempt_count: 0, max_attempts: 3 });
    retry.mockResolvedValue({ id: 'job-1', status: 'queued', phase: 'collecting', attempt_count: 1, max_attempts: 3, available_at: new Date().toISOString() });
  });

  it('uses four numbered stages and presents the offered style catalog', async () => {
    const user = userEvent.setup();
    renderPage();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs.map((tab) => tab.textContent)).toEqual(['1Foundation', '2Art Style', '3Sources', '4Review']);
    expect(screen.getByRole('tab', { name: 'Foundation' }).getAttribute('aria-selected')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Continue to art style' }));
    const pixelArt = screen.getByRole('radio', { name: /Pixel Art/ });
    expect(pixelArt.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/Official preset \/ Revision 2/)).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
  });

  it('canonicalizes preset matches and ignores duplicate custom genre entries', async () => {
    const user = userEvent.setup();
    renderPage();

    const genreInput = screen.getByLabelText('Game genres');
    await user.type(genreInput, 'rpg{Enter}');
    await user.type(genreInput, 'Cozy RPG{Enter}');
    await user.type(genreInput, 'cozy rpg{Enter}');

    expect(screen.getByRole('button', { name: 'Remove game genre RPG' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Remove game genre Cozy RPG' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'RPG' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('removes a selected genre tag and updates its preset state', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'RPG' }));
    await user.click(screen.getByRole('button', { name: 'Remove game genre RPG' }));

    expect(screen.queryByRole('button', { name: 'Remove game genre RPG' })).toBeNull();
    expect(screen.getByRole('button', { name: 'RPG' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps focus on a read-only design philosophy input at the request limit', () => {
    renderPage();

    const philosophyInput = screen.getByLabelText('Design philosophies') as HTMLInputElement;
    const addButton = screen.getByRole('button', { name: 'Add design philosophy' });
    for (let index = 1; index <= 20; index += 1) {
      fireEvent.change(philosophyInput, { target: { value: `Principle ${index}` } });
      fireEvent.click(addButton);
    }

    expect(screen.getAllByRole('button', { name: /Remove design philosophy/ })).toHaveLength(20);
    expect(philosophyInput.disabled).toBe(false);
    expect(philosophyInput.readOnly).toBe(true);
    expect(document.activeElement).toBe(philosophyInput);
    expect(screen.getByText('20 / 20')).toBeTruthy();
  });

  it('submits custom genre and philosophy tags', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('System name'), 'Cozy Rules');
    await user.type(screen.getByLabelText('Game genres'), 'Cozy RPG{Enter}');
    await user.type(screen.getByLabelText('Design philosophies'), 'Intentional Friction');
    await user.click(screen.getByRole('button', { name: 'Add design philosophy' }));
    await user.click(screen.getByRole('button', { name: 'Continue to art style' }));
    await user.click(screen.getByRole('button', { name: 'Continue to sources' }));
    await user.click(screen.getByRole('button', { name: 'Review input' }));
    await user.click(screen.getByRole('button', { name: 'Generate system' }));

    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0][0]).toMatchObject({
      title: 'Cozy Rules',
      genres: ['Cozy RPG'],
      philosophies: ['Intentional Friction'],
    });
  });

  it('commits custom tags when the user leaves their inputs without pressing Enter', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('System name'), 'Story Maze');
    await user.click(screen.getByRole('button', { name: 'Narrative' }));
    await user.type(screen.getByLabelText('Game genres'), 'Mystery Maze');
    await user.click(screen.getByLabelText('Design philosophies'));
    await user.click(screen.getByRole('button', { name: 'Meaningful Decisions' }));
    await user.type(screen.getByLabelText('Design philosophies'), 'Discovery First');
    await user.click(screen.getByRole('button', { name: 'Continue to art style' }));
    await user.click(screen.getByRole('button', { name: 'Continue to sources' }));
    await user.click(screen.getByRole('button', { name: 'Review input' }));

    expect(screen.getByText('Narrative, Mystery Maze')).toBeTruthy();
    expect(screen.getByText('Meaningful Decisions, Discovery First')).toBeTruthy();
  });

  it('connects tabs to panels and supports roving keyboard navigation', async () => {
    const user = userEvent.setup();
    renderPage();

    const foundation = screen.getByRole('tab', { name: 'Foundation' });
    const artStyle = screen.getByRole('tab', { name: 'Art Style' });
    const review = screen.getByRole('tab', { name: 'Review' });
    expect(foundation.id).toBe('gds-create-tab-foundation');
    expect(foundation.getAttribute('aria-controls')).toBe('gds-create-panel-foundation');
    expect(foundation.tabIndex).toBe(0);
    expect(artStyle.tabIndex).toBe(-1);
    expect(screen.getByRole('tabpanel').id).toBe('gds-create-panel-foundation');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(foundation.id);

    foundation.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(artStyle);
    expect(artStyle.getAttribute('aria-selected')).toBe('true');
    expect(artStyle.tabIndex).toBe(0);
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(artStyle.id);

    await user.keyboard('{End}');
    expect(document.activeElement).toBe(review);
    expect(review.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(foundation);
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(review);
  });

  it('shows canonical copy, fixed previews, field limits, dynamic references, and independent image failures', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Continue to art style' }));

    const mapAsset = PIXEL_ART_V2_PRESET.previewAssetSet.map;
    const characterAsset = PIXEL_ART_V2_PRESET.previewAssetSet.character;
    const map = screen.getByAltText(mapAsset.alt);
    const character = screen.getByAltText(characterAsset.alt);
    expect(map.getAttribute('width')).toBe(String(mapAsset.width));
    expect(map.getAttribute('height')).toBe(String(mapAsset.height));
    expect(character.getAttribute('width')).toBe(String(characterAsset.width));
    expect(character.getAttribute('height')).toBe(String(characterAsset.height));
    expect(screen.getByRole('heading', { name: 'Visual DNA' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Craft/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText(PIXEL_ART_V2_PRESET.specification.visualIdentity)).toBeTruthy();
    expect(screen.getByLabelText('Custom art direction').getAttribute('maxLength')).toBe('2000');
    expect(screen.getByLabelText('Visual avoid guidance').getAttribute('maxLength')).toBe('1000');

    await user.click(screen.getByRole('button', { name: 'Add visual reference' }));
    expect(screen.getByLabelText('Visual reference game 1').getAttribute('maxLength')).toBe('120');
    expect(screen.getByLabelText('What to borrow 1').getAttribute('maxLength')).toBe('500');
    await user.click(screen.getByRole('button', { name: 'Remove visual reference 1' }));
    expect(screen.queryByLabelText('Visual reference game 1')).toBeNull();

    fireEvent.error(map);
    expect(screen.getByRole('status', { name: `Map preview unavailable. ${mapAsset.alt}` })).toBeTruthy();
    expect(screen.getByAltText(characterAsset.alt)).toBeTruthy();
    fireEvent.error(character);
    expect(screen.getByRole('status', { name: `Character preview unavailable. ${characterAsset.alt}` })).toBeTruthy();
  });

  it('returns incomplete visual reference rows to Art Style and preserves entered values', async () => {
    const user = userEvent.setup();
    renderPage();
    await enterRequiredFoundation(user);
    await user.click(screen.getByRole('button', { name: 'Add visual reference' }));
    await user.type(screen.getByLabelText('Visual reference game 1'), 'Eastward');
    await continueToReview(user);

    await user.click(screen.getByRole('button', { name: 'Generate system' }));

    expect(screen.getByRole('tab', { name: 'Art Style' }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText('Visual reference game 1') as HTMLInputElement).value).toBe('Eastward');
    const borrowInput = screen.getByLabelText('What to borrow 1');
    const fieldError = screen.getByRole('alert');
    expect(fieldError.id).toBe('gds-visual-reference-error');
    expect(fieldError.getAttribute('aria-live')).toBe('polite');
    expect(fieldError.textContent).toBe('Enter both a game name and what to borrow.');
    expect(borrowInput.getAttribute('aria-invalid')).toBe('true');
    expect(borrowInput.getAttribute('aria-describedby')).toBe(fieldError.id);
    await waitFor(() => expect(document.activeElement).toBe(borrowInput));
    expect(start).not.toHaveBeenCalled();
  });

  it('allows the default Pixel Art style with no optional customization', async () => {
    const user = userEvent.setup();
    renderPage();
    await enterRequiredFoundation(user);
    await continueToReview(user, { fillArtStyle: false });

    await user.click(screen.getByRole('button', { name: 'Generate system' }));

    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0][0].artStyle).toEqual({
      presetId: 'pixel-art',
      presetVersion: 2,
      customization: {
        direction: '',
        referenceGames: [],
        avoid: '',
      },
    });
  });

  it('summarizes Art Style and submits only preset identity plus normalized customization', async () => {
    const user = userEvent.setup();
    renderPage();
    await enterRequiredFoundation(user);
    await user.type(screen.getByLabelText('Custom art direction'), '  Brighter route markers.  ');
    await user.click(screen.getByRole('button', { name: 'Add visual reference' }));
    await user.type(screen.getByLabelText('Visual reference game 1'), '  Eastward  ');
    await user.type(screen.getByLabelText('What to borrow 1'), '  Material clusters.  ');
    await user.type(screen.getByLabelText('Visual avoid guidance'), '  Muddy silhouettes.  ');
    await user.click(screen.getByRole('button', { name: 'Continue to sources' }));
    await user.click(screen.getByRole('button', { name: 'Add reference game' }));
    await user.type(screen.getByLabelText('Reference game 1'), 'Into the Breach');
    await user.type(screen.getByLabelText('Reference value 1'), 'Readable intent');
    await user.type(screen.getByLabelText('Reference avoid 1'), 'Direct copying');
    await user.click(screen.getByRole('button', { name: 'Review input' }));

    const summary = screen.getByLabelText('Art Style summary');
    expect(within(summary).getByRole('heading', { name: 'Pixel Art' })).toBeTruthy();
    const presetRow = within(summary).getByText('Preset').closest('div');
    expect(presetRow).not.toBeNull();
    expect(within(presetRow!).getByText('Pixel Art')).toBeTruthy();
    expect(within(summary).queryByText('Revision 2')).toBeNull();
    expect(within(summary).getByText('Brighter route markers.')).toBeTruthy();
    expect(within(summary).getByText('Eastward: Material clusters.')).toBeTruthy();
    expect(within(summary).getByText('Muddy silhouettes.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Generate system' }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0][0]).toEqual({
      title: 'Tactical Rules',
      genres: ['RPG'],
      philosophies: [],
      references: [],
      referenceGames: [{ name: 'Into the Breach', reference: 'Readable intent', avoid: 'Direct copying' }],
      artStyle: {
        presetId: 'pixel-art',
        presetVersion: 2,
        customization: {
          direction: 'Brighter route markers.',
          referenceGames: [{ name: 'Eastward', borrow: 'Material clusters.' }],
          avoid: 'Muddy silhouettes.',
        },
      },
    });
    expect(start.mock.calls[0][0].artStyle).not.toHaveProperty('specification');
    expect(start.mock.calls[0][0].artStyle).not.toHaveProperty('previewAssetSet');
    expect(start.mock.calls[0][0].artStyle).not.toHaveProperty('assets');
  }, 15_000);

  it('retains Art Style values after a failed creation request', async () => {
    start.mockRejectedValueOnce(new Error('Network unavailable'));
    const user = userEvent.setup();
    renderPage();
    await enterRequiredFoundation(user);
    await user.type(screen.getByLabelText('Custom art direction'), 'Warm daylight');
    await user.click(screen.getByRole('button', { name: 'Add visual reference' }));
    await user.type(screen.getByLabelText('Visual reference game 1'), 'Eastward');
    await user.type(screen.getByLabelText('What to borrow 1'), 'Material grouping');
    await user.type(screen.getByLabelText('Visual avoid guidance'), 'Low contrast');
    await continueToReview(user);
    await user.click(screen.getByRole('button', { name: 'Generate system' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Network unavailable');

    await user.click(screen.getByRole('tab', { name: 'Art Style' }));
    expect((screen.getByLabelText('Custom art direction') as HTMLTextAreaElement).value).toBe('Warm daylight');
    expect((screen.getByLabelText('Visual reference game 1') as HTMLInputElement).value).toBe('Eastward');
    expect((screen.getByLabelText('What to borrow 1') as HTMLInputElement).value).toBe('Material grouping');
    expect((screen.getByLabelText('Visual avoid guidance') as HTMLTextAreaElement).value).toBe('Low contrast');
  });

  it('selects real project resources and submits their IDs', async () => {
    const user = userEvent.setup();
    renderPage();
    await enterRequiredFoundation(user);
    await user.type(screen.getByLabelText('Custom art direction'), 'Readable visual hierarchy.');
    await user.click(screen.getByRole('button', { name: 'Continue to sources' }));
    await screen.findByRole('option', { name: 'Project A' });
    await user.selectOptions(await screen.findByLabelText('Source project'), '11111111-1111-4111-8111-111111111111');
    await user.click(await screen.findByRole('checkbox', { name: /Combat GDD/ }));
    await user.click(screen.getByRole('button', { name: 'Review input' }));
    await user.click(screen.getByRole('button', { name: 'Generate system' }));
    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Tactical Rules',
      references: [{ kind: 'document', projectId: '11111111-1111-4111-8111-111111111111', resourceId: '22222222-2222-4222-8222-222222222222' }],
    }), expect.any(String)));
  });

  it('disables only unselected project resources at the request limit', async () => {
    fetchOptions.mockResolvedValue(Array.from({ length: 11 }, (_, index) => ({
      kind: 'document',
      projectId: '11111111-1111-4111-8111-111111111111',
      resourceId: `22222222-2222-4222-8222-${String(index + 1).padStart(12, '0')}`,
      label: `Source ${index + 1}`,
      updatedAt: '2026-08-14',
    })));
    const user = userEvent.setup();
    renderPage();
    await enterRequiredFoundation(user);
    await user.click(screen.getByRole('button', { name: 'Continue to sources' }));
    await user.selectOptions(await screen.findByLabelText('Source project'), '11111111-1111-4111-8111-111111111111');
    const resources = await screen.findAllByRole('checkbox');

    for (const resource of resources.slice(0, 10)) await user.click(resource);

    expect(resources.slice(0, 10).every((resource) => !(resource as HTMLInputElement).disabled)).toBe(true);
    expect((resources[10] as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Project resources: 10 / 10')).toBeTruthy();

    await user.click(resources[0]);

    expect((resources[10] as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText('Project resources: 9 / 10')).toBeTruthy();
  });

  it('disables adding reference games at the request limit and restores it after removal', async () => {
    const user = userEvent.setup();
    renderPage();
    await enterRequiredFoundation(user);
    await user.click(screen.getByRole('button', { name: 'Continue to sources' }));
    const addButton = screen.getByRole('button', { name: 'Add reference game' });

    for (let index = 0; index < 10; index += 1) await user.click(addButton);

    expect(screen.getAllByLabelText(/^Reference game \d+$/)).toHaveLength(10);
    expect((addButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Reference games: 10 / 10')).toBeTruthy();

    await user.click(screen.getAllByRole('button', { name: 'Remove reference game' })[0]);

    expect((addButton as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('Reference games: 9 / 10')).toBeTruthy();
  });

  it('lists selected source names in Review and omits the output contract', async () => {
    fetchSystems.mockResolvedValue([
      { id: 'official-1', title: 'Official Rules', source: 'official', owner_id: null },
    ]);
    const user = userEvent.setup();
    renderPage();
    await enterRequiredFoundation(user);
    await user.click(screen.getByRole('button', { name: 'Continue to sources' }));

    await user.selectOptions(await screen.findByLabelText('Base system'), 'official-1');
    await user.selectOptions(screen.getByLabelText('Source project'), '11111111-1111-4111-8111-111111111111');
    await user.click(await screen.findByRole('checkbox', { name: /Combat GDD/ }));
    await user.click(screen.getByRole('button', { name: 'Add reference game' }));
    await user.type(screen.getByLabelText('Reference game 1'), 'Into the Breach');
    await user.click(screen.getByRole('button', { name: 'Review input' }));

    const sources = screen.getByRole('region', { name: 'Sources summary' });
    expect(within(sources).getByRole('heading', { name: 'Selected source material' })).toBeTruthy();
    expect(within(sources).getByText('Combat GDD / Document')).toBeTruthy();
    expect(within(sources).getByText('Into the Breach')).toBeTruthy();
    expect(within(sources).getByText('Official Rules')).toBeTruthy();
    expect(screen.queryByText('Output contract')).toBeNull();
    expect(screen.queryByText('Validated structured rules')).toBeNull();
  });

  it('retries a failed durable job without creating a replacement request', async () => {
    start.mockResolvedValueOnce({ id: 'job-1', status: 'failed', phase: 'failed', attempt_count: 1, max_attempts: 3, error: 'bad schema', available_at: new Date().toISOString() });
    const user = userEvent.setup();
    renderPage();
    await enterRequiredFoundation(user, 'Retry Rules');
    await continueToReview(user);
    await user.click(screen.getByRole('button', { name: 'Generate system' }));
    await user.click(await screen.findByRole('button', { name: /Retry job/ }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith('job-1', expect.any(String)));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('offers only official and viewer-owned systems as generation bases', async () => {
    fetchSystems.mockResolvedValue([
      { id: 'official-1', title: 'Official Rules', source: 'official', owner_id: null },
      { id: 'mine-1', title: 'My Rules', source: 'user', owner_id: 'viewer-1' },
      { id: 'external-1', title: 'Collaborator Draft', source: 'user', owner_id: 'author-2' },
    ]);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Continue to art style' }));
    await user.click(screen.getByRole('button', { name: 'Continue to sources' }));

    expect(await screen.findByRole('option', { name: 'Official Rules (Official)' })).not.toBeNull();
    expect(screen.getByRole('option', { name: 'My Rules (My system)' })).not.toBeNull();
    expect(screen.queryByRole('option', { name: /Collaborator Draft/ })).toBeNull();
  });

  it('returns a completed generated system to the embedded workspace', async () => {
    const completed = jest.fn();
    start.mockResolvedValueOnce({
      id: 'job-1', status: 'completed', phase: 'completed', attempt_count: 1, max_attempts: 1,
      design_system_id: 'system-generated', output_version_id: 'version-generated',
    });
    const user = userEvent.setup();
    renderPage({ embedded: true, onCompleted: completed });

    await enterRequiredFoundation(user, 'Generated tactics');
    await continueToReview(user);
    await user.click(screen.getByRole('button', { name: 'Generate system' }));

    await waitFor(() => expect(completed).toHaveBeenCalledWith('system-generated'));
    expect(push).not.toHaveBeenCalled();
  });

  it('restores raw draft fields and the selected stage after refresh', async () => {
    window.sessionStorage.setItem(GDS_GENERATION_RECOVERY_KEY, JSON.stringify({
      version: 1, ownerId: 'viewer-1', phase: 'draft', updatedAt: Date.now(),
      form: { stage: 'art-style', title: 'Recovered rules', genres: ['RPG'], philosophies: [], description: 'Saved draft', suitableFor: '', artDirection: 'Warm light', selectedArtStyleKey: 'pixel-art-v2', visualReferences: [{ name: 'Eastward', borrow: '' }], artAvoid: '', baseSystemId: '', pastedMarkdown: '', sourceProjectId: '', references: [], referenceGames: [] },
    }));
    renderPage();
    expect(await screen.findByDisplayValue('Warm light')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Art Style' }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText('Visual reference game 1') as HTMLInputElement).value).toBe('Eastward');
  });

  it('blocks an over-limit recovered draft until excess sources are removed', async () => {
    const options = Array.from({ length: 11 }, (_, index) => ({
      kind: 'document' as const,
      projectId: '11111111-1111-4111-8111-111111111111',
      resourceId: `22222222-2222-4222-8222-${String(index + 1).padStart(12, '0')}`,
      label: `Recovered source ${index + 1}`,
      updatedAt: '2026-08-14',
    }));
    fetchOptions.mockResolvedValue(options);
    window.sessionStorage.setItem(GDS_GENERATION_RECOVERY_KEY, JSON.stringify({
      version: 1, ownerId: 'viewer-1', phase: 'draft', updatedAt: Date.now(),
      form: {
        stage: 'review', title: 'Recovered rules', genres: ['RPG'], philosophies: [], description: '', suitableFor: '',
        artDirection: '', selectedArtStyleKey: 'pixel-art-v2', visualReferences: [], artAvoid: '', baseSystemId: '', pastedMarkdown: '',
        sourceProjectId: '11111111-1111-4111-8111-111111111111',
        references: options.map(({ kind, projectId, resourceId }) => ({ kind, projectId, resourceId })),
        referenceGames: Array.from({ length: 11 }, (_, index) => ({ name: `Game ${index + 1}`, reference: '', avoid: '' })),
      },
    }));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Generate system' }));

    expect(screen.getByRole('tab', { name: 'Sources' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain('Remove project resources and reference games until each has 10 or fewer.');
    expect(screen.getByText('Project resources: 11 / 10')).toBeTruthy();
    expect(screen.getByText('Reference games: 11 / 10')).toBeTruthy();
    expect(start).not.toHaveBeenCalled();

    await user.click((await screen.findAllByRole('checkbox'))[0]);
    await user.click(screen.getAllByRole('button', { name: 'Remove reference game' })[0]);
    await user.click(screen.getByRole('button', { name: 'Review input' }));
    await user.click(screen.getByRole('button', { name: 'Generate system' }));

    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  });

  it('returns an over-limit submitted recovery request to an editable draft', async () => {
    const referenceGames = Array.from({ length: 11 }, (_, index) => ({ name: `Game ${index + 1}`, reference: '', avoid: '' }));
    window.sessionStorage.setItem(GDS_GENERATION_RECOVERY_KEY, JSON.stringify({
      version: 1, ownerId: 'viewer-1', phase: 'submitted', updatedAt: Date.now(), idempotencyKey: 'stale-submit-key',
      form: {
        stage: 'review', title: 'Recovered rules', genres: ['RPG'], philosophies: [], description: '', suitableFor: '',
        artDirection: '', selectedArtStyleKey: 'pixel-art-v2', visualReferences: [], artAvoid: '', baseSystemId: '', pastedMarkdown: '',
        sourceProjectId: '', references: [], referenceGames,
      },
      request: {
        title: 'Recovered rules', genres: ['RPG'], philosophies: [], references: [], referenceGames,
        artStyle: { presetId: 'pixel-art', presetVersion: 2, customization: { direction: '', referenceGames: [], avoid: '' } },
      },
    }));
    renderPage();

    expect((await screen.findByRole('tab', { name: 'Sources' })).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain('Remove reference games until 10 or fewer remain.');
    expect(screen.getAllByLabelText(/^Reference game \d+$/)).toHaveLength(11);
    expect(start).not.toHaveBeenCalled();
    const stored = JSON.parse(window.sessionStorage.getItem(GDS_GENERATION_RECOVERY_KEY) ?? '{}');
    expect(stored).toMatchObject({ phase: 'draft', form: { stage: 'sources' } });
  });

  it('resumes a submitted job by id without creating another request', async () => {
    window.sessionStorage.setItem(GDS_GENERATION_RECOVERY_KEY, JSON.stringify({
      version: 1, ownerId: 'viewer-1', phase: 'submitted', updatedAt: Date.now(), jobId: 'job-existing', idempotencyKey: 'submit-key',
      form: { stage: 'review', title: 'Recovered rules', genres: ['RPG'], philosophies: [], description: '', suitableFor: '', artDirection: '', selectedArtStyleKey: 'pixel-art-v2', visualReferences: [], artAvoid: '', baseSystemId: '', pastedMarkdown: '', sourceProjectId: '', references: [], referenceGames: [] },
      request: { title: 'Recovered rules', genres: ['RPG'], philosophies: [], references: [], referenceGames: [], artStyle: { presetId: 'pixel-art', presetVersion: 2, customization: { direction: '', referenceGames: [], avoid: '' } } },
    }));
    fetchJob.mockResolvedValueOnce({ id: 'job-existing', status: 'failed', phase: 'failed', attempt_count: 1, max_attempts: 3, error: { message: 'Try again' } });
    renderPage();
    expect(await screen.findByRole('button', { name: /Retry job/ })).toBeTruthy();
    expect(fetchJob).toHaveBeenCalledWith('job-existing');
    expect(start).not.toHaveBeenCalled();
  });
});
