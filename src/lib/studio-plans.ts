export type StudioPlan = {
  id: string;
  label: string;
  description: string;
  amountCents: number;
  currency: 'usd';
};

/** Authoritative catalog. Checkout resolves amounts server-side from this list. */
export const STUDIO_PLANS: readonly StudioPlan[] = [
  {
    id: 'studio-credit',
    label: 'Studio credit',
    description: 'One-time Keco Studio credit purchase',
    amountCents: 2900,
    currency: 'usd',
  },
  {
    id: 'studio-pro-pack',
    label: 'Pro pack',
    description: 'Larger one-time credit pack for active projects',
    amountCents: 9900,
    currency: 'usd',
  },
] as const;

export function listStudioPlans(): StudioPlan[] {
  return STUDIO_PLANS.map((plan) => ({ ...plan }));
}

export function getStudioPlanById(planId: string): StudioPlan | null {
  const normalized = planId.trim().toLowerCase();
  const plan = STUDIO_PLANS.find((candidate) => candidate.id === normalized);
  return plan ? { ...plan } : null;
}

export function formatPlanPrice(plan: StudioPlan): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: plan.currency.toUpperCase(),
  }).format(plan.amountCents / 100);
}

/** Optional test override applied only on the server checkout path. */
export function applyCheckoutAmountOverride(plan: StudioPlan): StudioPlan {
  const raw = process.env.STRIPE_CHECKOUT_AMOUNT_CENTS?.trim();
  if (!raw || plan.id !== 'studio-credit') return plan;
  const amount = Number(raw);
  if (!Number.isSafeInteger(amount) || amount <= 0) return plan;
  return { ...plan, amountCents: amount };
}
