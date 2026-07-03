export type FocusableChatInput = {
  disabled?: boolean;
  focus: () => void;
};

export function focusChatInput(input: FocusableChatInput | null): boolean {
  if (!input || input.disabled) return false;
  input.focus();
  return true;
}
