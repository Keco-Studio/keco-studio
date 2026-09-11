'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ClockCircleOutlined,
  DatabaseOutlined,
  FilterOutlined,
  LeftOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type {
  KecoAdminOverview,
  KecoAdminUser,
  KecoAdminUserStatus,
} from '@/lib/types/kecoAdmin';
import styles from './KecoAdminDashboard.module.css';

class KecoAdminRequestError extends Error {
  constructor(readonly status: number) {
    super('Unable to load Keco Admin data');
  }
}

function isUser(value: unknown): value is KecoAdminUser {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<KecoAdminUser>;
  return (
    typeof candidate.id === 'string' &&
    (candidate.email === null || typeof candidate.email === 'string') &&
    typeof candidate.createdAt === 'string' &&
    (candidate.lastSignInAt === null || typeof candidate.lastSignInAt === 'string') &&
    (candidate.status === 'active' || candidate.status === 'suspended')
  );
}

function isOverview(value: unknown): value is KecoAdminOverview {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<KecoAdminOverview>;
  return (
    Number.isInteger(candidate.totalUsers) &&
    Number(candidate.totalUsers) >= 0 &&
    typeof candidate.refreshedAt === 'string' &&
    Number.isFinite(Date.parse(candidate.refreshedAt)) &&
    Array.isArray(candidate.users) &&
    candidate.users.every(isUser)
  );
}

async function fetchOverview(): Promise<KecoAdminOverview> {
  const response = await fetch('/api/keco-admin/overview', {
    cache: 'no-store',
  });
  if (!response.ok) throw new KecoAdminRequestError(response.status);

  const body: unknown = await response.json();
  if (!isOverview(body)) throw new KecoAdminRequestError(502);
  return body;
}

function formatRefreshedAt(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Never';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return '—';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(parsed));
}

function displayName(user: KecoAdminUser): string {
  if (!user.email) return 'No email';
  const local = user.email.split('@')[0]?.trim();
  return local || user.email;
}

