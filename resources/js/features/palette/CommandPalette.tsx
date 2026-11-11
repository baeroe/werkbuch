/*
 * The command palette (⌘K / Ctrl+K, spec 4.17): one input for search and commands, on strong tracing paper above a
 * light scrim. It is a modal dialog: the focus stays inside and returns where it came from when it closes.
 *
 * The input is a combobox: the arrows move the active row, Enter runs it, Escape closes. A command with a sub-list
 * (e.g. the status choice) shows that list in place; Backspace in the empty input goes back. `openPalette(id)` opens
 * the palette right in a command's sub-list (the item shortcuts `s`, `a`, `p` … do that). The list itself comes from
 * `model.ts`; the search runs on the server (`useSearch`, a moment after the last key, never in a sub-list). Enter
 * runs what the list shows now, also while the search is still on its way: a typed key jumps at once.
 */

import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { router } from '@inertiajs/react';
import { ChevronLeft, CircleAlert, RotateCw, Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
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
import { listCommands, useCommands, type CommandDef } from '@/lib/commands';
import { causeOf } from '@/lib/errors';
import { t, tn } from '@/lib/i18n';
import { paths } from '@/lib/links';
import { usePermissions } from '@/lib/permissions';
import { useDialogScope } from '@/lib/shortcuts/useShortcut';
import { useUiStore } from '@/store/ui';
import type { State } from '@/types';
import { EntryRow, OptionRow, type RowLookups } from './EntryRow';
import { LIMITS, matchingOptions, rootSections, searchTerms, type PaletteEntry } from './model';

/** The search waits this long after the last key. */
export const SEARCH_DELAY_MS = 150;

/** The longest query the search takes (`QuerySearch::Q_MAX`, in characters); the palette sends no more. */
const SEARCH_MAX = 255;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Where a hit leads; a command runs instead. */
function targetOf(entry: Exclude<PaletteEntry, { kind: 'command' }>, lookups: RowLookups): string {
  switch (entry.kind) {
    case 'jump':
      return paths.item(entry.key);
    case 'item':
      return paths.item(entry.item.key);
    case 'page':
      // a project the list does not hold (yet) is named by its id: the server answers with its identifier
      return paths.wiki(lookups.projectOf(entry.page.project_id)?.identifier ?? entry.page.project_id, entry.page.id);
    case 'project':
      return paths.project(entry.project.identifier);
    case 'person':
      return paths.settings(entry.user.type === 'bot' ? 'bots' : 'people');
    case 'view':
      return paths.view(entry.view.id);
  }
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
      <li>{t('palette.key_tip')}</li>
      <li>{t('palette.tip')}</li>
    </ul>
  );
}

