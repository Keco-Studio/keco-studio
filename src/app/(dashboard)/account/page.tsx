import { AccountCreditsSection } from '@/components/account/AccountCreditsSection';
import { AccountEmailSettings } from '@/components/account/AccountEmailSettings';
import styles from '@/components/account/AccountEmailSettings.module.css';

export default function AccountPage() {
  return (
    <main className={styles.page}>
      <div className={styles.content}>
        <header className={styles.pageHeader}>
          <h1>Account</h1>
          <p>Manage the email used to sign in and recover your account.</p>
        </header>
        <AccountCreditsSection />
        <AccountEmailSettings />
      </div>
    </main>
  );
}
