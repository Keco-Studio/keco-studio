export const DESKTOP_MODE_STORAGE_KEY = 'keco-desktop-mode';

export function isDesktopModeSearch(search: string): boolean {
  return new URLSearchParams(search).get('desktop') === '1';
}

export function isDesktopModeSession(storage: Storage): boolean {
  return storage.getItem(DESKTOP_MODE_STORAGE_KEY) === '1';
}
