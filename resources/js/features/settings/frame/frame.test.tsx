import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Building2, Users } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { currentToasts, resetToasts, runToastAction } from '@/components/ui/toast';
import { mockApi, type MockApi } from '@/test/api';
import { lene, list, mara, project } from '@/test/fixtures';
import type { User } from '@/types';
import { NotForMembers, ReadOnlyNotice, useOrgRight, type OrgPermission } from './access';
import {
  Badge,
  FieldGroup,
  FormActions,
  FormSkeleton,
  Loaded,
  Measure,
  Panel,
  ReadOnlyBanner,
  readOnlyField,
  Row,
  Rows,
  RowsSkeleton,
  RuledList,
  RuledRow,
  SectionHeader,
  SettingsCard,
  SettingsError,
  SettingsSkeleton,
} from './parts';
import { SectionNav, SectionNavSkeleton, SettingsFrame, type SectionItem } from './SettingsFrame';
import { useDialogRound } from './useDialogRound';
import { useRemoval } from './useRemoval';

let signedIn: User | null = mara;

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: signedIn, permissions: [] } } }),
  Link: ({ href, children, ref, ...rest }: { href: string; children: ReactNode; ref?: Ref<HTMLAnchorElement>; className?: string; 'aria-current'?: 'page' }) => (
    <a href={href} ref={ref} {...rest}>
      {children}
    </a>
  ),
}));

let api: MockApi | undefined;

afterEach(() => {
  api?.restore();
  api = undefined;
  signedIn = mara;
  resetToasts();
  vi.useRealTimers();
  document.body.replaceChildren();
});

const refusal = (status: number, detail: string) => new ApiError({ status, reason: 'service_unavailable', detail });

