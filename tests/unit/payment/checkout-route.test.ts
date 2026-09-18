import { NextRequest } from 'next/server';
import { describe, expect, it, jest } from '@jest/globals';

const createPaymentOrder = jest.fn();
const attachStripeSession = jest.fn();
const createCheckoutSession = jest.fn();

jest.mock('@/lib/auth/route-auth', () => ({
  withAuth:
    (handler: (...args: any[]) => Promise<Response>) =>
    (request: NextRequest, context: unknown) =>
      handler(request, context, {
        supabase: {},
        user: { id: '11111111-1111-4111-8111-111111111111' },
      }),
}));

jest.mock('@/lib/supabase-payments', () => ({
  createPaymentOrder: (...args: unknown[]) => createPaymentOrder(...args),
  attachStripeSession: (...args: unknown[]) => attachStripeSession(...args),
}));

jest.mock('@/lib/stripe', () => ({
  getStripe: () => ({
    checkout: { sessions: { create: (...args: unknown[]) => createCheckoutSession(...args) } },
  }),
}));

import { POST } from '@/app/api/checkout/route';

describe('account billing checkout route', () => {
  it('creates a user payment without requiring a project', async () => {
    createPaymentOrder.mockResolvedValue({ id: 'pay_1' });
    attachStripeSession.mockResolvedValue(undefined);
    createCheckoutSession.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });

    const response = await POST(
      new NextRequest('https://keco.test/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: 'plan-pro',
          customerEmail: 'payer@example.com',
        }),
      }),
      undefined
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      paymentId: expect.stringMatching(/^pay_/),
      url: 'https://checkout.stripe.test/cs_1',
    });
    expect(createPaymentOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        userId: '11111111-1111-4111-8111-111111111111',
      })
    );
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.not.objectContaining({ projectId: expect.anything() }),
        success_url: 'https://keco.test/payment/success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: expect.stringMatching(/^https:\/\/keco\.test\/payment\/cancel\?payment_id=pay_/),
      })
    );
  });
});
