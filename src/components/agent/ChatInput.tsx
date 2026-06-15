'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LoadingOutlined } from '@ant-design/icons';
import { clearDraft, getDraft, setDraft } from './agentChatStorage';
import styles from './ChatPanel.module.css';

interface Props {
  userId?: string;
  isStreaming: boolean;
  onSend: (message: string) => void;
}

const DEBOUNCE_MS = 300;

export function ChatInput({ userId, isStreaming, onSend }: Props) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) {
      setValue('');
      return;
    }
    const saved = getDraft(userId);
    setValue(saved);
    const el = textareaRef.current;
    if (el && saved) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    }
  }, [userId]);

  const updateValue = useCallback(
    (next: string) => {
      setValue(next);
      if (!userId) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (next.trim()) {
          setDraft(userId, next);
        } else {
          clearDraft(userId);
        }
      }, DEBOUNCE_MS);
    },
    [userId]
  );

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setValue('');
    if (userId) clearDraft(userId);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={styles.inputBar}>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        rows={1}
        disabled={isStreaming}
        placeholder={
          isStreaming
            ? 'Keco Assistant is working…'
            : 'Ask Keco Assistant…  (Enter to send, Shift+Enter for newline)'
        }
        value={value}
        onChange={(e) => {
          updateValue(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
        }}
        onKeyDown={handleKeyDown}
      />
      <button
        className={`${styles.sendBtn} ${isStreaming ? styles.sendBtnWorking : ''}`}
        disabled={isStreaming || !value.trim()}
        onClick={submit}
        aria-busy={isStreaming}
      >
        {isStreaming ? <LoadingOutlined spin /> : 'Send'}
      </button>
    </div>
  );
}

export default ChatInput;
