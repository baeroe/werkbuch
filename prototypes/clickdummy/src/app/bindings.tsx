/*
 * The shell's own shortcuts (start set of spec 5.3) and palette commands: palette and search, the shortcut help, new
 * item, applying a template, undo, navigation, theme and sidebar. Screens register theirs while they are mounted
 * (lists, the item, …).
 */

import type { LucideIcon } from 'lucide-react';
import {
  Eye,
  FolderKanban,
  Inbox,
  Keyboard,
  Layers,
  LayoutTemplate,
  Monitor,
  Moon,
  PanelLeft,
  Settings,
  SquarePen,
  Sun,
  SunMoon,
  UserRound,
  UserRoundCheck,
} from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { ProjectBadge } from '@/components/ui/ProjectBadge';
import { toast } from '@/components/ui/toast';
import { useProjects } from '@/hooks/projects';
import { useRefetchFailed } from '@/hooks/retry';
import { useTemplates } from '@/hooks/templates';
import { registerCommand, SHELL_COMMAND_GROUPS, useCommand } from '@/lib/commands';
import { notifyError } from '@/lib/errors';
import { usePermissions } from '@/lib/permissions';
import { registerShortcut } from '@/lib/shortcuts/registry';
import { useShortcut } from '@/lib/shortcuts/useShortcut';
import { isWide } from '@/lib/media';
import type { ThemeChoice } from '@/lib/theme';
import { canUndo, undoLatest } from '@/lib/undo';
import { useUiStore } from '@/store/ui';

const [ACTIONS, NAVIGATION] = SHELL_COMMAND_GROUPS;
/** Group of the help overlay for the shortcuts that work everywhere. */
const GENERAL = 'Allgemein';

const THEMES: { value: ThemeChoice; label: string; icon: LucideIcon; keywords: string[] }[] = [
  { value: 'system', label: 'System', icon: Monitor, keywords: ['automatisch', 'betriebssystem'] },
  { value: 'light', label: 'Hell', icon: Sun, keywords: ['arbeitsheft', 'light', 'tag'] },
  { value: 'dark', label: 'Dunkel', icon: Moon, keywords: ['nachtheft', 'dark', 'nacht'] },
];

/** Where the navigation commands lead; the first four also have a `g` shortcut. */
const PLACES: { id: string; to: string; label: string; command: string; keys?: string; icon: LucideIcon }[] = [
  { id: 'inbox', to: '/inbox', label: 'Inbox', command: 'Inbox öffnen', keys: 'g i', icon: Inbox },
  { id: 'my-items', to: '/my-items', label: 'Meine Items', command: 'Meine Items öffnen', keys: 'g m', icon: UserRoundCheck },
  { id: 'views', to: '/views', label: 'Views', command: 'Alle Views öffnen', keys: 'g v', icon: Layers },
  { id: 'projects', to: '/projects', label: 'Projekte', command: 'Alle Projekte öffnen', keys: 'g p', icon: FolderKanban },
  { id: 'created', to: '/created', label: 'Von mir erstellt', command: 'Von mir erstellte Items öffnen', icon: SquarePen },
  { id: 'subscribed', to: '/subscribed', label: 'Beobachtet', command: 'Beobachtete Items öffnen', icon: Eye },
  { id: 'settings', to: '/settings', label: 'Einstellungen', command: 'Einstellungen öffnen', icon: Settings },
  { id: 'me', to: '/me', label: 'Persönliche Einstellungen', command: 'Persönliche Einstellungen öffnen', icon: UserRound },
];

const ui = () => useUiStore.getState();

/**
 * "Vorlage anwenden …" (spec 4.12, 4.17): the templates of every project where the person may create items, each with
 * the badge and the name of its project, in the order of the projects. Choosing one opens the create dialog with the
 * project and the template, and the dialog applies it. With no template to apply, the command says why in a toast
 * instead of opening an empty list. It stays out of the palette while the templates, the projects and the rights load,
 * and while the create dialog is open (the dialog has its own choice of template).
 */
