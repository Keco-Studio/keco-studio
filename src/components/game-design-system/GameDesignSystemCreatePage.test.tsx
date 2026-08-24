/** @jest-environment jsdom */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PIXEL_ART_V2_PRESET } from '@/lib/game-art-style/presets';
import { GameDesignSystemCreatePage } from './GameDesignSystemCreatePage';

const push = jest.fn();
const start = jest.fn();
const fetchOptions = jest.fn();
const fetchSystems = jest.fn();
const retry = jest.fn();

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
  fetchGameDesignSystemGenerationJob: jest.fn(),
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

async function selectPixelArt(user: ReturnType<typeof userEvent.setup>) {
  const pixelArt = screen.getByRole('radio', { name: /Pixel Art/ });
  if (pixelArt.getAttribute('aria-checked') !== 'true') await user.click(pixelArt);
}

async function continueToReview(user: ReturnType<typeof userEvent.setup>) {
  await selectPixelArt(user);
  await user.click(screen.getByRole('button', { name: 'Continue to sources' }));
  await user.click(screen.getByRole('button', { name: 'Review input' }));
}

describe('GameDesignSystemCreatePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    retry.mockResolvedValue({ id: 'job-1', status: 'queued', phase: 'collecting', attempt_count: 1, max_attempts: 3, available_at: new Date().toISOString() });
  });

  it('starts without an Art Style and requires an explicit catalog selection', async () => {
    const user = userEvent.setup();
    renderPage();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs.map((tab) => tab.textContent)).toEqual(['1Foundation', '2Art Style', '3Sources', '4Review']);
    expect(screen.getByRole('tab', { name: 'Foundation' }).getAttribute('aria-selected')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Continue to art style' }));
    const pixelArt = screen.getByRole('radio', { name: /Pixel Art/ });
    const catalog = screen.getAllByRole('radio');
    expect(catalog).toHaveLength(5);
    expect(catalog.every((option) => option.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(pixelArt.tabIndex).toBe(0);
    expect(screen.getByLabelText('No Art Style selected')).toBeTruthy();
    expect(screen.getByText('Select an Art Style to preview its visual direction.')).toBeTruthy();
    expect(screen.getByText(/Recommended.*Official preset.*Revision 2/)).toBeTruthy();

    await user.type(screen.getByLabelText('Custom art direction'), 'Bright route markers.');
    await user.type(screen.getByLabelText('Visual avoid guidance'), 'Low contrast.');
    await user.click(screen.getByRole('button', { name: 'Continue to sources' }));
    const fieldError = screen.getByRole('alert');
    expect(fieldError.textContent).toBe('Select an Art Style before continuing.');
    await waitFor(() => expect(document.activeElement).toBe(fieldError));
    expect(screen.getByRole('tab', { name: 'Art Style' }).getAttribute('aria-selected')).toBe('true');

    pixelArt.focus();
    await user.keyboard('{ArrowDown}');
    const flatGraphic = screen.getByRole('radio', { name: /Flat Graphic 2D/ });
    expect(document.activeElement).toBe(flatGraphic);
    expect(flatGraphic.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Flat Graphic 2D preview')).toBeTruthy();

    await user.click(pixelArt);
    expect(pixelArt.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Pixel Art preview')).toBeTruthy();
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
    await selectPixelArt(user);

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
    await selectPixelArt(user);
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

  it('returns direct Review submission to Art Style when no preset was selected', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('tab', { name: 'Review' }));
    expect(within(screen.getByLabelText('Art Style summary')).getByText('Not selected')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Generate system' }));

    expect(screen.getByRole('tab', { name: 'Art Style' }).getAttribute('aria-selected')).toBe('true');
    const fieldError = screen.getByRole('alert');
    expect(fieldError.textContent).toBe('Select an Art Style before generating.');
    await waitFor(() => expect(document.activeElement).toBe(fieldError));
    expect(start).not.toHaveBeenCalled();
  });

  it('submits an explicitly selected preset with empty customization', async () => {
    const user = userEvent.setup();
    renderPage();
    await enterRequiredFoundation(user);
    await continueToReview(user);

    await user.click(screen.getByRole('button', { name: 'Generate system' }));

    await waitFor(() => expect(start).toHaveBeenCalledWith(expect.objectContaining({
      artStyle: {
        presetId: 'pixel-art',
        presetVersion: 2,
        customization: { direction: '', referenceGames: [], avoid: '' },
      },
    }), expect.any(String)));
  });

  it('summarizes Art Style and submits only preset identity plus normalized customization', async () => {
    const user = userEvent.setup();
    renderPage();
    await enterRequiredFoundation(user);
    await selectPixelArt(user);
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
    expect(within(summary).getByText('Pixel Art')).toBeTruthy();
    expect(within(summary).getByText('Revision 2')).toBeTruthy();
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
  });

  it('retains Art Style values after a failed creation request', async () => {
    start.mockRejectedValueOnce(new Error('Network unavailable'));
    const user = userEvent.setup();
    renderPage();
    await enterRequiredFoundation(user);
    await selectPixelArt(user);
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
    await selectPixelArt(user);
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
    await selectPixelArt(user);
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
});
