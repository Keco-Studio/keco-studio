/** @jest-environment jsdom */

import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DEFAULT_PROJECT_TEMPLATE_KEY,
  type ProjectTemplateKey,
} from './projectTemplates';
import { ProjectTemplatePicker } from './ProjectTemplatePicker';

function Harness() {
  const [value, setValue] = useState<ProjectTemplateKey>(DEFAULT_PROJECT_TEMPLATE_KEY);

  return <ProjectTemplatePicker value={value} onChange={setValue} />;
}

it('renders blank plus six representative templates', () => {
  render(<Harness />);

  expect(screen.getByRole('group', { name: 'Project template' })).not.toBeNull();
  expect(screen.getAllByRole('button')).toHaveLength(7);
  expect(screen.getByRole('button', { name: /Blank project/ }).getAttribute('aria-pressed')).toBe('true');
  for (const name of [
    'Tactical deckbuilder',
    'Narrative adventure',
    'Survival builder',
    'Management simulation',
    'Action roguelike',
    'Cooperative puzzle',
  ]) {
    expect(screen.getByRole('button', { name: new RegExp(name) })).not.toBeNull();
  }
});

it('reports and exposes the selected template', async () => {
  const user = userEvent.setup();
  render(<Harness />);

  await user.click(screen.getByRole('button', { name: /Narrative adventure/ }));

  expect(screen.getByRole('button', { name: /Narrative adventure/ }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: /Blank project/ }).getAttribute('aria-pressed')).toBe('false');
});
