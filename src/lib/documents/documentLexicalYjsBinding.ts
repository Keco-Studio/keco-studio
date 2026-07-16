import {
  createBinding,
  type Binding,
  type ExcludedProperties,
  type Provider,
} from '@lexical/yjs';
import type { LexicalEditor } from 'lexical';
import type { Doc } from 'yjs';

const excludedPropertiesByNodeType = new Map<string, readonly string[]>([
  ['table', ['focusEmitter']],
  ['codeblock', ['__focusEmitter']],
  ['jsx', ['__focusEmitter']],
]);

function createDocumentExcludedProperties(
  editor: LexicalEditor
): ExcludedProperties {
  const excludedProperties: ExcludedProperties = new Map();
  for (const [nodeType, propertyNames] of excludedPropertiesByNodeType) {
    const nodeClass = editor._nodes.get(nodeType)?.klass;
    if (!nodeClass) continue;
    excludedProperties.set(nodeClass, new Set(propertyNames));
  }
  return excludedProperties;
}

export function createDocumentLexicalYjsBinding(
  editor: LexicalEditor,
  provider: Provider,
  id: string,
  doc: Doc,
  docMap: Map<string, Doc>
): Binding {
  return createBinding(
    editor,
    provider,
    id,
    doc,
    docMap,
    createDocumentExcludedProperties(editor)
  );
}
