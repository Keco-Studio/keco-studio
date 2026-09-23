import { describe, expect, it, jest } from '@jest/globals';

const constructEvent = jest.fn();
const processStripeCheckoutEvent = jest.fn();

jest.mock('@/lib/stripe', () => ({
  getStripe: () => ({ webhooks: { constructEvent } }),
  getStripeWebhookSecret: () => 'whsec_test',
}));

jest.mock('@/lib/supabase-payments', () => ({
  processStripeCheckoutEvent: (...args: unknown[]) => processStripeCheckoutEvent(...args),
}));

import { POST } from '@/app/api/webhooks/stripe/route';

describe('Stripe webhook route', () => {
  it('sends a paid Checkout event through one atomic operation', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          payment_intent: 'pi_1',
          metadata: { planId: 'plan-studio' },
        },
      },
    });
    processStripeCheckoutEvent.mockResolvedValue({ processed: true, orderId: 'pay_1' });

    const response = await POST(new Request('https://keco.test/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'signed' },
      body: '{}',
    }));

    expect(response.status).toBe(200);
    expect(processStripeCheckoutEvent).toHaveBeenCalledWith({
      eventId: 'evt_1',
      eventType: 'checkout.session.completed',
      sessionId: 'cs_1',
      status: 'paid',
      paymentIntentId: 'pi_1',
      payload: { objectId: 'cs_1' },
      creditAmount: 50_000,
    });
  });

  it('records an unrecognized event without an order mutation or Credit grant', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_2',
      type: 'customer.created',
      data: { object: { id: 'cus_1' } },
    });
    processStripeCheckoutEvent.mockResolvedValue({ processed: true, orderId: null });

    const response = await POST(new Request('https://keco.test/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'signed' },
      body: '{}',
    }));

    expect(response.status).toBe(200);
    expect(processStripeCheckoutEvent).toHaveBeenCalledWith({
      eventId: 'evt_2',
      eventType: 'customer.created',
      sessionId: null,
      status: null,
      paymentIntentId: null,
      payload: { objectId: 'cus_1' },
      creditAmount: 0,
    });
  });
});
