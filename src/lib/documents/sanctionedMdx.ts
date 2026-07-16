import { isUuid } from '@/lib/utils/uuid';
import { DocumentContentValidationError } from './documentStateTypes';
import { parseResourceReferenceAttributes } from './resourceReferenceTypes';
import {
  parseSanctionedMdxAst,
  type SanctionedMdxAstNode,
} from './sanctionedMdxParser';

type SanctionedMdxPropertyRule = {
  name: string;
  required: boolean;
  allowedValues?: readonly string[];
};

type SanctionedMdxComponentRule = {
  kind: 'flow' | 'text';
  hasChildren: boolean;
  props: readonly SanctionedMdxPropertyRule[];
};

export const SANCTIONED_MDX_REGISTRY = {
  Callout: {
    kind: 'flow',
    hasChildren: true,
    props: [
      {
        name: 'type',
        required: true,
        allowedValues: ['info', 'note', 'warning', 'success'],
      },
      { name: 'title', required: false },
    ],
  },
  Details: {
    kind: 'flow',
    hasChildren: true,
    props: [{ name: 'summary', required: true }],
  },
  BlockAnchor: {
    kind: 'text',
    hasChildren: false,
    props: [{ name: 'id', required: true }],
  },
  ResourceReference: {
    kind: 'text',
    hasChildren: false,
    props: [
      {
        name: 'kind',
        required: true,
        allowedValues: ['table-row', 'document-block'],
      },
      { name: 'libraryId', required: false },
      { name: 'assetId', required: false },
      { name: 'displayFieldId', required: false },
      { name: 'documentId', required: false },
      { name: 'blockId', required: false },
      {
        name: 'blockType',
        required: false,
        allowedValues: ['heading', 'paragraph'],
      },
      { name: 'fallbackLabel', required: true },
    ],
  },
} as const satisfies Record<string, SanctionedMdxComponentRule>;

export type SanctionedComponentName = keyof typeof SANCTIONED_MDX_REGISTRY;
export const SANCTIONED_COMPONENT_NAMES = Object.keys(
  SANCTIONED_MDX_REGISTRY
) as SanctionedComponentName[];

type AstNode = SanctionedMdxAstNode;

const SAFE_MARKDOWN_NODE_TYPES = new Set([
  'root',
  'paragraph',
  'heading',
  'text',
  'emphasis',
  'strong',
  'delete',
  'blockquote',
  'list',
  'listItem',
  'code',
  'inlineCode',
  'break',
  'thematicBreak',
  'link',
  'image',
  'linkReference',
  'imageReference',
  'definition',
  'table',
  'tableRow',
  'tableCell',
]);

const EXPRESSION_NODE_TYPES = new Set([
  'mdxFlowExpression',
  'mdxTextExpression',
  'mdxjsEsm',
]);

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;
const DOCUMENT_CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const URL_BASE = 'https://keco.invalid';

function invalid(message = 'Unsupported or unsafe MDX syntax'): never {
  throw new DocumentContentValidationError(message);
}

function childrenOf(node: AstNode): readonly AstNode[] {
  return Array.isArray(node.children) ? node.children : [];
}

function visit(node: AstNode, visitor: (node: AstNode) => void): void {
  visitor(node);
  for (const child of childrenOf(node)) visit(child, visitor);
}

function parseSanctionedMdx(markdown: string): AstNode {
  try {
    return parseSanctionedMdxAst(markdown);
  } catch (error) {
    invalid(
      error instanceof Error
        ? `Document content is not valid MDX: ${error.message}`
        : 'Document content is not valid MDX'
    );
  }
}

function validateUrl(destination: string, kind: 'Link' | 'Image'): void {
  if (
    destination !== destination.trim() ||
    CONTROL_CHARACTER_PATTERN.test(destination) ||
    destination.includes('\\')
  ) {
    invalid(`${kind} URL is not supported`);
  }

  try {
    const url = new URL(destination);
    if (url.protocol === 'https:') return;
    if (
      kind === 'Image' &&
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    ) {
      return;
    }
  } catch {
    // Relative project links are handled below.
  }

  if (kind === 'Link' && /^\/(?!\/)/.test(destination)) {
    try {
      if (new URL(destination, URL_BASE).origin === URL_BASE) return;
    } catch {
      invalid(`${kind} URL is not supported`);
    }
  }

  invalid(`${kind} URL is not supported`);
}

function validateAttributes(
  node: AstNode,
  name: SanctionedComponentName
): Record<string, string> {
  const attributes = new Map<string, string>();
  for (const attribute of node.attributes ?? []) {
    if (
      attribute.type !== 'mdxJsxAttribute' ||
      typeof attribute.name !== 'string' ||
      typeof attribute.value !== 'string'
    ) {
      invalid(`${name} properties must be plain text`);
    }
    if (
      attribute.value.trim().length === 0 ||
      CONTROL_CHARACTER_PATTERN.test(attribute.value)
    ) {
      invalid(`MDX property ${attribute.name} must be plain text`);
    }
    if (attributes.has(attribute.name)) {
      invalid(`Duplicate MDX property: ${attribute.name}`);
    }
    attributes.set(attribute.name, attribute.value);
  }

  const rule = SANCTIONED_MDX_REGISTRY[name];
  const allowed = new Set<string>(
    rule.props.map(({ name: propertyName }) => propertyName)
  );
  for (const attribute of attributes.keys()) {
    if (!allowed.has(attribute)) {
      invalid(`Unsupported ${name} property: ${attribute}`);
    }
  }
  for (const property of rule.props) {
    if (property.required && !attributes.has(property.name)) {
      invalid(`${name} requires ${property.name}`);
    }
    if (
      'allowedValues' in property &&
      attributes.has(property.name) &&
      !property.allowedValues.includes(attributes.get(property.name) as never)
    ) {
      invalid(`${name} ${property.name} is not supported`);
    }
  }
  return Object.fromEntries(attributes);
}

