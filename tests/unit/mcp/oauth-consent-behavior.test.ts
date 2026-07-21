import type { ReactElement, ReactNode } from 'react';

type EffectCleanup = () => void;
type EffectSlot = {
  kind: 'effect';
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

  useEffect(effect: EffectSlot['effect'], dependencies?: readonly unknown[]): void {
    const index = this.cursor++;
    const previous = this.slots[index];
    if (previous && previous.kind !== 'effect') throw new Error(`Hook order changed at ${index}`);
    const previousEffect = previous as EffectSlot | undefined;
    const unchanged = previousEffect?.dependencies !== undefined
      && dependencies !== undefined
      && dependencies.length === previousEffect.dependencies.length
      && dependencies.every((value, dependencyIndex) =>
        Object.is(value, previousEffect.dependencies?.[dependencyIndex])
      );
    if (unchanged) return;
    const slot: EffectSlot = {
      kind: 'effect',
      cleanup: previousEffect?.cleanup,
      dependencies,
      effect,
    };
    this.slots[index] = slot;
    this.pendingEffects.push(slot);
  }

  render<T>(component: () => T): T {
    this.cursor = 0;
    this.pendingEffects = [];
    const result = component();
    for (const slot of this.pendingEffects) {
      slot.cleanup?.();
      const cleanup = slot.effect();
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    }
    return result;
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
const authorizationDetails = (authorizationId: string, projectId: string) => ({
  authorization_id: authorizationId,
  client: { id: 'client-id', name: 'MCP Client', uri: 'https://client.example', logo_uri: '' },
  user: { id: 'user-id', email: 'user@example.com' },
  scope: 'mcp:read',
  resource: `https://abc.supabase.co/functions/v1/mcp/${projectId}`,
});

let runtime: HookRuntime;
let currentAuthorizationId: string;
const getAuthorizationDetails = jest.fn();
const approveAuthorization = jest.fn();
const denyAuthorization = jest.fn();
const getProject = jest.fn();
const mockRouter = { replace: jest.fn() };
const mockSupabaseClient = {
  auth: { oauth: { getAuthorizationDetails, approveAuthorization, denyAuthorization } },
};
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

jest.mock('react', () => ({
  ...jest.requireActual<typeof import('react')>('react'),
  useEffect: (effect: EffectSlot['effect'], dependencies?: readonly unknown[]) =>
    runtime.useEffect(effect, dependencies),
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
jest.mock('@/components/mcp/OAuthConsent.module.css', () => ({
  __esModule: true,
  default: {},
}));

import { OAuthConsentClient } from '@/components/mcp/OAuthConsentClient';

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abc.supabase.co';
  runtime = new HookRuntime();
  currentAuthorizationId = 'authorization-a';
  getAuthorizationDetails.mockReset();
  approveAuthorization.mockReset();
  denyAuthorization.mockReset();
  getProject.mockReset();
  mockRouter.replace.mockReset();
});

afterAll(() => {
  if (originalSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
});

it('keeps approval blocked until access to the bound project is verified', async () => {
  const projectLookup = deferred<{ id: string; name: string }>();
  getAuthorizationDetails.mockResolvedValue({
    data: authorizationDetails('authorization-a', PROJECT_A),
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

it('does not reuse a verified binding after the authorization ID changes', async () => {
  getAuthorizationDetails.mockResolvedValueOnce({
    data: authorizationDetails('authorization-a', PROJECT_A),
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
  nextDetails.resolve(authorizationDetails('authorization-b', PROJECT_B));
  await flushAsyncWork();
});

it.each(['approve', 'deny'] as const)(
  'does not let a failed stale %s decision overwrite a newer authorization request',
  async (action) => {
    getAuthorizationDetails.mockResolvedValueOnce({
      data: authorizationDetails('authorization-a', PROJECT_A),
      error: null,
    });
    getProject.mockResolvedValueOnce({ id: PROJECT_A, name: 'Project A' });
    const decision = deferred<{ data: null; error: Error }>();
    const decisionMock = action === 'approve' ? approveAuthorization : denyAuthorization;
    decisionMock.mockReturnValueOnce(decision.promise);

    runtime.render(OAuthConsentClient);
    await flushAsyncWork();
    findButton(runtime.render(OAuthConsentClient), action === 'approve' ? 'Approve' : 'Deny')
      .props.onClick?.();

    currentAuthorizationId = 'authorization-b';
    getAuthorizationDetails.mockResolvedValueOnce({
      data: authorizationDetails('authorization-b', PROJECT_B),
      error: null,
    });
    getProject.mockResolvedValueOnce({ id: PROJECT_B, name: 'Project B' });
    runtime.render(OAuthConsentClient);
    await flushAsyncWork();
    expect(findButton(runtime.render(OAuthConsentClient), 'Approve').props.disabled).toBe(false);

    decision.resolve({ data: null, error: new Error('expired decision') });
    await flushAsyncWork();
    const nextTree = runtime.render(OAuthConsentClient);

    expect(findButton(nextTree, 'Approve').props.disabled).toBe(false);
    expect(JSON.stringify(nextTree)).not.toContain('Authorization decision could not be completed.');
  }
);
