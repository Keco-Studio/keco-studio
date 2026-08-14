'use client';

import {
  BOUNDARIES,
  PIPELINE_STAGES,
  PROJECT_CONTENTS,
  WORK_SURFACES,
} from './keco101Content';
import { ArrowDownIcon, ArrowRightIcon, InfoCircleIcon, SparkIcon } from './Keco101Icons';
import styles from './Keco101.module.css';

type Keco101WelcomeProps = {
  onOpenGuide: () => void;
  onScrollDown: () => void;
};

export function Keco101Welcome({ onOpenGuide, onScrollDown }: Keco101WelcomeProps) {
  return (
    <div className={styles.welcome}>
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.eyebrow}>
            <SparkIcon size={13} />
            <span>Keco 101</span>
          </div>
          <h1 className={styles.heroTitle}>
            Make your game,
            <br />
            <span className={styles.heroAccent}>one slice at a time.</span>
          </h1>
          <p className={styles.heroLead}>
            Keco is a workbench for building games. You write the design; Keco turns it into data and
            art, helps you build a playable slice in Godot, then scores it against a fixed standard
            and tells you what to fix next.
          </p>
          <div className={styles.heroActions}>
            <button type="button" className={styles.primaryButton} onClick={onOpenGuide}>
              Start the guide
              <ArrowRightIcon />
            </button>
            <button type="button" className={styles.ghostButton} onClick={onScrollDown}>
              See what is inside
              <ArrowDownIcon />
            </button>
          </div>
          <div className={styles.heroRail}>
            {PIPELINE_STAGES.map((stage) => (
              <div key={stage.id} className={styles.heroRailItem}>
                <div className={styles.heroRailStep}>{stage.step}</div>
                <div className={styles.heroRailTitle}>{stage.title}</div>
              </div>
            ))}
          </div>
          <div className={styles.scrollHint}>
            <ArrowDownIcon size={14} />
            <span>Scroll to see how the six stages fit together</span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeading}>
            <h2>One line, six stages</h2>
            <p>
              Each stage produces what the next one needs, and all six read from the same project. The
              design changes, the data follows; the data changes, the build reads the new values; the
              evaluation writes its findings back as the next round of work.
            </p>
          </div>
          <div className={styles.placeholder} aria-hidden>
            Placeholder: the six-stage production line diagram
          </div>
          <div className={styles.stageGrid} style={{ marginTop: 24 }}>
            {PIPELINE_STAGES.map((stage) => (
              <article key={stage.id} className={styles.stageCard}>
                <div className={styles.stageCardStep}>{stage.step}</div>
                <h3 className={styles.stageCardTitle}>{stage.title}</h3>
                <p className={styles.stageCardText}>{stage.summary}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionAlt}`}>
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeading}>
            <h2>What lives in your project</h2>
            <p>
              One project holds one game. Everything below hangs off it, and every change is made
              against a stable ID rather than a guessed name.
            </p>
          </div>
          <div className={styles.inventory}>
            {PROJECT_CONTENTS.map((group) => (
              <div key={group.label} className={styles.inventoryRow}>
                <span className={styles.inventoryLabel}>{group.label}</span>
                <span className={styles.inventoryPurpose}>{group.purpose}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeading}>
            <h2>Two ways to work, one set of data</h2>
            <p>
              Pick the surface that suits the task. A designer editing numbers in the browser and an
              engineer driving Keco from an AI client are looking at the same project.
            </p>
          </div>
          <div className={styles.surfaceGrid}>
            {WORK_SURFACES.map((surface) => (
              <article key={surface.name} className={styles.surfaceCard}>
                <h3 className={styles.surfaceName}>{surface.name}</h3>
                <div className={styles.surfaceRow}>
                  <span className={styles.surfaceRowLabel}>Best for</span>
                  <span>{surface.bestFor}</span>
                </div>
                <div className={styles.surfaceRow}>
                  <span className={styles.surfaceRowLabel}>Who</span>
                  <span>{surface.audience}</span>
                </div>
                <div className={styles.surfaceRow}>
                  <span className={styles.surfaceRowLabel}>Feels like</span>
                  <span>{surface.feel}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={`${styles.section} ${styles.sectionAlt}`}>
        <div className={styles.sectionInner}>
          <div className={styles.sectionHeading}>
            <h2>What Keco does not do</h2>
            <p>Knowing the edges is more useful than a longer feature list.</p>
          </div>
          <div className={styles.boundaryList}>
            {BOUNDARIES.map((boundary) => (
              <div key={boundary.title} className={styles.boundaryItem}>
                <span style={{ color: '#94a3b8' }} aria-hidden>
                  <InfoCircleIcon />
                </span>
                <div>
                  <h3 className={styles.boundaryTitle}>{boundary.title}</h3>
                  <p className={styles.boundaryText}>{boundary.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.ctaBand}>
        <h2 className={styles.ctaTitle}>Ready to build your first slice?</h2>
        <p className={styles.ctaText}>
          The guide walks the whole line, from writing a design document to reading your first
          evaluation report.
        </p>
        <button type="button" className={styles.primaryButton} onClick={onOpenGuide}>
          Open Getting Started
          <ArrowRightIcon />
        </button>
      </section>
    </div>
  );
}
