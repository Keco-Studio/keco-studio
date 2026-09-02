'use client';

import { useState } from 'react';
import { formatPlanPrice, listStudioPlans } from '@/lib/studio-plans';
import { showErrorToast } from '@/lib/utils/toast';
import styles from '@/components/admin/AdminPage.module.css';

type StripeCheckoutPanelProps = {
  projectId: string;
  defaultEmail: string;
};

export function StripeCheckoutPanel({
  projectId,
  defaultEmail,
}: StripeCheckoutPanelProps) {
  const plans = listStudioPlans();
  const [planId, setPlanId] = useState(plans[0]?.id ?? '');
  const [email, setEmail] = useState(defaultEmail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPlan = plans.find((plan) => plan.id === planId) ?? plans[0] ?? null;

  async function startCheckout() {
    if (!selectedPlan) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          planId: selectedPlan.id,
          customerEmail: email.trim(),
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
      setError(message);
      showErrorToast(message);
      setLoading(false);
    }
  }

  return (
    <div className={styles.checkoutPanel} data-testid="stripe-checkout-panel">
      <div className={styles.rowText}>
        <span className={styles.rowTitle}>Pay with Stripe</span>
        <span className={styles.rowSubtitle}>
          Open a secure Stripe Checkout session. Card details never touch Keco servers.
        </span>
      </div>

      <label className={styles.fieldLabel} htmlFor="stripe-plan">
        Plan
        <select
          id="stripe-plan"
          className={styles.fieldInput}
          value={planId}
          onChange={(event) => setPlanId(event.target.value)}
          disabled={loading}
        >
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.label} — {formatPlanPrice(plan)}
            </option>
          ))}
        </select>
      </label>

      {selectedPlan ? (
        <p className={styles.checkoutHint}>{selectedPlan.description}</p>
      ) : null}

      <label className={styles.fieldLabel} htmlFor="stripe-email">
        Email for receipt
        <input
          id="stripe-email"
          type="email"
          className={styles.fieldInput}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          disabled={loading}
          required
        />
      </label>

      <button
        type="button"
        className={styles.checkoutButton}
        disabled={loading || !email.trim() || !planId}
        onClick={() => void startCheckout()}
        data-testid="stripe-checkout-button"
      >
        {loading ? 'Opening secure checkout…' : 'Pay securely with Stripe'}
      </button>

      {error ? (
        <p className={styles.checkoutError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
