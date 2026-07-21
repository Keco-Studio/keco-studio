import { fromMarkdown } from 'mdast-util-from-markdown';
import { mdxFromMarkdown } from 'mdast-util-mdx';
import { mdxjs } from 'micromark-extension-mdxjs';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfmToMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { mdxToMarkdown } from 'mdast-util-mdx';
import { defaultHandlers, toMarkdown } from 'mdast-util-to-markdown';

export type SanctionedMdxAstAttribute = {
  type: string;
  name?: unknown;
  value?: unknown;
};

export type SanctionedMdxAstNode = {
  type: string;
  children?: readonly SanctionedMdxAstNode[];
  attributes?: readonly SanctionedMdxAstAttribute[];
  identifier?: string;
  name?: string | null;
  url?: string;
  value?: string;
  depth?: number;
  ordered?: boolean | null;
  start?: number | null;
  lang?: string | null;
  alt?: string | null;
  title?: string | null;
};

export function parseSanctionedMdxAst(markdown: string): SanctionedMdxAstNode {
  return fromMarkdown(markdown, {
    extensions: [gfm(), mdxjs()],
    mdastExtensions: [gfmFromMarkdown(), mdxFromMarkdown()],
  }) as SanctionedMdxAstNode;
}

export function serializeSanctionedMdxAst(ast: SanctionedMdxAstNode): string {
  return toMarkdown(ast as Parameters<typeof toMarkdown>[0], {
    extensions: [gfmToMarkdown(), mdxToMarkdown()],
    handlers: {
      text(node, parent, state, info) {
        if (node.data?.exactPlainText === true) return node.value;
        return defaultHandlers.text(node, parent, state, info);
      },
    },
  });
}