describe('SectionNavSkeleton', () => {
  it('says the sections are loading and fits the column of the frame: full width from lg on, a row of short bars below', () => {
    render(<SectionNavSkeleton />);

    const group = screen.getByRole('status');
    expect(group.textContent).toBe('Bereiche werden geladen …');
    expect(group.className).toContain('lg:flex-col');
    const bars = group.querySelectorAll('[aria-hidden="true"]');
    expect(bars).toHaveLength(4);
    expect(bars[0]!.className).toContain('lg:w-full');
    expect(bars[0]!.className).not.toMatch(/max-w-md/);
  });

  it('draws as many bars as asked for', () => {
    render(<SectionNavSkeleton items={2} />);

    expect(screen.getByRole('status').querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });
});

describe('SettingsFrame', () => {
  it('sets the title, what the page is about, the navigation and the content in a grid with a column for the navigation', () => {
    render(
      <SettingsFrame title="Einstellungen" lead={<span>Projekt WEB</span>} nav={<nav aria-label="Bereiche">Liste</nav>}>
        <p>Inhalt</p>
      </SettingsFrame>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeTruthy();
    expect(screen.getByText('Projekt WEB')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Bereiche' });
    expect(nav.parentElement?.className).toContain('lg:grid-cols-[12.5rem_minmax(0,1fr)]');
    expect(nav.nextElementSibling?.textContent).toBe('Inhalt');
  });

  it('gives the content the whole width when there is no navigation (the page could not load), and needs no lead', () => {
    render(
      <SettingsFrame title="Einstellungen" nav={null}>
        <p>Inhalt</p>
      </SettingsFrame>,
    );

    expect(screen.getByText('Inhalt').parentElement?.parentElement?.className).not.toContain('grid-cols');
  });
});

describe('SectionNav', () => {
  const items: SectionItem[] = [
    { slug: 'general', label: 'Allgemein', icon: Building2, group: 'Organisation' },
    { slug: 'people', label: 'Personen', icon: Users, group: 'Organisation', locked: true },
    { slug: 'types', label: 'Typen', group: 'Kataloge' },
  ];
  const hrefFor = (slug: string) => `/settings/${slug}`;

  it('links the sections by hrefFor and marks the current one', () => {
    render(<SectionNav label="Bereiche der Einstellungen" items={items} current="people" hrefFor={hrefFor} />);

    const nav = screen.getByRole('navigation', { name: 'Bereiche der Einstellungen' });
    expect(within(nav).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/settings/general', '/settings/people', '/settings/types']);
    expect(within(nav).getByRole('link', { name: /Personen/ }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Allgemein' }).getAttribute('aria-current')).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Typen' }).getAttribute('aria-current')).toBeNull();
  });

  it('heads each group once, tells screen readers about a section for admins only, and draws icons where there are some', () => {
    render(<SectionNav label="Bereiche" items={items} current={null} hrefFor={hrefFor} />);

    expect(screen.getAllByText('Organisation')).toHaveLength(1);
    expect(screen.getAllByText('Kataloge')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /^Personen\s*nur für Admins$/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Allgemein' }).querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Typen' }).querySelector('svg')).toBeNull();
    expect(screen.queryByRole('link', { current: 'page' })).toBeNull();
  });

  it('keeps its keys apart when a heading comes back later in the list', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <SectionNav
        label="Bereiche"
        items={[
          { slug: 'a', label: 'A', group: 'Kataloge' },
          { slug: 'b', label: 'B', group: 'Betrieb' },
          { slug: 'c', label: 'C', group: 'Kataloge' },
        ]}
        current="a"
        hrefFor={hrefFor}
      />,
    );

    expect(screen.getAllByText('Kataloge')).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('is one group without a heading for sections that have no group', () => {
    render(
      <SectionNav
        label="Bereiche"
        items={[
          { slug: 'profile', label: 'Profil' },
          { slug: 'security', label: 'Sicherheit' },
        ]}
        current="profile"
        hrefFor={(slug) => `/me/${slug}`}
      />,
    );

    expect(screen.getAllByRole('list')).toHaveLength(1);
    expect(screen.getByRole('navigation').querySelector('p')).toBeNull();
  });

  it('scrolls the current section into view where the browser can (the row of a phone), and copes where it cannot', () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const { rerender } = render(<SectionNav label="Bereiche" items={items} current="general" hrefFor={hrefFor} />);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole('link', { name: 'Allgemein' }));

      rerender(<SectionNav label="Bereiche" items={items} current="types" hrefFor={hrefFor} />);
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
    } finally {
      // @ts-expect-error jsdom has none: take the stub away again
      delete Element.prototype.scrollIntoView;
    }

    expect(() => render(<SectionNav label="Bereiche" items={items} current="general" hrefFor={hrefFor} />)).not.toThrow();
  });
});

