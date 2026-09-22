import { expect, test } from '@playwright/test';
import Stripe from 'stripe';
import {
  createTemporaryUser,
  deleteTemporaryUser,
  getE2EAdminClient,
  type TemporaryUser,
} from '../utils/supabase-admin';

const webhookSecret = 'whsec_keco_playwright_20260922';
const creditAmount = 50_000;

test.describe('Stripe webhook Credit idempotency', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  const admin = getE2EAdminClient();
  const runId = crypto.randomUUID();
  const eventId = `evt_keco_${runId}`;
  const orderId = `pay_${runId}`;
  const sessionId = `cs_test_keco_${runId}`;
  const paymentIntentId = `pi_test_keco_${runId}`;
  const referenceKey = `stripe-checkout:${sessionId}`;
  let user: TemporaryUser | undefined;
  let allocationBefore = 0;

  async function allocatedCredits(): Promise<number> {
    if (!user) return 0;
    const { data, error } = await admin
      .from('credit_ledger_entries')
      .select('credit_delta')
      .eq('user_id', user.id);
    if (error) throw error;
    return (data ?? []).reduce((sum, row) => sum + Number(row.credit_delta), 0);
  }

  test.beforeAll(async () => {
    user = await createTemporaryUser(admin, 'stripe-webhook-e2e');
    allocationBefore = await allocatedCredits();
    const { error } = await admin.from('payment_orders').insert({
      id: orderId,
      reference: `KECO-E2E-${runId}`,
      project_id: null,
      user_id: user.id,
      plan_id: 'plan-studio',
      plan_label: 'Studio',
      customer_email: user.email,
      amount_cents: 5_000,
      currency: 'usd',
      stripe_checkout_session_id: sessionId,
    });
    if (error) throw error;
  });

  test.afterAll(async () => {
    const eventCleanup = await admin.from('payment_webhook_events').delete().eq('id', eventId);
    const orderCleanup = await admin.from('payment_orders').delete().eq('id', orderId);
    if (eventCleanup.error) throw eventCleanup.error;
    if (orderCleanup.error) throw orderCleanup.error;
    if (user) await deleteTemporaryUser(admin, user);

    const [events, grants, orders] = await Promise.all([
      admin.from('payment_webhook_events').select('id').eq('id', eventId),
      admin.from('credit_ledger_entries').select('id').eq('reference_key', referenceKey),
      admin.from('payment_orders').select('id').eq('id', orderId),
    ]);
    if (events.error) throw events.error;
    if (grants.error) throw grants.error;
    if (orders.error) throw orders.error;
    expect(events.data).toEqual([]);
    expect(grants.data).toEqual([]);
    expect(orders.data).toEqual([]);
  });

  test('grants one Credit allocation across sequential and concurrent replay', async ({ request }) => {
    const payload = JSON.stringify({
      id: eventId,
      object: 'event',
      api_version: '2025-08-27.basil',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: sessionId,
          object: 'checkout.session',
          payment_intent: paymentIntentId,
          metadata: { planId: 'plan-studio' },
        },
      },
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type: 'checkout.session.completed',
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });
    const postEvent = () => request.post('/api/webhooks/stripe', {
      data: payload,
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signature,
      },
    });

    const first = await postEvent();
    expect(first.ok()).toBe(true);
    const sequentialReplay = await postEvent();
    expect(sequentialReplay.ok()).toBe(true);
    const concurrentReplays = await Promise.all([postEvent(), postEvent()]);
    expect(concurrentReplays.every((response) => response.ok())).toBe(true);

    const { data: events, error: eventError } = await admin
      .from('payment_webhook_events')
      .select('id,event_type')
      .eq('id', eventId);
    if (eventError) throw eventError;
    expect(events).toEqual([{ id: eventId, event_type: 'checkout.session.completed' }]);

    const { data: grants, error: grantError } = await admin
      .from('credit_ledger_entries')
      .select('credit_delta,reference_key')
      .eq('reference_key', referenceKey);
    if (grantError) throw grantError;
    expect(grants).toEqual([{ credit_delta: creditAmount, reference_key: referenceKey }]);
    expect(await allocatedCredits()).toBe(allocationBefore + creditAmount);

    const { data: order, error: orderError } = await admin
      .from('payment_orders')
      .select('status,stripe_payment_intent_id')
      .eq('id', orderId)
      .single();
    if (orderError) throw orderError;
    expect(order).toEqual({
      status: 'paid',
      stripe_payment_intent_id: paymentIntentId,
    });
  });
});
