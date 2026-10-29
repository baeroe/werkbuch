/*
 * Helpers of the tests of the project settings: the screen at an address as somebody, with the data layer around it.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach } from 'vitest';
import { listMembers } from '@/api/projects';
import { listWorkItems } from '@/api/workItems';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { currentToasts, resetToasts } from '@/components/ui/toast';
import { asUser, resetApi } from '@/test/api';
import ProjectSettings from './ProjectSettings';

/** Call once at the top of a test file: fresh demo data per test, and no toast left behind. */
export function useSettingsTestSetup(): void {
  beforeEach(() => {
    resetApi();
    window.scrollTo = () => {};
  });
  // the toast store is shared by all tests: close whatever a test left open
  afterEach(() => {
    act(() => resetToasts());
  });
}

/** The settings screen at an address, as somebody; the second route stands in for the list of projects. */
export function renderSettings(path: string, userId = 'u_mara') {
  asUser(userId);
  const router = createMemoryRouter(
    [
      { path: '/projects/:identifier/settings/:section?', element: <ProjectSettings /> },
      { path: '/projects', element: <p>Alle Projekte</p> },
    ],
    { initialEntries: [path] },
  );
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

/** Every item of a project, archived ones too. */
export const itemsOf = async (projectId: string) =>
  (await listWorkItems({ filter: { version: 1, conditions: [{ field: 'project', op: 'is', value: projectId }] }, include_archived: true })).items;

export const roleOf = async (project: string, userId: string) => (await listMembers(project)).items.find((member) => member.user_id === userId)?.role;
