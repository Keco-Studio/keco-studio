import { focusChatInput, focusChatInputWithRetry } from '../../../src/components/agent/chatInputFocus';

describe('focusChatInput', () => {
  it('focuses an enabled chat textarea when focus is requested', () => {
    const textarea = {
      disabled: false,
      focus: jest.fn(),
    };

    expect(focusChatInput(textarea)).toBe(true);
    expect(textarea.focus).toHaveBeenCalledTimes(1);
  });

  it('does not focus a missing or disabled textarea', () => {
    const disabledTextarea = {
      disabled: true,
      focus: jest.fn(),
    };

    expect(focusChatInput(null)).toBe(false);
    expect(focusChatInput(disabledTextarea)).toBe(false);
    expect(disabledTextarea.focus).not.toHaveBeenCalled();
  });

  it('retries focus on the next frame when the textarea becomes available late', () => {
    let queuedRetry: (() => void) | null = null;
    let textarea: { disabled: boolean; focus: jest.Mock } | null = null;
    const lateTextarea = {
      disabled: false,
      focus: jest.fn(),
    };

    focusChatInputWithRetry(
      () => textarea,
      (retry) => {
        queuedRetry = retry;
        return jest.fn();
      }
    );

    expect(lateTextarea.focus).not.toHaveBeenCalled();

    textarea = lateTextarea;
    queuedRetry?.();

    expect(lateTextarea.focus).toHaveBeenCalledTimes(1);
  });
});
