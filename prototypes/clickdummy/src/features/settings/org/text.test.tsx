import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetApi } from '@/test/api';
import OrgSettingsRoute from './OrgSettings';
import { SECTIONS } from './sections';

beforeEach(() => {
  resetApi();
});

/** A backslash, a "u" and four hex digits: the escape of a character, which only a JS string turns into the character. */
const ESCAPE = /\\u[0-9a-fA-F]{4}/;

/** The sources of this folder, as text. */
const SOURCES = import.meta.glob<string>('./*.tsx', { query: '?raw', import: 'default', eager: true });

/** The screens of the settings: every section, the workflow editor and the delivery log. */
const PLACES = [...SECTIONS.map((section) => `/settings/${section.slug}`), '/settings/workflows?workflow=wf_agency', '/settings/webhooks?deliveries=wh_crm'];

function renderSettings(location: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[location]}>
        <Routes>
          <Route path="settings/:section?" element={<OrgSettingsRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('what the settings print', () => {
  it.each(PLACES)('shows no escape sequence as text or in an attribute on %s', async (location) => {
    renderSettings(location);
    // a screen is done when its heading is there and nothing says "geladen …" any more
    await screen.findAllByRole('heading', { level: 2 });
    await waitFor(() => expect(screen.queryByText(/(geladen|Lädt) …$/)).toBeNull());

    expect(document.body.innerHTML).not.toMatch(ESCAPE);
  });

  it('writes no escape of a character inside a JSX attribute string or JSX text, where nothing would decode it', () => {
    // in `attribute="…"` and between tags the escape stays as it was typed; in `{'…'}` and in template strings it is decoded
    const offenders = Object.entries(SOURCES)
      .filter(([file]) => !file.endsWith('.test.tsx'))
      .flatMap(([file, source]) =>
        source.split('\n').flatMap((line, index) => (/=\s*"[^"]*\\u[0-9a-fA-F]{4}/.test(line) || />[^<{]*\\u[0-9a-fA-F]{4}[^<{]*</.test(line) ? [`${file.replace('./', '')}:${index + 1}`] : [])),
      );
    expect(offenders).toEqual([]);
  });
});
