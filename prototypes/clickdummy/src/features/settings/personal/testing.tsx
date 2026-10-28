/*
 * Helpers of the tests of the personal settings: the screen at an address as somebody, with the data layer around it.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach } from 'vitest';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { currentToasts, dismissToast } from '@/components/ui/toast';
import { asUser, resetApi } from '@/test/api';
import PersonalSettings from './PersonalSettings';
import { useTwoFactor } from './twoFactorStore';

/** Call once at the top of a test file: fresh demo data per test, nobody has two-factor, no toast left behind. */
export function usePersonalTestSetup(): void {
  beforeEach(() => {
    resetApi();
    useTwoFactor.setState(useTwoFactor.getInitialState());
    window.scrollTo = () => {};
  });
  afterEach(() => {
    act(() => currentToasts().forEach((item) => dismissToast(item.id)));
  });
}

export function renderPersonal(path = '/me', userId = 'u_mara') {
  asUser(userId);
  const router = createMemoryRouter([{ path: '/me/:section?', element: <PersonalSettings /> }], { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return router;
}

export const textbox = (name: string) => screen.findByRole<HTMLInputElement>('textbox', { name });
export const toastTitled = (title: string) => currentToasts().find((item) => item.title === title);
