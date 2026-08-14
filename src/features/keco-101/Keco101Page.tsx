'use client';

import { useCallback, useRef, useState } from 'react';
import { Keco101Welcome } from './Keco101Welcome';
import { Keco101GettingStarted } from './Keco101GettingStarted';
import { BookIcon, SparkIcon } from './Keco101Icons';
import type { Keco101Tab } from './keco101Content';
import styles from './Keco101.module.css';

const TABS: { id: Keco101Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'welcome', label: 'Welcome', icon: <BookIcon size={15} /> },
  { id: 'getting-started', label: 'Getting Started', icon: <SparkIcon size={15} /> },
];

export function Keco101Page() {
  const [tab, setTab] = useState<Keco101Tab>('welcome');
  const scrollerRef = useRef<HTMLDivElement>(null);

  const selectTab = useCallback((next: Keco101Tab) => {
    setTab(next);
    scrollerRef.current?.scrollTo({ top: 0 });
  }, []);

  const scrollPastHero = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.clientHeight, behavior: 'smooth' });
  }, []);

  return (
    <div className={styles.shell}>
      <header className={styles.tabBar}>
        <div className={styles.tabBrand}>
          <span className={styles.tabBrandMark} aria-hidden>
            <BookIcon size={14} />
          </span>
          <span>Keco 101</span>
        </div>
        <div className={styles.tabs} role="tablist" aria-label="Keco 101 sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`${styles.tab} ${tab === item.id ? styles.tabActive : ''}`}
              onClick={() => selectTab(item.id)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      </header>
      <div className={styles.scroller} ref={scrollerRef}>
        {tab === 'welcome' ? (
          <Keco101Welcome
            onOpenGuide={() => selectTab('getting-started')}
            onScrollDown={scrollPastHero}
          />
        ) : (
          <Keco101GettingStarted />
        )}
      </div>
    </div>
  );
}
