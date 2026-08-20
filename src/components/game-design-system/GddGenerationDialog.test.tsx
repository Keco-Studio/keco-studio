/** @jest-environment jsdom */
import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GddGenerationDialog } from './GddGenerationDialog';

jest.mock('./GameDesignSystemsPage.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));

describe('GddGenerationDialog', () => {
  it('shows a start failure inside the open dialog so the click is actionable', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(<GddGenerationDialog open projectName="Project" error="Bind the selected version first." onCancel={jest.fn()} onSubmit={onSubmit} />);

    expect(screen.getByRole('alert').textContent).toContain('Bind the selected version first.');
    await user.click(screen.getByRole('button', { name: 'Start generation' }));
    expect(onSubmit).toHaveBeenCalledWith({ mode: 'professional' });
  });
});
