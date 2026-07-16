import { Transaction, type TransactionSpec } from '@codemirror/state';

type CodeMirrorDocumentView = {
  state: {
    doc: {
      length: number;
      toString: () => string;
    };
  };
  dispatch: (transaction: TransactionSpec) => unknown;
};

export function syncCodeMirrorDocument(
  view: CodeMirrorDocumentView,
  code: string
): boolean {
  const current = view.state.doc.toString();
  if (current === code) return false;

  let from = 0;
  const sharedLength = Math.min(current.length, code.length);
  while (from < sharedLength && current.charCodeAt(from) === code.charCodeAt(from)) {
    from += 1;
  }

  let to = current.length;
  let insertTo = code.length;
  while (
    to > from &&
    insertTo > from &&
    current.charCodeAt(to - 1) === code.charCodeAt(insertTo - 1)
  ) {
    to -= 1;
    insertTo -= 1;
  }

  view.dispatch({
    changes: {
      from,
      to,
      insert: code.slice(from, insertTo),
    },
    annotations: Transaction.addToHistory.of(false),
  });
  return true;
}
