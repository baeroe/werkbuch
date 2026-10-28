/*
 * The command palette (⌘K / Strg+K, spec 4.17): one input for search and commands, on strong tracing paper above a
 * light scrim. It is a modal dialog: the focus stays inside and returns where it came from when it closes.
 *
 * The input is a combobox: the arrows move the active row, Enter runs it, Escape closes. A command with a sub-list
 * (e.g. the status choice) shows that list in place; Backspace in the empty input goes back. The list itself comes
 * from `model.ts`; the search runs on the server (`useSearch`, a moment after the last key).
 */

import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { ChevronLeft, CircleAlert, RotateCw, Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { IconButton } from '@/components/ui/IconButton';
import { Kbd } from '@/components/ui/Kbd';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { optionClass } from '@/components/ui/styles';
import { useProjects } from '@/hooks/projects';
import { useSearch } from '@/hooks/search';
import { useWorkflows } from '@/hooks/workflows';
import { useWorkItemTypes } from '@/hooks/workItemTypes';
import { useCommands, type CommandDef } from '@/lib/commands';
import { useDialogScope } from '@/lib/shortcuts/useShortcut';
import { useUiStore } from '@/store/ui';
import type { State } from '@/types';
import { EntryRow, OptionRow, type RowLookups } from './EntryRow';
import { matchingOptions, rootSections, searchTerms, type PaletteEntry } from './model';

const COUNT = new Intl.NumberFormat('de-DE');

/** The search waits this long after the last key. */
const SEARCH_DELAY_MS = 150;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** One row of the list, whatever it shows. */
interface Row {
  id: string;
  run: () => void;
  content: ReactNode;
}

const close = () => useUiStore.getState().setPaletteOpen(false);

function Tips() {
  return (
    <ul className="flex flex-col gap-1 px-2.5 pt-2 pb-1.5 text-sm text-pretty text-muted">
      <li>Ein Key wie WEB-47 springt direkt zum Item.</li>
      <li>Befehle findest du über ihren Namen, etwa „Theme“.</li>
    </ul>
  );
}

function PaletteBody() {
  const navigate = useNavigate();
  const commands = useCommands();
  const [query, setQuery] = useState('');
  const [subpage, setSubpage] = useState<CommandDef | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const searchQuery = useDebounced(subpage ? '' : query.trim(), SEARCH_DELAY_MS);
  const search = useSearch(searchQuery);
  const types = useWorkItemTypes();
  const workflows = useWorkflows();
  const projects = useProjects({ include_archived: true });
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  useDialogScope();

  const terms = searchTerms(query);
  const states = new Map<string, State>((workflows.data?.items ?? []).flatMap((workflow) => workflow.states.map((state) => [state.id, state] as const)));
  const lookups: RowLookups = {
    typeOf: (id) => types.data?.items.find((type) => type.id === id),
    stateOf: (id) => states.get(id),
    projectOf: (id) => projects.data?.items.find((project) => project.id === id),
  };

  function targetOf(entry: PaletteEntry): string | null {
    switch (entry.kind) {
      case 'jump':
        return `/items/${entry.key}`;
      case 'item':
        return `/items/${entry.item.key}`;
      case 'page': {
        const project = lookups.projectOf(entry.page.project_id);
        return project ? `/projects/${project.identifier}/wiki/${entry.page.id}` : null;
      }
      case 'project':
        return `/projects/${entry.project.identifier}`;
      case 'person':
        return entry.user.type === 'bot' ? '/settings/bots' : '/settings/people';
      case 'view':
        return `/views/${entry.view.id}`;
      case 'command':
        return null;
    }
  }

  function choose(entry: PaletteEntry) {
    if (entry.kind === 'command') {
      entry.command.run();
      if (entry.command.subpage) {
        setSubpage(entry.command);
        setQuery('');
        setActiveId(null);
        return;
      }
      close();
      return;
    }
    const to = targetOf(entry);
    if (to) navigate(to);
    close();
  }

  function back() {
    setSubpage(null);
    setQuery('');
    setActiveId(null);
    inputRef.current?.focus();
  }

  // what the list shows: the sub-list of a command, or the commands and the search results
  const page = subpage?.subpage?.();
  const options = page ? matchingOptions(page.options, query) : [];
  const sections = page ? [] : rootSections(query, commands, searchQuery ? search.data : undefined);
  const groups: { id: string; label: string; rows: Row[] }[] = page
    ? [
        {
          id: 'options',
          label: subpage!.label,
          rows: options.map((option) => ({
            id: `option:${option.id}`,
            run: () => {
              option.run();
              close();
            },
            content: <OptionRow option={option} terms={terms} />,
          })),
        },
      ].filter((group) => group.rows.length > 0)
    : sections.map((section) => ({
        id: section.id,
        label: section.label,
        rows: section.entries.map((entry) => ({ id: entry.id, run: () => choose(entry), content: <EntryRow entry={entry} terms={terms} lookups={lookups} /> })),
      }));
  const rows = groups.flatMap((group) => group.rows);
  const active = rows.find((row) => row.id === activeId) ?? rows[0];
  const optionId = (row: Row) => `${listId}-${rows.indexOf(row)}`;

  // the search has not answered for what is typed yet
  const searching = !page && terms.length > 0 && (searchQuery !== query.trim() || search.isFetching);
  const searchFailed = !page && searchQuery !== '' && search.isError;

  // keep the active row in view while the arrows move it, and when the list changes under it
  const activeDomId = active ? optionId(active) : null;
  const activeRowId = active?.id;
  useEffect(() => {
    if (activeDomId) document.getElementById(activeDomId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeDomId, activeRowId]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // the arrows and the Enter of an input method that composes belong to it (Safari ends with keyCode 229)
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (rows.length === 0) return;
      const index = active ? rows.indexOf(active) : -1;
      const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      setActiveId(rows[next].id);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      active?.run();
    } else if (event.key === 'Backspace' && query === '' && subpage) {
      event.preventDefault();
      back();
    }
  }

  let status = '';
  if (searching) status = 'Suche läuft …';
  else if (terms.length > 0) status = rows.length === 1 ? 'Ein Treffer' : `${COUNT.format(rows.length)} Treffer`;

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-edge pr-2 pl-4 md:pr-4">
        {subpage ? (
          <button
            type="button"
            onClick={back}
            aria-label={`Zurück zu allen Befehlen (${subpage.label})`}
            className="-ml-1.5 inline-flex h-11 max-w-[45%] shrink-0 cursor-pointer items-center gap-1 rounded-chip border border-line bg-surface pr-2 pl-1 text-sm text-ink shadow-elev-1 transition-colors duration-120 hover:border-line-input md:h-7"
          >
            <ChevronLeft className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
            <span className="truncate">{subpage.label}</span>
          </button>
        ) : (
          <Search className="size-4 shrink-0 text-muted" aria-hidden="true" />
        )}
        <input
          ref={inputRef}
          name="palette-query"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={active ? optionId(active) : undefined}
          aria-autocomplete="list"
          aria-label={subpage ? subpage.label : 'Suchen oder Befehl eingeben'}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="go"
          placeholder={page?.placeholder ?? 'Suchen oder Befehl …'}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveId(null);
          }}
          onKeyDown={onKeyDown}
          data-focus-ring="none"
          className="h-full min-w-0 flex-1 bg-transparent text-input text-ink outline-none placeholder:text-muted md:text-md"
        />
        <Kbd keys="escape" aria-hidden="true" className="max-md:hidden" />
        <BaseDialog.Close render={<IconButton icon={X} label="Befehlspalette schließen" tooltip={false} className="md:hidden" />} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        <div id={listId} role="listbox" aria-label={subpage ? subpage.label : 'Befehle und Treffer'}>
          {groups.map((group) => (
            <div key={group.id} role="group" aria-labelledby={`${listId}-${group.id}`}>
              {/* in a sub-list the chip beside the input names the list; the label is there for screen readers only */}
              <div id={`${listId}-${group.id}`} role="presentation" className={page ? 'sr-only' : 'px-2.5 pt-2 pb-1 text-sm text-muted'}>
                {group.label}
              </div>
              {group.rows.map((row) => (
                <div
                  key={row.id}
                  id={optionId(row)}
                  role="option"
                  aria-selected={row === active}
                  data-highlighted={row === active ? '' : undefined}
                  onMouseMove={() => row !== active && setActiveId(row.id)}
                  // the focus stays in the input
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={row.run}
                  className={optionClass}
                >
                  {row.content}
                </div>
              ))}
            </div>
          ))}
        </div>

        {searching && rows.length === 0 && (
          <SkeletonGroup label="Suche läuft …" className="flex flex-col gap-3.5 px-2.5 py-3">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3.5 w-3/5" />
          </SkeletonGroup>
        )}
        {searchFailed && (
          <div role="alert" className="mx-1 mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-ctl bg-danger-soft px-3 py-2 text-ui">
            <CircleAlert className="size-4 shrink-0 text-danger" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-ink">Die Suche hat nicht geantwortet: {search.error?.message}</span>
            <Button variant="secondary" size="sm" icon={RotateCw} pending={search.isFetching} onClick={() => void search.refetch()}>
              Erneut versuchen
            </Button>
          </div>
        )}
        {page && rows.length === 0 && <p className="px-2.5 py-6 text-center text-ui text-pretty text-muted">{page.emptyText ?? `Nichts passt zu „${query}“.`}</p>}
        {!page && terms.length > 0 && rows.length === 0 && !searching && !searchFailed && (
          <div className="px-2.5 pt-5 pb-2 text-center">
            <p className="font-display text-md font-bold tracking-title text-balance text-ink">Keine Treffer für „{query.trim()}“</p>
            <Tips />
          </div>
        )}
        {!page && terms.length === 0 && <Tips />}
      </div>

      <p role="status" className="sr-only">
        {status}
      </p>
      <div aria-hidden="true" className="hidden h-9 shrink-0 items-center gap-4 border-t border-edge px-4 text-sm text-muted md:flex">
        <span className="inline-flex items-center gap-1.5">
          <Kbd keys="arrowup" />
          <Kbd keys="arrowdown" />
          auswählen
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd keys="enter" />
          ausführen
        </span>
        {subpage && (
          <span className="inline-flex items-center gap-1.5">
            <Kbd keys="backspace" />
            zurück
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5">
          <Kbd keys="escape" />
          schließen
        </span>
      </div>
    </>
  );
}

export function CommandPalette() {
  const open = useUiStore((state) => state.paletteOpen);
  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => useUiStore.getState().setPaletteOpen(next)}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-scrim transition-opacity duration-160 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <BaseDialog.Popup
          data-focus-ring="none"
          className={cx(
            'tracing-strong popup-motion fixed inset-x-4 top-4 z-50 mx-auto flex max-h-[calc(100dvh-2rem)] max-w-[var(--palette-w)] flex-col overflow-hidden rounded-card text-ui text-ink outline-none',
            // the palette shows the focus as a whole; the input inside has none of its own
            'focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-solid focus-within:outline-(--focus-ring)',
            'md:top-12 md:max-h-[min(40rem,calc(100dvh-6rem))]',
          )}
        >
          <BaseDialog.Title className="sr-only">Befehlspalette</BaseDialog.Title>
          <PaletteBody />
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
