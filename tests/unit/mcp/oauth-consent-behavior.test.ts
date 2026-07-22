import type { ReactElement, ReactNode } from 'react';

type EffectCleanup = () => void;
type EffectSlot = {
  kind: 'effect' | 'layout-effect';
  cleanup?: EffectCleanup;
  dependencies?: readonly unknown[];
  effect: () => EffectCleanup | void;
};
type StateSlot = { kind: 'state'; value: unknown };
type RefSlot = { kind: 'ref'; value: { current: unknown } };
type HookSlot = EffectSlot | StateSlot | RefSlot;

class HookRuntime {
  private cursor = 0;
  private pendingEffects: EffectSlot[] = [];
  private pendingLayoutEffects: EffectSlot[] = [];
  private slots: HookSlot[] = [];

  useState<T>(initialValue: T): [T, (value: T | ((previous: T) => T)) => void] {
    const index = this.cursor++;
    const previous = this.slots[index];
    if (previous && previous.kind !== 'state') throw new Error(`Hook order changed at ${index}`);
    const slot = previous ?? { kind: 'state' as const, value: initialValue };
    this.slots[index] = slot;
    return [slot.value as T, (value) => {
      slot.value = typeof value === 'function'
        ? (value as (previous: T) => T)(slot.value as T)
        : value;
    }];
  }

  useRef<T>(initialValue: T): { current: T } {
    const index = this.cursor++;
    const previous = this.slots[index];
    if (previous && previous.kind !== 'ref') throw new Error(`Hook order changed at ${index}`);
    const slot = previous ?? { kind: 'ref' as const, value: { current: initialValue } };
    this.slots[index] = slot;
    return slot.value as { current: T };
  }

  private scheduleEffect(
    kind: EffectSlot['kind'],
    pending: EffectSlot[],
    effect: EffectSlot['effect'],
    dependencies?: readonly unknown[]
  ): void {
    const index = this.cursor++;
    const previous = this.slots[index];
    if (previous && previous.kind !== kind) throw new Error(`Hook order changed at ${index}`);
    const previousEffect = previous as EffectSlot | undefined;
    const unchanged = previousEffect?.dependencies !== undefined
      && dependencies !== undefined
      && dependencies.length === previousEffect.dependencies.length
      && dependencies.every((value, dependencyIndex) =>
        Object.is(value, previousEffect.dependencies?.[dependencyIndex])
      );
    if (unchanged) return;
    const slot: EffectSlot = {
      kind,
      cleanup: previousEffect?.cleanup,
      dependencies,
      effect,
    };
    this.slots[index] = slot;
    pending.push(slot);
  }

  useEffect(effect: EffectSlot['effect'], dependencies?: readonly unknown[]): void {
    this.scheduleEffect('effect', this.pendingEffects, effect, dependencies);
  }

  useLayoutEffect(effect: EffectSlot['effect'], dependencies?: readonly unknown[]): void {
    this.scheduleEffect('layout-effect', this.pendingLayoutEffects, effect, dependencies);
  }

  private flush(effects: EffectSlot[]): void {
    for (const slot of effects) {
      slot.cleanup?.();
      const cleanup = slot.effect();
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    }
  }

  flushEffects(): void {
    const effects = this.pendingEffects;
    this.pendingEffects = [];
    this.flush(effects);
  }

  render<T>(component: () => T, flushEffects = true): T {
    this.cursor = 0;
    const result = component();
    const layoutEffects = this.pendingLayoutEffects;
    this.pendingLayoutEffects = [];
    this.flush(layoutEffects);
    if (flushEffects) this.flushEffects();
    return result;
  }

