import Link from 'next/link';
import styles from '../payment.module.css';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const projectId =
    typeof params.project_id === 'string' ? params.project_id : null;
  const returnHref = projectId ? `/${projectId}/billing` : '/projects';

  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>Payment received</p>
      <h1 className={styles.title}>Thank you for your payment.</h1>
      <p className={styles.body}>
        Stripe has received your payment. Keco Studio will confirm the order after
        the secure webhook updates your billing record.
      </p>
      <Link href={returnHref} className={styles.link}>
        {projectId ? 'Return to billing' : 'Return to projects'}
      </Link>
    </main>
  );
}