describe('the building blocks', () => {
  it('SectionHeader: title, description, actions and a link back', () => {
    const { rerender } = render(<SectionHeader title="Personen" description="Wer Zugang hat." actions={<button type="button">Einladen</button>} back={<a href="/settings">Zurück</a>} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Personen' })).toBeTruthy();
    expect(screen.getByText('Wer Zugang hat.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Einladen' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Zurück' })).toBeTruthy();

    rerender(<SectionHeader title="Personen" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('SettingsCard: a sheet named by its title, with description, actions and footer', () => {
    render(
      <SettingsCard title="Allgemein" description="Name und Sprache." actions={<button type="button">Mehr</button>} footer={<button type="button">Speichern</button>}>
        <p>Felder</p>
      </SettingsCard>,
    );

    const card = screen.getByRole('region', { name: 'Allgemein' });
    expect(within(card).getByText('Name und Sprache.')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Mehr' })).toBeTruthy();
    expect(card.querySelector('footer')?.textContent).toBe('Speichern');
    expect(screen.getByText('Felder').parentElement?.className).toContain('py-4');
  });

  it('SettingsCard: the danger tone, a flush list and a card without content or footer', () => {
    const { rerender } = render(
      <SettingsCard title="Gefahrenzone" tone="danger" flush>
        <p>Liste</p>
      </SettingsCard>,
    );
    expect(screen.getByRole('region').className).toContain('border-danger/40');
    expect(screen.getByRole('heading', { name: 'Gefahrenzone' }).className).toContain('text-danger');
    expect(screen.getByText('Liste').parentElement?.className).toContain('pt-4');
    expect(screen.getByText('Liste').parentElement?.className).not.toContain('py-4');

    rerender(<SettingsCard title="Leer" />);
    expect(screen.getByRole('region').querySelector('footer')).toBeNull();
    expect(screen.getByRole('region').querySelector('header + div')?.className).toContain('pb-4');
  });

  it('RuledList and RuledRow: a list that keeps its role, with the label and rows', () => {
    render(
      <RuledList label="Tokens">
        <RuledRow>eins</RuledRow>
        <RuledRow className="extra">zwei</RuledRow>
      </RuledList>,
    );

    const rows = within(screen.getByRole('list', { name: 'Tokens' })).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual(['eins', 'zwei']);
    expect(rows[1]?.className).toContain('extra');
  });

  it('Panel: with and without a head', () => {
    const { rerender } = render(
      <Panel title="Mitglieder" description="Wer mitarbeitet." actions={<button type="button">Hinzufügen</button>}>
        <p>Inhalt</p>
      </Panel>,
    );
    expect(screen.getByRole('region', { name: 'Mitglieder' })).toBeTruthy();
    expect(screen.getByText('Wer mitarbeitet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeTruthy();

    rerender(<Panel actions={<button type="button">Nur Aktion</button>}>Inhalt</Panel>);
    expect(screen.getByRole('button', { name: 'Nur Aktion' })).toBeTruthy();
    expect(screen.queryByRole('heading')).toBeNull();

    rerender(<Panel className="eigene-klasse">Inhalt</Panel>);
    expect(screen.queryByRole('banner')).toBeNull();
    expect(document.querySelector('section')?.className).toContain('eigene-klasse');
    expect(document.querySelector('section')?.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('Rows and Row: a labelled list of rows', () => {
    render(
      <Rows label="Personen" className="eigene-klasse">
        <Row>Mara</Row>
        <Row className="extra">Ida</Row>
      </Rows>,
    );

    const rows = screen.getAllByRole('listitem');
    expect(screen.getByRole('list', { name: 'Personen' }).className).toContain('eigene-klasse');
    expect(rows.map((row) => row.textContent)).toEqual(['Mara', 'Ida']);
    expect(rows[1]?.className).toContain('extra');
  });

  it('Badge: the word, with an icon and a tone when given', () => {
    const { rerender } = render(<Badge>Aktiv</Badge>);
    expect(screen.getByText('Aktiv').className).toContain('bg-surface');
    expect(screen.getByText('Aktiv').querySelector('svg')).toBeNull();

    rerender(
      <Badge tone="danger" icon={Users} className="extra">
        Deaktiviert
      </Badge>,
    );
    expect(screen.getByText('Deaktiviert').className).toContain('bg-danger-soft');
    expect(screen.getByText('Deaktiviert').className).toContain('extra');
    expect(screen.getByText('Deaktiviert').querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('FieldGroup: the legend, then the hint, which the error replaces', () => {
    const { rerender } = render(
      <FieldGroup legend="Wochenbeginn" hint="Wann die Woche anfängt.">
        <input type="radio" aria-label="Montag" />
      </FieldGroup>,
    );
    const group = screen.getByRole('group', { name: 'Wochenbeginn' });
    expect(within(group).getByText('Wann die Woche anfängt.')).toBeTruthy();
    expect(group.getAttribute('aria-describedby')).toMatch(/-hint$/);

    rerender(
      <FieldGroup legend="Wochenbeginn" hint="Wann die Woche anfängt." error="Bitte wählen.">
        <input type="radio" aria-label="Montag" />
      </FieldGroup>,
    );
    expect(screen.queryByText('Wann die Woche anfängt.')).toBeNull();
    expect(screen.getByText('Bitte wählen.')).toBeTruthy();
    expect(screen.getByRole('group').getAttribute('aria-describedby')).toMatch(/-error$/);

    rerender(
      <FieldGroup legend="Wochenbeginn" className="eigene-klasse">
        <input type="radio" aria-label="Montag" />
      </FieldGroup>,
    );
    expect(screen.getByRole('group').hasAttribute('aria-describedby')).toBe(false);
    expect(screen.getByRole('group').className).toContain('eigene-klasse');
  });

  it('Measure and readOnlyField', () => {
    render(<Measure>Ein langer Satz.</Measure>);

    expect(screen.getByText('Ein langer Satz.').className).toContain('max-w-[65ch]');
    expect(readOnlyField).toBe('bg-sunken! shadow-none!');
  });

  it('the skeletons announce that they load, with a label of their own or the default', () => {
    const { rerender } = render(<SettingsSkeleton />);
    expect(screen.getByRole('status').textContent).toBe('Einstellungen werden geladen …');
    expect(screen.getByRole('status').querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(5);

    rerender(<SettingsSkeleton rows={1} label="Sicherheit wird geladen …" />);
    expect(screen.getByRole('status').textContent).toBe('Sicherheit wird geladen …');

    rerender(<RowsSkeleton />);
    expect(screen.getByRole('status').textContent).toBe('Wird geladen …');
    expect(screen.getByRole('status').querySelectorAll('.divide-y > div')).toHaveLength(4);

    rerender(<RowsSkeleton rows={2} label="Personen werden geladen …" />);
    expect(screen.getByRole('status').textContent).toBe('Personen werden geladen …');
    expect(screen.getByRole('status').querySelectorAll('.divide-y > div')).toHaveLength(2);

    rerender(<FormSkeleton />);
    expect(screen.getByRole('status').textContent).toBe('Wird geladen …');

    rerender(<FormSkeleton label="Allgemein wird geladen …" />);
    expect(screen.getByRole('status').textContent).toBe('Allgemein wird geladen …');
  });
});

describe('FormActions', () => {
  it('says "Keine Änderungen zu speichern." when saving was pressed with nothing changed', () => {
    render(<FormActions dirty={false} pending={false} quiet onReset={vi.fn()} />);

    expect(screen.getByRole('status').textContent).toBe('Keine Änderungen zu speichern.');
    expect(screen.getByRole('button', { name: 'Zurücksetzen' }).hasAttribute('disabled')).toBe(true);
    // saving stays possible, so the button is never dead
    expect(screen.getByRole('button', { name: 'Speichern' }).hasAttribute('disabled')).toBe(false);
  });

  it('is quiet by default, says there are unsaved changes, and resets', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    const { rerender } = render(<FormActions dirty={false} pending={false} onReset={onReset} />);
    expect(screen.getByRole('status').textContent).toBe('');

    rerender(<FormActions dirty pending={false} onReset={onReset} saveLabel="Projekt speichern" />);
    expect(screen.getByRole('status').textContent).toBe('Nicht gespeicherte Änderungen');
    expect(screen.getByRole('button', { name: /Projekt speichern/ }).getAttribute('type')).toBe('submit');

    await user.click(screen.getByRole('button', { name: 'Zurücksetzen' }));
    expect(onReset).toHaveBeenCalledTimes(1);

    // while it saves, nothing is left to reset
    rerender(<FormActions dirty pending onReset={onReset} />);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByRole('button', { name: 'Zurücksetzen' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('Loaded', () => {
  const query = (state: Partial<{ isPending: boolean; isError: boolean; error: Error | null; isFetching: boolean }> = {}) => ({
    isPending: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(() => Promise.resolve({} as never)),
    ...state,
  });

  it('shows the skeleton while any query loads', () => {
    render(
      <Loaded queries={[query(), query({ isPending: true })]} failure="Die Personen konnten nicht geladen werden" skeleton={<p>Skelett</p>}>
        <p>Inhalt</p>
      </Loaded>,
    );

    expect(screen.getByText('Skelett')).toBeTruthy();
    expect(screen.queryByText('Inhalt')).toBeNull();
  });

  it('shows the cause and "Erneut versuchen", which fetches the failed queries again and only those', async () => {
    const user = userEvent.setup();
    const failed = query({ isError: true, error: refusal(503, 'Der Server ist in Wartung.') });
    const fine = query();
    render(
      <Loaded queries={[fine, failed]} failure="Die Personen konnten nicht geladen werden" skeleton={<p>Skelett</p>}>
        <p>Inhalt</p>
      </Loaded>,
    );

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Die Personen konnten nicht geladen werden')).toBeTruthy();
    expect(within(alert).getByText('Der Server ist in Wartung.')).toBeTruthy();
    expect(screen.queryByText('Skelett')).toBeNull();

    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));
    expect(failed.refetch).toHaveBeenCalledTimes(1);
    expect(fine.refetch).not.toHaveBeenCalled();
  });

  it('shows the retry as running while a query is fetching', () => {
    render(
      <Loaded queries={[query({ isError: true, error: new TypeError('x') }), query({ isFetching: true })]} failure="Fehler" skeleton={null}>
        <p>Inhalt</p>
      </Loaded>,
    );

    expect(screen.getByText('Der Server hat nicht geantwortet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Erneut versuchen/ }).getAttribute('aria-busy')).toBe('true');
  });

  it('shows the content, as nodes or as a function that reads the data', () => {
    const { rerender } = render(
      <Loaded queries={[query()]} failure="Fehler" skeleton={<p>Skelett</p>}>
        <p>Inhalt</p>
      </Loaded>,
    );
    expect(screen.getByText('Inhalt')).toBeTruthy();

    rerender(
      <Loaded queries={[query()]} failure="Fehler" skeleton={<p>Skelett</p>}>
        {() => <p>Aus der Funktion</p>}
      </Loaded>,
    );
    expect(screen.getByText('Aus der Funktion')).toBeTruthy();
  });
});

describe('SettingsError and the notices', () => {
  it('SettingsError names the cause and retries, with a default title or its own', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender } = render(<SettingsError error={refusal(503, 'Wartung.')} onRetry={onRetry} />);

    expect(screen.getByText('Die Einstellungen konnten nicht geladen werden')).toBeTruthy();
    expect(screen.getByText('Wartung.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<SettingsError title="Dein Konto konnte nicht geladen werden" error={new TypeError('x')} onRetry={onRetry} retrying />);
    expect(screen.getByText('Dein Konto konnte nicht geladen werden')).toBeTruthy();
    expect(screen.getByText('Der Server hat nicht geantwortet.')).toBeTruthy();
  });

  it('ReadOnlyBanner gives the reason under "Du kannst das nur lesen" or a title of its own', () => {
    const { rerender } = render(<ReadOnlyBanner reason="Im Projekt WEB darfst du nur lesen." />);
    expect(screen.getByRole('status').textContent).toBe('Du kannst das nur lesenIm Projekt WEB darfst du nur lesen.');

    rerender(<ReadOnlyBanner title="Archiviert" reason="Das Projekt ist archiviert." />);
    expect(screen.getByRole('status').textContent).toBe('ArchiviertDas Projekt ist archiviert.');
  });

  it('ReadOnlyNotice gives the reason under "Nur lesen"', () => {
    render(<ReadOnlyNotice reason="Workflows verwalten nur Org-Admins." />);

    expect(screen.getByRole('status').textContent).toBe('Nur lesenWorkflows verwalten nur Org-Admins.');
  });

  it('NotForMembers says the section is for admins, why, and leads to Allgemein', () => {
    render(<NotForMembers reason="Personen verwalten nur Org-Admins." section="„Personen“" />);

    expect(screen.getByText('Nur für Admins')).toBeTruthy();
    expect(screen.getByText('Personen verwalten nur Org-Admins. Du siehst „Personen“ deshalb nicht.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Zu Allgemein' }).getAttribute('href')).toBe('/settings/general');
  });
});

describe('useOrgRight', () => {
  function Probe({ permission }: { permission: OrgPermission }) {
    const right = useOrgRight(permission);
    if (right.status === 'error') {
      return (
        <button type="button" onClick={right.retry}>
          Fehler {right.retrying ? 'läuft' : 'ruht'}
        </button>
      );
    }
    return <p>{right.status === 'loading' ? 'lädt' : `bereit: ${right.reason ?? 'darf'}`}</p>;
  }

  const show = (permission: OrgPermission = 'org.manage') => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <Probe permission={permission} />
      </QueryClientProvider>,
    );
  };

  it('waits for the rights instead of greeting an admin with the reason, then lets an admin change', async () => {
    api = mockApi({ 'GET /api/v1/projects': () => ({ body: list([project('WEB', 'admin')]) }) });
    show();

    expect(screen.getByText('lädt')).toBeTruthy();
    expect(await screen.findByText('bereit: darf')).toBeTruthy();
  });

  it('gives a member the reason, per kind of setting', async () => {
    signedIn = lene;
    api = mockApi({ 'GET /api/v1/projects': () => ({ body: list([project('WEB', 'member')]) }) });
    const { unmount } = show('org.manage');
    expect(await screen.findByText('bereit: Organisation, Personen, Bots und Webhooks verwalten nur Org-Admins.')).toBeTruthy();
    unmount();

    show('org.manage_catalog');
    expect(await screen.findByText('bereit: Workflows, Typen, Properties, Labels, Relationstypen und Resolutions verwalten nur Org-Admins.')).toBeTruthy();
  });

  it('reports a failed load with a retry that loads again', async () => {
    const user = userEvent.setup();
    let failing = true;
    api = mockApi({ 'GET /api/v1/projects': () => (failing ? { status: 503, body: { reason: 'service_unavailable' } } : { body: list([project('WEB', 'admin')]) }) });
    show();

    const retry = await screen.findByRole('button', { name: 'Fehler ruht' });
    failing = false;
    await user.click(retry);

    expect(await screen.findByText('bereit: darf')).toBeTruthy();
    expect(api.calls).toHaveLength(2);
  });

  it('loads nothing on a page without a signed-in person', async () => {
    signedIn = null;
    api = mockApi({ 'GET /api/v1/projects': () => ({ body: list([project('WEB', 'admin')]) }) });
    show();

    await new Promise((done) => setTimeout(done, 20));
    expect(api.calls).toHaveLength(0);
    expect(screen.getByText('lädt')).toBeTruthy();
  });
});

describe('useDialogRound', () => {
  it('starts closed, and every opening is a new round with its own target', () => {
    const { result } = renderHook(() => useDialogRound<{ name: string }>());
    expect(result.current).toMatchObject({ round: 0, open: false, target: null });

    act(() => result.current.show({ name: 'UX' }));
    expect(result.current).toMatchObject({ round: 1, open: true, target: { name: 'UX' } });

    // closing keeps the round and the target, so the dialog can play its exit animation
    act(() => result.current.setOpen(false));
    expect(result.current).toMatchObject({ round: 1, open: false, target: { name: 'UX' } });

    act(() => result.current.show());
    expect(result.current).toMatchObject({ round: 2, open: true, target: null });
  });

  it('gives the focus back to the button that opened the dialog, or to the fallback once that button is gone', () => {
    const { result } = renderHook(() => useDialogRound());
    const opener = document.body.appendChild(document.createElement('button'));
    const fallback = { current: document.body.appendChild(document.createElement('button')) };
    opener.focus();

    act(() => result.current.show());
    const target = result.current.returnFocus(fallback);
    expect(target.current).toBe(opener);

    // the empty state that offered "Create" gave way to the list
    opener.remove();
    expect(target.current).toBe(fallback.current);
    fallback.current.remove();
  });
});

describe('useRemoval', () => {
  it('hides the row at once, offers "Rückgängig", and calls only when the toast has run out', async () => {
    vi.useFakeTimers();
    const run = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useRemoval());

    act(() => result.current.remove({ id: 'l1', label: 'Label „UX“ gelöscht', run }));
    expect(result.current.hidden.has('l1')).toBe(true);
    expect(currentToasts().map((item) => [item.title, item.action?.label])).toEqual([['Label „UX“ gelöscht', 'Rückgängig']]);
    expect(run).not.toHaveBeenCalled();

    await act(async () => void vi.advanceTimersByTime(5000));
    expect(run).toHaveBeenCalledTimes(1);
    // the refreshed list no longer has it: the row is no longer on the hidden list either
    expect(result.current.hidden.size).toBe(0);
  });

  it('brings the row back on "Rückgängig", and never calls', async () => {
    vi.useFakeTimers();
    const run = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useRemoval());

    act(() => result.current.remove({ id: 'l1', label: 'Label gelöscht', run }));
    act(() => void runToastAction(currentToasts()[0]!.id));
    expect(result.current.hidden.size).toBe(0);

    await act(async () => void vi.advanceTimersByTime(10_000));
    expect(run).not.toHaveBeenCalled();
  });

  it('brings the row back when the call fails, and the error toast says why', async () => {
    vi.useFakeTimers();
    const run = vi.fn(() => Promise.reject(refusal(409, 'Das Label wird noch benutzt.')));
    const { result } = renderHook(() => useRemoval());

    act(() => result.current.remove({ id: 'l1', label: 'Label gelöscht', run, failureTitle: 'Label nicht gelöscht' }));
    expect(result.current.hidden.has('l1')).toBe(true);
    await act(async () => void vi.advanceTimersByTime(5000));

    expect(result.current.hidden.size).toBe(0);
    expect(currentToasts().find((item) => item.tone === 'error')).toMatchObject({ title: 'Label nicht gelöscht', description: 'Das Label wird noch benutzt.' });
  });

  it('hides several rows independently', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRemoval());

    act(() => result.current.remove({ id: 'a', label: 'a', run: () => Promise.resolve() }));
    act(() => result.current.remove({ id: 'b', label: 'b', run: () => Promise.resolve() }));

    expect([...result.current.hidden].sort()).toEqual(['a', 'b']);
  });

  it('moves the focus on to the next row, and takes the row before when the last one goes', async () => {
    const user = userEvent.setup();
    const paint = () => new Promise((done) => requestAnimationFrame(done));
    function Rows() {
      const { hidden, remove } = useRemoval();
      return (
        <ul>
          {['a', 'b', 'c'].filter((id) => !hidden.has(id)).map((id) => (
            <li key={id}>
              <button type="button" onClick={() => remove({ id, label: `${id} gelöscht`, run: () => Promise.resolve() })}>
                Löschen {id}
              </button>
            </li>
          ))}
        </ul>
      );
    }
    render(<Rows />);

    await user.click(screen.getByRole('button', { name: 'Löschen a' }));
    await act(paint);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Löschen b' }));

    await user.click(screen.getByRole('button', { name: 'Löschen c' }));
    await act(paint);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Löschen b' }));
  });

  it('moves no focus when it was not in a row (a button outside the list, or none)', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRemoval());
    (document.activeElement as HTMLElement | null)?.blur();

    act(() => result.current.remove({ id: 'a', label: 'a gelöscht', run: () => Promise.resolve() }));
    expect(document.activeElement).toBe(document.body);
    expect(result.current.hidden.has('a')).toBe(true);

    // a document that has no active element at all (no body yet) is no reason to fail
    const none = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null);
    expect(() => act(() => result.current.remove({ id: 'b', label: 'b gelöscht', run: () => Promise.resolve() }))).not.toThrow();
    none.mockRestore();
  });
});
