jest.mock('server-only', () => ({}));

const getSupabaseServiceRoleClient = jest.fn();

jest.mock('@/lib/server/supabaseServiceRole', () => ({
  getSupabaseServiceRoleClient,
}));

import { updatePaymentOrderFromStripe } from '@/lib/supabase-payments';

describe('Stripe payment Credit grants', () => {
  it('grants the purchased plan Credits for a paid Checkout session', async () => {
    const maybeSingle = jest.fn().mockResolvedValue({
      data: {
        id: 'pay_1',
        user_id: '11111111-1111-4111-8111-111111111111',
        plan_id: 'plan-studio',
        plan_label: 'Studio',
      },
      error: null,
    });
    const selectEq = jest.fn(() => ({ maybeSingle }));
    const select = jest.fn(() => ({ eq: selectEq }));
    const updateEq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn(() => ({ eq: updateEq }));
    const insert = jest.fn().mockResolvedValue({ error: null });
    const from = jest.fn((table: string) => {
      if (table === 'payment_orders') return { select, update };
      if (table === 'credit_ledger_entries') return { insert };
      throw new Error(`Unexpected table: ${table}`);
    });
    getSupabaseServiceRoleClient.mockReturnValue({ from });

    await updatePaymentOrderFromStripe({
      sessionId: 'cs_test_paid',
      status: 'paid',
      paymentIntentId: 'pi_test_paid',
    });

    expect(insert).toHaveBeenCalledWith({
      user_id: '11111111-1111-4111-8111-111111111111',
      credit_delta: 50_000,
      reason: 'Stripe Studio purchase',
      reference_key: 'stripe-checkout:cs_test_paid',
    });
  });
});
