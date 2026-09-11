'use client';

import {
  ArrowLeftOutlined,
  CloseOutlined,
  FilterOutlined,
  PlusOutlined,
  SearchOutlined,
  SendOutlined,
} from '@ant-design/icons';
import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import paperIcon from '@/assets/images/paper.svg';
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

export type MapChatAttachedDocument = {
  id: string;
  name: string;
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
  attachedDocument?: MapChatAttachedDocument | null;
  onClearAttachedDocument?: () => void;
  onAttachFile?: (file: File) => void;
  onAttachKecoDocument?: () => void;
  fileAccept?: string;
};

function FileClipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className={styles.chatAttachMenuIconSvg}>
      <path
        d="M10.5 4.5 5.75 9.25a2.121 2.121 0 1 0 3 3L13 8a3.536 3.536 0 0 0-5-5L4.25 6.75"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
  attachedDocument = null,
  onClearAttachedDocument,
  onAttachFile,
  onAttachKecoDocument,
  fileAccept = '.txt,.md,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}: MapChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const attachWrapRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftInvalid = containsUnsafeDescriptionContent(draft);
  const canSend = canAsk
    && (Boolean(draft.trim()) || Boolean(attachedDocument))
    && !draftInvalid
    && !busy
    && !readOnly;
  const canAttach = Boolean(onAttachFile || onAttachKecoDocument) && !busy && !readOnly;

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

  useEffect(() => {
    if (!attachMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!attachWrapRef.current?.contains(event.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAttachMenuOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [attachMenuOpen]);

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
        {attachedDocument ? (
          <div className={styles.chatAttachmentRow}>
            <span className={styles.chatAttachmentChip} title={attachedDocument.name}>
              <Image src={paperIcon} alt="" width={14} height={14} aria-hidden="true" />
              <span className={styles.chatAttachmentName}>{attachedDocument.name}</span>
              {onClearAttachedDocument && !readOnly ? (
                <button
                  type="button"
                  className={styles.chatAttachmentRemove}
                  aria-label="Remove attached document"
                  disabled={busy}
                  onClick={onClearAttachedDocument}
                >
                  <CloseOutlined />
                </button>
              ) : null}
            </span>
          </div>
        ) : null}
        <div className={styles.chatInputBar}>
          <div className={styles.chatAttachWrap} ref={attachWrapRef}>
            <input
              ref={fileInputRef}
              type="file"
              accept={fileAccept}
              className={styles.chatFileInputHidden}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file || !onAttachFile) return;
                onAttachFile(file);
              }}
            />
            <button
              type="button"
              className={styles.chatAttachButton}
              disabled={!canAttach}
              aria-label="Attach"
              aria-haspopup="menu"
              aria-expanded={attachMenuOpen}
              title="Attach"
              onClick={() => setAttachMenuOpen((open) => !open)}
            >
              <PlusOutlined />
            </button>
            {attachMenuOpen ? (
              <div className={styles.chatAttachMenu} role="menu" aria-label="Attach options">
                {onAttachFile ? (
                  <button
                    type="button"
                    className={styles.chatAttachMenuItem}
                    role="menuitem"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                  >
                    <FileClipIcon />
                    <span>File</span>
                  </button>
                ) : null}
                {onAttachKecoDocument ? (
                  <button
                    type="button"
                    className={styles.chatAttachMenuItem}
                    role="menuitem"
                    onClick={() => {
                      setAttachMenuOpen(false);
                      onAttachKecoDocument();
                    }}
                  >
                    <Image
                      src={paperIcon}
                      alt=""
                      width={16}
                      height={16}
                      className={styles.chatAttachMenuIcon}
                      aria-hidden="true"
                    />
                    <span>Keco Document</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
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
