import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { shellLayout } from '@/shell/layout';
import Index from './Index';

const screen = vi.hoisted(() => vi.fn((_props: unknown) => null));
vi.mock('@/features/templates/TemplatesScreen', () => ({ TemplatesScreen: screen }));

describe('templates page', () => {
  it('renders the templates screen with the identifier and the template of the address', () => {
    render(<Index identifier="WEB" templateId="new" />);

    expect(screen).toHaveBeenCalledWith({ identifier: 'WEB', templateId: 'new' }, undefined);
  });

  it('lives in the shell', () => {
    expect(Index.layout).toBe(shellLayout);
  });
});
