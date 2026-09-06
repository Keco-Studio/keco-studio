'use client';

import { useMemo, useState } from 'react';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { useAuth } from '@/lib/contexts/AuthContext';
import { listSubscriptionPlans, type StudioPlan } from '@/lib/studio-plans';
import { showErrorToast, showSuccessToast } from '@/lib/utils/toast';
import styles from './BillingPlansPage.module.css';

type BillingPlansPageProps = {
  projectId: string;
};

const SALES_EMAIL = 'sales@keco.studio';

export function BillingPlansPage({ projectId }: BillingPlansPageProps) {
  const { userProfile } = useAuth();
  const subscriptionPlans = useMemo(() => listSubscriptionPlans(), []);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);

  async function startCheckout(plan: StudioPlan) {
    const email = userProfile?.email?.trim() ?? '';
    if (!email) {
      showErrorToast('Sign in with an email account to purchase');
      return;
    }
    if (!plan.checkoutEnabled || plan.amountCents <= 0) {
      showErrorToast('This plan cannot be purchased online');
      return;
    }

    setLoadingPlanId(plan.id);
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          planId: plan.id,
          customerEmail: email,
        }),
      });
      const result = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !result.url) {
        throw new Error(result.error || 'Unable to start checkout');
      }
      window.location.assign(result.url);
    } catch (checkoutError) {
      const message =
        checkoutError instanceof Error
          ? checkoutError.message
          : 'Unable to start checkout';
      showErrorToast(message);
      setLoadingPlanId(null);
    }
  }

  function handlePlanAction(plan: StudioPlan) {
    setSelectedPlanId(plan.id);
    if (plan.kind === 'free') {
      showSuccessToast('Starter is already available on your account');
      return;
    }
    if (plan.kind === 'enterprise') {
      window.location.href = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent('Keco Studio Enterprise')}`;
      return;
    }
    void startCheckout(plan);
  }

  return (
    <div className={styles.page} data-testid="billing-plans-page">
      <section className={styles.plansGrid} aria-label="Subscription plans">
        {subscriptionPlans.map((plan) => {
          const busy = loadingPlanId === plan.id;
          const selected = selectedPlanId === plan.id;
          return (
            <article
              key={plan.id}
              className={`${styles.planCard} ${selected ? styles.planCardSelected : ''}`}
              data-testid={`billing-plan-${plan.id}`}
              data-selected={selected ? 'true' : 'false'}
              onClick={() => setSelectedPlanId(plan.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelectedPlanId(plan.id);
                }
              }}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
            >
              {plan.popular ? (
                <span className={styles.popularBadge}>Most popular</span>
              ) : null}
              <div className={styles.planHeader}>
                <h2 className={styles.planTitle}>{plan.label}</h2>
                <p className={styles.planSubtitle}>{plan.description}</p>
              </div>
              <div className={styles.planPricing}>
                <p className={styles.planPrice}>{plan.priceLabel}</p>
                <p className={styles.planCredits}>{plan.creditsLabel}</p>
              </div>
              <ul className={styles.featureList}>
                {plan.features.map((feature) => (
                  <li key={feature.label} className={styles.featureItem}>
                    <span
                      className={
                        feature.included ? styles.featureIconOn : styles.featureIconOff
                      }
                      aria-hidden
                    >
                      {feature.included ? <CheckOutlined /> : <CloseOutlined />}
                    </span>
                    <span className={feature.included ? undefined : styles.featureMuted}>
                      {feature.label}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={styles.planButton}
                disabled={busy || loadingPlanId !== null}
                onClick={(event) => {
                  event.stopPropagation();
                  handlePlanAction(plan);
                }}
              >
                {busy ? 'Opening checkout…' : plan.ctaLabel}
              </button>
            </article>
          );
        })}
      </section>
    </div>
  );
}