function useTemplateCommand(): void {
  const { can, reason, loading } = usePermissions();
  const projects = useProjects();
  const templates = useTemplates();
  const refetchFailed = useRefetchFailed();
  const projectList = projects.data?.items;
  const failed = [templates, projects].find((query) => query.isError && query.data === undefined);
  const ready = !loading && (failed !== undefined || (templates.data !== undefined && projectList !== undefined));
  const usable = (templates.data?.items ?? [])
    .flatMap((template) => {
      const index = projectList?.findIndex((project) => project.id === template.project_id) ?? -1;
      return index >= 0 && can('item.create', template.project_id) ? [{ template, project: projectList![index], index }] : [];
    })
    .sort((a, b) => a.index - b.index || a.template.name.localeCompare(b.template.name, 'de'));
  const offers = usable.length > 0 && failed === undefined;

  /** Why there is nothing to choose: the templates did not load, the person may create items nowhere, or no template. */
  function explain() {
    if (failed) {
      // the retry fetches whatever else failed with them as well, the rights included
      notifyError('Vorlagen nicht geladen', failed.error, refetchFailed);
      return;
    }
    const description =
      reason('item.create') ?? 'In den Projekten, in denen du Items anlegen darfst, gibt es noch keine Vorlage. Vorlagen legst du im Projekt unter „Vorlagen“ an.';
    toast({ title: 'Keine Vorlage anwendbar', description, tone: 'error' });
  }

  useCommand(
    {
      id: 'shell.template',
      label: 'Vorlage anwenden …',
      group: ACTIONS,
      icon: <LayoutTemplate />,
      keywords: ['template', 'anlegen', 'erstellen'],
      when: () => ready && !ui().createOpen,
      // with templates to choose from, the palette opens their list instead
      run: () => {
        if (!offers) explain();
      },
      subpage: offers
        ? () => ({
            placeholder: 'Vorlage wählen …',
            options: usable.map(({ template, project }) => ({
              id: template.id,
              label: template.name,
              // the badge is 20 px; the margin fits it into the 16 px slot of an option's icon
              icon: <ProjectBadge project={project} className="-m-0.5" />,
              hint: project.name,
              keywords: [project.name, project.identifier],
              run: () => ui().openCreate({ project_id: project.id, template_id: template.id }),
            })),
          })
        : undefined,
    },
    // registered anew when what it offers changes, so an open palette shows that
    [ready, usable.map(({ template }) => template.id).join(' ')],
  );
}

export function useShellBindings(): void {
  const navigate = useNavigate();
  const { can, reason } = usePermissions();
  const collapsed = useUiStore((state) => state.sidebarCollapsed);

  function createItem() {
    // already open: a second "c" must not reset what is being typed
    if (ui().createOpen) return;
    const denied = reason('item.create');
    if (denied) toast({ title: 'Kein neues Item möglich', description: denied, tone: 'error' });
    else ui().openCreate();
  }

  useShortcut({ id: 'shell.palette', keys: 'mod+k', scope: 'global', label: 'Befehlspalette und Suche', group: GENERAL, run: () => ui().setPaletteOpen(!ui().paletteOpen) });
  useShortcut({ id: 'shell.search', keys: '/', scope: 'global', label: 'Suchen', group: GENERAL, run: () => ui().setPaletteOpen(true) });
  useShortcut({ id: 'shell.help', keys: '?', scope: 'global', label: 'Alle Kürzel', group: GENERAL, run: () => ui().setHelpOpen(true) });
  useShortcut({ id: 'shell.create', keys: 'c', scope: 'global', label: 'Neues Item', group: GENERAL, run: createItem });
  useShortcut({ id: 'shell.undo', keys: 'mod+z', scope: 'global', label: 'Rückgängig, solange der Toast steht', group: GENERAL, run: () => undoLatest(), when: canUndo });
  // g i, g m, g v, g p
  useEffect(() => {
    const offs = PLACES.flatMap(({ id, keys, label, to }) =>
      keys ? [registerShortcut({ id: `shell.go.${id}`, keys, scope: 'global', label, group: NAVIGATION, run: () => navigate(to) })] : [],
    );
    return () => offs.forEach((off) => off());
  }, [navigate]);

  // hidden without the right; the shortcut "c" says why instead (toast)
  useCommand({ id: 'shell.create', label: 'Neues Item', group: ACTIONS, keys: 'c', icon: <SquarePen />, keywords: ['anlegen', 'erstellen'], run: createItem, when: () => can('item.create') });
  useTemplateCommand();
  useCommand({
    id: 'shell.theme',
    label: 'Theme wechseln …',
    group: ACTIONS,
    icon: <SunMoon />,
    keywords: ['farbschema', ...THEMES.flatMap((theme) => [theme.label, ...theme.keywords])],
    run: () => {},
    subpage: () => ({
      placeholder: 'Theme wählen …',
      options: THEMES.map(({ value, label, icon: Icon, keywords }) => ({
        id: value,
        label,
        icon: <Icon />,
        keywords,
        hint: ui().theme === value ? 'aktiv' : undefined,
        run: () => ui().setTheme(value),
      })),
    }),
  });
  useCommand({
    id: 'shell.sidebar',
    label: collapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen',
    group: ACTIONS,
    icon: <PanelLeft />,
    run: () => ui().toggleSidebar(),
    // below md the sidebar is a drawer behind the menu button
    when: isWide,
  });
  useCommand({ id: 'shell.help', label: 'Alle Tastaturkürzel', group: ACTIONS, keys: '?', icon: <Keyboard />, keywords: ['hilfe', 'kürzel', 'tastatur'], run: () => ui().setHelpOpen(true) });

  // the navigation commands, all at once (the router's navigate does not change)
  useEffect(() => {
    const offs = PLACES.map((place) =>
      registerCommand({ id: `shell.go.${place.id}`, label: place.command, group: NAVIGATION, keys: place.keys, icon: <place.icon />, run: () => navigate(place.to) }),
    );
    return () => offs.forEach((off) => off());
  }, [navigate]);
}
