/** @jest-environment jsdom */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GddGenerationDialog } from './GddGenerationDialog';

jest.mock('./GameDesignSystemsPage.module.css', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));

const pageStyles = readFileSync(
  join(process.cwd(), 'src/components/game-design-system/GameDesignSystemsPage.module.css'),
  'utf8',
);

function zIndexFor(className: string): number {
  const match = pageStyles.match(new RegExp(`\\.${className}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`Missing .${className} CSS rule`);
  const zIndex = match[1].match(/z-index:\s*(\d+)/);
  if (!zIndex) throw new Error(`Missing z-index for .${className}`);
  return Number(zIndex[1]);
}

describe('GddGenerationDialog', () => {
  it('places its backdrop above the dashboard chrome', () => {
    expect(zIndexFor('dialogBackdrop')).toBeGreaterThan(zIndexFor('library'));
  });

  it('shows a start failure inside the open dialog so the click is actionable', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(<GddGenerationDialog open projectName="Project" error="Bind the selected version first." onCancel={jest.fn()} onSubmit={onSubmit} />);

    expect(screen.getByRole('alert').textContent).toContain('Bind the selected version first.');
    await user.click(screen.getByRole('button', { name: 'Generate GDD + maps' }));
    expect(onSubmit).toHaveBeenCalledWith({ mode: 'professional' });
  });
});
