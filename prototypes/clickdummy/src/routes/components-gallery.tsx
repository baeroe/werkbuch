import {
  Archive,
  Ban,
  Bell,
  Calendar as CalendarIcon,
  Check,
  Eye,
  GripVertical,
  Inbox,
  Link as LinkIcon,
  List,
  Monitor,
  Moon,
  Palette,
  Plus,
  Settings,
  SmilePlus,
  SquareKanban,
  Sun,
  Table2,
  Tag,
  Trash2,
  UserRoundCheck,
  UserRoundPlus,
  Users,
  WifiOff,
  ChartGantt,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Avatar, UnassignedAvatar } from '@/components/ui/Avatar';
import { Banner } from '@/components/ui/Banner';
import { Button, buttonClass } from '@/components/ui/Button';
import { Calendar } from '@/components/ui/Calendar';
import { Checkbox } from '@/components/ui/Checkbox';
import { Chip, ToneDot } from '@/components/ui/Chip';
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox';
import { cx } from '@/components/ui/cx';
import { Dialog, DialogClose } from '@/components/ui/Dialog';
import { EmojiPicker } from '@/components/ui/EmojiPicker';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconButton } from '@/components/ui/IconButton';
import { IndexCard } from '@/components/ui/IndexCard';
import { InPageLink } from '@/components/ui/InPageLink';
import { Input } from '@/components/ui/Input';
import { Kbd } from '@/components/ui/Kbd';
import { Menu, MenuCheckboxItem, MenuContent, MenuGroup, MenuGroupLabel, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSubmenu, MenuTrigger } from '@/components/ui/Menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { PRIORITY_LABELS, PriorityIcon } from '@/components/ui/PriorityIcon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select, type SelectOption } from '@/components/ui/Select';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { StatusIcon } from '@/components/ui/StatusIcon';
import { Switch } from '@/components/ui/Switch';
import { Tab, Tabs, TabsList, TabsPanel } from '@/components/ui/Tabs';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/toast';
import { ToastCard } from '@/components/ui/Toaster';
import { Tooltip } from '@/components/ui/Tooltip';
import { TypeTab } from '@/components/ui/TypeTab';
import { isWide } from '@/lib/media';
import { applyTheme, readTheme, type ThemeChoice } from '@/lib/theme';
import type { Priority, StateCategory, StateIcon, TypeTone } from '@/types';
import { FieldsSection } from './gallery/FieldsSection';
import { Section, Specimen, State, States } from './gallery/layout';

/* Demo data: everything here is made up (see the moodboard README). */

const TODAY = '2026-10-28';

const STATES: { name: string; icon: StateIcon; category: StateCategory }[] = [
  { name: 'Backlog', icon: 'dashed', category: 'backlog' },
  { name: 'Todo', icon: 'circle', category: 'unstarted' },
  { name: 'In Progress', icon: 'half', category: 'started' },
  { name: 'Review', icon: 'three-quarter', category: 'started' },
  { name: 'Pending', icon: 'pause', category: 'started' },
  { name: 'Done', icon: 'check', category: 'completed' },
  { name: 'Cancelled', icon: 'cross', category: 'canceled' },
];

const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];

const TYPES: { name: string; tone: TypeTone; icon: string; colour: string }[] = [
  { name: 'Task', tone: 'sky', icon: 'square-check', colour: 'Himmel' },
  { name: 'Bug', tone: 'ochre', icon: 'bug', colour: 'Ocker' },
  { name: 'Epic', tone: 'moss', icon: 'zap', colour: 'Moos' },
  { name: 'Kundenwunsch', tone: 'plum', icon: 'message-square-heart', colour: 'Pflaume' },
  { name: 'Dokumentation', tone: 'sand', icon: 'file-text', colour: 'Sand' },
  { name: 'Wartung', tone: 'slate', icon: 'wrench', colour: 'Schiefer' },
];

const LABELS: { name: string; tone: TypeTone }[] = [
  { name: 'UX', tone: 'sky' },
  { name: 'Formulare', tone: 'moss' },
  { name: 'Produktion', tone: 'ochre' },
  { name: 'Barrierefreiheit', tone: 'plum' },
  { name: 'SEO', tone: 'sand' },
  { name: 'Backend', tone: 'slate' },
];

const PEOPLE = [
  { name: 'Mara Lindqvist', type: 'person' },
  { name: 'Jonas Feld', type: 'person' },
  { name: 'Ida Brenner', type: 'person' },
  { name: 'Theo Okafor', type: 'person' },
  { name: 'Lene Vogt', type: 'person' },
] as const;

const BOTS = [
  { name: 'Automation', type: 'bot', badge: 'Bot', note: 'Standard-Bot' },
  { name: 'Kira', type: 'bot', badge: 'Bot', note: 'gehört Mara Lindqvist' },
] as const;

const dot = (tone: TypeTone) => <ToneDot tone={tone} className="size-2" />;

const CUSTOMERS: SelectOption[] = [
  { value: 'opt_nordlicht', label: 'Studio Nordlicht', icon: dot('sky') },
  { value: 'opt_hafenkontor', label: 'Hafenkontor', icon: dot('ochre') },
  { value: 'opt_moos', label: 'Gärtnerei Moos', icon: dot('moss') },
];

const ASSIGNEES: ComboboxOption[] = [...PEOPLE, ...BOTS].map((user) => ({
  value: user.name,
  label: user.type === 'bot' ? `${user.name} (Bot)` : user.name,
  icon: <Avatar user={user} size="sm" decorative />,
}));

