'use client';

import { useCallback, useEffect, useState } from 'react';
import { MailOutlined } from '@ant-design/icons';
import { useSupabase } from '@/lib/SupabaseContext';
import { normalizeEmail } from '@/lib/auth/emailIdentity';
import {
  emailChangeErrorMessage,
  pendingEmailFromUser,
  validateEmailChangeIdentity,
} from '@/lib/auth/emailChange';
import styles from './AccountEmailSettings.module.css';

export function AccountEmailSettings() {
  const supabase = useSupabase();
  const [currentEmail, setCurrentEmail] = useState('');
  const [currentEmailInput, setCurrentEmailInput] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [loadingEmail, setLoadingEmail] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUser = useCallback(async () => {
    const { data, error: authError } = await supabase.auth.getUser();
    if (authError || !data.user?.email) throw authError ?? new Error('Missing email');
    const email = normalizeEmail(data.user.email);
    setCurrentEmail(email);
    setCurrentEmailInput(email);
    const pending = pendingEmailFromUser(data.user);
    setPendingEmail(pending);
    if (pending) {
      setNewEmail(pending);
      setStep('verify');
    }
    return email;
  }, [supabase]);

  useEffect(() => {
    let active = true;

    void loadUser().then(() => {
      if (!active) return;
    }).catch(() => {
      if (active) setError('Unable to load your account email.');
    }).finally(() => {
      if (!active) return;
      setLoadingEmail(false);
    });

    return () => {
      active = false;
    };
  }, [loadUser]);

  const requestChange = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const validated = validateEmailChangeIdentity(currentEmail, currentEmailInput, newEmail);
      const { error: updateError } = await supabase.auth.updateUser({ email: validated.newEmail });
      if (updateError) throw updateError;
      setNewEmail(validated.newEmail);
      setPendingEmail(validated.newEmail);
      setVerificationCode('');
      setStep('verify');
    } catch (cause) {
      setError(cause instanceof Error && cause.message.startsWith('Current email')
        ? cause.message
        : emailChangeErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const verifyChange = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (!pendingEmail) throw new Error('No pending email change.');
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: pendingEmail,
        token: verificationCode.trim(),
        type: 'email_change',
      });
      if (verifyError) throw verifyError;
      await loadUser();
      setPendingEmail(null);
      setNewEmail('');
      setVerificationCode('');
      setStep('request');
    } catch (cause) {
      setError(emailChangeErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="account-email-heading">
      <div className={styles.sectionHeading}>
        <span className={styles.icon} aria-hidden="true">
          <MailOutlined />
        </span>
        <div>
          <h2 id="account-email-heading">Email address</h2>
          <p>Verify a change before it becomes the email used to sign in.</p>
        </div>
      </div>

      <dl className={styles.currentEmail}>
        <dt>Current email</dt>
        <dd>{loadingEmail ? 'Loading...' : currentEmail || 'Unavailable'}</dd>
      </dl>

      {!loadingEmail && currentEmail ? (
        <div className={styles.form}>
          {step === 'request' ? (
            <>
              <label>
                Current email
                <input
                  type="email"
                  value={currentEmailInput}
                  onChange={(event) => setCurrentEmailInput(event.target.value)}
                  autoComplete="email"
                />
              </label>
              <label>
                New email
                <input
                  type="email"
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  autoComplete="email"
                />
              </label>
              <button type="button" onClick={() => void requestChange()} disabled={submitting}>
                {submitting ? 'Sending code...' : 'Change email'}
              </button>
            </>
          ) : (
            <>
              <p className={styles.pending}>A verification code was sent to {pendingEmail}.</p>
              <label>
                Verification code
                <input
                  inputMode="numeric"
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value)}
                  autoComplete="one-time-code"
                />
              </label>
              <div className={styles.actions}>
                <button type="button" onClick={() => void verifyChange()} disabled={submitting || !verificationCode.trim()}>
                  {submitting ? 'Verifying...' : 'Verify email'}
                </button>
                <button type="button" className={styles.secondaryButton} onClick={() => { setStep('request'); setError(null); }} disabled={submitting}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </section>
  );
}
