import Link from 'next/link';
import styles from '../payment.module.css';

export default function PaymentCancelPage() {
  return (
    <main className={styles.page}>
      <p className={styles.eyebrowMuted}>Checkout canceled</p>
      <h1 className={styles.title}>No payment was taken.</h1>
      <p className={styles.body}>
        You can return to billing and try Stripe Checkout again whenever you are
        ready.
      </p>
      <Link href="/billing" className={styles.link}>Return to billing</Link>
    </main>
  );
}
