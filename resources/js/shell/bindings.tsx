/*
 * The shell's own shortcuts and palette commands (start set of spec 5.3): the search (`/`), the shortcut help, undo,
 * new item, the `g` sequences to the main places and, in the palette, new item, "Vorlage anwenden …"
 * (`features/templates/applyTemplate.tsx`), the theme, the sidebar, the shortcut help and the same places. Keys, labels and groups of the shortcuts come from the catalog (`lib/shortcuts/catalog.ts`);
 * the palette's own key lives with it (`PaletteHost`). Screens register theirs while they are mounted.
 */

import { router } from '@inertiajs/react';
import type { LucideIcon } from 'lucide-react';
import { FolderKanban, Inbox, Keyboard, Layers, Monitor, Moon, PanelLeft, SquarePen, Sun, SunMoon, UserRoundCheck } from 'lucide-react';
import { useEffect } from 'react';
import { toast } from '@/components/ui/toast';
import { useApplyTemplateCommand } from '@/features/templates/applyTemplate';
import { registerCommand, SHELL_COMMAND_GROUPS, useCommand } from '@/lib/commands';
import { paths } from '@/lib/links';
import { t, type TranslationKey } from '@/lib/i18n';
import { isWide } from '@/lib/media';
import { usePermissions } from '@/lib/permissions';
import { SHORTCUTS, type ShortcutId } from '@/lib/shortcuts/catalog';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import type { ThemeChoice } from '@/lib/theme';
import { canUndo, undoLatest } from '@/lib/undo';
import { useUiStore } from '@/store/ui';

const [ACTIONS, NAVIGATION] = SHELL_COMMAND_GROUPS;

const THEMES: { value: ThemeChoice; label: TranslationKey; icon: LucideIcon; keywords: TranslationKey }[] = [
  { value: 'system', label: 'theme.system', icon: Monitor, keywords: 'commands.theme.keywords.system' },
  { value: 'light', label: 'theme.light', icon: Sun, keywords: 'commands.theme.keywords.light' },
  { value: 'dark', label: 'theme.dark', icon: Moon, keywords: 'commands.theme.keywords.dark' },
];

/** The main places: a `g` sequence and a palette command each. */
const PLACES: { shortcut: ShortcutId; command: TranslationKey; to: () => string; icon: LucideIcon }[] = [
  { shortcut: 'shell.go.inbox', command: 'commands.go.inbox', to: paths.inbox, icon: Inbox },
  { shortcut: 'shell.go.my_items', command: 'commands.go.my_items', to: paths.myItems, icon: UserRoundCheck },
  { shortcut: 'shell.go.views', command: 'commands.go.views', to: paths.views, icon: Layers },
  { shortcut: 'shell.go.projects', command: 'commands.go.projects', to: paths.projects, icon: FolderKanban },
];

const ui = () => useUiStore.getState();

export function useShellBindings(): void {
  const { can, reason } = usePermissions();
  const collapsed = useUiStore((state) => state.sidebarCollapsed);

  /** `c` and "Neues Item": the create dialog (`CreateHost`); on the page of a project or item it starts in that project. */
  function createItem() {
    // already open: a second "c" must not reset what is being typed
    if (ui().createOpen) return;
    const denied = reason('item.create');
    if (denied) toast({ title: t('commands.create.denied'), description: denied, tone: 'error' });
    else ui().openCreate();
  }

  // in an item list its title search (`list.search`, scope list) wins over this
  useShortcut('shell.search', () => ui().setPaletteOpen(true));
  useShortcut('shell.help', () => ui().setHelpOpen(true));
  useShortcut('shell.undo', () => undoLatest(), { when: canUndo });
  useShortcut('item.create', createItem);
  // g i, g m, g v, g p
  useShortcut('shell.go.inbox', () => router.visit(paths.inbox()));
  useShortcut('shell.go.my_items', () => router.visit(paths.myItems()));
  useShortcut('shell.go.views', () => router.visit(paths.views()));
  useShortcut('shell.go.projects', () => router.visit(paths.projects()));

  // hidden without the right; the shortcut "c" says why instead (toast). Registered anew when the right arrives, so an
  // open palette shows it then
  const mayCreate = can('item.create');
  useCommand(
    {
      id: 'shell.create',
      label: t('commands.create.label'),
      group: t(ACTIONS),
      keys: SHORTCUTS['item.create'].keys,
      icon: <SquarePen />,
      keywords: [t('commands.create.keywords')],
      run: createItem,
      when: () => mayCreate,
    },
    [mayCreate],
  );
  useApplyTemplateCommand();
  useCommand({
    id: 'shell.theme',
    label: t('commands.theme.label'),
    group: t(ACTIONS),
    icon: <SunMoon />,
    keywords: [t('commands.theme.keywords.all'), ...THEMES.flatMap((theme) => [t(theme.label), t(theme.keywords)])],
    run: () => {},
    subpage: () => ({
      placeholder: t('commands.theme.placeholder'),
      options: THEMES.map(({ value, label, icon: Icon, keywords }) => ({
        id: value,
        label: t(label),
        icon: <Icon />,
        keywords: [t(keywords)],
        hint: ui().theme === value ? t('commands.theme.active') : undefined,
        run: () => ui().setTheme(value),
      })),
    }),
  });

  useCommand({
    id: 'shell.sidebar',
    label: t(collapsed ? 'commands.sidebar.expand' : 'commands.sidebar.collapse'),
    group: t(ACTIONS),
    icon: <PanelLeft />,
    run: () => ui().toggleSidebar(),
    // below md the sidebar is a drawer behind the menu button
    when: isWide,
  });
  useCommand({
    id: 'shell.help',
    label: t('commands.help.label'),
    group: t(ACTIONS),
    keys: SHORTCUTS['shell.help'].keys,
    icon: <Keyboard />,
    keywords: [t('commands.help.keywords')],
    run: () => ui().setHelpOpen(true),
  });

  // the navigation commands, all at once
  useEffect(() => {
    const offs = PLACES.map((place) =>
      registerCommand({
        id: place.shortcut,
        label: t(place.command),
        group: t(NAVIGATION),
        keys: SHORTCUTS[place.shortcut].keys,
        icon: <place.icon />,
        run: () => router.visit(place.to()),
      }),
    );
    return () => offs.forEach((off) => off());
  }, []);
}
