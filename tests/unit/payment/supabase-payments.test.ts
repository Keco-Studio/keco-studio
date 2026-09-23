jest.mock('server-only', () => ({}));

const getSupabaseServiceRoleClient = jest.fn();

jest.mock('@/lib/server/supabaseServiceRole', () => ({
  getSupabaseServiceRoleClient,
}));

import { processStripeCheckoutEvent } from '@/lib/supabase-payments';

describe('atomic Stripe webhook processing', () => {
  it('maps a Checkout event to one service-role RPC call', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { processed: true, orderId: 'pay_1' },
      error: null,
    });
    getSupabaseServiceRoleClient.mockReturnValue({ rpc });

    await expect(processStripeCheckoutEvent({
      eventId: 'evt_1',
      eventType: 'checkout.session.completed',
      sessionId: 'cs_test_paid',
      status: 'paid',
      paymentIntentId: 'pi_test_paid',
      payload: { objectId: 'cs_test_paid' },
      creditAmount: 50_000,
    })).resolves.toEqual({ processed: true, orderId: 'pay_1' });

    expect(rpc).toHaveBeenCalledWith('process_stripe_checkout_event', {
      p_event_id: 'evt_1',
      p_event_type: 'checkout.session.completed',
      p_session_id: 'cs_test_paid',
      p_status: 'paid',
      p_payment_intent_id: 'pi_test_paid',
      p_payload: { objectId: 'cs_test_paid' },
      p_credit_amount: 50_000,
    });
  });

  it('maps RPC failures without falling back to non-atomic writes', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'transaction failed' },
    });
    getSupabaseServiceRoleClient.mockReturnValue({ rpc });

    await expect(processStripeCheckoutEvent({
      eventId: 'evt_2',
      eventType: 'customer.created',
      sessionId: null,
      status: null,
      paymentIntentId: null,
      payload: { objectId: 'cus_1' },
      creditAmount: 0,
    })).rejects.toThrow('Failed to process Stripe webhook: transaction failed');
  });
});
