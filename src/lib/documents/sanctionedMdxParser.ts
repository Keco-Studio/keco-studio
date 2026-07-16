import { fromMarkdown } from 'mdast-util-from-markdown';
import { mdxFromMarkdown } from 'mdast-util-mdx';
import { mdxjs } from 'micromark-extension-mdxjs';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

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
};

export function parseSanctionedMdxAst(markdown: string): SanctionedMdxAstNode {
  return fromMarkdown(markdown, {
    extensions: [gfm(), mdxjs()],
    mdastExtensions: [gfmFromMarkdown(), mdxFromMarkdown()],
  }) as SanctionedMdxAstNode;
}
