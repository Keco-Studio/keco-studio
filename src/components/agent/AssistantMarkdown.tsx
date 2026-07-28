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
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
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
