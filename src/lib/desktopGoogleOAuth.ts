type DesktopBridge = {
  invoke(
    command: 'desktop.begin_google_oauth',
    payload: Record<string, never>,
  ): Promise<{ status: 'completed' }>;
};

declare global {
  interface Window {
    zero?: DesktopBridge;
  }
}

export async function beginDesktopGoogleOAuth(): Promise<void> {
  const bridge = window.zero;
  if (!bridge) {
    throw new Error('Desktop sign-in is unavailable. Please restart Keco Studio.');
  }

  await bridge.invoke('desktop.begin_google_oauth', {});
}
