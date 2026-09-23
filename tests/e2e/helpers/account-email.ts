import type { Page, Route } from '@playwright/test';
import {
  ACCOUNT_STORAGE_OWNER_ID,
  AccountStorageMockBackend,
} from './account-storage';

type OtpFailure = 'incorrect' | 'expired' | null;

const SUPABASE_ORIGIN = new URL(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
).origin;
const INITIAL_EMAIL = 'account-storage-e2e@example.com';

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function fakeJwt(email: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: ACCOUNT_STORAGE_OWNER_ID,
    role: 'authenticated',
    email,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.signature`;
}

export class AccountEmailMockBackend extends AccountStorageMockBackend {
  readonly updateRequests: Array<Record<string, unknown>> = [];
  readonly verifyRequests: Array<Record<string, unknown>> = [];
  private currentEmail = INITIAL_EMAIL;
  private pendingEmail: string | null = null;
  private otpFailure: OtpFailure = null;

  override async install(page: Page): Promise<void> {
    await super.install(page);
    await page.route(`${SUPABASE_ORIGIN}/auth/v1/**`, (route) => this.handleAuth(route));
  }

  setPendingEmail(email: string): void {
    this.pendingEmail = email;
  }

  setOtpFailure(failure: Exclude<OtpFailure, null>): void {
    this.otpFailure = failure;
  }

  private user(): Record<string, unknown> {
    return {
      id: ACCOUNT_STORAGE_OWNER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: this.currentEmail,
      ...(this.pendingEmail ? { new_email: this.pendingEmail } : {}),
      app_metadata: {},
      user_metadata: {},
    };
  }

  private session(): Record<string, unknown> {
    return {
      access_token: fakeJwt(this.currentEmail),
      refresh_token: 'account-email-refresh-token',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: this.user(),
    };
  }

  private async handleAuth(route: Route): Promise<void> {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (path === '/auth/v1/token') return json(route, this.session());
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
    if (path === '/auth/v1/user' && request.method() === 'GET') {
      return json(route, this.user());
    }
    if (path === '/auth/v1/user' && request.method() === 'PUT') {
      const body = request.postDataJSON() as Record<string, unknown>;
      this.updateRequests.push(body);
      this.pendingEmail = String(body.email ?? '').trim().toLowerCase();
      return json(route, this.user());
    }
    if (path === '/auth/v1/verify' && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      this.verifyRequests.push(body);
      if (this.otpFailure === 'expired') {
        return json(route, { code: 403, msg: 'Token has expired' }, 403);
      }
      if (this.otpFailure === 'incorrect') {
        return json(route, { code: 403, msg: 'Invalid token' }, 403);
      }
      if (this.pendingEmail) this.currentEmail = this.pendingEmail;
      this.pendingEmail = null;
      return json(route, this.session());
    }

    return json(route, {});
  }
}