  stateValues(): unknown[] {
    return this.slots
      .filter((slot): slot is StateSlot => slot.kind === 'state')
      .map((slot) => slot.value);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; onClick?: () => void }>;

function findButton(node: ReactNode, label: string): Element {
  if (node && typeof node === 'object' && 'type' in node) {
    const element = node as Element;
    if (element.type === 'button' && element.props.children === label) return element;
    const children = Array.isArray(element.props.children)
      ? element.props.children
      : [element.props.children];
    for (const child of children) {
      try { return findButton(child, label); } catch { /* continue */ }
    }
  }
  throw new Error(`Missing ${label} button`);
}

const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_B = '22222222-2222-4222-8222-222222222222';
const projectResource = (projectId: string) => `https://abc.supabase.co/functions/v1/mcp/${projectId}`;
const authorizationDetails = (authorizationId: string) => ({
  authorization_id: authorizationId,
  client: { id: 'client-id', name: 'MCP Client', uri: 'https://client.example', logo_uri: '' },
  user: { id: 'user-id', email: 'user@example.com' },
  scope: '',
});

let runtime: HookRuntime;
let currentAuthorizationId: string;
const getAuthorizationDetails = jest.fn();
const approveAuthorization = jest.fn();
const denyAuthorization = jest.fn();
const getProject = jest.fn();
const getOAuthAuthorizationResource = jest.fn();
const prepareOAuthProjectGrant = jest.fn();
const finalizeOAuthProjectGrant = jest.fn();
const mockRouter = { replace: jest.fn() };
const assignLocation = jest.fn();
const mockSupabaseClient = {
  auth: { oauth: { getAuthorizationDetails, approveAuthorization, denyAuthorization } },
};
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

function queueFreshApprovalCheck() {
  getAuthorizationDetails.mockResolvedValueOnce({
    data: authorizationDetails('authorization-a'),
    error: null,
  });
  getOAuthAuthorizationResource.mockResolvedValueOnce(projectResource(PROJECT_A));
  getProject.mockResolvedValueOnce({ id: PROJECT_A, name: 'Project A' });
}

jest.mock('react', () => ({
  ...jest.requireActual<typeof import('react')>('react'),
  useEffect: (effect: EffectSlot['effect'], dependencies?: readonly unknown[]) =>
    runtime.useEffect(effect, dependencies),
  useLayoutEffect: (effect: EffectSlot['effect'], dependencies?: readonly unknown[]) =>
    runtime.useLayoutEffect(effect, dependencies),
  useState: <T,>(initialValue: T) => runtime.useState(initialValue),
  useRef: <T,>(initialValue: T) => runtime.useRef(initialValue),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => ({
    get: (name: string) => name === 'authorization_id' ? currentAuthorizationId : null,
  }),
}));
jest.mock('@/lib/SupabaseContext', () => ({
  useSupabase: () => mockSupabaseClient,
}));
jest.mock('@/lib/services/projectService', () => ({
  getProject: (...args: unknown[]) => getProject(...args),
}));
jest.mock('@/lib/mcp/oauthAuthorizationResource', () => ({
  getOAuthAuthorizationResource: (...args: unknown[]) => getOAuthAuthorizationResource(...args),
}));
jest.mock('@/lib/mcp/oauthProjectGrant', () => ({
  prepareOAuthProjectGrant: (...args: unknown[]) => prepareOAuthProjectGrant(...args),
  finalizeOAuthProjectGrant: (...args: unknown[]) => finalizeOAuthProjectGrant(...args),
}));
jest.mock('@/components/mcp/OAuthConsent.module.css', () => ({
  __esModule: true,
  default: {},
}));

import { OAuthConsentClient } from '@/components/mcp/OAuthConsentClient';

async function flushAsyncWork() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co';
  runtime = new HookRuntime();
  currentAuthorizationId = 'authorization-a';
  getAuthorizationDetails.mockReset();
  approveAuthorization.mockReset();
  denyAuthorization.mockReset();
  getProject.mockReset();
  getOAuthAuthorizationResource.mockReset();
  getOAuthAuthorizationResource.mockResolvedValue(projectResource(PROJECT_A));
  prepareOAuthProjectGrant.mockReset();
  prepareOAuthProjectGrant.mockResolvedValue(true);
  finalizeOAuthProjectGrant.mockReset();
  finalizeOAuthProjectGrant.mockResolvedValue(true);
  mockRouter.replace.mockReset();
  assignLocation.mockReset();
  Object.assign(globalThis, {
    window: { location: { assign: assignLocation } },
  });
});