/** `inputRef` belongs to the dialog: it puts the focus there when it opens, also in a sub-list with its back chip first. */
function PaletteBody({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const commands = useCommands();
  const [query, setQuery] = useState('');
  // opened by a shortcut such as `s`: start in that command's sub-list
  const [subpage, setSubpage] = useState<CommandDef | null>(() => {
    const commandId = useUiStore.getState().paletteCommandId;
    return listCommands().find((command) => command.id === commandId && command.subpage) ?? null;
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  // what the search gets: nothing in a sub-list, at most what it takes (whole characters, never half a pair)
  const wanted = subpage ? '' : Array.from(query.trim()).slice(0, SEARCH_MAX).join('');
  const searchQuery = useDebounced(wanted, SEARCH_DELAY_MS);
  // no more hits than the palette shows (the items show the most)
  const search = useSearch(searchQuery, { limit: LIMITS.items }, { enabled: !subpage });
  const types = useWorkItemTypes();
  const workflows = useWorkflows();
  const projects = useProjects({ include_archived: true });
  const people = usePermissions().can('org.manage');
  const listId = useId();

  const terms = searchTerms(query);
  const states = new Map<string, State>((workflows.data?.items ?? []).flatMap((workflow) => workflow.states.map((state) => [state.id, state] as const)));
  const lookups: RowLookups = {
    typeOf: (id) => types.data?.items.find((type) => type.id === id),
    stateOf: (id) => states.get(id),
    projectOf: (id) => projects.data?.items.find((project) => project.id === id),
  };

  function choose(entry: PaletteEntry) {
    if (entry.kind !== 'command') {
      router.visit(targetOf(entry, lookups));
      close();
      return;
    }
    const { command } = entry;
    command.run();
    if (command.subpage) {
      setSubpage(command);
      setQuery('');
      setActiveId(null);
      return;
    }
    close();
  }

  function back() {
    setSubpage(null);
    setQuery('');
    setActiveId(null);
    inputRef.current?.focus();
  }

  // what the list shows: the sub-list of a command, or the commands and the hits (only those of what is typed now:
  // emptied, the input shows the commands, not the last hits the search keeps)
  const page = subpage?.subpage?.();
  const shown = searchQuery !== '' && wanted !== '' ? search.data : undefined;
  // the key match of an answer to another query (the last hits stay while the next query is on its way) names an item
  // of another key: the typed key jumps instead
  const fresh = searchQuery === wanted && !search.isPlaceholderData;
  const results = shown && !fresh ? { ...shown, key_match: null } : shown;
  const groups: { id: string; label: string; rows: Row[] }[] = page
    ? [
        {
          id: 'options',
          label: subpage!.label,
          rows: matchingOptions(page.options, query).map((option) => ({
            id: `option:${option.id}`,
            run: () => {
              option.run();
              close();
            },
            content: <OptionRow option={option} terms={terms} />,
          })),
        },
      ].filter((group) => group.rows.length > 0)
    : rootSections(query, commands, results, { people }).map((section) => ({
        id: section.id,
        label: section.label,
        rows: section.entries.map((entry) => ({ id: entry.id, run: () => choose(entry), content: <EntryRow entry={entry} terms={terms} lookups={lookups} /> })),
      }));
  const rows = groups.flatMap((group) => group.rows);
  const active = rows.find((row) => row.id === activeId) ?? rows[0];
  // by what the row shows, not by its place: another hit in the active place is another active option
  const optionId = (row: Row) => `${listId}-row-${row.id}`;

  // the search has not answered for what is typed yet
  const searching = !page && terms.length > 0 && (searchQuery !== wanted || search.isFetching);
  const searchFailed = !page && searchQuery !== '' && wanted !== '' && search.isError;

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
      setActiveId(rows[next]!.id);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      active?.run();
    } else if (event.key === 'Backspace' && query === '' && subpage) {
      event.preventDefault();
      back();
    }
  }

  // a failed search has its alert: no count beside it
  let status = '';
  if (searching) status = t('palette.searching');
  else if (terms.length > 0 && !searchFailed) status = tn('palette.hits', rows.length);

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-edge pr-2 pl-4 md:pr-4">
        {subpage ? (
          <button
            type="button"
            onClick={back}
            aria-label={t('palette.back', { label: subpage.label })}
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
          aria-label={subpage ? subpage.label : t('palette.input')}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="go"
          placeholder={page?.placeholder ?? t('palette.placeholder')}
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
        <BaseDialog.Close render={<IconButton icon={X} label={t('palette.close')} tooltip={false} className="md:hidden" />} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        <div id={listId} role="listbox" aria-label={subpage ? subpage.label : t('palette.list')}>
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
          <SkeletonGroup label={t('palette.searching')} className="flex flex-col gap-3.5 px-2.5 py-3">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3.5 w-3/5" />
          </SkeletonGroup>
        )}
        {searchFailed && (
          <div role="alert" className="mx-1 mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-ctl bg-danger-soft px-3 py-2 text-ui">
            <CircleAlert className="size-4 shrink-0 text-danger" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-ink">{t('palette.search_failed', { cause: causeOf(search.error) })}</span>
            <Button variant="secondary" size="sm" icon={RotateCw} pending={search.isFetching} onClick={() => void search.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        )}
        {page && rows.length === 0 && <p className="px-2.5 py-6 text-center text-ui text-pretty text-muted">{page.emptyText ?? t('palette.no_match', { query })}</p>}
        {!page && terms.length > 0 && rows.length === 0 && !searching && !searchFailed && (
          <div className="px-2.5 pt-5 pb-2 text-center">
            <p className="font-display text-md font-bold tracking-title text-balance text-ink">{t('palette.no_results', { query: query.trim() })}</p>
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
          {t('palette.footer.select')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd keys="enter" />
          {t('palette.footer.run')}
        </span>
        {subpage && (
          <span className="inline-flex items-center gap-1.5">
            <Kbd keys="backspace" />
            {t('palette.footer.back')}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5">
          <Kbd keys="escape" />
          {t('palette.footer.close')}
        </span>
      </div>
    </>
  );
}

export function CommandPalette() {
  const open = useUiStore((state) => state.paletteOpen);
  const commandId = useUiStore((state) => state.paletteCommandId);
  const inputRef = useRef<HTMLInputElement>(null);
  // while it is open the page's shortcuts pause; while it animates out they work again (⌘Z after a command)
  useDialogScope(open);
  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => useUiStore.getState().setPaletteOpen(next)}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-scrim transition-opacity duration-160 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <BaseDialog.Popup
          // typing goes to the input at once; in a sub-list the chip that goes back would be the first stop
          initialFocus={inputRef}
          data-focus-ring="none"
          className={cx(
            'tracing-strong popup-motion fixed inset-x-4 top-4 z-50 mx-auto flex max-h-[calc(100dvh-2rem)] max-w-[var(--palette-w)] flex-col overflow-hidden rounded-card text-ui text-ink outline-none',
            // the palette shows the focus as a whole; the input inside has none of its own
            'focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-solid focus-within:outline-(--focus-ring)',
            'md:top-12 md:max-h-[min(40rem,calc(100dvh-6rem))]',
          )}
        >
          <BaseDialog.Title className="sr-only">{t('palette.title')}</BaseDialog.Title>
          {/* a new start (another command's sub-list) starts afresh, also while the last one is still closing */}
          <PaletteBody key={commandId ?? 'root'} inputRef={inputRef} />
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
