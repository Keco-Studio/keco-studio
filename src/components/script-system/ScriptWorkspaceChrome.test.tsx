/** @jest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it } from '@jest/globals';
import { cleanup, render, screen } from '@testing-library/react';
import { ScriptWorkspaceToolbar } from './ScriptWorkspaceToolbar';

afterEach(cleanup);

describe('ScriptWorkspaceToolbar', () => {
  it('renders the script identity without template actions', () => {
    render(
      <ScriptWorkspaceToolbar
        libraryName="Midnight Guest Room"
      />,
    );

    expect(screen.getByText('Story Script')).not.toBeNull();
    expect(screen.getByText('Midnight Guest Room')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Templates' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save as Template' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Structure Check/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save Script' })).toBeNull();
    expect(screen.queryByText('Generate Animation')).toBeNull();
  });
});