function initials(user: KecoAdminUser): string {
  const source = displayName(user);
  const parts = source.split(/[.\s_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase() || '?';
}

function statusLabel(status: KecoAdminUserStatus): string {
  return status === 'suspended' ? 'Suspended' : 'Active';
}

const unavailableMetrics = [
  {
    label: 'Credit usage',
    icon: <ThunderboltOutlined aria-hidden />,
  },
  {
    label: 'Storage used',
    icon: <DatabaseOutlined aria-hidden />,
  },
  {
    label: 'Stay duration',
    icon: <ClockCircleOutlined aria-hidden />,
  },
] as const;

const plans = ['All', 'Starter', 'Pro', 'Studio', 'Enterprise'] as const;

export function KecoAdminDashboard() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const overviewQuery = useQuery({
    queryKey: ['keco-admin-overview'],
    queryFn: fetchOverview,
    retry: false,
  });

  const { data, error, isFetching, isLoading, refetch } = overviewQuery;
  const denied =
    error instanceof KecoAdminRequestError &&
    (error.status === 401 || error.status === 403);

  useEffect(() => {
    if (denied) router.replace('/projects');
  }, [denied, router]);

  const filteredUsers = useMemo(() => {
    const users = data?.users ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return users;
    return users.filter((user) => {
      const email = user.email?.toLowerCase() ?? '';
      const id = user.id.toLowerCase();
      return email.includes(query) || id.includes(query);
    });
  }, [data?.users, search]);

  if (denied) return null;

  const firstLoadFailed = Boolean(error && !data);
  const refreshFailed = Boolean(error && data);
  const hasUsers = (data?.users.length ?? 0) > 0;

  return (
    <main className={styles.page}>
      <div className={styles.pageInner}>
        <header className={styles.pageHeader}>
          <div>
            <div className={styles.titleRow}>
              <h1>Keco Admin</h1>
              <span className={styles.adminBadge}>Admin only</span>
            </div>
            <p>Account resource overview</p>
          </div>
          <div className={styles.headerActions}>
            {data ? (
              <span className={styles.refreshedAt}>
                Synced {formatRefreshedAt(data.refreshedAt)}
              </span>
            ) : null}
            <button
              type="button"
              className={styles.refreshButton}
              aria-label="Refresh admin data"
              title="Refresh data"
              disabled={isFetching}
              onClick={() => void refetch()}
            >
              <ReloadOutlined aria-hidden className={isFetching ? styles.spinning : ''} />
            </button>
          </div>
        </header>

        {firstLoadFailed ? (
          <section className={styles.errorState} role="alert">
            <div>
              <strong>Admin data could not be loaded</strong>
              <span>The account service is temporarily unavailable.</span>
            </div>
            <button type="button" onClick={() => void refetch()}>
              Retry
            </button>
          </section>
        ) : (
          <>
            {refreshFailed ? (
              <div className={styles.refreshError} role="status">
                Refresh failed. Showing the last synced total.
              </div>
            ) : null}

            <section className={styles.metricsGrid} aria-label="Resource overview">
              <article className={`${styles.metricPanel} ${styles.metricPanelLive}`}>
                <div className={`${styles.metricIcon} ${styles.metricIconLive}`}>
                  <UserOutlined aria-hidden />
                </div>
                <span className={styles.metricLabel}>Total users</span>
                {isLoading ? (
                  <span
                    className={styles.metricSkeleton}
                    data-testid="keco-admin-total-loading"
                    aria-label="Loading total users"
                  />
                ) : data ? (
                  <strong
                    className={styles.metricValue}
                    data-testid="keco-admin-total-users"
                  >
                    {data.totalUsers.toLocaleString('en-US')}
                  </strong>
                ) : null}
                <span className={styles.liveStatus}>
                  <span aria-hidden />
                  Live from Supabase Auth
                </span>
              </article>

              {unavailableMetrics.map((metric) => (
                <article className={styles.metricPanel} key={metric.label}>
                  <div className={styles.metricIcon}>{metric.icon}</div>
                  <span className={styles.metricLabel}>{metric.label}</span>
                  <strong className={`${styles.metricValue} ${styles.metricUnavailable}`}>
                    &mdash;
                  </strong>
                  <span className={styles.unavailableStatus}>Not connected</span>
                </article>
              ))}
            </section>

            <section className={styles.userSection} aria-labelledby="user-resource-heading">
              <div className={styles.sectionHeader}>
                <div>
                  <h2 id="user-resource-heading">User resource details</h2>
                  <p>Credit, Stay, Storage and account status</p>
                </div>
                <div className={styles.searchField}>
                  <SearchOutlined aria-hidden />
                  <input
                    aria-label="Search users"
                    placeholder="Search users"
                    value={search}
                    disabled={!hasUsers}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
              </div>

              <div className={styles.tableTools}>
                <div className={styles.planSegments} aria-label="Plan filter">
                  {plans.map((plan) => (
                    <button
                      key={plan}
                      type="button"
                      className={plan === 'All' ? styles.segmentActive : undefined}
                      disabled
                      title="Plan data is not connected"
                    >
                      {plan}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={styles.filterButton}
                  disabled
                  title="Plan data is not connected"
                >
                  <FilterOutlined aria-hidden />
                  Filter
                </button>
              </div>

              <div
                className={styles.tableScroller}
                role="region"
                aria-label="Scrollable user resource table"
                tabIndex={0}
              >
                <table aria-label="User resource details">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Plan</th>
                      <th>Credit</th>
                      <th>Stay</th>
                      <th>Storage</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      <tr>
                        <td colSpan={7}>
                          <div className={styles.tableEmpty}>
                            <strong>Loading users…</strong>
                          </div>
                        </td>
                      </tr>
                    ) : !hasUsers ? (
                      <tr>
                        <td colSpan={7}>
                          <div className={styles.tableEmpty}>
                            <DatabaseOutlined aria-hidden />
                            <strong>No users found</strong>
                            <span>Supabase Auth returned an empty account list.</span>
                          </div>
                        </td>
                      </tr>
                    ) : filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={7}>
                          <div className={styles.tableEmpty}>
                            <SearchOutlined aria-hidden />
                            <strong>No matching users</strong>
                            <span>Try a different email or user id.</span>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((user) => (
                        <tr key={user.id} data-testid="keco-admin-user-row">
                          <td>
                            <div className={styles.userCell}>
                              <div className={styles.userAvatar} aria-hidden>
                                {initials(user)}
                              </div>
                              <div className={styles.userMeta}>
                                <span className={styles.userName}>{displayName(user)}</span>
                                <span className={styles.userEmail}>
                                  {user.email ?? user.id}
                                </span>
                                <span className={styles.userJoined}>
                                  Joined {formatDateTime(user.createdAt)}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className={styles.unavailableCell}>&mdash;</span>
                          </td>
                          <td>
                            <span className={styles.unavailableCell}>&mdash;</span>
                          </td>
                          <td>
                            <span className={styles.unavailableCell}>&mdash;</span>
                          </td>
                          <td>
                            <span className={styles.unavailableCell}>&mdash;</span>
                          </td>
                          <td>
                            <div
                              className={`${styles.statusCell} ${
                                user.status === 'suspended'
                                  ? styles.statusSuspended
                                  : styles.statusActive
                              }`}
                            >
                              <span aria-hidden />
                              {statusLabel(user.status)}
                            </div>
                          </td>
                          <td>
                            <span className={styles.unavailableCell} title="Actions not available yet">
                              &mdash;
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <footer className={styles.tableFooter}>
                <span>
                  {hasUsers
                    ? `Showing ${filteredUsers.length.toLocaleString('en-US')} of ${data!.totalUsers.toLocaleString('en-US')} users`
                    : 'No user records available'}
                </span>
                <div className={styles.pagination} aria-label="Pagination">
                  <button type="button" disabled aria-label="Previous page">
                    <LeftOutlined aria-hidden />
                  </button>
                  <button type="button" disabled aria-current="page">1</button>
                  <button type="button" disabled aria-label="Next page">
                    <RightOutlined aria-hidden />
                  </button>
                </div>
              </footer>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
