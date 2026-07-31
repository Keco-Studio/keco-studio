'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './ChatPanel.module.css';
import { collapseMarkdownThematicBreaks } from './collapseMarkdownThematicBreaks';

export function AssistantMarkdown({ markdown }: { markdown: string }) {
  const normalized = collapseMarkdownThematicBreaks(markdown);

  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          hr: () => null,
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
          code: ({ node: _node, className, children, ...props }) => {
            const isBlock = typeof className === 'string' && className.includes('language-');
            if (isBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className={styles.entityChip} {...props}>
                {children}
              </code>
            );
          },
          strong: ({ node: _node, children, ...props }) => (
            <strong className={styles.entityChip} {...props}>
              {children}
            </strong>
          ),
          table: ({ node: _node, ...props }) => (
            <div className={styles.markdownTableWrap}>
              <table {...props} className={styles.markdownTable} />
            </div>
          ),
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

export default AssistantMarkdown;
