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
  it('validates checkout input without accepting arbitrary values', () => {
    expect(
      validateCheckoutInput({
        projectId: '11111111-1111-4111-8111-111111111111',
        planId: 'plan-pro',
        customerEmail: 'payer@example.com',
      })
    ).toEqual({
      projectId: '11111111-1111-4111-8111-111111111111',
      planId: 'plan-pro',
      customerEmail: 'payer@example.com',
    });

    expect(() =>
      validateCheckoutInput({
        projectId: 'not-a-uuid',
        planId: 'plan-pro',
        customerEmail: 'payer@example.com',
      })
    ).toThrow(/valid project id/i);

    expect(() =>
      validateCheckoutInput({
        projectId: '11111111-1111-4111-8111-111111111111',
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
      creditsLabel: '10,000 agent credits included',
    });
    expect(getStudioPlanById('plan-studio')?.creditsLabel)
      .toBe('50,000 agent credits included');
    expect(formatPlanPrice(getStudioPlanById('plan-pro')!)).toMatch(/\$/);
  });
});