const dueDate = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const formatDue = (iso: string) => dueDate.format(new Date(`${iso}T00:00:00Z`));

/* Page */

export function ComponentsGallery() {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);

  useEffect(() => {
    const previous = document.title;
    document.title = 'Komponenten – werkbuch Klickdummy';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="px-4 md:px-8">
      <InPageLink to="main" className="sr-only rounded-ctl bg-surface px-3 py-2 text-ui font-semibold text-ink shadow-elev-2 focus:not-sr-only focus:absolute focus:top-3 focus:left-3">
        Zum Inhalt
      </InPageLink>
      <header className="mx-auto max-w-7xl pt-10 pb-4 md:pt-14">
        <div className="flex flex-wrap items-start justify-between gap-x-12 gap-y-6">
          <div className="min-w-0 max-w-[60ch]">
            <h1 className="font-display text-3xl font-extrabold tracking-display text-ink">Komponenten</h1>
            <p className="mt-4 text-body text-pretty text-ink">
              Alle Bausteine des Klickdummys in ihren Zuständen. Hover und Fokus sind hier festgehalten, Menü, Auswahl und Tooltip stehen offen; Dialoge und
              Toasts öffnen sich per Klick.
            </p>
            <nav aria-label="Abschnitte" className="mt-5">
              <ul className="flex flex-wrap gap-2">
                {[
                  ['controls', 'Bedienung'],
                  ['elements', 'Status und Elemente'],
                  ['fields', 'Felder'],
                  ['feedback', 'Rückmeldung'],
                ].map(([id, label]) => (
                  <li key={id}>
                    <InPageLink to={id} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
                      {label}
                    </InPageLink>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <div className="flex flex-col items-start gap-2">
            <SegmentedControl
              label="Farbschema"
              value={theme}
              onValueChange={(next) => {
                applyTheme(next);
                setTheme(next);
              }}
              options={[
                { value: 'system', label: 'System', icon: Monitor },
                { value: 'light', label: 'Hell', icon: Sun },
                { value: 'dark', label: 'Nachtheft', icon: Moon },
              ]}
            />
            <p className="text-sm text-muted">Hell heißt Arbeitsheft, dunkel Nachtheft.</p>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-7xl pb-24">
        <ControlsSection />
        <ElementsSection />
        <FieldsSection />
        <FeedbackSection />
      </main>
    </div>
  );
}

/* Bedienung */

function ControlsSection() {
  return (
    <Section id="controls" title="Bedienung" intro="Kürzel stehen direkt an der Aktion.">
      <ButtonsSpecimen />
      <IconButtonsSpecimen />
      <KbdSpecimen />
      <InputsSpecimen />
      <SelectSpecimen />
      <ComboboxSpecimen />
      <MenuSpecimen />
      <TooltipSpecimen />
      <PopoverSpecimen />
      <EmojiSearchSpecimen />
      <DialogSpecimen />
      <TogglesSpecimen />
      <SegmentedSpecimen />
      <TabsSpecimen />
      <CalendarSpecimen />
    </Section>
  );
}

function DemoButtons({ demo, pending, disabled, size }: { demo?: string; pending?: boolean; disabled?: boolean; size?: 'sm' }) {
  const common = { 'data-demo': demo, pending, disabled, size };
  return (
    <>
      <Button variant="primary" icon={Plus} shortcut="c" {...common}>
        Item anlegen
      </Button>
      <Button variant="secondary" icon={UserRoundPlus} shortcut="a" {...common}>
        Zuweisen
      </Button>
      <Button variant="ghost" shortcut="escape" {...common}>
        Abbrechen
      </Button>
      <Button variant="danger" icon={Trash2} shortcut="mod+backspace" {...common}>
        Löschen
      </Button>
    </>
  );
}

function ButtonsSpecimen() {
  return (
    <Specimen title="Buttons" note="Primär, sekundär, ghost, gefährlich. Löschen fragt nicht nach: Es gibt 5&nbsp;Sekunden Rückgängig." wide>
      <States>
        <State label="Ruhe">
          <DemoButtons />
        </State>
        <State label="Hover">
          <DemoButtons demo="hover" />
        </State>
        <State label="Fokus">
          <DemoButtons demo="focus" />
        </State>
        <State label="Pending">
          <DemoButtons pending />
        </State>
        <State label="Deaktiviert">
          <DemoButtons disabled />
        </State>
        <State label="Nicht erlaubt">
          <Button variant="danger" icon={Trash2} disabledReason="Nur Projekt-Admins dürfen Items löschen.">
            Löschen
          </Button>
          <span className="text-sm text-muted">Bleibt fokussierbar; der Grund steht im Tooltip.</span>
        </State>
        <State label="Klein">
          <DemoButtons size="sm" />
        </State>
      </States>
    </Specimen>
  );
}

function IconButtonsSpecimen() {
  return (
    <Specimen title="Icon-Buttons" note="Der Name steht im Tooltip, das Kürzel daneben.">
      <States>
        <State label="Ruhe">
          <IconButton icon={LinkIcon} label="Link kopieren" />
          <IconButton icon={Settings} label="Einstellungen" variant="secondary" />
        </State>
        <State label="Hover">
          <IconButton icon={LinkIcon} label="Link kopieren" data-demo="hover" />
          <IconButton icon={Settings} label="Einstellungen" variant="secondary" data-demo="hover" />
        </State>
        <State label="Fokus">
          <IconButton icon={LinkIcon} label="Link kopieren" data-demo="focus" />
        </State>
        <State label="Gedrückt">
          <IconButton icon={Eye} label="Beobachten" aria-pressed="true" />
        </State>
        <State label="Deaktiviert">
          <IconButton icon={LinkIcon} label="Link kopieren" disabled />
          <IconButton icon={Plus} label="View anlegen" size="sm" disabledReason="Nur Mitglieder dürfen Views anlegen." />
        </State>
        <State label="Klein">
          <IconButton icon={Plus} label="Item in Backlog anlegen" size="sm" shortcut="c" />
        </State>
      </States>
    </Specimen>
  );
}

function KbdSpecimen() {
  const rows: [string, string][] = [
    ['mod+k', 'Befehlspalette und Suche'],
    ['g i', 'Inbox'],
    ['shift+d', 'Start-Date'],
    ['mod+enter', 'Speichern bzw. absenden'],
    ['mod+backspace', 'Archivieren bzw. löschen'],
    ['mod+z', 'Rückgängig, solange der Toast steht'],
    ['escape', 'Schließen, Auswahl aufheben'],
    ['?', 'Alle Kürzel'],
  ];
  return (
    <Specimen title="Tastatur" note="Schreibweise wie im Register. Modifier als Glyphen, Screenreader hören die Tasten in Worten.">
      <ul className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5 text-ui text-ink">
        {rows.map(([keys, action]) => (
          <li key={keys} className="contents">
            <Kbd keys={keys} size="md" />
            <span>{action}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Kbd keys="arrowup" />
        <Kbd keys="arrowdown" />
        <span className="text-sm text-muted">auswählen</span>
        <Kbd keys="enter" />
        <span className="text-sm text-muted">ausführen</span>
      </div>
    </Specimen>
  );
}

function InputsSpecimen() {
  return (
    <Specimen title="Eingabe" note="Die Schreiblinie macht das Feld als Feld erkennbar. Fehler nennen die Abhilfe.">
      <div className="flex flex-col gap-4">
        <Input label="Titel" placeholder="z.&nbsp;B. Kontaktformular testen …" hint="Pflicht, bis 255&nbsp;Zeichen." name="title" autoComplete="off" />
        <Input label="Titel (Hover)" defaultValue="Kontaktformular sendet doppelt" data-demo="hover" name="title-hover" autoComplete="off" />
        <Input label="Titel (Fokus)" defaultValue="Kontaktformular sendet doppelt" data-demo="focus" name="title-focus" autoComplete="off" />
        <Input
          label="Aufwand (h)"
          defaultValue="3,5 h"
          inputMode="decimal"
          error="Nur eine Zahl eingeben, zum Beispiel 3,5"
          name="effort"
          autoComplete="off"
          className="tabular-nums"
        />
        <Input label="Kennung" defaultValue="WEB" disabled hint="Lässt sich nach dem Anlegen nur in den Einstellungen ändern." name="identifier" />
        <Textarea label="Kommentar" placeholder="Kommentar schreiben …" hint="Mit @ erwähnst du jemanden." name="comment" />
        <Textarea label="Kommentar (Hover)" defaultValue="Kann ich reproduzieren, nur unter iOS&nbsp;18." data-demo="hover" name="comment-hover" />
        <Textarea label="Kommentar (Fokus)" defaultValue="Kann ich reproduzieren, nur unter iOS&nbsp;18." data-demo="focus" name="comment-focus" />
        <Textarea label="Kommentar (deaktiviert)" defaultValue="Viewer lesen mit, kommentieren aber nicht." disabled hint="Nur Mitglieder dürfen kommentieren." name="comment-disabled" />
        <Textarea label="Schritte zum Nachstellen" defaultValue={'1. Formular ausfüllen\n2. Absenden'} error="Bitte beschreibe auch, was du erwartet hast." name="steps" />
      </div>
    </Specimen>
  );
}

function SelectSpecimen() {
  const [customer, setCustomer] = useState<string | null>('opt_nordlicht');
  const [empty, setEmpty] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>('opt_nordlicht');
  return (
    <Specimen title="Auswahl" note="Für kurze Listen. Der aktive Eintrag liegt als Karte auf dem Transparentpapier.">
      <div className="flex flex-col gap-4">
        <Select label="Kunde" options={CUSTOMERS} value={customer} onValueChange={setCustomer} />
        <Select label="Kunde (Hover)" options={CUSTOMERS} value={customer} onValueChange={setCustomer} data-demo="hover" />
        <Select label="Kunde (Fokus)" options={CUSTOMERS} value={customer} onValueChange={setCustomer} data-demo="focus" />
        <Select label="Kunde (leer)" options={CUSTOMERS} value={empty} onValueChange={setEmpty} placeholder="Kunde wählen …" hint="Optional." />
        <Select label="Umgebung" options={CUSTOMERS} value={null} onValueChange={() => undefined} placeholder="Umgebung wählen …" error="Pflichtfeld für Bugs: Wo tritt der Fehler auf?" />
        <Select label="Kunde (deaktiviert)" options={CUSTOMERS} value="opt_moos" onValueChange={() => undefined} disabled />
        <div className="pb-36">
          <Select label="Kunde (offen)" options={CUSTOMERS} value={open} onValueChange={setOpen} defaultOpen modal={false} keepSide />
        </div>
      </div>
    </Specimen>
  );
}

function ComboboxSpecimen() {
  const [assignee, setAssignee] = useState<string | null>('Jonas Feld');
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Specimen title="Suche mit Auswahl" note="Für lange Listen: tippen filtert, Pfeile wählen, Enter übernimmt.">
      <div className="flex flex-col gap-4">
        <Combobox label="Assignee" options={ASSIGNEES} value={assignee} onValueChange={setAssignee} placeholder="Person suchen …" />
        <Combobox label="Assignee (Hover)" options={ASSIGNEES} value={assignee} onValueChange={setAssignee} data-demo="hover" />
        <Combobox label="Assignee (Fokus)" options={ASSIGNEES} value={assignee} onValueChange={setAssignee} data-demo="focus" />
        <Combobox
          label="Reviewer"
          options={ASSIGNEES}
          value={null}
          onValueChange={() => undefined}
          placeholder="Person suchen …"
          error="Pflichtfeld bei Kundenwünschen: Wer nimmt vor der Freigabe ab?"
        />
        <Combobox label="Reviewer (deaktiviert)" options={ASSIGNEES} value="Ida Brenner" onValueChange={() => undefined} disabled />
        <div className="pb-16">
          <Combobox label="Assignee (keine Treffer)" options={ASSIGNEES} value={null} onValueChange={() => undefined} defaultOpen keepSide defaultInputValue="Xaver" emptyText="Niemand heißt so. Prüfe die Schreibweise." />
        </div>
        <div className="pb-56 md:pb-48">
          <Combobox label="Assignee (offen)" options={ASSIGNEES} value={open} onValueChange={setOpen} placeholder="Person suchen …" defaultOpen keepSide defaultInputValue="o" />
        </div>
      </div>
    </Specimen>
  );
}

function MenuSpecimen() {
  const [theme, setTheme] = useState('system');
  const [showArchived, setShowArchived] = useState(true);
  // the submenu opens to the side; on phones there is no room for it next to the menu
  const [wide] = useState(isWide);
  return (
    <Specimen
      title="Menü"
      note="Aktionen mit Kürzeln; der hervorgehobene Eintrag zeigt den aktiven Streifen. Daneben Auswahl, Häkchen und ein Untermenü."
      wide
    >
      <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
        <div className="w-full pb-96 sm:w-64 md:pb-80">
          <Menu defaultOpen modal={false}>
            <MenuTrigger render={<Button variant="secondary">Aktionen für WEB-47</Button>} />
            <MenuContent keepSide>
              <MenuItem icon={Check} shortcut="s" data-demo="hover">
                Status ändern …
              </MenuItem>
              <MenuItem icon={UserRoundPlus} shortcut="a">
                Zuweisen …
              </MenuItem>
              <MenuItem icon={UserRoundCheck} shortcut="i">
                Mir zuweisen
              </MenuItem>
              <MenuItem icon={Tag} shortcut="l">
                Labels …
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={LinkIcon}>Link kopieren</MenuItem>
              <MenuItem icon={Archive} shortcut="mod+backspace">
                Archivieren
              </MenuItem>
              <MenuItem icon={Trash2} disabled>
                Löschen (nur Admins)
              </MenuItem>
              <MenuItem icon={Trash2} danger>
                Löschen …
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
        <div className="w-full pb-80 md:w-[30rem] md:pb-96">
          <Menu defaultOpen modal={false}>
            <MenuTrigger render={<Button variant="ghost" icon={Palette}>Profilmenü</Button>} />
            <MenuContent keepSide>
              <MenuGroup>
                <MenuGroupLabel>Farbschema</MenuGroupLabel>
                <MenuRadioGroup value={theme} onValueChange={(value) => setTheme(String(value))}>
                  <MenuRadioItem value="system">System</MenuRadioItem>
                  <MenuRadioItem value="light">Hell</MenuRadioItem>
                  <MenuRadioItem value="dark">Nachtheft</MenuRadioItem>
                </MenuRadioGroup>
              </MenuGroup>
              <MenuSeparator />
              <MenuCheckboxItem checked={showArchived} onCheckedChange={setShowArchived}>
                Archivierte zeigen
              </MenuCheckboxItem>
              <MenuSubmenu label="Als … ansehen" icon={Users} defaultOpen={wide} keepSide>
                {PEOPLE.map((person) => (
                  <MenuItem key={person.name}>{person.name}</MenuItem>
                ))}
              </MenuSubmenu>
            </MenuContent>
          </Menu>
        </div>
      </div>
    </Specimen>
  );
}

function TooltipSpecimen() {
  return (
    <Specimen title="Tooltip" note="Erst nach kurzer Pause, danach sofort. Nur zur Ergänzung: Der Auslöser hat seinen eigenen Namen.">
      <div className="pt-10">
        <Tooltip content="Priorität ändern" shortcut="p" defaultOpen>
          <Button variant="secondary" aria-keyshortcuts="P">
            <span aria-hidden="true" className="inline-flex">
              <PriorityIcon priority="urgent" />
            </span>
            Urgent
          </Button>
        </Tooltip>
      </div>
    </Specimen>
  );
}

function PopoverSpecimen() {
  const [due, setDue] = useState<string | null>('2026-10-31');
  return (
    <Specimen title="Popover" note="Hält Inhalt, der zum Auslöser gehört: Reaktionen, Datum, Filter. Emoji nur für Reaktionen und Seitentitel, nie als Icon.">
      <div className="flex flex-wrap items-start gap-2.5 pb-[25rem]">
        <Popover defaultOpen>
          <PopoverTrigger render={<IconButton icon={SmilePlus} label="Reaktion hinzufügen" variant="secondary" tooltip={false} />} />
          <PopoverContent keepSide initialFocus={false} className="p-3">
            <EmojiPicker onPick={(emoji) => toast({ title: `Reaktion ${emoji} hinzugefügt`, tone: 'success' })} />
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger render={<Button variant="secondary" icon={CalendarIcon}>{due ? `Due ${formatDue(due)}` : 'Due-Date setzen'}</Button>} />
          <PopoverContent className="w-auto p-3">
            <Calendar value={due} onChange={setDue} today={TODAY} label="Due-Date" />
          </PopoverContent>
        </Popover>
      </div>
    </Specimen>
  );
}

function EmojiSearchSpecimen() {
  return (
    <Specimen title="Emoji-Suche ohne Treffer" note="Kein Name passt. Ein eingetipptes Emoji lässt sich trotzdem übernehmen.">
      <div className="inline-block max-w-full rounded-card border border-line bg-surface p-3 shadow-elev-1">
        <EmojiPicker defaultQuery="Einhorn 🦄" onPick={(emoji) => toast({ title: `Reaktion ${emoji} hinzugefügt`, tone: 'success' })} />
      </div>
    </Specimen>
  );
}

function DialogSpecimen() {
  const [deleting, setDeleting] = useState(false);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  return (
    <Specimen title="Dialoge" note="Rückfrage nur bei großen Folgen; sonst gibt es Rückgängig. Die Fokusfalle hält Tab im Dialog.">
      <div className="flex flex-wrap gap-2.5">
        <Dialog
          open={creating}
          onOpenChange={setCreating}
          trigger={
            <Button variant="primary" icon={Plus} data-shot="dialog">
              Neues Projekt
            </Button>
          }
          title="Neues Projekt"
          description="Projekte bündeln Items, Wiki und Vorlagen eines Teams."
          footer={
            <>
              <DialogClose
                render={
                  <Button variant="ghost" shortcut="escape">
                    Abbrechen
                  </Button>
                }
              />
              <Button
                variant="primary"
                shortcut="mod+enter"
                onClick={() => {
                  setCreating(false);
                  toast({ title: 'Projekt angelegt', tone: 'success' });
                }}
              >
                Projekt anlegen
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <Input label="Name" placeholder="z.&nbsp;B. Website-Relaunch …" name="project-name" autoComplete="off" />
            <Input label="Kennung" placeholder="WEB" hint="2 bis 10&nbsp;Zeichen; steht vor jeder Item-Nummer, z.&nbsp;B. WEB-47." name="project-identifier" autoComplete="off" />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">Sichtbarkeit</span>
              <SegmentedControl
                label="Sichtbarkeit"
                value={visibility}
                onValueChange={setVisibility}
                options={[
                  { value: 'public', label: 'Öffentlich' },
                  { value: 'private', label: 'Privat' },
                ]}
              />
            </div>
          </div>
        </Dialog>
        <AlertDialog
          open={open}
          onOpenChange={setOpen}
          trigger={
            <Button variant="danger" icon={Trash2} data-shot="alert-dialog">
              Projekt löschen …
            </Button>
          }
          title="Projekt WEB löschen?"
          description="Alle 56&nbsp;Items, das Wiki und die Vorlagen von „Website-Relaunch“ werden gelöscht. Das lässt sich nicht rückgängig machen."
          confirmLabel="Projekt löschen"
          pending={deleting}
          onConfirm={() => {
            setDeleting(true);
            window.setTimeout(() => {
              setDeleting(false);
              setOpen(false);
              toast({ title: 'Projekt WEB gelöscht', tone: 'success' });
            }, 900);
          }}
        />
      </div>
    </Specimen>
  );
}

function TogglesSpecimen() {
  const [children, setChildren] = useState(true);
  const [archived, setArchived] = useState(false);
  const [mail, setMail] = useState(true);
  const [digest, setDigest] = useState(false);
  return (
    <Specimen title="Checkbox und Switch" note="Checkbox für Auswahl und Optionen, Switch für Einstellungen, die sofort gelten.">
      <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Checkbox label="Kind-Items zeigen" checked={children} onCheckedChange={setChildren} />
          <Checkbox label="Archivierte zeigen" checked={archived} onCheckedChange={setArchived} />
          <Checkbox label="Teilweise gewählt" checked={false} indeterminate />
          <Checkbox label="Hover" data-demo="hover" />
          <Checkbox label="Fokus" checked data-demo="focus" />
          <Checkbox label="Deaktiviert" disabled />
          <Checkbox label="Deaktiviert, an" checked disabled />
        </div>
        <div className="flex flex-col gap-1">
          <Switch label="Mail bei Erwähnung" checked={mail} onCheckedChange={setMail} />
          <Switch label="Sammelmail um 8&nbsp;Uhr" checked={digest} onCheckedChange={setDigest} />
          <Switch label="Fokus" checked data-demo="focus" />
          <Switch label="Deaktiviert" disabled />
          <Switch label="Deaktiviert, an" checked disabled />
        </div>
      </div>
    </Specimen>
  );
}

function SegmentedSpecimen() {
  const [layout, setLayout] = useState('board');
  const [compact, setCompact] = useState('board');
  const [filter, setFilter] = useState('all');
  return (
    <Specimen title="Umschalter" note="Segmente sitzen konzentrisch in der eingelassenen Fläche. Pfeiltasten wechseln.">
      <div className="flex flex-col items-start gap-4">
        <SegmentedControl
          label="Layout"
          value={layout}
          onValueChange={setLayout}
          options={[
            { value: 'list', label: 'Liste', shortcut: '1' },
            { value: 'board', label: 'Board', shortcut: '2' },
            { value: 'table', label: 'Tabelle', shortcut: '3' },
            { value: 'timeline', label: 'Timeline', shortcut: '4' },
          ]}
        />
        <SegmentedControl
          label="Layout (klein)"
          size="sm"
          value={compact}
          onValueChange={setCompact}
          options={[
            { value: 'list', label: 'Liste', icon: List },
            { value: 'board', label: 'Board', icon: SquareKanban },
            { value: 'table', label: 'Tabelle', icon: Table2 },
            { value: 'timeline', label: 'Timeline', icon: ChartGantt },
          ]}
        />
        <SegmentedControl
          label="Aktivität filtern"
          size="sm"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: 'all', label: 'Alles' },
            { value: 'comments', label: 'Kommentare' },
            { value: 'changes', label: 'Änderungen', disabled: true },
          ]}
        />
      </div>
    </Specimen>
  );
}

function TabsSpecimen() {
  return (
    <Specimen title="Tabs" note="Für Bereiche einer Seite. Der aktive Tab ist tintenblau unterstrichen; Mitglieder zeigt den Fokus, Workflow den Hover.">
      <Tabs defaultValue="general">
        <TabsList aria-label="Projekteinstellungen">
          <Tab value="general">Allgemein</Tab>
          <Tab value="members" data-demo="focus">
            Mitglieder
          </Tab>
          <Tab value="workflow" data-demo="hover">
            Workflow
          </Tab>
          <Tab value="automations" disabled>
            Automatisierungen
          </Tab>
        </TabsList>
        <TabsPanel value="general" className="text-ui text-ink">
          Name, Kennung, Beschreibung und Bild des Projekts.
        </TabsPanel>
        <TabsPanel value="members" className="text-ui text-ink">
          Wer im Projekt mitarbeitet, und mit welcher Rolle.
        </TabsPanel>
        <TabsPanel value="workflow" className="text-ui text-ink">
          Welcher Workflow gilt und wie die Status zueinander führen.
        </TabsPanel>
      </Tabs>
    </Specimen>
  );
}

function CalendarSpecimen() {
  const [due, setDue] = useState<string | null>('2026-10-31');
  const [start, setStart] = useState<string | null>(null);
  return (
    <Specimen title="Kalender" note="Heute trägt den Textmarker, das gewählte Datum Tintenblau. Pfeile, Bild auf/ab und Enter bedienen ihn.">
      <div className="flex flex-wrap gap-6">
        <div className="rounded-card border border-line bg-surface p-3 shadow-elev-1">
          <Calendar value={due} onChange={setDue} today={TODAY} label="Due-Date" />
        </div>
        <div className="rounded-card border border-line bg-surface p-3 shadow-elev-1">
          <Calendar value={start} onChange={setStart} today={TODAY} label="Start-Date" />
        </div>
      </div>
    </Specimen>
  );
}

/* Status und Elemente */

function ElementsSection() {
  return (
    <Section id="elements" title="Status und Elemente" intro="Farbe zeigt die Kategorie, die Form den Status. Typ, Status und Priorität nie nur über Farbe.">
      <ChipsSpecimen />
      <StatusSpecimen />
      <TypesSpecimen />
      <CardsSpecimen />
      <AvatarsSpecimen />
      <ProgressSpecimen />
      <BannerSpecimen />
    </Section>
  );
}

function ChipsSpecimen() {
  const [labels, setLabels] = useState(LABELS.slice(0, 3));
  return (
    <Specimen title="Chips" note="Status, Priorität, Label. Entfernbare Chips haben ein eigenes Kreuz.">
      <States>
        <State label="Status">
          {STATES.slice(0, 4).map((state) => (
            <Chip key={state.name} icon={<StatusIcon icon={state.icon} category={state.category} label={state.name} className="size-3.5" />}>
              {state.name}
            </Chip>
          ))}
        </State>
        <State label="Priorität">
          {PRIORITIES.slice(0, 3).map((priority) => (
            <Chip key={priority} icon={<PriorityIcon priority={priority} />}>
              {PRIORITY_LABELS[priority]}
            </Chip>
          ))}
        </State>
        <State label="Label">
          {labels.map((label) => (
            <Chip key={label.name} dot={label.tone} onRemove={() => setLabels((current) => current.filter((entry) => entry.name !== label.name))} removeLabel={`Label ${label.name} entfernen`}>
              {label.name}
            </Chip>
          ))}
          {labels.length === 0 && <span className="text-sm text-muted">Alle entfernt.</span>}
        </State>
        <State label="Töne">
          {LABELS.map((label) => (
            <Chip key={label.name} dot={label.tone}>
              {label.name}
            </Chip>
          ))}
        </State>
      </States>
    </Specimen>
  );
}

function StatusSpecimen() {
  return (
    <Specimen title="Status und Priorität" note="Sieben Formen in fünf Kategorie-Farben; Prioritäten als Federstriche.">
      <ul className="grid gap-2 text-ui">
        {STATES.map((state) => (
          <li key={state.name} className="flex items-center gap-2.5">
            <StatusIcon icon={state.icon} category={state.category} label={state.name} aria-hidden="true" />
            <span className="w-24 font-medium text-ink">{state.name}</span>
            <span className="text-muted">
              {state.category}, {state.icon}
            </span>
          </li>
        ))}
      </ul>
      <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-ui text-ink">
        {PRIORITIES.map((priority) => (
          <li key={priority} className="inline-flex items-center gap-2">
            <PriorityIcon priority={priority} />
            {PRIORITY_LABELS[priority]}
          </li>
        ))}
      </ul>
    </Specimen>
  );
}

function TypesSpecimen() {
  return (
    <Specimen title="Typen" note="Sechs gedeckte Töne für Reiter; das Icon trägt den Typ immer mit.">
      <ul className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {TYPES.map((type) => (
          <li key={type.name} className="min-w-0">
            <div className="relative mt-6 h-10 rounded-card border border-line bg-surface shadow-elev-1">
              <span className="absolute bottom-full left-3 flex">
                <TypeTab tone={type.tone} icon={type.icon} label={type.name} size="sm" />
              </span>
            </div>
            <p className="mt-2 text-sm text-muted">
              {type.colour} ({type.tone})
            </p>
          </li>
        ))}
      </ul>
    </Specimen>
  );
}

function CardMeta({ priority, due, children }: { priority: Priority; due?: string; children: ReactNode }) {
  return (
    <div className="mt-3 flex items-center gap-2 text-sm text-muted">
      <PriorityIcon priority={priority} />
      {due && (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <CalendarIcon className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Due-Date</span>
          {formatDue(due)}
        </span>
      )}
      <span className="ml-auto flex">{children}</span>
    </div>
  );
}

function CardsSpecimen() {
  const [lifted, setLifted] = useState(true);
  return (
    <Specimen title="Karteikarte" note="Ruhe, Auswahl, Tastaturfokus, Ziehen. Der Reiter deckt die Kante der Karte ab." wide>
      <ul className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <li className="flex flex-col">
          <IndexCard tone="sky" icon="square-check" tabLabel="WEB-50" aria-label="WEB-50, Task">
            <p className="text-ui font-medium text-pretty text-ink">Fehlerseite 404 gestalten</p>
            <CardMeta priority="medium">
              <UnassignedAvatar />
            </CardMeta>
          </IndexCard>
          <span className="mt-2 text-sm text-muted">Ruhe</span>
        </li>
        <li className="flex flex-col">
          <IndexCard tone="ochre" icon="bug" tabLabel="WEB-47" selected aria-label="WEB-47, Bug, ausgewählt">
            <p className="text-ui font-medium text-pretty text-ink">
              <span className="hl">Kontaktformular sendet doppelt</span>
            </p>
            <CardMeta priority="urgent" due="2026-10-31">
              <Avatar user={PEOPLE[1]} size="sm" />
            </CardMeta>
          </IndexCard>
          <span className="mt-2 text-sm text-muted">Ausgewählt: Textmarker auf dem Titel</span>
        </li>
        <li className="flex flex-col">
          <IndexCard tone="sky" icon="square-check" tabLabel="WEB-42" data-demo="focus" aria-label="WEB-42, Task">
            <p className="text-ui font-medium text-pretty text-ink">Startseite: Hero und Teaser bauen</p>
            <CardMeta priority="high" due="2026-10-30">
              <Avatar user={PEOPLE[2]} size="sm" />
            </CardMeta>
          </IndexCard>
          <span className="mt-2 text-sm text-muted">Fokus: Tinten-Ring mit Marker-Halo</span>
        </li>
        <li className="flex flex-col">
          <div className="relative mt-5">
            <div className="absolute inset-0 rounded-card border-2 border-dashed border-line-strong" aria-hidden="true" />
            <IndexCard tone="moss" icon="zap" tabLabel="WEB-30" lifted={lifted} className="mt-0" aria-label={`WEB-30, Epic${lifted ? ', wird gezogen' : ''}`}>
              <p className="text-ui font-medium text-pretty text-ink">Relaunch Phase 1</p>
              <ProgressBar done={6} total={10} label="Kind-Items" className="mt-3" />
            </IndexCard>
          </div>
          <span className="mt-2 flex items-center justify-between gap-2 text-sm text-muted">
            Ziehen: angehoben und geneigt
            <Button variant="secondary" size="sm" icon={GripVertical} aria-pressed={lifted} onClick={() => setLifted((value) => !value)}>
              {lifted ? 'Ablegen' : 'Anheben'}
            </Button>
          </span>
        </li>
      </ul>
    </Specimen>
  );
}

function AvatarsSpecimen() {
  return (
    <Specimen title="Avatare" note="Menschen rund, Bots eckig in Tinte und mit Zusatz.">
      <ul className="grid grid-cols-1 gap-x-4 gap-y-2.5 text-ui text-ink sm:grid-cols-2">
        {PEOPLE.map((person) => (
          <li key={person.name} className="flex items-center gap-2">
            <Avatar user={person} decorative />
            {person.name}
          </li>
        ))}
        <li className="flex items-center gap-2">
          <UnassignedAvatar size="md" />
          <span className="text-muted">Nicht zugewiesen</span>
        </li>
      </ul>
      <ul className="mt-4 flex flex-col gap-2.5 border-t border-line pt-4 text-ui text-ink">
        {BOTS.map((bot) => (
          <li key={bot.name} className="flex flex-wrap items-center gap-2">
            <Avatar user={bot} decorative />
            {bot.name}
            <Chip>{bot.badge}</Chip>
            <span className="text-sm text-muted">{bot.note}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 flex items-center gap-2 text-sm text-muted">
        Klein, in Karten und Aktivität:
        {[...PEOPLE.slice(0, 3), BOTS[0]].map((user) => (
          <Avatar key={user.name} user={user} size="sm" />
        ))}
      </p>
    </Specimen>
  );
}

function ProgressSpecimen() {
  return (
    <Specimen title="Fortschritt" note="Ein Segment je Kind-Item, ab 13 ein durchgehender Balken.">
      <div className="flex max-w-80 flex-col gap-4">
        <ProgressBar done={6} total={10} label="Kind-Items von WEB-30" />
        <ProgressBar done={2} total={3} label="Kind-Items von APP-12" tone="sky" />
        <ProgressBar done={0} total={4} label="Kind-Items von OPS-3" tone="slate" />
        <ProgressBar done={37} total={52} label="Kind-Items von WEB-1" tone="plum" />
      </div>
    </Specimen>
  );
}

function BannerSpecimen() {
  return (
    <Specimen title="Hinweise" note="Eingelassene Flächen für Zustände, die man nicht übersehen soll.">
      <div className="flex flex-col gap-3">
        <Banner tone="danger" icon={Ban} title="Blockiert, solange OPS-12 offen ist">
          <span className="flex min-w-0 items-center gap-1.5">
            <StatusIcon icon="circle" category="unstarted" label="Status Todo" className="size-3.5" />
            <span className="shrink-0 font-semibold tabular-nums">OPS-12</span>
            <span className="min-w-0 truncate">Mail-Limits am Server erhöhen</span>
          </span>
        </Banner>
        <Banner
          icon={WifiOff}
          title="Live-Updates pausiert"
          action={
            <Button variant="secondary" size="sm">
              Neu laden
            </Button>
          }
        >
          Änderungen anderer erscheinen erst nach dem Neuladen.
        </Banner>
        <Banner tone="info" title="Jonas Feld hat diese Seite gerade geändert">
          Deine Fassung bleibt im Editor; vergleiche beide, bevor du speicherst.
        </Banner>
      </div>
    </Specimen>
  );
}

/* Rückmeldung */

function FeedbackSection() {
  return (
    <Section id="feedback" title="Rückmeldung" intro="Jede Ansicht kennt Laden, Leer, Fehler und Inhalt.">
      <ToastSpecimen />
      <SkeletonSpecimen />
      <EmptySpecimen />
      <ErrorSpecimen />
    </Section>
  );
}

function ToastSpecimen() {
  return (
    <Specimen title="Toast" note="Bleibt 5&nbsp;Sekunden, der Strich zeigt die Zeit; Zeiger oder Fokus halten ihn an. Kommt mit Feder.">
      <div className="flex flex-col gap-3">
        <ToastCard item={{ id: 0, title: 'WEB-51 archiviert', action: { label: 'Rückgängig', onClick: () => undefined }, duration: 5000, tone: 'neutral' }} />
        <ToastCard item={{ id: 0, title: 'Status nicht geändert', description: 'Der Server antwortet gerade nicht (503).', action: { label: 'Erneut versuchen', onClick: () => undefined }, duration: 5000, tone: 'error' }} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2.5">
        <Button
          variant="secondary"
          data-shot="toast"
          onClick={() =>
            toast({
              title: 'WEB-51 archiviert',
              action: { label: 'Rückgängig', onClick: () => toast({ title: 'WEB-51 wiederhergestellt', tone: 'success' }) },
            })
          }
        >
          Toast mit Rückgängig
        </Button>
        <Button variant="ghost" onClick={() => toast({ title: 'Status nicht geändert', description: 'Der Server antwortet gerade nicht (503).', tone: 'error', action: { label: 'Erneut versuchen', onClick: () => undefined } })}>
          Fehler-Toast
        </Button>
      </div>
    </Specimen>
  );
}

function SkeletonSpecimen() {
  return (
    <Specimen title="Laden" note="Platzhalter in der Form des Inhalts, ohne Schimmer-Schleife.">
      <SkeletonGroup label="Items laden …" className="flex flex-col gap-4">
        <div className="relative mt-5 rounded-card border border-line bg-surface p-3 shadow-elev-1">
          <Skeleton className="absolute bottom-full left-3 h-5 w-16 rounded-b-none" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="mt-2 h-3 w-1/2" />
          <div className="mt-4 flex items-center gap-2">
            <Skeleton className="h-3 w-8" />
            <Skeleton className="ml-auto size-5 rounded-full" />
          </div>
        </div>
        <ul className="flex flex-col gap-3">
          {['w-2/3', 'w-1/2', 'w-3/5'].map((width) => (
            <li key={width} className="flex items-center gap-3">
              <Skeleton className="size-4 rounded-full" />
              <Skeleton className="h-3 w-14" />
              <Skeleton className={cx('h-3', width)} />
            </li>
          ))}
        </ul>
      </SkeletonGroup>
    </Specimen>
  );
}

function EmptySpecimen() {
  return (
    <Specimen title="Leerer Zustand" note="Erklärt, was fehlt, und nennt die nächste Aktion.">
      <EmptyState
        icon={Inbox}
        badge={Check}
        title="Inbox ist leer"
        description="Erwähnungen, Zuweisungen und Änderungen an Items, die du beobachtest, landen hier."
        actions={
          <>
            <Button variant="secondary" icon={Bell}>
              Benachrichtigungen einstellen
            </Button>
            <InPageLink to="controls" className="inline-flex h-11 items-center rounded-ctl px-3 text-ui font-semibold text-accent-text transition-colors duration-120 hover:bg-hover md:h-8">
              Meine Items öffnen
            </InPageLink>
          </>
        }
      />
    </Specimen>
  );
}

function ErrorSpecimen() {
  const [retrying, setRetrying] = useState(false);
  return (
    <Specimen title="Fehler" note="Nennt die Ursache und bietet „Erneut versuchen“.">
      <ErrorState
        title="Items konnten nicht geladen werden"
        description="Der Server antwortet gerade nicht (Fehler&nbsp;503). Deine Filter bleiben erhalten."
        retrying={retrying}
        onRetry={() => {
          setRetrying(true);
          window.setTimeout(() => setRetrying(false), 1200);
        }}
      />
    </Specimen>
  );
}
