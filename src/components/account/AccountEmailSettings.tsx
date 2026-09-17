'use client';

import { FormEvent, useEffect, useState } from 'react';
import { MailOutlined } from '@ant-design/icons';
import { useSupabase } from '@/lib/SupabaseContext';
import { isDuplicateEmailError, normalizeEmail } from '@/lib/auth/emailIdentity';
import styles from './AccountEmailSettings.module.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AccountEmailSettings() {
  const supabase = useSupabase();
  const [currentEmail, setCurrentEmail] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [loadingEmail, setLoadingEmail] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void supabase.auth.getUser().then(({ data, error: authError }) => {
      if (!active) return;
      if (authError || !data.user?.email) {
        setError('Unable to load your account email.');
      } else {
        setCurrentEmail(normalizeEmail(data.user.email));
      }
      setLoadingEmail(false);
    });

    return () => {
      active = false;
    };
  }, [supabase]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const normalizedEmail = normalizeEmail(newEmail);
    if (!normalizedEmail || !EMAIL_PATTERN.test(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (normalizedEmail === currentEmail) {
      setError('Enter a different email address.');
      return;
    }

    setSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser(
        { email: normalizedEmail },
        {
          emailRedirectTo: `${window.location.origin}/auth/callback?redirect=/account`,
        }
      );
      if (updateError) throw updateError;

      setNewEmail('');
      setMessage(
        'Confirm the email change using the messages sent to your email addresses.'
      );
    } catch (updateError) {
      setError(
        isDuplicateEmailError(updateError)
          ? 'An account with this email already exists.'
          : updateError instanceof Error
            ? updateError.message
            : 'Unable to request an email change.'
      );
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
          <p>A change takes effect only after the required email confirmations.</p>
        </div>
      </div>

      <dl className={styles.currentEmail}>
        <dt>Current email</dt>
        <dd>{loadingEmail ? 'Loading...' : currentEmail || 'Unavailable'}</dd>
      </dl>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <label htmlFor="account-new-email">New email</label>
        <div className={styles.formRow}>
          <input
            id="account-new-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="name@example.com"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            disabled={loadingEmail || submitting || !currentEmail}
          />
          <button
            type="submit"
            disabled={loadingEmail || submitting || !currentEmail}
          >
            {submitting ? 'Requesting...' : 'Change email'}
          </button>
        </div>
      </form>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {message ? <p className={styles.success} role="status">{message}</p> : null}
    </section>
  );
}
