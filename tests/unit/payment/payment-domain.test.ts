import { describe, expect, it } from '@jest/globals';
import {
  getPaymentStatusForCheckoutEvent,
  normalizeCurrency,
  validateCheckoutInput,
} from '@/lib/payment-domain';
import {
  formatPlanPrice,
  getStudioPlanById,
  listCreditPacks,
  listStudioPlans,
} from '@/lib/studio-plans';

describe('payment-domain', () => {
  it('validates account-level checkout input without accepting arbitrary values', () => {
    expect(
      validateCheckoutInput({
        planId: 'plan-pro',
        customerEmail: 'payer@example.com',
      })
    ).toEqual({
      planId: 'plan-pro',
      customerEmail: 'payer@example.com',
    });

    expect(() =>
      validateCheckoutInput({
        planId: 'plan-pro',
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
    expect(listCreditPacks()).toEqual([]);
    expect(getStudioPlanById('credits-1000')).toBeNull();
    expect(getStudioPlanById('credits-5000')).toBeNull();
    expect(getStudioPlanById('plan-pro')).toMatchObject({
      popular: true,
      creditAmount: 10_000,
      creditsLabel: '10,000 agent credits included',
    });
    expect(getStudioPlanById('plan-studio')).toMatchObject({
      creditAmount: 50_000,
      creditsLabel: '50,000 agent credits included',
    });
    expect(formatPlanPrice(getStudioPlanById('plan-pro')!)).toMatch(/\$/);
  });
});
