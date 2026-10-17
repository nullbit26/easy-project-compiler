import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import App from '../App';

describe('i18n and Language Switcher', () => {
  it('toggles language between English and Russian', () => {
    localStorage.removeItem('easy_project_compiler_lang');
    render(<App />);

    // In default Russian:
    const ruButton = screen.getByRole('button', { name: 'RU' });
    const enButton = screen.getByRole('button', { name: 'EN' });
    expect(ruButton).toBeInTheDocument();
    expect(enButton).toBeInTheDocument();

    // Default language is RU: check Russian UI element
    expect(screen.getByText('Компилятор промптов')).toBeInTheDocument();

    // Switch to English
    fireEvent.click(enButton);

    // Check English tab name is present
    expect(screen.getByText('Prompt Compiler')).toBeInTheDocument();

    // Switch back to Russian
    fireEvent.click(ruButton);
    expect(screen.getByText('Компилятор промптов')).toBeInTheDocument();
  });
});
