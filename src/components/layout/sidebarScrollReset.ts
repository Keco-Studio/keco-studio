type ResetScrollOptions = {
  /** Keep this element's scrollLeft (e.g. rename input scrolled to show the caret). */
  preserve?: HTMLElement | null;
};

/** Reset horizontal scroll nudged by inline-rename focus on sidebar tree/list containers. */
export function resetSidebarHorizontalScroll(
  anchor: HTMLElement | null,
  options: ResetScrollOptions = {}
) {
  if (!anchor) return;
  const preserve = options.preserve ?? null;

  let el: HTMLElement | null = anchor;
  while (el) {
    if (el !== preserve && el.scrollLeft !== 0) el.scrollLeft = 0;
    el = el.parentElement;
  }

  const aside = anchor.closest('aside');
  if (!aside) return;

  aside
    .querySelectorAll<HTMLElement>(
      '.ant-tree-list-holder, .ant-tree-list-holder-inner, [class*="sectionList"], [class*="projectSelectorOptions"], [class*="content"]'
    )
    .forEach((node) => {
      if (node !== preserve && node.scrollLeft !== 0) node.scrollLeft = 0;
    });
}

export function snapSidebarHorizontalScroll(
  anchor: HTMLElement | null,
  options: ResetScrollOptions = {}
) {
  resetSidebarHorizontalScroll(anchor, options);
  requestAnimationFrame(() => resetSidebarHorizontalScroll(anchor, options));
}

function placeCaretAtEnd(input: HTMLInputElement) {
  if (!input.isConnected) return;

  try {
    input.focus({ preventScroll: true });
  } catch {
    input.focus();
  }

  const end = input.value.length;
  // Collapsed selection at end — shows the blinking caret (not a highlight range).
  input.setSelectionRange(end, end);

  // Wait until the input has a real width, then scroll only the input to the end.
  const maxScroll = Math.max(0, input.scrollWidth - input.clientWidth);
  input.scrollLeft = maxScroll;

  // Undo any ancestor scroll the caret may have caused; keep the input's own scroll.
  resetSidebarHorizontalScroll(input, { preserve: input });
}

/**
 * Place caret at end of a rename input and scroll only the input so the end is visible.
 * Parent sidebar/tree scroll is reset so the sidebar width/alignment does not shift.
 * Re-applies after layout frames so the caret is not left off-screen before flex width settles.
 */
export function focusRenameInputAtEnd(input: HTMLInputElement | null) {
  if (!input) return;

  placeCaretAtEnd(input);
  requestAnimationFrame(() => {
    placeCaretAtEnd(input);
    requestAnimationFrame(() => placeCaretAtEnd(input));
  });
}

/**
 * Start sidebar inline rename after the current pointer sequence settles,
 * so the opening double-click does not blur or scroll away the new input/caret.
 */
export function beginSidebarInlineRename(start: () => void) {
  requestAnimationFrame(() => {
    start();
  });
}
