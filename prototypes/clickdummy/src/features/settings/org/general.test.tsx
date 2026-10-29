/*
 * The organisation's general settings: a logo that is too big is refused at its field, with its size in German
 * number format.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { resetToasts } from '@/components/ui/toast';
import { resetApi } from '@/test/api';
import General from './General';

beforeEach(() => resetApi());
afterEach(() => act(() => resetToasts()));

it('refuses a logo above 256 KB and names its size with a thousands separator', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter([{ path: '/', element: <General readOnlyReason={null} /> }]);
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  const picker = await screen.findByLabelText('Logo-Datei wählen');
  const big = new File([new Uint8Array(1_500_000)], 'logo.png', { type: 'image/png' });
  fireEvent.change(picker, { target: { files: [big] } });

  // the text as it stands, with its non-breaking spaces (the query itself would read them as plain ones)
  const message = await screen.findByText(/^Das Bild ist/);
  expect(message.textContent).toBe('Das Bild ist 1.465\u00a0KB groß. Erlaubt sind höchstens 256\u00a0KB.');
});
