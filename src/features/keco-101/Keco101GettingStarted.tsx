'use client';

import type { MouseEvent } from 'react';
import {
  FAQ_ITEMS,
  GLOSSARY_ITEMS,
  GUIDE_STAGES,
  SAFETY_RULES,
} from './keco101Content';
import { CheckCircleIcon, InfoCircleIcon, ShieldIcon } from './Keco101Icons';
import styles from './Keco101.module.css';

const BEFORE_YOU_START = [
  'Pick the project you are working in. The tools always act inside the selected project — there is no cross-project listing and no project creation from a chat.',
  'To work in the browser, just open Keco and start writing. Nothing else to set up.',
  'To drive Keco from an AI client, install the Keco plugin and connect it once from the account menu, then confirm the connection and authentication are valid before the first write.',
];

export function Keco101GettingStarted() {
  const scrollToSection = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className={styles.guide}>
      <nav className={styles.toc} aria-label="Guide contents">
        <div className={styles.tocTitle}>On this page</div>
        <ul className={styles.tocList}>
          {GUIDE_STAGES.map((stage) => (
            <li key={stage.id}>
              <a
                className={styles.tocLink}
                href={`#${stage.id}`}
                onClick={(event) => scrollToSection(event, stage.id)}
              >
                <span className={styles.tocStep}>{stage.step}</span>
                <span>{stage.title}</span>
              </a>
            </li>
          ))}
          <li>
            <a className={styles.tocLink} href="#safety" onClick={(event) => scrollToSection(event, 'safety')}>
              <span className={styles.tocStep}>—</span>
              <span>How it keeps you safe</span>
            </a>
          </li>
          <li>
            <a className={styles.tocLink} href="#faq" onClick={(event) => scrollToSection(event, 'faq')}>
              <span className={styles.tocStep}>—</span>
              <span>Questions</span>
            </a>
          </li>
          <li>
            <a className={styles.tocLink} href="#glossary" onClick={(event) => scrollToSection(event, 'glossary')}>
              <span className={styles.tocStep}>—</span>
              <span>Glossary</span>
            </a>
          </li>
        </ul>
      </nav>

      <div className={styles.guideBody}>
        <header className={styles.guideHeader}>
          <h1>Getting Started</h1>
          <p className={styles.guideLead}>
            This guide follows one game from an idea to a scored build. Read it in order the first
            time; after that, jump to whichever stage you are standing in.
          </p>
        </header>

        <div className={styles.startCard}>
          <h2 className={styles.startCardTitle}>Before you start</h2>
          <ul className={styles.checkList} style={{ marginBottom: 0 }}>
            {BEFORE_YOU_START.map((item) => (
              <li key={item}>
                <span className={styles.bullet} aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {GUIDE_STAGES.map((stage) => (
          <section key={stage.id} id={stage.id} className={styles.stageSection}>
            <div className={styles.stageHeader}>
              <span className={styles.stageStep}>{stage.step}</span>
              <h2 className={styles.stageTitle}>{stage.title}</h2>
            </div>
            <p className={styles.stageTagline}>{stage.tagline}</p>
            <div className={styles.wherePill}>Where: {stage.where}</div>

            <h3 className={styles.blockTitle}>What you do</h3>
            <ul className={styles.checkList}>
              {stage.youDo.map((item) => (
                <li key={item}>
                  <span className={styles.bullet} aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            {stage.lists?.map((list) => (
              <div key={list.heading} className={styles.subBlock}>
                <h3 className={styles.blockTitle}>{list.heading}</h3>
                {list.heading === 'Field types available' ? (
                  <ul className={styles.chipList}>
                    {list.items.map((item) => (
                      <li key={item} className={styles.chip}>
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className={styles.plainList}>
                    {list.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}

            <div className={styles.outcome}>
              <span aria-hidden style={{ color: '#0f9b6c' }}>
                <CheckCircleIcon />
              </span>
              <span>
                <strong>What you get: </strong>
                {stage.youGet}
              </span>
            </div>

            {stage.limits ? (
              <div className={styles.limits}>
                <span aria-hidden style={{ color: '#b08b2e' }}>
                  <InfoCircleIcon />
                </span>
                <span>
                  <strong>Good to know: </strong>
                  {stage.limits}
                </span>
              </div>
            ) : null}

            <div className={styles.placeholder} aria-hidden>
              {stage.placeholder}
            </div>
          </section>
        ))}

        <section id="safety" className={styles.stageSection}>
          <div className={styles.stageHeader}>
            <span className={styles.stageStep} aria-hidden>
              <ShieldIcon size={16} />
            </span>
            <h2 className={styles.stageTitle}>How it keeps you safe</h2>
          </div>
          <p className={styles.stageTagline}>
            The same rules apply at every stage, whether you are clicking in the browser or asking an
            AI client to do the work.
          </p>
          <ul className={styles.checkList}>
            {SAFETY_RULES.map((rule) => (
              <li key={rule}>
                <span className={styles.bullet} aria-hidden />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </section>

        <section id="faq" className={styles.stageSection}>
          <div className={styles.stageHeader}>
            <h2 className={styles.stageTitle}>Questions people ask first</h2>
          </div>
          <div className={styles.faqList}>
            {FAQ_ITEMS.map((item) => (
              <div key={item.question} className={styles.faqItem}>
                <h3 className={styles.faqQuestion}>{item.question}</h3>
                <p className={styles.faqAnswer}>{item.answer}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="glossary" className={styles.stageSection}>
          <div className={styles.stageHeader}>
            <h2 className={styles.stageTitle}>Glossary</h2>
          </div>
          <div className={styles.glossary}>
            {GLOSSARY_ITEMS.map((item) => (
              <div key={item.term} className={styles.glossaryRow}>
                <span className={styles.glossaryTerm}>{item.term}</span>
                <span className={styles.glossaryMeaning}>{item.meaning}</span>
              </div>
            ))}
          </div>
        </section>

        <p className={styles.footNote}>
          This page is the first pass of Keco 101. The written guide is in place and the visual
          treatment is still open — the dashed blocks mark where screenshots and walkthroughs will
          go once the design is settled.
        </p>
      </div>
    </div>
  );
}
