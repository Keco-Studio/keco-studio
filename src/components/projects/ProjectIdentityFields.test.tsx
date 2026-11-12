/** @jest-environment jsdom */

import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ProjectIdentityFields,
  type ProjectIdentityDraft,
} from './ProjectIdentityFields';

const emptyDraft: ProjectIdentityDraft = { name: '', description: '' };

function Harness() {
  const [value, setValue] = useState(emptyDraft);
  return <ProjectIdentityFields value={value} onChange={setValue} />;
}

it('renders only project identity fields with unique label targets', () => {
  const { container } = render(
    <>
      <ProjectIdentityFields value={emptyDraft} onChange={jest.fn()} />
      <ProjectIdentityFields value={emptyDraft} onChange={jest.fn()} />
    </>,
  );

  for (const text of ['Project name', 'Description']) {
    const labels = Array.from(container.querySelectorAll('label'))
      .filter((label) => label.textContent === text);
    const targetIds = labels.map((label) => label.htmlFor);
    expect(labels).toHaveLength(2);
    expect(new Set(targetIds).size).toBe(2);
    targetIds.forEach((targetId) => expect(document.getElementById(targetId)).not.toBeNull());
  }

  expect(screen.queryByLabelText('Game genres')).toBeNull();
  expect(screen.queryByLabelText('Design philosophies')).toBeNull();
});

it('reports controlled name and description changes', async () => {
  const user = userEvent.setup();
  render(<Harness />);

  await user.type(screen.getByLabelText('Project name'), 'Harbor Signal');
  await user.type(screen.getByLabelText('Description'), 'A cooperative mystery.');

  expect((screen.getByLabelText('Project name') as HTMLInputElement).value).toBe('Harbor Signal');
  expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('A cooperative mystery.');
});
