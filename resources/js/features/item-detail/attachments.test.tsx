/*
 * The file list of an item against a fake REST API (`mockApi`) and a fake XMLHttpRequest for the uploads (K18): the
 * files with size and preview, two uploads at once each with its own progress and result, removing with undo, and what
 * a reader without the right to edit sees.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentToasts, dismissToast, resetToasts, runToastAction } from '@/components/ui/toast';
import { formatSize } from '@/components/fields/format';
import { useWorkItem } from '@/hooks/workItems';
import { qk } from '@/hooks/keys';
import { mockApi, type MockApi, type MockRoute } from '@/test/api';
import { lene, list, makeAttachment, organization, project, standard, types, web47 } from '@/test/fixtures';
import { useUiStore } from '@/store/ui';
import { FakeXhr, installFakeXhr, restoreFakeXhr } from '@/test/xhr';
import type { Attachment, Project, WorkItem } from '@/types';
import { Attachments } from './Attachments';
import { ItemDetailProvider } from './ItemBody';

vi.mock('@inertiajs/react', () => ({
  usePage: () => ({ props: { auth: { user: lene, permissions: [] }, organization }, url: '/items/WEB-47' }),
  router: { visit: vi.fn(), replace: vi.fn(), on: () => () => {} },
  Link: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let api: MockApi | undefined;
/** The files of WEB-47 as the fake server holds them; each test sets its own. */
let files: Attachment[] = [];

beforeEach(() => installFakeXhr());

afterEach(() => {
  api?.restore();
  api = undefined;
  restoreFakeXhr();
  act(() => resetToasts());
});

const owner = { type: 'work_item' as const, id: 'wi_web_47' };
const fileOf = (id: string, filename: string, overrides: Partial<Attachment> = {}) =>
  makeAttachment({ id, filename, owner, kind: 'file', mime: 'application/pdf', inline: false, size: 120_400, ...overrides });
const pdf = (name: string) => new File([new Uint8Array([37, 80, 68, 70])], name, { type: 'application/pdf' });
const lastToast = () => currentToasts().at(-1);
const leaving = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

/** The section as the detail shows it: the item comes from the fake server, so an upload or a delete shows on reload. */
function Harness() {
  const { data } = useWorkItem('WEB-47');
  return data ? <Attachments detail={data} /> : null;
}

