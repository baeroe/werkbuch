/*
 * The component gallery (/_components) renders where the browser has no matchMedia (jsdom here, old engines): the
 * menu specimen asks `isWide()` instead of calling matchMedia unguarded.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { resetToasts } from '@/components/ui/toast';
import { resetApi } from '@/test/api';
import { ComponentsGallery } from './components-gallery';

beforeEach(() => resetApi());
afterEach(() => act(() => resetToasts()));

it('renders without matchMedia', async () => {
  expect(typeof window.matchMedia).not.toBe('function');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter>
          <ComponentsGallery />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );

  // the open specimens (menus, pickers) hide the rest from assistive technology, so look for the text itself
  expect(await screen.findByText('Komponenten', { selector: 'h1' })).toBeTruthy();
  expect(screen.getByText('Menü', { selector: 'h3' })).toBeTruthy();
});
