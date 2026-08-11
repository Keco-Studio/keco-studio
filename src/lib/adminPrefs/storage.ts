export type AdminBillingPrefs = {
  paymentEnabled: boolean;
  methodLabel: string;
  billingAddress: string;
};

export type AdminNotificationPrefs = {
  emailAlerts: boolean;
  inAppAlerts: boolean;
  collaboratorInvites: boolean;
  libraryUpdates: boolean;
};

export type AdminPrivacyPrefs = {
  shareUsageAnalytics: boolean;
  allowProjectDiscovery: boolean;
  retainActivityHistory: boolean;
};

const BILLING_PREFIX = 'keco.admin.billing';
const NOTIFICATION_PREFIX = 'keco.admin.notifications';
const PRIVACY_PREFIX = 'keco.admin.privacy';

const DEFAULT_BILLING: AdminBillingPrefs = {
  paymentEnabled: true,
  methodLabel: '',
  billingAddress: '',
};

const DEFAULT_NOTIFICATIONS: AdminNotificationPrefs = {
  emailAlerts: true,
  inAppAlerts: true,
  collaboratorInvites: true,
  libraryUpdates: false,
};

const DEFAULT_PRIVACY: AdminPrivacyPrefs = {
  shareUsageAnalytics: false,
  allowProjectDiscovery: false,
  retainActivityHistory: true,
};

function getLocalStorage(): Storage | null {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (!storage) return null;
    return storage;
  } catch {
    return null;
  }
}

function readJson<T>(key: string, fallback: T): T {
  const storage = getLocalStorage();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  const storage = getLocalStorage();
  if (!storage) return;
  storage.setItem(key, JSON.stringify(value));
}

export function readBillingPrefs(userId: string, projectId: string): AdminBillingPrefs {
  return readJson(`${BILLING_PREFIX}:${userId}:${projectId}`, DEFAULT_BILLING);
}

export function writeBillingPrefs(
  userId: string,
  projectId: string,
  prefs: AdminBillingPrefs
): void {
  writeJson(`${BILLING_PREFIX}:${userId}:${projectId}`, prefs);
}

export function readNotificationPrefs(userId: string): AdminNotificationPrefs {
  return readJson(`${NOTIFICATION_PREFIX}:${userId}`, DEFAULT_NOTIFICATIONS);
}

export function writeNotificationPrefs(userId: string, prefs: AdminNotificationPrefs): void {
  writeJson(`${NOTIFICATION_PREFIX}:${userId}`, prefs);
}

export function readPrivacyPrefs(userId: string): AdminPrivacyPrefs {
  return readJson(`${PRIVACY_PREFIX}:${userId}`, DEFAULT_PRIVACY);
}

export function writePrivacyPrefs(userId: string, prefs: AdminPrivacyPrefs): void {
  writeJson(`${PRIVACY_PREFIX}:${userId}`, prefs);
}
