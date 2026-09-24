import { AccountCreditsSection } from '@/components/account/AccountCreditsSection';
import { AccountEmailSettings } from '@/components/account/AccountEmailSettings';
import { AccountStorageSection } from '@/components/account/AccountStorageSection';
import styles from '@/components/account/AccountEmailSettings.module.css';

export default function AccountPage() {
  return (
    <main className={styles.page}>
      <div className={styles.content}>
        <header className={`${styles.pageHeader} ${styles.narrow}`}>
          <h1>Account</h1>
          <p>View the email used to sign in and recover your account.</p>
        </header>
        <div className={styles.narrow}><AccountCreditsSection /></div>
        <AccountStorageSection />
        <div className={styles.narrow}><AccountEmailSettings /></div>
      </div>
    </main>
  );
}
