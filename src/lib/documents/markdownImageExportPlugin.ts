import {
  $isImageNode,
  addExportVisitor$,
  realmPlugin,
  type ImageNode,
  type LexicalVisitor,
} from '@mdxeditor/editor';

/**
 * MDXEditor's default image export becomes raw `<img>` HTML/JSX whenever the
 * node has explicit width/height (e.g. after resize). Our sanctioned MDX only
 * allows Markdown images (`![alt](url)`), so always export that form.
 */
export const markdownImageExportVisitor: LexicalVisitor = {
  priority: 100,
  testLexicalNode: $isImageNode,
  visitLexicalNode({ mdastParent, lexicalNode, actions }) {
    const imageNode = lexicalNode as ImageNode;
    actions.appendToParent(mdastParent, {
      type: 'image',
      url: imageNode.getSrc(),
      alt: imageNode.getAltText(),
      title: imageNode.getTitle(),
    });
  },
};

export const markdownImageExportPlugin = realmPlugin({
  init(realm) {
    realm.pub(addExportVisitor$, markdownImageExportVisitor);
  },
});
