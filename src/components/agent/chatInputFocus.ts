export type FocusableChatInput = {
  disabled?: boolean;
  focus: () => void;
};

export type ScheduleFocusRetry = (retry: () => void) => () => void;

const scheduleNextFrame: ScheduleFocusRetry = (retry) => {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    const frameId = window.requestAnimationFrame(retry);
    return () => window.cancelAnimationFrame(frameId);
  }

  const timeoutId = setTimeout(retry, 0);
  return () => clearTimeout(timeoutId);
};

export function focusChatInput(input: FocusableChatInput | null): boolean {
  if (!input || input.disabled) return false;
  input.focus();
  return true;
}

export function focusChatInputWithRetry(
  getInput: () => FocusableChatInput | null,
  schedule: ScheduleFocusRetry = scheduleNextFrame
): () => void {
  focusChatInput(getInput());
  return schedule(() => {
    focusChatInput(getInput());
  });
}
