import { describe, expect, it } from '@jest/globals';
import {
  getPaymentStatusForCheckoutEvent,
  normalizeCurrency,
  validateCheckoutInput,
} from '@/lib/payment-domain';
import {
  applyCheckoutAmountOverride,
  formatPlanPrice,
  getStudioPlanById,
  listStudioPlans,
} from '@/lib/studio-plans';

describe('payment-domain', () => {
  it('validates checkout input without accepting arbitrary values', () => {
    expect(
      validateCheckoutInput({
        projectId: '11111111-1111-4111-8111-111111111111',
        planId: 'studio-credit',
        customerEmail: 'payer@example.com',
      })
    ).toEqual({
      projectId: '11111111-1111-4111-8111-111111111111',
      planId: 'studio-credit',
      customerEmail: 'payer@example.com',
    });

    expect(() =>
      validateCheckoutInput({
        projectId: 'not-a-uuid',
        planId: 'studio-credit',
        customerEmail: 'payer@example.com',
      })
    ).toThrow(/valid project id/i);

    expect(() =>
      validateCheckoutInput({
        projectId: '11111111-1111-4111-8111-111111111111',
        planId: 'studio-credit',
        customerEmail: 'bad',
      })
    ).toThrow(/valid customer email/i);
  });

  it('normalizes USD and maps Stripe Checkout outcomes', () => {
    expect(normalizeCurrency('USD')).toBe('usd');
    expect(() => normalizeCurrency('cad')).toThrow(/Only USD/i);
    expect(getPaymentStatusForCheckoutEvent('checkout.session.completed')).toBe('paid');
    expect(
      getPaymentStatusForCheckoutEvent('checkout.session.async_payment_failed')
    ).toBe('failed');
    expect(getPaymentStatusForCheckoutEvent('checkout.session.expired')).toBe('failed');
    expect(getPaymentStatusForCheckoutEvent('customer.created')).toBeNull();
  });
});

describe('studio-plans', () => {
  it('exposes catalog plans with formatted prices', () => {
    const plans = listStudioPlans();
    expect(plans.length).toBeGreaterThan(0);
    expect(getStudioPlanById('studio-credit')?.label).toBe('Studio credit');
    expect(formatPlanPrice(plans[0]!)).toMatch(/\$/);
  });

  it('applies amount override only to studio-credit', () => {
    const previous = process.env.STRIPE_CHECKOUT_AMOUNT_CENTS;
    process.env.STRIPE_CHECKOUT_AMOUNT_CENTS = '500';
    try {
      const credit = getStudioPlanById('studio-credit')!;
      const pro = getStudioPlanById('studio-pro-pack')!;
      expect(applyCheckoutAmountOverride(credit).amountCents).toBe(500);
      expect(applyCheckoutAmountOverride(pro).amountCents).toBe(pro.amountCents);
    } finally {
      if (previous == null) delete process.env.STRIPE_CHECKOUT_AMOUNT_CENTS;
      else process.env.STRIPE_CHECKOUT_AMOUNT_CENTS = previous;
    }
  });
});
