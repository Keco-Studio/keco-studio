/** @jest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { ProjectFoundationFields } from './ProjectFoundationFields';

jest.mock('./ProjectFoundationFields.module.css', () => ({
  fields: 'fields',
  field: 'field',
  nameField: 'nameField',
  input: 'input',
  tagFields: 'tagFields',
  descriptionField: 'descriptionField',
  textarea: 'textarea',
}));

const draft = {
  name: '',
  genres: [],
  designPhilosophies: [],
  description: '',
};

it('uses unique label targets when two Foundation forms render together', () => {
  const { container } = render(
    <>
      <ProjectFoundationFields value={draft} onChange={jest.fn()} />
      <ProjectFoundationFields value={draft} onChange={jest.fn()} />
    </>,
  );

  for (const text of ['Project name', 'Game genres', 'Design philosophies', 'Description']) {
    const labels = Array.from(container.querySelectorAll('label'))
      .filter((label) => label.textContent === text);
    const targetIds = labels.map((label) => label.htmlFor);

    expect(labels).toHaveLength(2);
    expect(new Set(targetIds).size).toBe(2);
    for (const targetId of targetIds) {
      expect(document.getElementById(targetId)).not.toBeNull();
    }
  }
});

it('places the project name in a full-width row above the tag columns', () => {
  render(<ProjectFoundationFields value={draft} onChange={jest.fn()} />);

  const nameField = screen.getByLabelText('Project name').parentElement;
  expect(nameField?.classList.contains('nameField')).toBe(true);
});