function renderFiles({ item = web47, role = 'member', routes = {} }: { item?: WorkItem; role?: Project['my_role']; routes?: Record<string, MockRoute> } = {}) {
  api = mockApi({
    'GET /api/v1/projects': () => ({ body: list([project('WEB', role, { name: 'Website-Relaunch' })]) }),
    'GET /api/v1/work-items/WEB-47': () => ({
      body: { data: { ...item, children: [], relations: [], type: types.find((type) => type.id === item.type_id), workflow: standard, attachments: files } },
    }),
    ...routes,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ItemDetailProvider surface="page">
        <Harness />
      </ItemDetailProvider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

const sent = (method: string, url: string) => api!.calls.filter((call) => call.method === method && call.url === url);
/** A drag that leaves `zone` for `to` (jsdom's plain events drop `relatedTarget` from their init). */
const leave = (zone: Element, to: Element | null) => {
  const event = createEvent.dragLeave(zone);
  Object.defineProperty(event, 'relatedTarget', { value: to });
  fireEvent(zone, event);
};
const reasonOf = (button: HTMLElement) => document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent;

describe('Attachments', () => {
  it('lists files with size and preview', async () => {
    files = [
      fileOf('att_scan', 'scan.png', { mime: 'image/png', inline: true, size: 512, preview_url: '/attachments/att_scan/preview' }),
      fileOf('att_offer', 'angebot.pdf'),
      fileOf('att_anim', 'ladekreis.gif', { mime: 'image/gif', inline: true, size: 25_300_000 }),
    ];
    const { client } = renderFiles();

    const section = await screen.findByRole('region', { name: 'Dateien' });
    expect(within(section).getByText('3')).toBeTruthy();
    const links = within(section).getAllByRole('link');
    // a picture opens as itself in a new tab with its download beside it, any other file is a download (F28)
    expect(links.map((link) => [link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('download')])).toEqual([
      ['/attachments/att_scan', '_blank', null],
      ['/attachments/att_scan?download=1', null, 'scan.png'],
      ['/attachments/att_offer?download=1', null, 'angebot.pdf'],
      ['/attachments/att_anim', '_blank', null],
      ['/attachments/att_anim?download=1', null, 'ladekreis.gif'],
    ]);
    expect(links[0]!.textContent).toBe(`scan.png${formatSize(512)}`);
    expect(links[1]!.getAttribute('aria-label')).toBe('„scan.png“ herunterladen');
    expect(links[2]!.textContent).toBe(`angebot.pdf${formatSize(120_400)}`);
    expect(links[3]!.textContent).toBe(`ladekreis.gif${formatSize(25_300_000)}`);
    // a picture shows small, from its preview once the queue made one, otherwise the file itself; anything else an icon
    const pictures = section.querySelectorAll('img');
    expect([...pictures].map((picture) => picture.getAttribute('src'))).toEqual(['/attachments/att_scan/preview', '/attachments/att_anim']);
    expect(pictures[0]!.getAttribute('alt')).toBe('');
    // previews load when they come into view
    expect([...pictures].map((picture) => [picture.getAttribute('loading'), picture.getAttribute('decoding')])).toEqual([
      ['lazy', 'async'],
      ['lazy', 'async'],
    ]);
    // the files that came with the detail are in the cache of attachments: a text that shows one asks for nothing
    expect(client.getQueryData(qk.attachments.detail('att_offer'))).toEqual(files[1]);
    // a member may upload and remove
    expect(await within(section).findByRole('button', { name: 'Datei hochladen' })).toBeTruthy();
    expect(within(section).getByRole('button', { name: '„angebot.pdf“ entfernen' })).toBeTruthy();
  });

  it('uploads two files each with its own progress and result', async () => {
    files = [];
    const { container } = renderFiles();
    const section = await screen.findByRole('region', { name: 'Dateien' });
    expect(within(section).getByText('Noch keine Dateien. Lade eine hoch oder zieh sie hierher.')).toBeTruthy();
    const button = await within(section).findByRole('button', { name: 'Datei hochladen' });

    // "Datei hochladen" opens the browser's choice of files: the hidden input, out of the tab order
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.multiple).toBe(true);
    expect(input.tabIndex).toBe(-1);
    const choose = vi.spyOn(input, 'click').mockImplementation(() => {});
    await userEvent.click(button);
    expect(choose).toHaveBeenCalledTimes(1);
    choose.mockRestore();
    await userEvent.upload(input, [pdf('angebot.pdf'), pdf('vertrag.pdf')]);

    // one call and one line each, each with its own bar; the live region of the section says the last start (F21)
    expect(FakeXhr.all).toHaveLength(2);
    expect(container.querySelector('[data-attachments-announcer]')!.textContent).toBe('„vertrag.pdf“ wird hochgeladen …');
    const [first, second] = FakeXhr.all as [FakeXhr, FakeXhr];
    expect(first.opened).toEqual(['POST', '/api/v1/attachments']);
    expect(Object.fromEntries([...first.sent!.entries()].filter(([key]) => key !== 'file'))).toEqual({ project_id: 'p_web', kind: 'file', work_item_id: 'wi_web_47' });
    expect((second.sent!.get('file') as File).name).toBe('vertrag.pdf');
    const offerBar = within(section).getByRole('progressbar', { name: '„angebot.pdf“ wird hochgeladen …' });
    const contractBar = within(section).getByRole('progressbar', { name: '„vertrag.pdf“ wird hochgeladen …' });
    act(() => first.progress(50, 100));
    act(() => second.progress(10, 40));
    expect(offerBar.getAttribute('aria-valuenow')).toBe('50');
    expect(contractBar.getAttribute('aria-valuenow')).toBe('25');
    // the input is empty again: the same file can be chosen once more
    expect(input.value).toBe('');
    // while files go out, leaving the page asks first
    expect(leaving()).toBe(true);

    // the second is stored first: its line gives way to the file once the item is read again, the first keeps its bar
    const contract = fileOf('att_contract', 'vertrag.pdf');
    files = [contract];
    act(() => second.answer(201, { data: contract }));
    expect(await within(section).findByRole('link', { name: /vertrag\.pdf/ })).toBeTruthy();
    expect(within(section).queryByRole('progressbar', { name: '„vertrag.pdf“ wird hochgeladen …' })).toBeNull();
    expect(within(section).getByRole('progressbar', { name: '„angebot.pdf“ wird hochgeladen …' })).toBeTruthy();
    expect(currentToasts().map((toast) => toast.title)).toEqual(['„vertrag.pdf“ angehängt']);

    // the first is refused: its line goes, a toast of its own says why and offers no retry for a refusal
    act(() => first.answer(413, { reason: 'payload_too_large', detail: 'Die Datei ist zu groß.' }));
    await waitFor(() => expect(within(section).queryByRole('progressbar')).toBeNull());
    expect(lastToast()).toMatchObject({ title: '„angebot.pdf“ nicht hochgeladen', description: 'Die Datei ist zu groß.' });
    expect(lastToast()!.action).toBeUndefined();
    expect(within(section).getAllByRole('link')).toHaveLength(1);
    expect(leaving()).toBe(false);
  });

  it('reports the result of an upload whose view went away, also of its retry, and holds the page meanwhile', async () => {
    files = [];
    const view = renderFiles();
    const section = await screen.findByRole('region', { name: 'Dateien' });
    await within(section).findByRole('button', { name: 'Datei hochladen' });
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;

    // the preview moves on while the file goes out: the page still asks before it is left
    await userEvent.upload(input, [pdf('angebot.pdf')]);
    await waitFor(() => expect(FakeXhr.all).toHaveLength(1));
    view.unmount();
    expect(leaving()).toBe(true);

    // refused: a toast says so and names the item, without a retry for a refusal
    act(() => FakeXhr.last.answer(413, { reason: 'payload_too_large', detail: 'Die Datei ist zu groß.' }));
    await waitFor(() => expect(lastToast()).toMatchObject({ title: '„angebot.pdf“ nicht an WEB-47 angehängt', description: 'Die Datei ist zu groß.' }));
    expect(lastToast()!.action).toBeUndefined();
    expect(leaving()).toBe(false);

    // no answer at all: "Erneut versuchen" sends it again, and its result is reported as well
    api!.restore();
    const again = renderFiles();
    await within(await screen.findByRole('region', { name: 'Dateien' })).findByRole('button', { name: 'Datei hochladen' });
    await userEvent.upload(again.container.querySelector<HTMLInputElement>('input[type="file"]')!, [pdf('vertrag.pdf')]);
    await waitFor(() => expect(FakeXhr.all).toHaveLength(2));
    again.unmount();
    act(() => FakeXhr.last.onerror?.());
    await waitFor(() => expect(lastToast()).toMatchObject({ title: '„vertrag.pdf“ nicht an WEB-47 angehängt', action: { label: 'Erneut versuchen' } }));
    expect(leaving()).toBe(false);
    act(() => runToastAction(lastToast()!.id));
    await waitFor(() => expect(FakeXhr.all).toHaveLength(3));
    expect((FakeXhr.last.sent!.get('file') as File).name).toBe('vertrag.pdf');
    expect(leaving()).toBe(true);
    files = [fileOf('att_contract', 'vertrag.pdf')];
    act(() => FakeXhr.last.answer(201, { data: files[0] }));
    await waitFor(() => expect(lastToast()).toMatchObject({ title: '„vertrag.pdf“ an WEB-47 angehängt', tone: 'success', action: { label: 'Öffnen' } }));
    expect(leaving()).toBe(false);
    // "Öffnen" shows the item in the preview
    act(() => runToastAction(lastToast()!.id));
    expect(useUiStore.getState().peekItemId).toBe('wi_web_47');
    act(() => useUiStore.getState().openPeek(null));
  });

  it('takes files dropped on the section and retries a failed upload from its toast', async () => {
    files = [];
    renderFiles();
    const section = await screen.findByRole('region', { name: 'Dateien' });
    await within(section).findByRole('button', { name: 'Datei hochladen' });
    const zone = within(section).getByText('Noch keine Dateien. Lade eine hoch oder zieh sie hierher.').parentElement!;

    // something else than files (text from a page) is not taken
    fireEvent.dragOver(zone, { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(zone.dataset.over).toBeUndefined();
    fireEvent.drop(zone, { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(FakeXhr.all).toHaveLength(0);

    fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'], files: [] } });
    expect(zone.dataset.over).toBe('');
    // leaving into a child of the zone is still over it; leaving the zone is not
    leave(zone, zone.firstElementChild);
    expect(zone.dataset.over).toBe('');
    leave(zone, document.body);
    expect(zone.dataset.over).toBeUndefined();
    fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'], files: [] } });
    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [pdf('angebot.pdf')] } });
    expect(zone.dataset.over).toBeUndefined();
    await waitFor(() => expect(FakeXhr.all).toHaveLength(1));

    // no answer at all: the toast offers "Erneut versuchen", which sends the same file again
    act(() => FakeXhr.last.onerror?.());
    await waitFor(() => expect(lastToast()).toMatchObject({ title: '„angebot.pdf“ nicht hochgeladen', action: { label: 'Erneut versuchen' } }));
    expect(within(section).queryByRole('progressbar')).toBeNull();
    act(() => runToastAction(lastToast()!.id));
    await waitFor(() => expect(FakeXhr.all).toHaveLength(2));
    expect((FakeXhr.last.sent!.get('file') as File).name).toBe('angebot.pdf');
    expect(within(section).getByRole('progressbar', { name: '„angebot.pdf“ wird hochgeladen …' })).toBeTruthy();
    files = [fileOf('att_offer', 'angebot.pdf')];
    act(() => FakeXhr.last.answer(201, { data: files[0] }));
    await waitFor(() => expect(within(section).queryByRole('progressbar')).toBeNull());
    expect(leaving()).toBe(false);
  });

  it('removes a file with undo', async () => {
    files = [fileOf('att_offer', 'angebot.pdf'), fileOf('att_contract', 'vertrag.pdf')];
    let refuse = true;
    const { client } = renderFiles({
      routes: {
        'DELETE /api/v1/attachments/att_offer': () => {
          if (refuse) return { status: 503, body: { reason: 'service_unavailable', detail: 'Gerade nicht.' } };
          files = files.filter((file) => file.id !== 'att_offer');
          return { status: 204 };
        },
      },
    });
    const user = userEvent.setup();
    const section = await screen.findByRole('region', { name: 'Dateien' });
    const upload = await within(section).findByRole('button', { name: 'Datei hochladen' });
    expect(client.getQueryData(qk.attachments.detail('att_offer'))).toBeTruthy();

    // gone at once, with undo; the focus moves on to "Datei hochladen"
    within(section).getByRole('button', { name: '„angebot.pdf“ entfernen' }).focus();
    await user.keyboard('{Enter}');
    expect(within(section).queryByRole('link', { name: /angebot\.pdf/ })).toBeNull();
    expect(within(section).getByText('1')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(upload));
    const undo = lastToast()!;
    expect(undo).toMatchObject({ title: '„angebot.pdf“ entfernt', action: { label: 'Rückgängig' } });
    act(() => runToastAction(undo.id));
    expect(await within(section).findByRole('link', { name: /angebot\.pdf/ })).toBeTruthy();
    expect(sent('DELETE', '/api/v1/attachments/att_offer')).toEqual([]);

    // the toast runs out: the server fails, and the file comes back with a retry
    await user.click(within(section).getByRole('button', { name: '„angebot.pdf“ entfernen' }));
    act(() => dismissToast(lastToast()!.id));
    await waitFor(() => expect(lastToast()).toMatchObject({ title: '„angebot.pdf“ nicht entfernt', description: 'Gerade nicht.', action: { label: 'Erneut versuchen' } }));
    expect(await within(section).findByRole('link', { name: /angebot\.pdf/ })).toBeTruthy();

    // and once more, now it goes for good: out of the list and out of the cache of attachments
    refuse = false;
    await user.click(within(section).getByRole('button', { name: '„angebot.pdf“ entfernen' }));
    act(() => dismissToast(lastToast()!.id));
    await waitFor(() => expect(sent('DELETE', '/api/v1/attachments/att_offer')).toHaveLength(2));
    await waitFor(() => expect(client.getQueryData(qk.attachments.detail('att_offer'))).toBeUndefined());
    expect(within(section).queryByRole('link', { name: /angebot\.pdf/ })).toBeNull();
    expect(within(section).getByRole('link', { name: /vertrag\.pdf/ })).toBeTruthy();
  });

  it('shows nothing to a viewer without files', async () => {
    files = [];
    const view = renderFiles({ role: 'viewer' });
    // the item and the rights are there: nothing to show and nothing to do, no section at all
    await waitFor(() => expect(view.client.getQueryData(qk.workItems.detail('WEB-47'))).toBeTruthy());
    await waitFor(() => expect(view.client.isFetching()).toBe(0));
    await act(async () => {});
    expect(screen.queryByRole('region', { name: 'Dateien' })).toBeNull();
    view.unmount();
    api!.restore();

    // with files the viewer reads the list, and the upload says why it is not possible (an id of its own: a removed
    // file stays hidden for the module's life)
    files = [fileOf('att_read', 'angebot.pdf')];
    renderFiles({ role: 'viewer' });
    const section = await screen.findByRole('region', { name: 'Dateien' });
    const upload = await within(section).findByRole('button', { name: 'Datei hochladen' });
    await waitFor(() => expect(reasonOf(upload)).toMatch(/nur lesen/));
    expect(within(section).queryByRole('button', { name: '„angebot.pdf“ entfernen' })).toBeNull();
  });

  it('says why upload is not possible on an archived item', async () => {
    files = [fileOf('att_archived', 'angebot.pdf')];
    const { container } = renderFiles({ item: { ...web47, archived_at: '2026-10-30T10:00:00.000Z' } });
    const section = await screen.findByRole('region', { name: 'Dateien' });

    const upload = within(section).getByRole('button', { name: 'Datei hochladen' });
    expect(upload.getAttribute('aria-disabled')).toBe('true');
    expect(reasonOf(upload)).toBe('WEB-47 ist archiviert und schreibgeschützt. Stelle es zuerst wieder her.');
    await userEvent.click(upload);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    // the file stays readable and downloadable, but cannot be removed, and nothing dropped is taken
    expect(within(section).getByRole('link', { name: /angebot\.pdf/ })).toBeTruthy();
    expect(within(section).queryByRole('button', { name: '„angebot.pdf“ entfernen' })).toBeNull();
    // a file over the section is taken in, so the browser does not open it and leave the page; the drop says why (F27)
    const heading = within(section).getByRole('heading', { name: 'Dateien' });
    expect(fireEvent.dragOver(heading, { dataTransfer: { types: ['Files'], files: [] } })).toBe(false);
    expect(fireEvent.drop(heading, { dataTransfer: { types: ['Files'], files: [pdf('vertrag.pdf')] } })).toBe(false);
    await act(async () => {});
    expect(FakeXhr.all).toHaveLength(0);
    expect(lastToast()).toMatchObject({ title: 'Keine Datei hinzugefügt', description: 'WEB-47 ist archiviert und schreibgeschützt. Stelle es zuerst wieder her.' });
  });

  it('hides a removed file in a view opened again, hides it again on retry, and takes a 404 as removed (F27)', async () => {
    files = [fileOf('att_twice', 'protokoll.pdf'), fileOf('att_gone', 'alt.pdf')];
    let refuse = true;
    const routes = {
      'DELETE /api/v1/attachments/att_twice': () => (refuse ? { status: 503, body: { reason: 'service_unavailable', detail: 'Gerade nicht.' } } : { status: 204 }),
      'DELETE /api/v1/attachments/att_gone': () => ({ status: 404, body: { reason: 'not_found' } }),
    };
    const user = userEvent.setup();
    const first = renderFiles({ routes });
    let section = await screen.findByRole('region', { name: 'Dateien' });
    await user.click(await within(section).findByRole('button', { name: '„protokoll.pdf“ entfernen' }));

    // the view closes and opens again while the undo toast stands: the file stays hidden
    first.unmount();
    api!.restore();
    renderFiles({ routes });
    section = await screen.findByRole('region', { name: 'Dateien' });
    await within(section).findByRole('link', { name: /alt\.pdf/ });
    expect(within(section).queryByRole('link', { name: /protokoll\.pdf/ })).toBeNull();

    // the time runs out, the server fails: back with a retry, which hides it again at once
    act(() => dismissToast(currentToasts().find((toast) => toast.title === '„protokoll.pdf“ entfernt')!.id));
    await within(section).findByRole('link', { name: /protokoll\.pdf/ });
    const failed = await waitFor(() => currentToasts().find((toast) => toast.title === '„protokoll.pdf“ nicht entfernt')!);
    refuse = false;
    act(() => runToastAction(failed.id));
    expect(within(section).queryByRole('link', { name: /protokoll\.pdf/ })).toBeNull();

    // gone meanwhile (404): removed all the same, no error
    await user.click(within(section).getByRole('button', { name: '„alt.pdf“ entfernen' }));
    act(() => dismissToast(currentToasts().find((toast) => toast.title === '„alt.pdf“ entfernt')!.id));
    await waitFor(() => expect(sent('DELETE', '/api/v1/attachments/att_gone')).toHaveLength(1));
    await act(async () => {});
    expect(currentToasts().find((toast) => toast.title === '„alt.pdf“ nicht entfernt')).toBeUndefined();
    expect(within(section).queryByRole('link', { name: /alt\.pdf/ })).toBeNull();
  });
});
