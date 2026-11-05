import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { shellLayout } from '@/shell/layout';
import Index from './Index';

// Until the templates screen comes, the page is its frame: the heading and a skeleton.

describe('templates page', () => {
  it('shows the heading and that it loads', () => {
    render(<Index identifier="WEB" templateId={null} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Vorlagen' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Lädt …');
  });

  it('lives in the shell', () => {
    expect(Index.layout).toBe(shellLayout);
  });
});
