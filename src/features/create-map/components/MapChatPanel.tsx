'use client';

import {
  ArrowLeftOutlined,
  FilterOutlined,
  PlusOutlined,
  SearchOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  containsUnsafeDescriptionContent,
  DIRECT_MAP_UNSAFE_DESCRIPTION_MESSAGE,
} from '../model/directMapSchema';
import styles from '../CreateMapWorkbench.module.css';

export type MapChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type MapChatPanelProps = {
  mapTitle: string;
  messages: MapChatMessage[];
  onBack: () => void;
  onCreate?: () => void;
  onAsk: (prompt: string) => void;
  onGenerate: () => void;
  canAsk: boolean;
  canGenerate: boolean;
  showGenerate: boolean;
  busy?: boolean;
  readOnly?: boolean;
  error?: string | null;
};

export function MapChatPanel({
  mapTitle,
  messages,
  onBack,
  onCreate,
  onAsk,
  onGenerate,
  canAsk,
  canGenerate,
  showGenerate,
  busy = false,
  readOnly = false,
  error = null,
}: MapChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const draftInvalid = containsUnsafeDescriptionContent(draft);
  const canSend = canAsk
    && Boolean(draft.trim())
    && !draftInvalid
    && !busy
    && !readOnly;

  const visibleMessages = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return messages;
    return messages.filter((message) => message.text.toLowerCase().includes(needle));
  }, [messages, query]);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [visibleMessages, showGenerate, filterOpen]);

  const submit = () => {
    if (!canSend) return;
    const prompt = draft.trim();
    setDraft('');
    onAsk(prompt);
  };

  const showSearch = filterOpen || messages.length > 0;

  return (
    <section className={styles.chatPanel} aria-label="Map conversation">
      <header className={styles.chatHeader}>
        <button type="button" className={styles.chatBackButton} aria-label="Back to saved maps" onClick={onBack}>
          <ArrowLeftOutlined />
        </button>
        <h2 className={styles.chatTitle}>{mapTitle || 'New map'}</h2>
        <div className={styles.chatHeaderActions}>
          <button
            type="button"
            className={styles.chatHeaderIconButton}
            aria-label="Create map"
            title="Create map"
            disabled={readOnly || !onCreate}
            onClick={onCreate}
          >
            <PlusOutlined />
          </button>
          <button
            type="button"
            className={styles.chatHeaderIconButton}
            aria-label="Filter messages"
            aria-pressed={filterOpen}
            title="Filter messages"
            onClick={() => setFilterOpen((open) => !open)}
          >
            <FilterOutlined />
          </button>
        </div>
      </header>

      <div className={styles.chatBody} ref={listRef}>
        {messages.length === 0 ? (
          <p className={styles.chatEmpty}>
            Describe the map you want. Keco will create a map plan you can review and generate.
          </p>
        ) : null}
        {showSearch ? (
          <label className={styles.chatSearch}>
            <SearchOutlined aria-hidden />
            <input
              type="search"
              placeholder="Search messages..."
              aria-label="Search messages"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        ) : null}
        {visibleMessages.map((message) => (
          <div
            key={message.id}
            className={message.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAssistant}
          >
            {message.text}
          </div>
        ))}
        {showGenerate ? (
          <button
            type="button"
            className={styles.chatGenerateButton}
            disabled={!canGenerate || busy || readOnly}
            onClick={onGenerate}
          >
            Generate map
          </button>
        ) : null}
        {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
      </div>

      <div className={styles.chatComposer}>
        <div className={styles.chatInputBar}>
          <button type="button" className={styles.chatAttachButton} disabled aria-label="Attach" title="Attach">
            <PlusOutlined />
          </button>
          <textarea
            className={styles.chatInput}
            rows={1}
            placeholder="Ask AI to help..."
            aria-label="Ask AI to help"
            aria-invalid={draftInvalid || undefined}
            value={draft}
            disabled={busy || readOnly}
            maxLength={4000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button
            type="button"
            className={styles.chatSendButton}
            aria-label="Send"
            disabled={!canSend}
            onClick={submit}
          >
            <SendOutlined />
          </button>
        </div>
        {draftInvalid ? (
          <p className={styles.inlineError} role="alert">
            <strong>Invalid.</strong> {DIRECT_MAP_UNSAFE_DESCRIPTION_MESSAGE}
          </p>
        ) : null}
      </div>
    </section>
  );
}
