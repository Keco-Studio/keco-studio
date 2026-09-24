'use client';

import { ThunderboltOutlined } from '@ant-design/icons';
import { Modal } from 'antd';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { AccountCreditSummary } from '@/lib/types/accountCredits';
import modalStyles from '@/components/collaboration/InviteCollaboratorModal.module.css';
import styles from './AccountCreditsSection.module.css';

class AccountCreditsRequestError extends Error {
  constructor() {
    super('Unable to load account Credits');
  }
}

function isCreditCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isCreditAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isAccountCreditSummary(value: unknown): value is AccountCreditSummary {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AccountCreditSummary>;

  return (
    isCreditAmount(candidate.allocated) &&
    isCreditAmount(candidate.used) &&
    isCreditAmount(candidate.remaining) &&
    isCreditAmount(candidate.overage) &&
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
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value);
}

function formatTrackedFrom(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function incompleteUsageMessage(count: number): string {
  if (count === 1) {
    return '1 usage record is awaiting final Credit totals and is not included in Used.';
  }
  return `${count} usage records are awaiting final Credit totals and are not included in Used.`;
}

function exhaustedMessage(overage: number): string {
  if (overage > 0) {
    return `Credit allocation exhausted. ${formatCredits(overage)} Credits over allocation.`;
  }
  return 'Credit allocation exhausted.';
}

export function AccountCreditsSection() {
  const router = useRouter();
  const [hasDismissedRechargePrompt, setHasDismissedRechargePrompt] = useState(false);
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['account-credits'],
    queryFn: fetchAccountCredits,
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const firstLoadFailed = Boolean(error && !data);
  const refreshFailed = Boolean(error && data);
  const isRechargePromptOpen = Boolean(data?.overage > 0 && !hasDismissedRechargePrompt);

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
            aria-busy={isLoading}
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

          {isLoading ? (
            <p className={styles.loadingAnnouncement} role="status">
              Loading Credits
            </p>
          ) : null}

          {data ? (
            <div className={styles.statuses}>
              {refreshFailed ? (
                <div className={styles.refreshError} role="alert">
                  <span>Credit data could not be refreshed. Showing the last loaded values.</span>
                  <button type="button" onClick={() => void refetch()}>
                    Retry
                  </button>
                </div>
              ) : null}
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
      <Modal
        title="Credit allocation exhausted"
        open={isRechargePromptOpen}
        centered
        destroyOnHidden
        width="38.5rem"
        className={modalStyles.modal}
        cancelText="Not now"
        okText="Recharge Credits"
        onCancel={() => setHasDismissedRechargePrompt(true)}
        onOk={() => router.push('/billing')}
      >
        <div className={modalStyles.content}>
          <p className={modalStyles.infoText}>
            Your account has exceeded its Credit allocation. Recharge to continue using Keco.
          </p>
        </div>
      </Modal>
    </section>
  );
}
