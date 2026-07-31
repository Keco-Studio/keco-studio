import { redirect } from 'next/navigation';

/** Dashboard route-group index: send users to the projects list. */
export default function DashboardPage() {
  redirect('/projects');
}
