'use client';

import { ArrowLeftOutlined, PlusOutlined, SendOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import {
  containsUnsafeDescriptionContent,
  DIRECT_MAP_UNSAFE_DESCRIPTION_MESSAGE,
} from '../model/directMapSchema';
import type { MapSourceOption } from './MapSourcePanel';
import styles from '../CreateMapWorkbench.module.css';

export type MapChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type MapChatPanelProps = {
  mapTitle: string;
  messages: MapChatMessage[];
  documents: MapSourceOption[];
  documentId: string;
  onDocumentChange: (id: string) => void;
  onBack: () => void;
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
  documents,
  documentId,
  onDocumentChange,
  onBack,
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
  const listRef = useRef<HTMLDivElement | null>(null);
  const draftInvalid = containsUnsafeDescriptionContent(draft);
  const canSend = canAsk
    && (Boolean(draft.trim()) || Boolean(documentId))
    && !draftInvalid
    && !busy
    && !readOnly;

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, showGenerate]);

  const submit = () => {
    if (!canSend) return;
    const prompt = draft.trim();
    setDraft('');
    onAsk(prompt);
  };

  return (
    <section className={styles.chatPanel} aria-label="Map conversation">
      <header className={styles.chatHeader}>
        <button type="button" className={styles.chatBackButton} aria-label="Back to saved maps" onClick={onBack}>
          <ArrowLeftOutlined />
        </button>
        <h2 className={styles.chatTitle}>{mapTitle || 'New map'}</h2>
      </header>

      <div className={styles.chatBody} ref={listRef}>
        {messages.length === 0 ? (
          <p className={styles.chatEmpty}>
            Describe the map you want. Keco will create a map plan you can review and generate.
          </p>
        ) : null}
        {messages.map((message) => (
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
        {documents.length > 0 ? (
          <label className={styles.chatDocumentSelect}>
            <span className={styles.srOnly}>Document</span>
            <select
              aria-label="Document"
              value={documentId}
              disabled={busy || readOnly}
              onChange={(event) => onDocumentChange(event.target.value)}
            >
              <option value="">No document</option>
              {documents.map((document) => (
                <option key={document.id} value={document.id}>{document.name}</option>
              ))}
            </select>
          </label>
        ) : null}
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
