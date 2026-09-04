export type StudioPlanKind = 'subscription' | 'credits' | 'free' | 'enterprise';

export type StudioPlanFeature = {
  label: string;
  included: boolean;
};

export type StudioPlan = {
  id: string;
  label: string;
  description: string;
  amountCents: number;
  currency: 'usd';
  kind: StudioPlanKind;
  /** Display price string for the card (e.g. Free, $49/month, Custom). */
  priceLabel: string;
  /** Blue accent line under the price. */
  creditsLabel: string;
  features: readonly StudioPlanFeature[];
  ctaLabel: string;
  popular?: boolean;
  /** When false, plan is display-only and cannot start Stripe Checkout. */
  checkoutEnabled: boolean;
  /** Credit pack size for top-up UI; only set for kind === 'credits'. */
  creditAmount?: number;
};

/** Authoritative catalog. Checkout resolves amounts server-side from this list. */
export const STUDIO_PLANS: readonly StudioPlan[] = [
  {
    id: 'plan-starter',
    label: 'Starter',
    description: 'Try the core tools for free',
    amountCents: 0,
    currency: 'usd',
    kind: 'free',
    priceLabel: 'Free',
    creditsLabel: 'No agent credits',
    features: [
      { label: 'Dialogue table generation', included: true },
      { label: 'Basic config export', included: true },
      { label: 'Community support', included: true },
      { label: 'AI agent', included: false },
    ],
    ctaLabel: 'Choose Starter',
    checkoutEnabled: false,
  },
  {
    id: 'plan-pro',
    label: 'Pro',
    description: 'AI agent for solo creators',
    amountCents: 1000,
    currency: 'usd',
    kind: 'subscription',
    priceLabel: '$10/month',
    creditsLabel: '50 agent credits included',
    features: [
      { label: 'AI agent access', included: true },
      { label: 'Script conversion pipeline', included: true },
      { label: 'All export formats', included: true },
      { label: 'Email support', included: true },
    ],
    ctaLabel: 'Choose Pro',
    popular: true,
    checkoutEnabled: true,
  },
  {
    id: 'plan-studio',
    label: 'Studio',
    description: 'Built for teams and studios',
    amountCents: 5000,
    currency: 'usd',
    kind: 'subscription',
    priceLabel: '$50/month',
    creditsLabel: '170 agent credits included',
    features: [
      { label: 'Priority processing', included: true },
      { label: 'Team collaboration', included: true },
      { label: 'Commercial usage rights', included: true },
      { label: 'Priority support', included: true },
    ],
    ctaLabel: 'Choose Studio',
    checkoutEnabled: true,
  },
  {
    id: 'plan-enterprise',
    label: 'Enterprise',
    description: 'Custom deployments at scale',
    amountCents: 0,
    currency: 'usd',
    kind: 'enterprise',
    priceLabel: 'Custom',
    creditsLabel: 'Custom credits volume',
    features: [
      { label: 'Per-seat pricing', included: true },
      { label: 'Self-hosted / SSO', included: true },
      { label: 'Dedicated consultation', included: true },
      { label: 'Custom contract', included: true },
    ],
    ctaLabel: 'Contact sales',
    checkoutEnabled: false,
  },
  {
    id: 'credits-1000',
    label: '1,000 credits',
    description: 'One-time top-up of 1,000 agent credits',
    amountCents: 5999,
    currency: 'usd',
    kind: 'credits',
    priceLabel: '$59.99',
    creditsLabel: '1,000 agent credits',
    features: [],
    ctaLabel: 'Purchase 1,000 credits',
    checkoutEnabled: true,
    creditAmount: 1000,
  },
  {
    id: 'credits-5000',
    label: '5,000 credits',
    description: 'One-time top-up of 5,000 agent credits',
    amountCents: 27499,
    currency: 'usd',
    kind: 'credits',
    priceLabel: '$274.99',
    creditsLabel: '5,000 agent credits',
    features: [],
    ctaLabel: 'Purchase 5,000 credits',
    checkoutEnabled: true,
    creditAmount: 5000,
  },
] as const;

export function listStudioPlans(): StudioPlan[] {
  return STUDIO_PLANS.map((plan) => ({
    ...plan,
    features: plan.features.map((feature) => ({ ...feature })),
  }));
}

export function listSubscriptionPlans(): StudioPlan[] {
  return listStudioPlans().filter((plan) => plan.kind !== 'credits');
}

export function listCreditPacks(): StudioPlan[] {
  return listStudioPlans().filter((plan) => plan.kind === 'credits');
}

export function getStudioPlanById(planId: string): StudioPlan | null {
  const normalized = planId.trim().toLowerCase();
  const plan = STUDIO_PLANS.find((candidate) => candidate.id === normalized);
  if (!plan) return null;
  return {
    ...plan,
    features: plan.features.map((feature) => ({ ...feature })),
  };
}

export function formatPlanPrice(plan: StudioPlan): string {
  if (plan.amountCents <= 0) return plan.priceLabel;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: plan.currency.toUpperCase(),
  }).format(plan.amountCents / 100);
}

/** Optional test override applied only on the server checkout path. */
export function applyCheckoutAmountOverride(plan: StudioPlan): StudioPlan {
  const raw = process.env.STRIPE_CHECKOUT_AMOUNT_CENTS?.trim();
  if (!raw || plan.id !== 'credits-1000') return plan;
  const amount = Number(raw);
  if (!Number.isSafeInteger(amount) || amount <= 0) return plan;
  return { ...plan, amountCents: amount };
}
