import Link from 'next/link';
import styles from '../payment.module.css';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PaymentCancelPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const projectId =
    typeof params.project_id === 'string' ? params.project_id : null;
  const returnHref = projectId ? `/${projectId}/admin` : '/projects';

  return (
    <main className={styles.page}>
      <p className={styles.eyebrowMuted}>Checkout canceled</p>
      <h1 className={styles.title}>No payment was taken.</h1>
      <p className={styles.body}>
        You can return to project settings and try Stripe Checkout again whenever
        you are ready.
      </p>
      <Link href={returnHref} className={styles.link}>
        {projectId ? 'Return to settings' : 'Return to projects'}
      </Link>
    </main>
  );
}
