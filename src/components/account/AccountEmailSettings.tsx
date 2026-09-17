'use client';

import { useEffect, useState } from 'react';
import { MailOutlined } from '@ant-design/icons';
import { useSupabase } from '@/lib/SupabaseContext';
import { normalizeEmail } from '@/lib/auth/emailIdentity';
import styles from './AccountEmailSettings.module.css';

export function AccountEmailSettings() {
  const supabase = useSupabase();
  const [currentEmail, setCurrentEmail] = useState('');
  const [loadingEmail, setLoadingEmail] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main className={styles.page}>
      <div className={styles.content}>
        <header className={styles.pageHeader}>
          <h1>Account</h1>
          <p>View the email used to sign in and recover your account.</p>
        </header>

        <section className={styles.section} aria-labelledby="account-email-heading">
          <div className={styles.sectionHeading}>
            <span className={styles.icon} aria-hidden="true">
              <MailOutlined />
            </span>
            <div>
              <h2 id="account-email-heading">Email address</h2>
              <p>Your account email is currently read-only.</p>
            </div>
          </div>

          <dl className={styles.currentEmail}>
            <dt>Current email</dt>
            <dd>{loadingEmail ? 'Loading...' : currentEmail || 'Unavailable'}</dd>
          </dl>

          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </section>
      </div>
    </main>
  );
}
