export const LEFTNAV_COLLAPSED_KEY = 'keco.leftnav.collapsed';

export function readLeftNavCollapsed(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(LEFTNAV_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeLeftNavCollapsed(collapsed: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (collapsed) {
      localStorage.setItem(LEFTNAV_COLLAPSED_KEY, '1');
    } else {
      localStorage.removeItem(LEFTNAV_COLLAPSED_KEY);
    }
  } catch {
    // ignore quota / private mode
  }
}
