import type Stripe from 'stripe';

export type InternalPaymentStatus = 'pending' | 'paid' | 'failed';

export type CheckoutInput = {
  projectId: string;
  planId: string;
  customerEmail: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCheckoutInput(value: unknown): CheckoutInput {
  if (!value || typeof value !== 'object') {
    throw new Error('Request body is required');
  }
  const input = value as Record<string, unknown>;
  const projectId = typeof input.projectId === 'string' ? input.projectId.trim() : '';
  const planId = typeof input.planId === 'string' ? input.planId.trim() : '';
  const customerEmail =
    typeof input.customerEmail === 'string' ? input.customerEmail.trim() : '';

  if (!UUID_RE.test(projectId)) {
    throw new Error('A valid project id is required');
  }
  if (!planId) {
    throw new Error('A valid plan is required');
  }
  if (!customerEmail || !EMAIL_RE.test(customerEmail)) {
    throw new Error('A valid customer email is required');
  }

  return { projectId, planId, customerEmail };
}

export function normalizeCurrency(currency: string): 'usd' {
  if (currency.trim().toLowerCase() !== 'usd') {
    throw new Error('Only USD payments are supported');
  }
  return 'usd';
}

export function getPaymentStatusForCheckoutEvent(
  eventType: Stripe.Event.Type | string
): InternalPaymentStatus | null {
  if (eventType === 'checkout.session.completed') return 'paid';
  if (
    eventType === 'checkout.session.async_payment_failed' ||
    eventType === 'checkout.session.expired'
  ) {
    return 'failed';
  }
  return null;
}
