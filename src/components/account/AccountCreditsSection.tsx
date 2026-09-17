'use client';

import { ThunderboltOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import type { AccountCreditSummary } from '@/lib/types/accountCredits';
import styles from './AccountCreditsSection.module.css';

class AccountCreditsRequestError extends Error {
  constructor() {
    super('Unable to load account Credits');
  }
}

function isCreditCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isAccountCreditSummary(value: unknown): value is AccountCreditSummary {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AccountCreditSummary>;

  return (
    isCreditCount(candidate.allocated) &&
    isCreditCount(candidate.used) &&
    isCreditCount(candidate.remaining) &&
    isCreditCount(candidate.overage) &&
    isCreditCount(candidate.deepseekTokens) &&
    isCreditCount(candidate.incompleteCount) &&
    typeof candidate.trackedFrom === 'string' &&
    Number.isFinite(Date.parse(candidate.trackedFrom))
  );
}

async function fetchAccountCredits(): Promise<AccountCreditSummary> {
  const response = await fetch('/api/account/credits', { cache: 'no-store' });
  if (!response.ok) throw new AccountCreditsRequestError();

  const body: unknown = await response.json();
  if (!isAccountCreditSummary(body)) throw new AccountCreditsRequestError();
  return body;
}

function formatCredits(value: number): string {
  return value.toLocaleString('en-US');
}

function formatTrackedFrom(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function incompleteUsageMessage(count: number): string {
  const record = count === 1 ? 'record is' : 'records are';
  return `${count} usage ${record} awaiting final Credit totals and are not included in Used.`;
}

function exhaustedMessage(overage: number): string {
  if (overage > 0) {
    return `Credit allocation exhausted. ${formatCredits(overage)} Credits over allocation.`;
  }
  return 'Credit allocation exhausted.';
}

export function AccountCreditsSection() {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['account-credits'],
    queryFn: fetchAccountCredits,
    retry: false,
  });

  const firstLoadFailed = Boolean(error && !data);

  return (
    <section className={styles.section} aria-labelledby="account-credits-heading">
      <div className={styles.sectionHeading}>
        <span className={styles.icon} aria-hidden="true">
          <ThunderboltOutlined />
        </span>
        <div>
          <h2 id="account-credits-heading">Credits</h2>
          <p>Account-wide AI usage allocation.</p>
        </div>
      </div>

      {firstLoadFailed ? (
        <div className={styles.errorState} role="alert">
          <div>
            <strong>Credit data could not be loaded</strong>
            <span>The account service is temporarily unavailable.</span>
          </div>
          <button type="button" onClick={() => void refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <dl
            className={styles.ledger}
            data-testid={isLoading ? 'account-credits-loading' : undefined}
          >
            <div className={styles.ledgerItem}>
              <dt>Allocated</dt>
              <dd data-testid={data ? 'account-credits-allocated' : undefined}>
                {data ? formatCredits(data.allocated) : <span className={styles.placeholder} data-testid="account-credits-value-placeholder" />}
              </dd>
            </div>
            <div className={styles.ledgerItem}>
              <dt>Used</dt>
              <dd data-testid={data ? 'account-credits-used' : undefined}>
                {data ? formatCredits(data.used) : <span className={styles.placeholder} data-testid="account-credits-value-placeholder" />}
              </dd>
            </div>
            <div className={`${styles.ledgerItem} ${styles.remainingItem}`}>
              <dt>Remaining</dt>
              <dd
                className={styles.remainingValue}
                data-testid={data ? 'account-credits-remaining' : undefined}
              >
                {data ? formatCredits(data.remaining) : <span className={styles.placeholder} data-testid="account-credits-value-placeholder" />}
              </dd>
            </div>
          </dl>

          {data ? (
            <div className={styles.statuses}>
              <p className={styles.trackedFrom}>Usage tracked since {formatTrackedFrom(data.trackedFrom)}</p>
              {data.incompleteCount > 0 ? (
                <p className={styles.warning} role="status">
                  {incompleteUsageMessage(data.incompleteCount)}
                </p>
              ) : null}
              {data.remaining === 0 && (data.allocated > 0 || data.used > 0) ? (
                <p className={styles.warning} role="alert">
                  {exhaustedMessage(data.overage)}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
