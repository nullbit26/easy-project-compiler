import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';
import React from 'react';

describe('App Smoke Test', () => {
  it('renders without crashing', () => {
    render(<App />);
    // The app names itself at the top of the full-height sidebar column, which is the only place it does.
    expect(screen.getByTestId('app-brand')).toHaveTextContent('Easy Project Compiler');
  });
});
