'use client';

import type { ComponentType } from 'react';
import {
  BarChartOutlined,
  CheckOutlined,
  CreditCardOutlined,
  FileOutlined,
  FireOutlined,
  ReadOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  PROJECT_TEMPLATES,
  type ProjectTemplateDefinition,
  type ProjectTemplateKey,
} from './projectTemplates';
import styles from './ProjectTemplatePicker.module.css';

export type ProjectTemplatePickerProps = {
  value: ProjectTemplateKey;
  onChange: (key: ProjectTemplateKey) => void;
  disabled?: boolean;
};

const templateIcons: Record<ProjectTemplateDefinition['icon'], ComponentType<{ className?: string }>> = {
  blank: FileOutlined,
  cards: CreditCardOutlined,
  story: ReadOutlined,
  survival: FireOutlined,
  management: BarChartOutlined,
  action: ThunderboltOutlined,
  cooperative: TeamOutlined,
};

export function ProjectTemplatePicker({
  value,
  onChange,
  disabled = false,
}: ProjectTemplatePickerProps) {
  const blankTemplate = PROJECT_TEMPLATES[0];
  const templates = PROJECT_TEMPLATES.slice(1);

  return (
    <section className={styles.picker} role="group" aria-label="Project template">
      <TemplateButton
        template={blankTemplate}
        selected={value === blankTemplate.key}
        disabled={disabled}
        onChange={onChange}
        className={styles.blankOption}
      />
      <div className={styles.grid}>
        {templates.map((template) => (
          <TemplateButton
            key={template.key}
            template={template}
            selected={value === template.key}
            disabled={disabled}
            onChange={onChange}
          />
        ))}
      </div>
    </section>
  );
}

type TemplateButtonProps = {
  template: ProjectTemplateDefinition;
  selected: boolean;
  disabled: boolean;
  onChange: (key: ProjectTemplateKey) => void;
  className?: string;
};

function TemplateButton({
  template,
  selected,
  disabled,
  onChange,
  className,
}: TemplateButtonProps) {
  const Icon = templateIcons[template.icon];
  const unavailable = template.availability === 'coming-soon';

  return (
    <button
      className={`${styles.option} ${selected ? styles.selected : ''} ${className ?? ''}`}
      type="button"
      aria-pressed={selected}
      disabled={disabled || unavailable}
      onClick={() => onChange(template.key)}
    >
      <Icon className={styles.icon} aria-hidden="true" />
      <span className={styles.copy}>
        <span className={styles.name}>{template.name}</span>
        <span className={styles.description}>{template.description}</span>
        {unavailable ? <span className={styles.availability}>Coming soon</span> : null}
      </span>
      {selected ? <CheckOutlined className={styles.check} aria-hidden="true" /> : null}
    </button>
  );
}