export function validateSanctionedMdxPropertyEdit(
  componentName: string,
  values: Record<string, string>
): Record<string, string> | null {
  if (!Object.hasOwn(SANCTIONED_MDX_REGISTRY, componentName)) return null;
  const rule = SANCTIONED_MDX_REGISTRY[
    componentName as SanctionedComponentName
  ];
  const propertyNames = new Set<string>(rule.props.map(({ name }) => name));
  if (Object.keys(values).some((name) => !propertyNames.has(name))) return null;

  const validated: Record<string, string> = {};
  for (const property of rule.props) {
    const value = values[property.name] ?? '';
    if (!property.required && value.length === 0) continue;
    if (
      ((property.required || value.length > 0) && value.trim().length === 0) ||
      CONTROL_CHARACTER_PATTERN.test(value)
    ) {
      return null;
    }
    if (
      'allowedValues' in property &&
      !property.allowedValues.includes(value as never)
    ) {
      return null;
    }
    validated[property.name] = value;
  }
  if (
    componentName === 'ResourceReference' &&
    !parseResourceReferenceAttributes(validated)
  ) {
    return null;
  }
  if (componentName === 'BlockAnchor' && !isUuid(validated.id)) return null;
  return validated;
}

function validateJsxNode(node: AstNode): void {
  const nodeKind = node.type === 'mdxJsxTextElement' ? 'text' : 'flow';
  if (nodeKind === 'text' && node.name === 'u') {
    if ((node.attributes ?? []).length > 0) {
      invalid('Underline markup does not accept properties');
    }
    return;
  }

  if (
    !SANCTIONED_COMPONENT_NAMES.includes(node.name as SanctionedComponentName)
  ) {
    invalid(
      `Unsupported ${nodeKind === 'text' ? 'inline ' : ''}MDX component: ${node.name ?? 'fragment'}`
    );
  }
  const name = node.name as SanctionedComponentName;
  const rule = SANCTIONED_MDX_REGISTRY[name];
  if (rule.kind !== nodeKind) {
    invalid(`${name} is not supported as a ${nodeKind} component`);
  }
  const attributes = validateAttributes(node, name);
  if (name === 'BlockAnchor' && !isUuid(attributes.id)) {
    invalid('BlockAnchor id must be a UUID');
  }
  if (
    name === 'ResourceReference' &&
    !parseResourceReferenceAttributes(attributes)
  ) {
    invalid('ResourceReference properties are invalid');
  }
  if (rule.hasChildren && childrenOf(node).length === 0) {
    invalid(`${name} must contain Markdown children`);
  }
  if (!rule.hasChildren && childrenOf(node).length > 0) {
    invalid(`${name} must not contain Markdown children`);
  }
}

function collectDefinitions(root: AstNode): Map<string, string> {
  const definitions = new Map<string, string>();
  visit(root, (node) => {
    if (node.type !== 'definition') return;
    if (typeof node.identifier !== 'string' || typeof node.url !== 'string') {
      invalid('Markdown definition is invalid');
    }
    validateUrl(node.url, 'Link');
    if (!definitions.has(node.identifier)) {
      definitions.set(node.identifier, node.url);
    }
  });
  return definitions;
}

function validateAst(root: AstNode): void {
  const definitions = collectDefinitions(root);
  visit(root, (node) => {
    if (EXPRESSION_NODE_TYPES.has(node.type)) {
      invalid('MDX expressions, imports, and exports are not supported');
    }
    if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      validateJsxNode(node);
      return;
    }
    if (!SAFE_MARKDOWN_NODE_TYPES.has(node.type)) {
      invalid(`Unsupported Markdown node: ${node.type}`);
    }
    if (node.type === 'link' || node.type === 'image') {
      if (typeof node.url !== 'string') invalid('Markdown URL is invalid');
      validateUrl(node.url, node.type === 'image' ? 'Image' : 'Link');
    }
    if (node.type === 'imageReference') {
      const destination = node.identifier
        ? definitions.get(node.identifier)
        : undefined;
      if (destination) validateUrl(destination, 'Image');
    }
  });
}

export function validateSanctionedMdxAstNode(node: unknown): void {
  if (
    !node ||
    typeof node !== 'object' ||
    typeof (node as { type?: unknown }).type !== 'string'
  ) {
    invalid('Document contains an invalid MDX node');
  }
  validateAst(node as AstNode);
}

export function parseValidatedSanctionedMdx(markdown: string): SanctionedMdxAstNode {
  if (
    typeof markdown !== 'string' ||
    DOCUMENT_CONTROL_CHARACTER_PATTERN.test(markdown)
  ) {
    throw new DocumentContentValidationError('Document content is invalid');
  }
  const root = parseSanctionedMdx(markdown);
  validateSanctionedMdxAstNode(root);
  return root;
}

export function validateSanctionedMdx(markdown: string): void {
  parseValidatedSanctionedMdx(markdown);
}