afterAll(() => {
  if (originalSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
});

it('keeps approval blocked until access to the bound project is verified', async () => {
  const projectLookup = deferred<{ id: string; name: string }>();
  getAuthorizationDetails.mockResolvedValue({
    data: authorizationDetails('authorization-a'),
    error: null,
  });
  getProject.mockReturnValue(projectLookup.promise);

  runtime.render(OAuthConsentClient);
  await flushAsyncWork();
  const pendingTree = runtime.render(OAuthConsentClient);
  const pendingApprove = findButton(pendingTree, 'Approve');

  expect(pendingApprove.props.disabled).toBe(true);
  pendingApprove.props.onClick?.();
  expect(approveAuthorization).not.toHaveBeenCalled();

  projectLookup.resolve({ id: PROJECT_A, name: 'Project A' });
  await flushAsyncWork();
  const verifiedTree = runtime.render(OAuthConsentClient);
  expect(findButton(verifiedTree, 'Approve').props.disabled).toBe(false);
});

it.each([
  ['a missing', null],
  ['a malformed', 'https://abc.supabase.co/functions/v1/mcp/not-a-project'],
] as const)('keeps approval blocked when the resource adapter returns %s binding', async (_case, resource) => {
  getAuthorizationDetails.mockResolvedValueOnce({
    data: authorizationDetails('authorization-a'),
    error: null,
  });
  getOAuthAuthorizationResource.mockResolvedValueOnce(resource);

  runtime.render(OAuthConsentClient);
  await flushAsyncWork();
  const tree = runtime.render(OAuthConsentClient);

  expect(findButton(tree, 'Approve').props.disabled).toBe(true);
  expect(findButton(tree, 'Deny').props.disabled).toBe(false);
  expect(getProject).not.toHaveBeenCalled();
  expect(JSON.stringify(tree)).toContain(
    'Project binding was not preserved by the authorization server.'
  );

  denyAuthorization.mockResolvedValueOnce({
    data: { redirect_url: 'https://client.example/callback?error=access_denied' },
    error: null,
  });
  findButton(tree, 'Deny').props.onClick?.();
  await flushAsyncWork();

  expect(denyAuthorization).toHaveBeenCalledWith('authorization-a', {
    skipBrowserRedirect: true,
  });
  expect(assignLocation).toHaveBeenCalledWith(
    'https://client.example/callback?error=access_denied'
  );
});

it('treats resource adapter errors as missing bindings', async () => {
  getAuthorizationDetails.mockResolvedValueOnce({
    data: authorizationDetails('authorization-a'),
    error: null,
  });
  getOAuthAuthorizationResource.mockRejectedValueOnce(new Error('rpc failed'));

  runtime.render(OAuthConsentClient);
  await flushAsyncWork();
  const tree = runtime.render(OAuthConsentClient);

  expect(findButton(tree, 'Approve').props.disabled).toBe(true);
  expect(findButton(tree, 'Deny').props.disabled).toBe(false);
  expect(getProject).not.toHaveBeenCalled();
});

it('keeps denial available when existing consent bypassed project-bound approval', async () => {
  getAuthorizationDetails.mockResolvedValueOnce({
    data: {
      ...authorizationDetails('authorization-a'),
      redirect_url: 'https://client.example/callback',
    },
    error: null,
  });

  runtime.render(OAuthConsentClient);
  await flushAsyncWork();
  const tree = runtime.render(OAuthConsentClient);

  expect(findButton(tree, 'Approve').props.disabled).toBe(true);
  expect(findButton(tree, 'Deny').props.disabled).toBe(false);
  expect(JSON.stringify(tree)).toContain(
    'Existing OAuth consent bypassed the project-bound approval step.'
  );
});

it('reloads the same resource immediately before approving', async () => {
  getAuthorizationDetails
    .mockResolvedValueOnce({ data: authorizationDetails('authorization-a'), error: null })
    .mockResolvedValueOnce({ data: authorizationDetails('authorization-a'), error: null });
  getOAuthAuthorizationResource
    .mockResolvedValueOnce(projectResource(PROJECT_A))
    .mockResolvedValueOnce(projectResource(PROJECT_A));
  getProject
    .mockResolvedValueOnce({ id: PROJECT_A, name: 'Project A' })
    .mockResolvedValueOnce({ id: PROJECT_A, name: 'Project A' });
  approveAuthorization.mockResolvedValueOnce({
    data: { redirect_url: 'https://client.example/callback' },
    error: null,
  });

  runtime.render(OAuthConsentClient);
  await flushAsyncWork();
  findButton(runtime.render(OAuthConsentClient), 'Approve').props.onClick?.();
  await flushAsyncWork();

  expect(getOAuthAuthorizationResource).toHaveBeenCalledTimes(2);
  expect(getOAuthAuthorizationResource).toHaveBeenNthCalledWith(
    2,
    mockSupabaseClient,
    'authorization-a'
  );
  expect(prepareOAuthProjectGrant).toHaveBeenCalledWith(
    mockSupabaseClient,
    'authorization-a',
    PROJECT_A,
    projectResource(PROJECT_A)
  );
  expect(prepareOAuthProjectGrant.mock.invocationCallOrder[0]).toBeLessThan(
    approveAuthorization.mock.invocationCallOrder[0]
  );
  expect(approveAuthorization.mock.invocationCallOrder[0]).toBeLessThan(
    finalizeOAuthProjectGrant.mock.invocationCallOrder[0]
  );
  expect(finalizeOAuthProjectGrant).toHaveBeenCalledWith(
    mockSupabaseClient,
    'authorization-a',
    PROJECT_A,
    projectResource(PROJECT_A)
  );
  expect(approveAuthorization).toHaveBeenCalledWith('authorization-a', {
    skipBrowserRedirect: true,
  });
});

it.each([
  ['a rejected finalization', false],
  ['a failed finalization RPC', new Error('RPC unavailable')],
] as const)('does not redirect after %s', async (_case, finalizationResult) => {
  getAuthorizationDetails.mockResolvedValueOnce({
    data: authorizationDetails('authorization-a'),
    error: null,
  });
  getProject.mockResolvedValueOnce({ id: PROJECT_A, name: 'Project A' });
  runtime.render(OAuthConsentClient);
  await flushAsyncWork();

  queueFreshApprovalCheck();
  approveAuthorization.mockResolvedValueOnce({
    data: { redirect_url: 'https://client.example/callback' },
    error: null,
  });
  if (finalizationResult instanceof Error) {
    finalizeOAuthProjectGrant.mockRejectedValueOnce(finalizationResult);
  } else {
    finalizeOAuthProjectGrant.mockResolvedValueOnce(finalizationResult);
  }
  findButton(runtime.render(OAuthConsentClient), 'Approve').props.onClick?.();
  await flushAsyncWork();

  expect(assignLocation).not.toHaveBeenCalled();
  expect(JSON.stringify(runtime.render(OAuthConsentClient))).toContain(
    'Authorization grant could not be finalized.'
  );
});

it.each([
  ['a rejected preparation', false],
  ['a failed preparation RPC', new Error('RPC unavailable')],
] as const)('does not approve after %s', async (_case, preparationResult) => {
  getAuthorizationDetails.mockResolvedValueOnce({
    data: authorizationDetails('authorization-a'),
    error: null,
  });
  getProject.mockResolvedValueOnce({ id: PROJECT_A, name: 'Project A' });

  runtime.render(OAuthConsentClient);
  await flushAsyncWork();

  queueFreshApprovalCheck();
  if (preparationResult instanceof Error) {
    prepareOAuthProjectGrant.mockRejectedValueOnce(preparationResult);
  } else {
    prepareOAuthProjectGrant.mockResolvedValueOnce(preparationResult);
  }
  findButton(runtime.render(OAuthConsentClient), 'Approve').props.onClick?.();
  await flushAsyncWork();

  expect(approveAuthorization).not.toHaveBeenCalled();
  expect(JSON.stringify(runtime.render(OAuthConsentClient))).toContain(
    'Authorization grant could not be prepared.'
  );
});

it('re-checks membership immediately before approving', async () => {
  getAuthorizationDetails.mockResolvedValueOnce({
    data: authorizationDetails('authorization-a'),
    error: null,
  });
  getProject.mockResolvedValueOnce({ id: PROJECT_A, name: 'Project A' });

  runtime.render(OAuthConsentClient);
  await flushAsyncWork();
  expect(findButton(runtime.render(OAuthConsentClient), 'Approve').props.disabled).toBe(false);

  getAuthorizationDetails.mockResolvedValueOnce({
    data: authorizationDetails('authorization-a'),
    error: null,
  });
  getProject.mockResolvedValueOnce(null);
  approveAuthorization.mockResolvedValueOnce({
    data: { redirect_url: 'https://client.example/callback' },
    error: null,
  });

  findButton(runtime.render(OAuthConsentClient), 'Approve').props.onClick?.();
  await flushAsyncWork();

  expect(approveAuthorization).not.toHaveBeenCalled();
  expect(JSON.stringify(runtime.render(OAuthConsentClient))).toContain(
    'You do not have access to the bound project.'
  );
});

it.each([
  ['authorization ID', authorizationDetails('authorization-b'), projectResource(PROJECT_A)],
  ['authorization resource', authorizationDetails('authorization-a'), projectResource(PROJECT_B)],
  ['missing authorization resource', authorizationDetails('authorization-a'), null],
  ['malformed authorization resource', authorizationDetails('authorization-a'), 'https://evil.example/mcp'],
] as const)('rejects approval when the %s changes before approval', async (_change, changedDetails, changedResource) => {
  getAuthorizationDetails.mockResolvedValueOnce({
    data: authorizationDetails('authorization-a'),
    error: null,
  });
  getProject.mockResolvedValueOnce({ id: PROJECT_A, name: 'Project A' });

  runtime.render(OAuthConsentClient);
  await flushAsyncWork();
  expect(findButton(runtime.render(OAuthConsentClient), 'Approve').props.disabled).toBe(false);

  getAuthorizationDetails.mockResolvedValueOnce({
    data: changedDetails,
    error: null,
  });
  getOAuthAuthorizationResource.mockResolvedValueOnce(changedResource);
  approveAuthorization.mockResolvedValueOnce({
    data: { redirect_url: 'https://client.example/callback' },
    error: null,
  });

  findButton(runtime.render(OAuthConsentClient), 'Approve').props.onClick?.();
  await flushAsyncWork();

  expect(approveAuthorization).not.toHaveBeenCalled();
  expect(JSON.stringify(runtime.render(OAuthConsentClient))).toContain(
    'Authorization request changed before approval.'
  );
});

it('does not reuse a verified binding after the authorization ID changes', async () => {
  getAuthorizationDetails.mockResolvedValueOnce({
    data: authorizationDetails('authorization-a'),
    error: null,
  });
  getProject.mockResolvedValueOnce({ id: PROJECT_A, name: 'Project A' });

  runtime.render(OAuthConsentClient);
  await flushAsyncWork();
  expect(findButton(runtime.render(OAuthConsentClient), 'Approve').props.disabled).toBe(false);

  const nextDetails = deferred<ReturnType<typeof authorizationDetails>>();
  currentAuthorizationId = 'authorization-b';
  getAuthorizationDetails.mockReturnValueOnce(
    nextDetails.promise.then((data) => ({ data, error: null }))
  );
  const changedTree = runtime.render(OAuthConsentClient);
  const changedApprove = findButton(changedTree, 'Approve');

  expect(changedApprove.props.disabled).toBe(true);
  changedApprove.props.onClick?.();
  expect(approveAuthorization).not.toHaveBeenCalled();

  getProject.mockResolvedValueOnce({ id: PROJECT_B, name: 'Project B' });
  nextDetails.resolve(authorizationDetails('authorization-b'));
  await flushAsyncWork();
});

it.each(['approve', 'deny'] as const)(
  'does not let a failed stale %s decision overwrite a newer authorization request',
  async (action) => {
    getAuthorizationDetails.mockResolvedValueOnce({
      data: authorizationDetails('authorization-a'),
      error: null,
    });
    getProject.mockResolvedValueOnce({ id: PROJECT_A, name: 'Project A' });
    if (action === 'approve') queueFreshApprovalCheck();
    const decision = deferred<{ data: null; error: Error }>();
    const decisionMock = action === 'approve' ? approveAuthorization : denyAuthorization;
    decisionMock.mockReturnValueOnce(decision.promise);

    runtime.render(OAuthConsentClient);
    await flushAsyncWork();
    findButton(runtime.render(OAuthConsentClient), action === 'approve' ? 'Approve' : 'Deny')
      .props.onClick?.();
    await flushAsyncWork();

    expect(decisionMock).toHaveBeenCalledWith('authorization-a', {
      skipBrowserRedirect: true,
    });

    currentAuthorizationId = 'authorization-b';
    getAuthorizationDetails.mockResolvedValueOnce({
      data: authorizationDetails('authorization-b'),
      error: null,
    });
    getOAuthAuthorizationResource.mockResolvedValueOnce(projectResource(PROJECT_B));
    getProject.mockResolvedValueOnce({ id: PROJECT_B, name: 'Project B' });
    runtime.render(OAuthConsentClient);
    await flushAsyncWork();
    expect(findButton(runtime.render(OAuthConsentClient), 'Approve').props.disabled).toBe(false);

    decision.resolve({ data: null, error: new Error('expired decision') });
    await flushAsyncWork();
    const nextTree = runtime.render(OAuthConsentClient);

    expect(assignLocation).not.toHaveBeenCalled();
    expect(findButton(nextTree, 'Approve').props.disabled).toBe(false);
    expect(JSON.stringify(nextTree)).not.toContain('Authorization decision could not be completed.');
  }
);

it.each(['approve', 'deny'] as const)(
  'blocks a stale successful %s decision before passive effects flush',
  async (action) => {
    getAuthorizationDetails.mockResolvedValueOnce({
      data: authorizationDetails('authorization-a'),
      error: null,
    });
    getProject.mockResolvedValueOnce({ id: PROJECT_A, name: 'Project A' });
    if (action === 'approve') queueFreshApprovalCheck();
    const decision = deferred<{ data: { redirect_url: string }; error: null }>();
    const decisionMock = action === 'approve' ? approveAuthorization : denyAuthorization;
    decisionMock.mockReturnValueOnce(decision.promise);

    runtime.render(OAuthConsentClient);
    await flushAsyncWork();
    findButton(runtime.render(OAuthConsentClient), action === 'approve' ? 'Approve' : 'Deny')
      .props.onClick?.();
    await flushAsyncWork();

    expect(decisionMock).toHaveBeenCalledWith('authorization-a', {
      skipBrowserRedirect: true,
    });
    expect(assignLocation).not.toHaveBeenCalled();

    currentAuthorizationId = 'authorization-b';
    runtime.render(OAuthConsentClient, false);
    decision.resolve({ data: { redirect_url: 'https://client.example/callback' }, error: null });
    await flushAsyncWork();

    expect(assignLocation).not.toHaveBeenCalled();
  }
);

it.each(['approve', 'deny'] as const)(
  'blocks a stale failed %s decision before passive effects flush',
  async (action) => {
    getAuthorizationDetails.mockResolvedValueOnce({
      data: authorizationDetails('authorization-a'),
      error: null,
    });
    getProject.mockResolvedValueOnce({ id: PROJECT_A, name: 'Project A' });
    if (action === 'approve') queueFreshApprovalCheck();
    const decision = deferred<{ data: null; error: Error }>();
    const decisionMock = action === 'approve' ? approveAuthorization : denyAuthorization;
    decisionMock.mockReturnValueOnce(decision.promise);

    runtime.render(OAuthConsentClient);
    await flushAsyncWork();
    findButton(runtime.render(OAuthConsentClient), action === 'approve' ? 'Approve' : 'Deny')
      .props.onClick?.();
    await flushAsyncWork();

    expect(decisionMock).toHaveBeenCalledWith('authorization-a', {
      skipBrowserRedirect: true,
    });
    expect(JSON.stringify(runtime.stateValues()))
      .not.toContain('Authorization decision could not be completed.');

    currentAuthorizationId = 'authorization-b';
    runtime.render(OAuthConsentClient, false);
    decision.resolve({ data: null, error: new Error('expired decision') });
    await flushAsyncWork();

    expect(JSON.stringify(runtime.stateValues()))
      .not.toContain('Authorization decision could not be completed.');
  }
);
