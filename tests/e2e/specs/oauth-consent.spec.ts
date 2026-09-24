import { expect, test, type Page, type Route } from '@playwright/test';
import { gotoAuth, loginWithCredentials } from '../utils/auth-helpers';
import {
  createTemporaryUser,
  deleteTemporaryUser,
  getE2EAdminClient,
  type TemporaryUser,
} from '../utils/supabase-admin';

const AUTHORIZATION_ID = 'e2e-authorization';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!configuredSupabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL is required for OAuth consent E2E tests');
}
const supabaseOrigin = new URL(configuredSupabaseUrl).origin;
const accountResource = `${supabaseOrigin}/functions/v1/mcp`;

type ConsentAction = 'approve' | 'deny';
type AuthorizationDetails = {
  authorization_id: string;
  client: { id: string; name: string; uri: string; logo_uri: string };
  user: { id: string; email: string };
  scope: string;
};
type OAuthBackendOptions = {
  details?: AuthorizationDetails;
  resources?: string[];
};

function appOrigin(): string {
  return `http://localhost:${process.env.PLAYWRIGHT_PORT ?? '3000'}`;
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function authorizationDetails(
  user: TemporaryUser,
  authorizationId = AUTHORIZATION_ID
): AuthorizationDetails {
  return {
    authorization_id: authorizationId,
    client: {
      id: 'e2e-mcp-client',
      name: 'E2E MCP Client',
      uri: `${appOrigin()}/oauth-client`,
      logo_uri: '',
    },
    user: { id: user.id, email: user.email },
    scope: 'read write',
  };
}

class OAuthBackend {
  authorizationReads = 0;
  resourceReads = 0;
  consentActions: ConsentAction[] = [];

  constructor(
    private readonly user: TemporaryUser,
    private readonly options: OAuthBackendOptions = {}
  ) {}

  async install(page: Page): Promise<void> {
    await page.route(
      `${supabaseOrigin}/auth/v1/oauth/authorizations/${AUTHORIZATION_ID}/consent`,
      async (route) => {
        expect(route.request().method()).toBe('POST');
        const body = route.request().postDataJSON() as { action?: ConsentAction };
        expect(body.action === 'approve' || body.action === 'deny').toBe(true);
        const action = body.action!;
        this.consentActions.push(action);
        const callback = action === 'approve'
          ? `${appOrigin()}/payment/success?oauth=approve`
          : `${appOrigin()}/payment/cancel?oauth=deny&error=access_denied`;
        await json(route, { redirect_url: callback });
      }
    );
    await page.route(
      `${supabaseOrigin}/auth/v1/oauth/authorizations/${AUTHORIZATION_ID}`,
      async (route) => {
        const request = route.request();
        if (request.method() !== 'GET') {
          throw new Error(
            `Unexpected OAuth authorization request: ${request.method()} ${request.url()}`
          );
        }
        this.authorizationReads += 1;
        await json(route, this.options.details ?? authorizationDetails(this.user));
      }
    );
    await page.route(
      `${supabaseOrigin}/rest/v1/rpc/get_oauth_authorization_resource`,
      async (route) => {
        expect(route.request().method()).toBe('POST');
        expect(route.request().postDataJSON()).toEqual({
          p_authorization_id: AUTHORIZATION_ID,
        });
        const resources = this.options.resources ?? [accountResource];
        const resource = resources[Math.min(this.resourceReads, resources.length - 1)];
        this.resourceReads += 1;
        await json(route, resource);
      }
    );
  }
}

test.describe('OAuth consent', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  const admin = getE2EAdminClient();
  let user: TemporaryUser;

  test.beforeAll(async () => {
    user = await createTemporaryUser(admin, 'oauth-consent-e2e');
  });

  test.afterAll(async () => {
    if (user) await deleteTemporaryUser(admin, user);
  });

  async function login(page: Page): Promise<void> {
    await gotoAuth(page);
    await loginWithCredentials(page, user.email, user.password);
    await expect(page).toHaveURL(/\/projects(?:\?|$)/, { timeout: 30_000 });
    await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 30_000 });
  }

  async function openConsent(page: Page, backend: OAuthBackend): Promise<void> {
    await backend.install(page);
    await page.goto(`/oauth/consent?authorization_id=${AUTHORIZATION_ID}`);
    await expect(page.getByText('E2E MCP Client', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  }

  test('approves an account request only after revalidating its details and resource', async ({
    page,
  }) => {
    await login(page);
    const backend = new OAuthBackend(user);
    await openConsent(page, backend);

    await expect(page.getByText('Requested scopes: read write')).toBeVisible();
    await expect(page.getByText(/requests access to the Keco account/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Deny' })).toBeEnabled();

    await page.getByRole('button', { name: 'Approve' }).click();

    await expect(page).toHaveURL(/\/payment\/success\?oauth=approve$/);
    expect(backend.authorizationReads).toBe(2);
    expect(backend.resourceReads).toBe(2);
    expect(backend.consentActions).toEqual(['approve']);
  });

  test('denies without approval revalidation and follows the access-denied callback', async ({
    page,
  }) => {
    await login(page);
    const backend = new OAuthBackend(user);
    await openConsent(page, backend);

    await page.getByRole('button', { name: 'Deny' }).click();

    await expect(page).toHaveURL(
      /\/payment\/cancel\?oauth=deny&error=access_denied$/
    );
    expect(backend.authorizationReads).toBe(1);
    expect(backend.resourceReads).toBe(1);
    expect(backend.consentActions).toEqual(['deny']);
  });

  test('blocks approval when the authorization resource changes during revalidation', async ({
    page,
  }) => {
    await login(page);
    const backend = new OAuthBackend(user, {
      resources: [accountResource, `${accountResource}/${PROJECT_ID}`],
    });
    await openConsent(page, backend);

    await page.getByRole('button', { name: 'Approve' }).click();

    await expect(page).toHaveURL(
      new RegExp(`/oauth/consent\\?authorization_id=${AUTHORIZATION_ID}$`)
    );
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'Authorization request changed before approval.'
    );
    await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(backend.authorizationReads).toBe(2);
    expect(backend.resourceReads).toBe(2);
    expect(backend.consentActions).toEqual([]);
  });

  test('disables both decisions for a mismatched authorization request', async ({ page }) => {
    await login(page);
    const backend = new OAuthBackend(user, {
      details: authorizationDetails(user, 'different-authorization'),
    });
    await backend.install(page);
    await page.goto(`/oauth/consent?authorization_id=${AUTHORIZATION_ID}`);

    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'Authorization request is unavailable or expired.',
      { timeout: 30_000 }
    );
    await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Deny' })).toBeDisabled();
    expect(backend.authorizationReads).toBe(1);
    expect(backend.resourceReads).toBe(0);
    expect(backend.consentActions).toEqual([]);
  });
});
