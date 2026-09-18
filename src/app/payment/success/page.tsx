import Link from 'next/link';
import styles from '../payment.module.css';

export default function PaymentSuccessPage() {
  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>Payment received</p>
      <h1 className={styles.title}>Thank you for your payment.</h1>
      <p className={styles.body}>
        Stripe has received your payment. Keco Studio will confirm the order after
        the secure webhook updates your billing record.
      </p>
      <Link href="/billing" className={styles.link}>Return to billing</Link>
    </main>
  );
}
