# werkbuch Klickdummy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein durchklickbarer Prototyp von werkbuch mit allen Bildschirmen aus Spec 5.2 und dem Tastaturkonzept aus 5.3, damit Oberfläche und Abläufe vor der Umsetzung korrigiert werden können.

**Architecture:** Eine reine Client-App mit der Infrastruktur aus `design-webapp`:
- Fachlogik als reine TS-Funktionen in `src/domain/`. Sie wird später nach PHP portiert (Spec 7.2).
- Fake-API in `src/api/`. Ihre Funktionssignaturen spiegeln die REST-API aus Spec 6.1.
- Server-State über TanStack-Query-Hooks, Client-State über Zustand.
- Eigenes Komponentenset auf Base UI.
- Features in `src/features/<name>/` mit fester Dateihoheit, damit die Tasks 6–12 parallel laufen können.

**Tech Stack:** Vite 8, React 19, TypeScript, Tailwind 4 (`@tailwindcss/vite`), `@base-ui/react` 1.9, TanStack Query 5, `@tanstack/react-virtual` 3, Zustand 5, `react-router` 8, `lucide-react`, `@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/figtree`, `@dnd-kit/*`, Tiptap 3.32 (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-list`, `@tiptap/extensions`, `@tiptap/extension-mention`, `@tiptap/extension-table`, `@tiptap/extension-image`, `@tiptap/extension-file-handler`, `@tiptap/suggestion`), `fractional-indexing` 4, Vitest + jsdom + Testing Library, Playwright 1.64.

**Spec:** `docs/superpowers/specs/2026-10-28-werkbuch-design.md` (Abschnitte 4, 5, 11). **Gestaltung:** `prototypes/clickdummy/DESIGN.md` (bindend).

## Global Constraints

**Ort und Werkzeuge**
- Alles liegt unter `prototypes/clickdummy/`, als eigenes pnpm-Projekt mit eigener `pnpm-lock.yaml`.
- Nur pnpm, nie npm oder npx; Einmal-Tools über `pnpm dlx`. Node 24 (`.node-version` = `24`).
- Der Klickdummy läuft direkt auf dem Mac. DDEV kommt erst mit der Fundament-Phase der App.

**Stack**
- Genau der Stack oben, in den genannten Hauptversionen.
- Kein shadcn, keine andere UI-Bibliothek, kein CSS-in-JS, keine weiteren Abhängigkeiten ohne Not.
- Datum und Zahlen über `Intl`.
- Alle Tiptap-Pakete in derselben Version.

**Gestaltung**
- `DESIGN.md` ist bindend:
  - Tokens, Radien 6/10/14/rund, Bricolage Grotesque und Figtree
  - Tintenblau ist der einzige Akzent; Textmarker nur für Auswahl, Fokus und Treffer
  - Glas (Transparentpapier) nur auf schwebenden Flächen
  - Motion: 160 ms ease-out, Feder 420 ms
- Themes Hell, Nachtheft und System. WCAG 2.2 AA, sichtbarer Fokus, `prefers-reduced-motion`.
- UI-Tasks laden vor dem ersten Code den Skill `frontend-design:frontend-design`.
- **Status-Icons:** Jeder Status hat ein `icon` aus einer festen Menge (`dashed`, `circle`, `half`, `three-quarter`, `pause`, `check`, `cross`). Die Farbe folgt der Kategorie (DESIGN.md: Farbe = Kategorie, Form = Status). Das ersetzt die freie Statusfarbe aus Spec 4.5; der Spec-Nachtrag folgt nach den Korrekturrunden.
- **Typ-Farben:** sechs gedeckte Töne, nämlich `sky`, `ochre`, `moss` aus DESIGN.md plus `plum`, `sand`, `slate`, jeweils mit `-tab`- und `-ink`-Variante für hell und dunkel. Sie werden in Task 1 in `DESIGN.md` nachgetragen.

**Sprache**
- UI-Texte nur Deutsch; der Klickdummy hat keine i18n-Schicht.
- Code, Kommentare und Dateinamen auf Englisch.
- Felder der Fake-API in snake_case, wie die spätere REST-API (Spec 6.1). URLs auf Englisch und ohne Sprachpräfix (Spec 7.3).

**Demo**
- Nur fiktive Daten, wie in Task 3 beschrieben.
- Angemeldet ist Mara Lindqvist (Org-Admin).
- „Heute“ ist Mittwoch, 2026-10-28. Die Uhr startet um 10:00 Europe/Berlin und läuft ab dem Laden der Seite weiter (`src/lib/clock.ts`).

**Fake-API**
- Jede Funktion ist async und wartet 150–450 ms; in Tests 0 ms (`import.meta.env.MODE === 'test'`).
- Fehler sind `ApiError { status, reason, errors? }`, aufgebaut wie Problem Details.
- `localStorage.setItem("api:fail", "1")` lässt jede Funktion mit 503 `simulated` scheitern.
- Die Daten liegen in `localStorage` unter `werkbuch:db` mit `schema_version`.
- Komponenten rufen nie `src/api/*` direkt auf, nur über Hooks.

**Zustände**
- Jede datentragende Ansicht hat vier Zustände:
  - Loading: Skeleton in Inhaltsform
  - Empty: erklärt, was fehlt, und nennt die nächste Aktion
  - Error: Ursache und „Erneut versuchen“
  - Content
- Mutationen zeigen Pending am Auslöser und danach einen Toast.
- Löschen und Archivieren haben 5 s Rückgängig, wie in openbill: Ausgeführt wird erst, wenn der Toast abläuft.

**Tastatur**
- Jede Aktion ist per Tastatur erreichbar.
- Kürzel nur über das Register (Task 4), Startsatz aus Spec 5.3. `?` zeigt alle.
- In Eingabefeldern, Textareas und im Editor feuern nur `mod+k`, `escape` und `mod+enter`.

**Rechte**
- `usePermissions()` (Task 4) blendet nicht erlaubte Aktionen aus oder deaktiviert sie mit Begründung im Tooltip (Spec 4.3).
- Über das Profilmenü „Als … ansehen“ lässt sich die angemeldete Person wechseln.

**Dateihoheit**
- Die gemeinsamen Schichten gehören den Tasks 1–5: `src/types.ts`, `src/domain/`, `src/api/`, `src/hooks/`, `src/store/`, `src/lib/`, `src/components/` und `src/app/`.
- Die Tasks 6–12 ändern sie nicht. Fehlt etwas, entsteht es im eigenen Feature-Ordner; Task 13 räumt auf.
- Jede Task besitzt nur ihre eigenen Feature-Ordner, siehe die **Files**-Liste der Task.

**Prüfen je Task**
- `pnpm typecheck && pnpm test && pnpm build` sind grün.
- Die eigenen Routen werden mit `pnpm shots <route…>` aufgenommen: 1440/768/390, hell und dunkel, ohne FINDINGS. Die PNGs selbst ansehen, bis zu 3 Runden.
- Danach `design:web-design-guidelines` über den eigenen Code laufen lassen und alle MUST- und NEVER-Befunde fixen.

**Git**
- Branch `feat/clickdummy`. Wellen laufen in Worktrees, der Orchestrator führt sie zusammen.
- Conventional Commits, Commit-Text endet mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Reihenfolge**
- Tasks 1 → 2 → 3 → 4 → 5 nacheinander.
- Welle A parallel: 6, 8, 9, 11, 12.
- Welle B parallel: 7 (braucht 6) und 10 (braucht 8).
- Zum Schluss 13.

## Review Focus

1. **Alter oder kaputter `localStorage`** (alte `schema_version`, kaputtes JSON): Die Seed-Daten werden neu geladen statt einer weißen Seite. Test in Task 3.
2. **Kürzel beim Tippen:** `c`, `s`, `a` im Titel-Feld, im Kommentar, im Editor oder in der Filtersuche lösen nichts aus; `mod+k` und `escape` schon. Test in Task 4.
3. **Unerlaubter Übergang beim Ziehen und bei Mehrfachbearbeitung:** Die Karte springt zurück und ein Toast nennt den Grund. Die Mehrfachbearbeitung ändert die erlaubten Items und nennt die abgelehnten. Tests in Task 3 (API) und Task 7 (Drop-Ziel).
4. **Zeitumstellung in Zeitplänen** (Europe/Berlin, 2026-10-25 und 2027-03-28): Termine bleiben um 09:00 Ortszeit. Test in Task 2.
5. **API-Fehler während einer optimistischen Änderung:** Der alte Stand kommt zurück, ein Fehler-Toast bietet „Erneut versuchen“, nichts bleibt im Pending hängen. Test in Task 3.

---

### Task 1: Grundgerüst, Tokens und Komponentenset

**Files:**
- **Projekt:** `prototypes/clickdummy/` mit `package.json` (Skripte `dev`, `build`, `build:review`, `preview`, `typecheck`, `test`, `shots`, `e2e`), `.node-version`, `index.html`, `vite.config.ts` (Alias `@` → `src`, Vitest mit jsdom), `tsconfig.json` und `tsconfig.app.json`, `README.md`.
- **App-Einstieg und Styles:** `src/main.tsx`, `src/styles/tokens.css` (alle Tokens aus DESIGN.md, hell und Nachtheft, plus Typ-Töne), `src/styles/app.css` (`@import "tailwindcss"`, `@theme inline` mit `--color-*: initial`, Grundstile für Punktraster, Fokus und `::selection`).
- **Komponenten** in `src/components/ui/`:
  - Bedienung: `Button`, `IconButton`, `Kbd`, `Input`, `Textarea`, `Select`, `Combobox`, `Menu`, `Popover`, `Tooltip`, `Dialog`, `AlertDialog`, `Checkbox`, `Switch`, `SegmentedControl`, `Tabs`, `Calendar`, `EmojiPicker`
  - Status und Elemente: `Chip`, `StatusIcon`, `PriorityIcon`, `TypeTab`, `IndexCard`, `Avatar`, `ProgressBar`, `Banner`
  - Rückmeldung: `Toaster` und `toast.ts`, `Skeleton`, `EmptyState`, `ErrorState`
- **Galerie und Tests:** `src/routes/components-gallery.tsx` (Route `/_components`) und `src/components/ui/ui.test.tsx`.
- **Werkzeug:** `scripts/shots.mjs`.
- **Ändern:** `.github/workflows/tests.yml`, `DESIGN.md` (Typ-Töne), `/.gitignore` (`prototypes/clickdummy/{node_modules,dist,dist-review,.shots,test-results,playwright-report}`).

**Interfaces:**
- Produces:
  - `Button({ variant: 'primary'|'secondary'|'ghost'|'danger', size?: 'sm'|'md', shortcut?: string, pending?: boolean, ...button props })`
  - `Kbd({ keys: string })`: Schreibweise wie das Register (`"mod+k"`, `"g i"`, `"shift+d"`); Modifier als Lucide-Icons mit Klartext-`aria-label`
  - `StatusIcon({ icon: StateIcon, category: StateCategory, label: string })`
  - `PriorityIcon({ priority: Priority })`
  - `TypeTab({ tone: TypeTone, icon: string, label: string })`
  - `Avatar({ user: { name: string, type: 'person'|'bot' }, size?: 'sm'|'md' })`
  - `toast({ title: string, description?: string, action?: { label: string, onClick: () => void }, onExpire?: () => void, duration?: number /* default 5000 */ })`
  - `Calendar({ value: string|null /* YYYY-MM-DD */, onChange(v): void })`
  - `EmojiPicker({ onPick(emoji: string): void })`
  - `pnpm shots [--base=http://localhost:5173] [--keys=<Playwright keys>] [--click=<selector>] [--only=desktop,tablet,mobile] [--light|--dark] <route…>` schreibt nach `.shots/<route>/<viewport>-<theme>.png` und gibt `FINDINGS` aus: Konsolenfehler, fehlgeschlagene Requests, Schriften mit Status `error` (nicht `unloaded`) und seitlichen Überlauf. Das Theme kommt per `localStorage['werkbuch:theme']` vor dem Laden.

- [ ] **Step 1: Projekt aufsetzen.**
  - Vite-React-TS-Gerüst mit `pnpm create vite`, dann die Abhängigkeiten aus dem Tech Stack installieren.
  - Fonts per `import` in `main.tsx`.
  - `pnpm dev` zeigt eine leere Seite ohne Konsolenfehler.
- [ ] **Step 2: Tokens übertragen.**
  - Den Token-Block aus DESIGN.md 1:1 nach `tokens.css` übernehmen.
  - Dunkel unter `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` und unter `:root[data-theme="dark"]`.
  - Mit `@theme inline` auf Utilities mappen (`bg-paper`, `bg-surface`, `text-ink`, `text-muted`, `border-line`, `bg-accent`, `rounded-chip|ctl|card`, `font-display`, `font-ui`, `shadow-elev-1..3`).
  - Typ-Töne `plum`, `sand`, `slate` im Stil der vorhandenen drei ergänzen und in DESIGN.md unter Tokens und Entscheidungen nachtragen.
- [ ] **Step 3: Failing tests schreiben** in `ui.test.tsx`:
  - `Kbd renders "mod+k" with the accessible name "Befehl K"` (macOS-Glyphen; die Plattform ist im Test fest Mac)
  - `Button with pending shows a busy state and is disabled` (`aria-busy="true"`, `disabled`)
  - `toast with action calls onExpire after the duration unless the action ran` (Fake-Timer, 5000 ms)
- [ ] **Step 4: Komponenten bauen**, bis die Tests grün sind.
  - Base-UI-Primitive für Select, Combobox, Menu, Popover, Tooltip, Dialog, AlertDialog, Checkbox, Switch, Toggle-Group und Tabs.
  - Gestaltung nach DESIGN.md: Karteikarte mit echtem Reiter, Transparentpapier für Popover, Menu, Dialog und Toast, Schreiblinie an Eingaben.
- [ ] **Step 5: Galerie `/_components` bauen.** Sie zeigt alle Komponenten in allen Zuständen: hover, focus, disabled, error, pending, leer und offen.
- [ ] **Step 6: `scripts/shots.mjs` schreiben** nach der Interface-Beschreibung. Playwright 1.64 startet einen eigenen Headless-Chromium. Dann `pnpm shots /_components` ausführen, bis keine FINDINGS mehr kommen.
- [ ] **Step 7: CI anpassen.** `tests.yml`, Job `tests`:
  - pnpm/action-setup und Node 24
  - `pnpm --dir prototypes/clickdummy install --frozen-lockfile`
  - `typecheck`, `test`, `build`
  - Den Platzhalter-Schritt entfernen.
- [ ] **Step 8: README schreiben.** Deutsch, mit Kommandos, Ordneraufbau, Fehlerfall (`api:fail`) und dem Satz, wo die echte API später andockt.
- [ ] **Step 9: Prüfen und committen.** `pnpm typecheck && pnpm test && pnpm build` grün, Commit `feat(clickdummy): scaffold, tokens and component set`.

### Task 2: Typen und Fachlogik

**Files:**
- Typen: `src/types.ts`.
- Fachlogik in `src/domain/`: `workflow.ts`, `resolution.ts`, `filter.ts`, `grouping.ts`, `board.ts`, `recurrence.ts`, `placeholders.ts`, `progress.ts`, `keys.ts`, `rank.ts`, `tz.ts`.
- Tests: je eine `*.test.ts` daneben.

**Interfaces:**
- **Produces (Typen)** in `src/types.ts`. Alle IDs sind `string`, Datumswerte `YYYY-MM-DD`, Zeitpunkte ISO-Strings.
  - **Grundtypen:**
    - `StateCategory = 'backlog'|'unstarted'|'started'|'completed'|'canceled'`
    - `StateIcon` wie oben
    - `Priority = 'urgent'|'high'|'medium'|'low'|'none'`
    - `TypeTone = 'sky'|'ochre'|'moss'|'plum'|'sand'|'slate'`
    - `FieldType = 'text'|'number'|'dropdown'|'boolean'|'date'|'member'|'rich_text'|'url'`
    - `RichText = JSONContent` (Tiptap)
  - **Konten und Projekte:**
    - `Organization { id, name, locale, timezone, week_start: 0|1, logo_url }`
    - `User { id, type: 'person'|'bot', name, handle, email|null, org_role: 'admin'|'member', is_default_bot, owner_id|null, disabled_at|null, avatar_url|null, locale, timezone }`
    - `Project { id, identifier, name, description, image_url|null, lead_id, visibility: 'public'|'private', workflow_id, enabled_type_ids, default_type_id, archived_at|null }`
    - `ProjectMember { project_id, user_id, role: 'admin'|'member'|'viewer' }`
  - **Workflows:**
    - `State { id, name, icon: StateIcon, category, position }`
    - `Workflow { id, name, description, is_default, is_free, initial_state_id, states: State[], transitions: [from: string, to: string][] }`
  - **Typen und Felder:**
    - `WorkItemType { id, name, icon /* lucide name */, tone: TypeTone, description, is_epic, properties: { property_id, required, position }[], archived_at|null }`
    - `Property { id, key, label, field_type, help, default_value: PropertyValue, settings: { multiple?: boolean, decimals?: number }, options: PropertyOption[] }`
    - `PropertyOption { id, label, color: TypeTone, position, archived_at|null }`
    - `PropertyValue = string|number|boolean|string[]|RichText|null`
  - **Kataloge:**
    - `Label { id, name, color: TypeTone }`
    - `RelationType { id, name, outward_label, inward_label|null, built_in: 'blocks'|'duplicates'|'relates'|null }`
    - `Resolution { id, label, default_for: 'completed'|'canceled'|null, position, archived_at|null }`
  - **Work Items:**
    - `WorkItem { id, project_id, number, key, type_id, title, description: RichText|null, description_version, state_id, resolution_id|null, assignee_id|null, priority, label_ids, start_date|null, due_date|null, parent_id|null, rank, values: Record<string, PropertyValue>, created_by, created_at, updated_at, started_at|null, closed_at|null, archived_at|null, template_id|null, subscriber_ids }`
    - `Relation { id, type_id, source_id, target_id }`
    - `Comment { id, work_item_id, author_id, body: RichText, created_at, edited_at|null, reactions: { emoji, user_ids }[] }`
    - `Attachment { id, project_id, owner: { type: 'work_item'|'comment'|'page'|'template', id }|null, kind: 'inline'|'file', filename, mime, size, url }`
    - `ItemEvent { id, type, actor_id, subject: { type, id }, project_id|null, changes: Record<string, { old: unknown, new: unknown }>, reason: string|null, occurred_at }`
  - **Views:**
    - `Condition { field: string, op: ConditionOp, value?: unknown }`
    - `ConditionOp = 'is'|'is_not'|'in'|'not_in'|'is_empty'|'is_not_empty'|'before'|'after'|'between'|'contains'|'gt'|'lt'|'overdue'`
    - `Filter { version: 1, conditions: Condition[] }`
    - `SortSpec { field: string, direction: 'asc'|'desc' }`
    - `GroupBy = 'state'|'category'|'assignee'|'priority'|'type'|'label'|'project'|'parent'|'none'`
    - `Display { layout: 'list'|'board'|'table'|'timeline', group_by: GroupBy, sort: SortSpec, fields: string[], show_sub_items: boolean }`
    - `View { id, name, icon, filter, display, created_by, created_at }`
  - **Vorlagen:**
    - `Schedule { frequency: 'daily'|'weekly'|'monthly'|'yearly', interval: number, weekdays?: (0..6)[], month_day?: number|'last', nth_weekday?: { n: 1|2|3|4|-1, weekday: 0..6 }, yearly_date?: 'MM-DD', time: 'HH:MM', starts_on, ends: { type: 'never' }|{ type: 'on', date }|{ type: 'count', count }, paused: boolean }`
    - `Template { id, project_id, name, payload: { type_id, title, description, priority, assignee_id, label_ids, values, parent_id, start_offset_days|null, due_offset_days|null }, schedule: Schedule|null, run_count, last_run_at|null, next_run_at|null, created_by }`
    - `TemplateRun { id, template_id, scheduled_for, work_item_id|null, status: 'created'|'failed', error|null }`
  - **Weitere Ressourcen:** `Automation`, `Page`, `PageVersion`, `Notification`, `NotificationPreference`, `Webhook`, `WebhookDelivery`, `Token`, `SystemStatus`. Felder jeweils nach Spec 7.4 bzw. 4.12–4.15 und 6.3, in snake_case.
- **Produces (Funktionen):**
  - `canTransition(wf: Workflow, from: string, to: string): boolean`
  - `allowedTargets(wf: Workflow, from: string): State[]`
  - `validateWorkflow(wf: Workflow): { code: 'no_initial_state'|'no_completed_state'|'unreachable_state', state_id?: string }[]`
  - `resolutionAfterTransition(fromCat: StateCategory, toCat: StateCategory, current: string|null, chosen: string|null, resolutions: Resolution[]): string|null`
  - `matchesFilter(item: WorkItem, filter: Filter, ctx: FilterContext): boolean` mit `FilterContext { me, today, week_start, stateCategory(stateId): StateCategory, typeHasProperty(typeId, key): boolean, hasChildren(itemId): boolean, isBlocked(itemId): boolean }`
  - `sortItems(items, sort: SortSpec, ctx): WorkItem[]`
  - `effectiveGroupBy(groupBy: GroupBy, items: WorkItem[], workflowOf: (item) => string): GroupBy`
  - `groupItems(items, groupBy, ctx & { labelFor(groupBy, key): string, orderFor(groupBy): string[] }): Group[]` mit `Group { key: string, label: string, items: WorkItem[] }` (exportiert aus `src/types.ts`)
  - `dropTargetState(item: WorkItem, target: { kind: 'state', state_id: string }|{ kind: 'category', category: StateCategory }, wf: Workflow): string|null`
  - `nextOccurrences(s: Schedule, after: Date, count: number, timeZone: string, runCount?: number): Date[]`
  - `missedRunToCatchUp(s: Schedule, lastRunAt: Date|null, now: Date, timeZone: string): Date|null`
  - `renderTitle(template: string, at: Date, locale: 'de'|'en', timeZone: string): string`
  - `childProgress(children: WorkItem[], stateCategory): { done: number, total: number }`
  - `parseKey(input: string): { identifier: string, number: number }|null`
  - `rankBetween(before: string|null, after: string|null): string`, gebaut auf `fractional-indexing`
  - Zeitzonen-Helfer in `tz.ts` nur mit `Intl`, keine weitere Bibliothek

- [ ] **Step 1: Failing tests schreiben.** Jeder Test ist ein `it` mit genau diesen Werten.
  - **Fixtures** (in `src/domain/fixtures.ts`, auch für Task 3):
    - Workflow `Standard`, frei, Status `std_backlog`, `std_todo`, `std_progress` (In Progress), `std_pending`, `std_done` und `std_cancelled`
    - Workflow `Agentur-Freigabe` mit den Status `app_backlog`, `app_todo`, `app_progress`, `app_review`, `app_approval` (Kundenfreigabe), `app_done` und `app_cancelled`
    - Übergänge von `Agentur-Freigabe`:
      - backlog→todo, todo→progress, progress→review, review→progress, review→approval, approval→done, approval→progress
      - jeder offene Status → cancelled
      - done→todo, cancelled→backlog
```ts
// workflow.test.ts
expect(canTransition(agency, 'app_todo', 'app_done')).toBe(false)
expect(canTransition(agency, 'app_approval', 'app_done')).toBe(true)
expect(canTransition(agency, 'app_progress', 'app_cancelled')).toBe(true)
expect(canTransition(standard, 'std_todo', 'std_done')).toBe(true)
expect(canTransition(agency, 'app_review', 'app_review')).toBe(true) // no-op
expect(allowedTargets(agency, 'app_review').map(s => s.id)).toEqual(['app_progress', 'app_approval', 'app_cancelled'])
expect(validateWorkflow({ ...agency, states: agency.states.filter(s => s.category !== 'completed') })).toContainEqual({ code: 'no_completed_state' })
expect(validateWorkflow(withoutTransitionsInto(agency, 'app_review'))).toContainEqual({ code: 'unreachable_state', state_id: 'app_review' })
// resolution.test.ts: res_done (default completed), res_wontdo (default canceled), res_duplicate
expect(resolutionAfterTransition('started', 'completed', null, null, res)).toBe('res_done')
expect(resolutionAfterTransition('started', 'canceled', null, 'res_duplicate', res)).toBe('res_duplicate')
expect(resolutionAfterTransition('completed', 'unstarted', 'res_done', null, res)).toBeNull()
expect(resolutionAfterTransition('completed', 'completed', 'res_done', null, res)).toBe('res_done')
// filter.test.ts: today '2026-10-28', me 'u_mara'; web47 = assignee u_jonas, due 2026-10-31, started,
// urgent, labels [lb_forms, lb_production], values { customer: 'opt_nordlicht', effort: 3.5 }
expect(matchesFilter(web47, f({ field: 'assignee', op: 'in', value: ['me'] }), ctx)).toBe(false)
expect(matchesFilter(web47, f({ field: 'due_date', op: 'before', value: { relative: '+7d' } }), ctx)).toBe(true)
expect(matchesFilter(web47, f({ field: 'due_date', op: 'before', value: { relative: '+3d' } }), ctx)).toBe(false)
expect(matchesFilter(web47, f({ field: 'state_category', op: 'in', value: ['unstarted', 'started'] }), ctx)).toBe(true)
expect(matchesFilter(web47, f({ field: 'property:customer', op: 'in', value: ['opt_nordlicht'] }), ctx)).toBe(true)
expect(matchesFilter(web47, f({ field: 'property:effort', op: 'gt', value: 3 }), ctx)).toBe(true)
expect(matchesFilter(web47, f({ field: 'title', op: 'contains', value: 'KONTAKT' }), ctx)).toBe(true)
expect(matchesFilter(overdueStarted /* due 2026-10-27 */, f({ field: 'due_date', op: 'overdue' }), ctx)).toBe(true)
expect(matchesFilter(overdueDone, f({ field: 'due_date', op: 'overdue' }), ctx)).toBe(false)
expect(matchesFilter(epicWithoutCustomer, f({ field: 'property:customer', op: 'is_empty' }), ctx)).toBe(true)
expect(matchesFilter(web47, { version: 1, conditions: [] }, ctx)).toBe(true)
// grouping/board
expect(effectiveGroupBy('state', [webItem, appItem], i => i.project_id === 'p_app' ? 'wf_agency' : 'wf_standard')).toBe('category')
expect(dropTargetState(appTodoItem, { kind: 'category', category: 'completed' }, agency)).toBeNull()
expect(dropTargetState(appApprovalItem, { kind: 'category', category: 'completed' }, agency)).toBe('app_done')
expect(dropTargetState(webTodoItem, { kind: 'category', category: 'started' }, standard)).toBe('std_progress')
// recurrence: daily09 = { frequency: 'daily', interval: 1, time: '09:00', starts_on: '2026-01-01', ends: { type: 'never' }, paused: false }
expect(iso(nextOccurrences(daily09, new Date('2026-10-23T08:00:00Z'), 3, 'Europe/Berlin')))
  .toEqual(['2026-10-24T07:00:00.000Z', '2026-10-25T08:00:00.000Z', '2026-10-26T08:00:00.000Z'])
expect(iso(nextOccurrences(daily09, new Date('2027-03-27T09:00:00Z'), 2, 'Europe/Berlin')))
  .toEqual(['2027-03-28T07:00:00.000Z', '2027-03-29T07:00:00.000Z'])
expect(iso(nextOccurrences(weeklyMonThu09, new Date('2026-10-28T09:00:00Z'), 3, 'Europe/Berlin')))
  .toEqual(['2026-10-29T08:00:00.000Z', '2026-11-02T08:00:00.000Z', '2026-11-05T08:00:00.000Z'])
expect(iso(nextOccurrences(firstMonday09, new Date('2026-10-28T09:00:00Z'), 5, 'Europe/Berlin')))
  .toEqual(['2026-11-02T08:00:00.000Z', '2026-12-07T08:00:00.000Z', '2027-01-04T08:00:00.000Z', '2027-02-01T08:00:00.000Z', '2027-03-01T08:00:00.000Z'])
expect(iso(nextOccurrences(monthDay31at09, new Date('2026-10-28T09:00:00Z'), 3, 'Europe/Berlin')))
  .toEqual(['2026-10-31T08:00:00.000Z', '2026-11-30T08:00:00.000Z', '2026-12-31T08:00:00.000Z'])
expect(iso(nextOccurrences(everyOtherWed09 /* starts_on 2026-10-28 */, new Date('2026-10-28T09:00:00Z'), 2, 'Europe/Berlin')))
  .toEqual(['2026-11-11T08:00:00.000Z', '2026-11-25T08:00:00.000Z'])
expect(nextOccurrences({ ...daily09, ends: { type: 'count', count: 3 } }, new Date('2026-10-28T09:00:00Z'), 5, 'Europe/Berlin', 2)).toHaveLength(1)
expect(nextOccurrences({ ...daily09, paused: true }, new Date('2026-10-28T09:00:00Z'), 5, 'Europe/Berlin')).toEqual([])
expect(missedRunToCatchUp(daily09, new Date('2026-10-25T08:00:00Z'), new Date('2026-10-28T09:00:00Z'), 'Europe/Berlin')?.toISOString()).toBe('2026-10-28T08:00:00.000Z')
expect(missedRunToCatchUp(daily09, new Date('2026-10-28T08:00:00Z'), new Date('2026-10-28T09:00:00Z'), 'Europe/Berlin')).toBeNull()
// placeholders
expect(renderTitle('Monatsbericht {month_name} {year}', new Date('2026-11-02T08:00:00Z'), 'de', 'Europe/Berlin')).toBe('Monatsbericht November 2026')
expect(renderTitle('Wartung KW {week}', new Date('2026-10-29T08:00:00Z'), 'de', 'Europe/Berlin')).toBe('Wartung KW 44')
expect(renderTitle('Bericht {date} Q{quarter}/{month} {foo}', new Date('2026-11-02T08:00:00Z'), 'en', 'Europe/Berlin')).toBe('Bericht 2026-11-02 Q4/11 {foo}')
// progress, keys, rank
expect(childProgress([done, cancelled, inProgress, todo], cat)).toEqual({ done: 2, total: 4 })
expect(parseKey(' web-123 ')).toEqual({ identifier: 'WEB', number: 123 })
expect(parseKey('WEB123')).toBeNull(); expect(parseKey('W-1')).toBeNull()
// rank: 50 random inserts between neighbours stay strictly sorted and unique
```
- [ ] **Step 2: Laufen lassen.** `pnpm test src/domain` schlägt fehl, weil die Funktionen noch fehlen.
- [ ] **Step 3: Typen und Funktionen implementieren.**
  - Zeitpläne rechnen in der Ortszeit der Zeitzone. Jeder Kandidat wird über `Intl.DateTimeFormat(…, { timeZone })` in UTC umgerechnet.
  - `nth_weekday.n = -1` heißt der letzte Wochentag des Monats.
  - `month_day` über der Monatslänge wird auf den letzten Tag gekürzt.
  - `interval` bei wöchentlichen Plänen zählt Wochen ab der Woche von `starts_on`.
- [ ] **Step 4: Prüfen.** `pnpm test src/domain` ist grün, `pnpm typecheck` auch.
- [ ] **Step 5: Committen.** `feat(clickdummy): domain types and logic`

### Task 3: Fake-API, Seed-Daten, Hooks und Stores

**Files:**
- **Fake-API** in `src/api/`:
  - Basis: `client.ts` (Latenz, `maybeFail`, `ApiError`, `currentUserId`), `db.ts` (laden, speichern, migrieren, zurücksetzen), `seed.ts`
  - Ressourcen: `organization.ts`, `users.ts`, `tokens.ts`, `projects.ts`, `workflows.ts`, `workItemTypes.ts`, `properties.ts`, `catalog.ts` (Labels, Relationstypen, Resolutions), `workItems.ts`, `comments.ts`, `relations.ts`, `attachments.ts`, `views.ts`, `notifications.ts`, `pages.ts`, `templates.ts`, `automations.ts`, `webhooks.ts`, `system.ts`, `search.ts`, `live.ts`
- **Hooks** in `src/hooks/`: `keys.ts`, je Ressource eine Datei.
- **Stores** in `src/store/`: `ui.ts`, `session.ts`.
- **Tests:** `src/api/api.test.ts`, `src/hooks/hooks.test.tsx`.

**Interfaces:**
- Consumes: Typen und Domain aus Task 2.
- **Produces (API):** Jede Funktion ist async und wirft `ApiError`. Listen liefern `Page<T> { items: T[], next_cursor: string|null, total: number }` (`per_page` Standard 100). Die Namen spiegeln die Endpunkte aus Spec 6.1.
  - **Work Items:**
    - lesen: `listWorkItems({ view_id?, filter?, sort?, cursor?, per_page?, include_archived? })`, angewendet über `matchesFilter`/`sortItems` und den Scope der sichtbaren Projekte; `getWorkItem(keyOrId): WorkItemDetail` mit `{ item, type, state, workflow, children, relations: { relation, other, direction, hidden }[], attachments, subscribed }`. Auch Keys mit einer alten Projektkennung lösen auf.
    - anlegen: `createWorkItem({ project_id, type_id, title, description?, state_id?, ... })` → Nummer = höchste + 1, Status = Startstatus, ein anderer Status nur über `canTransition` vom Startstatus, sonst 409 `transition_not_allowed`; Pflicht-Properties fehlen → 422 `errors['values.<key>']`
    - ändern: `updateWorkItem(id, patch, { base_description_version? })` → 409 `description_conflict`; `transitionWorkItem(id, to_state_id, resolution_id?)` setzt `resolution_id`, `started_at`, `closed_at`; `bulkUpdateWorkItems(ids, patch)` → `{ updated: string[], rejected: { id, reason }[] }`; `changeWorkItemType(id, type_id, values)`
    - Archiv: `archiveWorkItem(id)` (nur geschlossene, sonst 409 `not_closed`), `restoreWorkItem(id)`, `deleteWorkItem(id)`
    - Beobachten: `setSubscribed(id, on)`
    - Aktivität: `listActivity(itemId)` → Kommentare und `ItemEvent`s gemischt
  - **Kommentare, Relationen, Anhänge:** `addComment`, `editComment`, `deleteComment`, `toggleReaction(commentId, emoji)`, `addRelation(source_id, type_id, target_id)`, `removeRelation(id)`, `uploadAttachment(project_id, file: File, owner|null, kind)` als Data-URL, `deleteAttachment(id)`.
  - **Projekte:** `listProjects`, `getProject(identifier)`, `createProject`, `updateProject` (Kennung ändern → alte Kennung bleibt als Alias), `archiveProject`, `deleteProject`, `joinProject`, `listMembers`, `addMember`, `updateMemberRole`, `removeMember`.
  - **Konfiguration:**
    - Workflows: `listWorkflows`, `saveWorkflow` (422 mit `validateWorkflow`-Codes), `deleteWorkflow` (409 `in_use`), `assignWorkflow(project_id, workflow_id, mapping)`
    - Typen, Properties, Kataloge: jeweils `list…`/`save…`/`delete…`, wobei benutzte Einträge archiviert werden
  - **Views:** `listViews`, `saveView`, `deleteView`, `toggleFavorite({ kind: 'view'|'project', id })`, `listFavorites`.
  - **Benachrichtigungen:** `listNotifications({ unread_only?, mentions_only? })`, `markRead(ids)`, `markAllRead`, `deleteNotification`, `getPreferences`, `savePreferences`.
  - **Wiki:**
    - `listPages(project_id)` als Baum, `getPage`
    - `savePage(id, { title, emoji, content, base_version })` → 409 `page_conflict` mit `{ current }`, wenn die Version abweicht
    - `movePage(id, parent_id, before_id)`, `deletePage(id)` (mit Teilbaum), `listPageVersions`, `restorePageVersion`
  - **Vorlagen und Automatisierungen:** `listTemplates`, `saveTemplate`, `deleteTemplate`, `runTemplateNow`, `listTemplateRuns`, `listAutomations(project_id)`, `saveAutomation`.
  - **Webhooks:** `listWebhooks`, `saveWebhook` (das Geheimnis kommt nur beim Anlegen oder Erneuern zurück), `deleteWebhook`, `listDeliveries`, `redeliver`, `pingWebhook`.
  - **Personen, Bots, Tokens:** `listUsers`, `inviteUser` → `{ link }`, `updateUserRole`, `deactivateUser` (409 `last_admin`), `reactivateUser`, `createBot`, `updateUser`, `listTokens(user_id)`, `createToken` → `{ token, plain_text }`, `revokeToken`.
  - **Organisation und System:** `getOrganization`, `updateOrganization`, `getSystemStatus`, `retryFailedJobs`, `sendTestMail`.
  - **Suche:** `search(q)` → `{ items, pages, projects, people, views }`, nur aus sichtbaren Projekten.
  - **Live:** `subscribeLive(cb: (e: { type: string, item_id?: string, actor_id: string }) => void): () => void`, `simulateRemoteChange()`, `setLiveConnected(on)`.
- **Produces (Hooks):**
  - Pro API-Funktion ein Hook: `listX` → `useXs(args)`, `getX` → `useX(id)`, Mutationen `useCreateX`, `useUpdateX` usw.
  - Query-Keys zentral als `qk.<resource>.all|list(args)|detail(id)`.
  - Item-Mutationen sind optimistisch (Liste und Detail) mit Rollback und Fehler-Toast „Erneut versuchen“.
- **Produces (Stores):**
  - `useSession`: `{ userId, setUserId }`, persistiert unter `werkbuch:session`.
  - `useUiStore`: `{ theme: 'system'|'light'|'dark', setTheme, sidebarCollapsed, toggleSidebar, paletteOpen, setPaletteOpen, peekItemId, openPeek(id|null), createOpen, openCreate(defaults?), selection: string[], setSelection, flashIds: string[], flash(id) }`; das Theme liegt unter `werkbuch:theme`.

**Seed** (`seed.ts`, alles fiktiv):
- **Organisation:** „Feldwerk“, locale `de`, Zeitzone `Europe/Berlin`, Woche ab Montag.
- **Personen:**

  | Person | Handle | Rolle |
  |---|---|---|
  | Mara Lindqvist | `mara` | Admin, angemeldet |
  | Jonas Feld | `jonas` | Member |
  | Ida Brenner | `ida` | Member |
  | Theo Okafor | `theo` | Member |
  | Lene Vogt | `lene` | Member |
  | Sven Albers | `sven` | Member, deaktiviert |

- **Bots:** „Automation“ (`automation`, Standard-Bot, Admin) und „Kira“ (`kira`, Agent, Member, Owner Mara).
- **Projekte:**

  | Projekt | Sichtbarkeit | Lead | Workflow | Typen | Mitglieder (Rolle) |
  |---|---|---|---|---|---|
  | WEB „Website-Relaunch“ | öffentlich | Ida | Standard | Task, Bug, Epic | Mara und Ida Admin, Jonas, Lene und Kira Member, Theo Viewer |
  | APP „Kunden-App“ | öffentlich | Theo | Agentur-Freigabe | Task, Bug, Epic, Kundenwunsch | Theo Admin, Mara, Jonas, Lene |
  | OPS „Infrastruktur“ | privat | Jonas | Standard | Task, Bug, Epic | Jonas Admin, Mara, Kira |

  Ida und Theo sind nicht in OPS. Das ist nötig für den Test zur Sichtbarkeit. Die beiden Workflows kommen aus `src/domain/fixtures.ts`, mit denselben IDs.
- **Typen:**

  | Typ | Ton | Icon | Properties |
  |---|---|---|---|
  | Task | sky | `square-check` | customer, effort |
  | Bug | ochre | `bug` | customer, environment (Pflicht), browser, steps |
  | Epic | moss | `zap`, `is_epic` | target_quarter, customer |
  | Kundenwunsch | plum | `message-square-heart` | customer (Pflicht), ticket_url, approved, reviewer |

- **Properties:**

  | Key | Label | Feldtyp und Werte |
  |---|---|---|
  | `customer` | Kunde | Dropdown: Studio Nordlicht, Hafenkontor, Gärtnerei Moos |
  | `effort` | Aufwand (h) | Number, 1 Nachkommastelle |
  | `environment` | Umgebung | Dropdown: Produktion, Staging, Lokal |
  | `browser` | Browser | Text |
  | `ticket_url` | Ticket beim Kunden | URL |
  | `approved` | Abgenommen | Boolean |
  | `reviewer` | Reviewer | Member |
  | `steps` | Schritte zum Nachstellen | Rich Text |
  | `target_quarter` | Zielquartal | Dropdown: Q4 2026, Q1 2027, Q2 2027 |

- **Kataloge:**
  - Labels: UX, Formulare, Produktion, Performance, SEO, Barrierefreiheit, Backend, Design.
  - Relationstypen: blockiert, Duplikat, verwandt, dazu eigener Typ „testet“ / „wird getestet von“.
  - Resolutions: Done (Standard für Completed), Won't do (Standard für Canceled), Duplicate, Cannot reproduce.
- **Items:** ungefähr 70 (WEB bis WEB-56, APP bis APP-24, OPS bis OPS-15), gestreute Daten.
  - Alle Items aus `prototypes/moodboards/README.md` mit genau diesen Keys, Feldern und Texten.
  - Dazu Eltern- und Kind-Beziehungen, Relationen, 3 archivierte Items, Kommentare und History an 15 Items, Anhänge an 3 Items.
- **Views:**

  | View | Filter | Darstellung |
  |---|---|---|
  | Fällig diese Woche | offen, due diese Woche | Liste nach Projekt |
  | Bugs in Produktion | Typ Bug, environment = Produktion | Board |
  | Für Kira | Assignee Kira | – |
  | Studio Nordlicht | customer | Tabelle |
  | Roadmap | – | Timeline |
  | Blockiert | blockiert | – |

  Maras Favoriten: Fällig diese Woche, Bugs in Produktion, Für Kira.
- **Wiki:**
  - WEB hat 12 Seiten in bis zu 3 Ebenen, darunter „Kontaktformular – Technik“ und „Seitenstruktur“.
  - „Seitenstruktur“ hat 3 Versionen und `simulate_conflict_once: true`, damit der erste Save einen Konflikt meldet.
  - APP hat 4 Seiten, OPS 3.
- **Vorlagen:**

  | Projekt | Vorlage | Zeitplan | Titel | Assignee und Fälligkeit |
  |---|---|---|---|---|
  | WEB | „Wöchentliche Wartung“ | wöchentlich Mo 09:00 | „Wartung KW {week}“ | Jonas, fällig nach 2 Tagen |
  | APP | „Monatsbericht“ | erster Montag 09:00 | „Monatsbericht {month_name} {year}“ | Theo |
  | OPS | „Zertifikate prüfen“ | 1. des Monats 07:00, pausiert | – | – |

  Ein Lauf der OPS-Vorlage ist gescheitert: „Pflicht-Property Umgebung fehlt“.
- **Automatisierungen:** WEB hat Auto-Archiv (30 Tage) und Assignee beim Start an, APP Auto-Close (90 Tage → Cancelled) und Eltern schließen.
- **Benachrichtigungen:** 14 für Mara, davon 3 ungelesen; Erwähnungen, Zuweisung, Kommentare, Statuswechsel, fällig, die gescheiterte Vorlage und ein abgeschalteter Webhook.
- **Webhooks:**
  - „Deploy-Bot“: Organisation, `work_item.state_changed`, aktiv.
  - „Kira-Agent“: Bot-Filter Kira, `bot.*`.
  - „Altes CRM“: Projekt APP, abgeschaltet nach 500ern und Timeouts.
  - Jeder Webhook hat Zustellungen.
- **Tokens:**
  - Mara: „Claude Code“ (`read`, `write`, `mcp`), „CI-Skript“ (`read`, abgelaufen).
  - Kira: „Agent“ (`read`, `write`, `mcp`).
- **System:** Version `0.1.0-dev`, 3 Jobs in der Queue, 2 fehlgeschlagen, Meilisearch ok, Mail konfiguriert.

- [ ] **Step 1: Failing tests schreiben** in `api.test.ts`. Jeder Test setzt die DB auf den Seed zurück, die Latenz ist 0.
  - `createWorkItem numbers per project and starts in the initial state`: Nächstes WEB-Item ist `WEB-57` im Status Backlog.
  - `createWorkItem directly in a non-initial state checks the transition`: APP mit `state_id: app_done` → `ApiError` 409 `transition_not_allowed`.
  - `createWorkItem without a required property fails`: APP, Typ Kundenwunsch ohne `customer` → 422, `errors['values.customer']` ist gesetzt.
  - `transitionWorkItem to Done sets resolution res_done and closed_at; reopening clears both`: an WEB-42.
  - `bulkUpdateWorkItems moves allowed items and reports the rest`: APP-Items in `app_review` und `app_todo` nach `app_approval` → `updated` enthält das Review-Item, `rejected` das Todo-Item mit `transition_not_allowed`.
  - `changeWorkItemType drops values the new type lacks`: Bug → Task entfernt `environment`, `browser` und `steps` und behält `customer`.
  - `archiveWorkItem refuses open items with 409 not_closed`.
  - `savePage with a stale base_version returns 409 page_conflict with the current page`.
  - `deactivateUser refuses the last active admin`: Mara deaktivieren, während sie die einzige Admin-Person ist → 409 `last_admin`; der Standard-Bot zählt nicht.
  - `search hides private projects from non-members`: Session als Ida, Suche „Mail-Limits“ → kein OPS-12.
  - `db falls back to the seed on an old schema_version or broken JSON` (Review Focus 1).
  - `maybeFail throws 503 simulated when api:fail is set`.
- [ ] **Step 2: Hook-Test schreiben** in `hooks.test.tsx` mit jsdom, `renderHook` und QueryClient:
  - `useUpdateWorkItem shows the change immediately and rolls back on failure` (Review Focus 5)
  - Dabei ist `api:fail` gesetzt. Erwartet: der Titel ist erst neu, danach wieder alt; `isPending` ist am Ende `false`; `toast` wurde mit der Aktion „Erneut versuchen“ aufgerufen.
- [ ] **Step 3: Laufen lassen.** Die Tests schlagen fehl.
- [ ] **Step 4: Bauen.**
  - API, Seed, Hooks und Stores umsetzen.
  - `live.ts` hält einen In-Memory-Bus. `simulateRemoteChange()` lässt Ida den Status oder die Priorität eines zufälligen WEB-Items ändern und schreibt ein Event.
- [ ] **Step 5: Prüfen.** `pnpm test && pnpm typecheck` sind grün.
- [ ] **Step 6: Committen.** `feat(clickdummy): fake API, seed data, hooks and stores`

### Task 4: Shell, Router, Tastatur, Befehlspalette, Auth-Screens, Rechte, Live

**Files:**
- Shell in `src/app/`: `App.tsx`, `router.tsx`, `Shell.tsx`, `Sidebar.tsx`, `ProfileMenu.tsx`, `LiveIndicator.tsx`, `PeekHost.tsx`, `CreateHost.tsx`.
- Bibliothek in `src/lib/`: `shortcuts/registry.ts`, `shortcuts/useShortcut.ts`, `shortcuts/HelpOverlay.tsx`, `commands.ts`, `permissions.ts`, `undo.ts` (`runWithUndo`), `clock.ts`.
- Features: `src/features/palette/*`, `src/features/auth/{Login,Invitation,ForgotPassword}.tsx`.
- Platzhalter `index.tsx` mit `EmptyState` „Kommt in Task N“ für jede Feature-Route.
- Tests: `src/lib/shortcuts/registry.test.ts`.

**Interfaces:**
- Consumes: Hooks und Stores aus Task 3, UI aus Task 1.
- **Produces (Routen, Feature-Einstieg, Task):**

  | Route | Feature-Einstieg | Task |
  |---|---|---|
  | `/login`, `/invitations/:token`, `/forgot-password` | `features/auth` | 4 |
  | `/my-items`, `/created`, `/subscribed`, `/views/:viewId`, `/projects/:identifier` | `features/items/routes.tsx` | 6 |
  | `/inbox` | `features/inbox` | 9 |
  | `/views` | `features/views-overview` | 9 |
  | `/projects` | `features/projects` | 9 |
  | `/items/:key` | `features/item-detail/ItemPage.tsx` | 8 |
  | `/projects/:identifier/wiki/:pageId?` | `features/wiki` | 10 |
  | `/projects/:identifier/templates/:templateId?` | `features/templates` | 10 |
  | `/projects/:identifier/settings/:section?` | `features/settings/project` | 12 |
  | `/settings/:section?` | `features/settings/org` | 11 |
  | `/me/:section?` | `features/settings/personal` | 12 |
  | `/_components` | – | 1 |

  `/` leitet auf `/my-items`. Unbekannte Keys und Routen zeigen eine 404-Seite im Stil des Leerzustands.
- **Produces (Funktionen und Komponenten):**
  - `registerShortcut({ id, keys, scope: 'global'|'list'|'detail'|'dialog', label, group, run, when? }): () => void`
  - `useShortcut(def, deps)`, `listShortcuts(): ShortcutDef[]`
  - Sequenzen wie `"g i"` mit 1000 ms Fenster; `mod` ist ⌘ auf dem Mac und Strg sonst.
  - `registerCommand({ id, label, group, keys?, run, when?, subpage? })` für die Palette. `subpage` rendert eine Unterliste in der Palette, z. B. die Statuswahl.
  - `usePermissions(): { can(p: Permission, projectId?: string): boolean, reason(p, projectId?): string|null }`. Die Rechte folgen Spec 4.3, z. B. `org.manage`, `org.manage_catalog`, `project.create`, `project.manage`, `item.create`, `item.edit`, `item.delete`, `item.comment`, `wiki.edit`, `template.manage`, `view.create`, `view.manage_any`.
  - `runWithUndo({ label, run, undo?, delay = 5000 })` zeigt den Toast und führt `run` erst bei Ablauf aus.
  - `PeekHost` rendert `features/item-detail/ItemPeek` (Platzhalter bis Task 8) für `useUiStore.peekItemId`.
  - `CreateHost` rendert `features/create-item/CreateItemDialog` (Platzhalter bis Task 8) für `createOpen`.

- [ ] **Step 1: Failing tests schreiben** in `registry.test.ts` (Review Focus 2):
  - `ignores single-key shortcuts while focus is in input, textarea or contenteditable`
  - `still runs mod+k, escape and mod+enter while typing`
  - `runs "g i" within 1000 ms and not after 1000 ms` (Fake-Timer)
  - `prefers the innermost active scope: dialog over detail over list over global`
- [ ] **Step 2: Laufen lassen.** Die Tests schlagen fehl.
- [ ] **Step 3: Register und Hooks bauen.** Danach sind die Tests grün.
- [ ] **Step 4: Shell bauen.**
  - **Seitenleiste:** Inbox mit Zähler, Meine Items, Views (Favoriten und „Alle Views“), Projekte (Favoriten mit Items, Wiki, Vorlagen, Einstellungen; „Alle Projekte“), unten Einstellungen und Profil. Einklappbar.
  - **Router:** Alle Routen aus der Tabelle, Platzhalter für die späteren Tasks.
  - **Hilfe:** `?` öffnet das Hilfe-Overlay, erzeugt aus `listShortcuts()`.
  - **Globale Kürzel:** `c` öffnet `openCreate`. `g i`, `g m`, `g v` und `g p` springen zu Inbox, Meine Items, Views und Projekten. `mod+k` öffnet die Palette. `mod+z` löst die Rückgängig-Aktion des jüngsten Toasts aus, solange er steht.
- [ ] **Step 5: Befehlspalette bauen.**
  - Transparentpapier mit Fokusfalle.
  - Suche über `useSearch`, Treffer gruppiert nach Aktionen, Items, Seiten, Projekten, Personen und Views.
  - Ein Key nach dem Muster `/^[A-Z][A-Z0-9]{1,9}-\d+$/i` springt direkt zum Item.
  - Navigationsbefehle und Theme-Befehle.
  - Leerer Zustand mit Tipps.
- [ ] **Step 6: Profilmenü bauen** mit diesen Einträgen:
  - Theme: System, Hell, Dunkel
  - „Als … ansehen“
  - „Live-Ereignis simulieren“, „Live-Verbindung trennen“
  - „Demo zurücksetzen“
  - „Abmelden“ führt auf `/login`
- [ ] **Step 7: Live-Anzeige und Auth-Screens bauen.**
  - `LiveIndicator`: Ist die Verbindung getrennt, erscheint ein Banner „Live-Updates pausiert – Änderungen anderer erscheinen erst nach dem Neuladen“ (Spec 14).
  - Kommt ein Live-Event, werden die Queries invalidiert und `flash(id)` hebt die Karte oder Zeile für 2 s hervor.
  - Auth-Screens: Login, Einladung annehmen (Name, Passwort) und Passwort vergessen. Jede Eingabe gilt als gültig.
- [ ] **Step 8: Prüfen.**
  - `pnpm shots / /inbox /settings /login` ausführen.
  - Dazu `pnpm shots --keys="Meta+K" /my-items` und `pnpm shots --keys="Shift+?" /my-items`.
  - Danach der Guidelines-Review.
- [ ] **Step 9: Committen.** `feat(clickdummy): app shell, shortcuts, command palette`

### Task 5: Feld-Editoren und Item-Bausteine

**Files:**
- Feld-Editoren in `src/components/fields/`: `StatePicker.tsx`, `ResolutionPrompt.tsx`, `AssigneePicker.tsx`, `PriorityPicker.tsx`, `LabelsPicker.tsx`, `DateField.tsx`, `TypePicker.tsx`, `ParentPicker.tsx`, `PropertyField.tsx` (alle acht Feldtypen), `commands.ts`.
- Item-Bausteine in `src/components/items/`: `ItemCard.tsx`, `ItemRowBase.tsx`, `ItemKey.tsx`, `BlockedHint.tsx`.
- Tests: `src/components/fields/fields.test.tsx`.
- Galerie `/_components` um einen Abschnitt „Felder“ erweitern.

**Interfaces:**
- **Produces (Picker):**
  - `StatePicker({ item, onDone? })` listet nur `allowedTargets` und fragt beim Wechsel nach Completed oder Canceled über `ResolutionPrompt` nach der Resolution.
  - `AssigneePicker({ item })`: nur Projektmitglieder, Bots erkennbar, „Mir zuweisen“ oben.
  - `PriorityPicker`, `LabelsPicker`, `DateField({ item, field: 'start_date'|'due_date' })`, `TypePicker({ item })` mit Wechseldialog (verlorene Werte und Pflichtfelder), `ParentPicker({ item })`.
  - `PropertyField({ item, property, required })` für alle Feldtypen; Rich Text bekommt hier vorerst eine einfache Textarea, den Editor liefert Task 8.
  - Alle Picker sind per Tastatur bedienbar und nutzen die Item-Mutationen aus Task 3.
- **Produces (Bausteine):**
  - `ItemCard({ item, compact?, onOpen })`: Karteikarte mit Reiter (Typ und Key), Titel, Chips, Avatar, Fälligkeit, Blockiert-Hinweis und Fortschritt bei Epics.
  - `ItemRowBase({ item, depth, fields: string[], onOpen })`.
- **Produces (Befehle):** `registerItemCommands()` meldet die Palette-Befehle für das ausgewählte Item bzw. die Auswahl an: Status, Assignee, Mir zuweisen, Priorität, Labels, Typ, Due-Date, Start-Date, Eltern, Archivieren, Löschen. Jeder Befehl hat seine Kürzel aus Spec 5.3.

- [ ] **Step 1: Failing tests schreiben** in `fields.test.tsx`:
  - `StatePicker on an APP item in app_todo offers only app_progress and app_cancelled`
  - `choosing Done asks for a resolution and preselects Done`
  - `PropertyField number keeps one decimal and rejects letters`
  - `TypePicker warns which values will be lost when Bug becomes Task`
- [ ] **Step 2: Laufen lassen** (FAIL), dann bauen, bis die Tests grün sind.
- [ ] **Step 3: Prüfen.**
  - `pnpm shots /_components` und `pnpm shots --keys="Meta+K" /my-items` ausführen.
  - Der Abschnitt „Felder“ der Galerie ist vollständig.
  - Danach der Guidelines-Review.
- [ ] **Step 4: Committen.** `feat(clickdummy): field editors and item building blocks`

### Task 6: Item-Listen: Filter, Anzeige, Liste, Tabelle, Mehrfachauswahl (Welle A)

**Files:**
- In `src/features/items/`:
  - Einstieg: `routes.tsx`, `ItemsScreen.tsx`, `viewState.ts`
  - Filter und Anzeige: `filter/FilterBar.tsx`, `filter/ConditionEditor.tsx`, `filter/fieldOps.ts`, `display/DisplayMenu.tsx`, `display/layouts.ts`
  - Layouts: `list/ListLayout.tsx`, `table/TableLayout.tsx`, `table/cells.tsx`
  - Auswahl: `selection/useSelection.ts`, `selection/BulkBar.tsx`
- Platzhalter für Task 7: `board/BoardLayout.tsx` und `timeline/TimelineLayout.tsx`.
- Test: `viewState.test.ts`.

**Interfaces:**
- Consumes: `useWorkItems`, `useViews`, `useSaveView` und die Domain-Funktionen `groupItems`/`effectiveGroupBy` aus den Tasks 2 und 3; `ItemRowBase` und die Picker aus Task 5.
- **Produces:**
  - `ItemsScreen({ preset: 'project'|'my'|'created'|'subscribed'|'view', projectIdentifier?, viewId? })`
  - `LayoutProps { items: WorkItem[], groups: Group[], display: Display, ctx: FilterContext, selection: string[], onSelect(ids), onOpen(id) }`
  - `layouts: Record<Display['layout'], ComponentType<LayoutProps>>`
  - `encodeViewState(state): string` und `decodeViewState(search: string): { filter, display }` für den URL-Zustand.

- [ ] **Step 1: Failing test schreiben** in `viewState.test.ts`:
  - `encode/decode round-trips filter and display`
  - `a view with changed filter reports unsaved changes`
- [ ] **Step 2: Laufen lassen** (FAIL), dann `viewState.ts` bauen, bis der Test grün ist.
- [ ] **Step 3: `ItemsScreen` bauen.**
  - Kopf mit Breadcrumb, Favoriten-Stern und Layout-Umschalter (`1`–`4`).
  - `FilterBar`: Bedingung hinzufügen mit `f`, Operatoren je Feldtyp, dynamische Werte (`me`, `today`, relativ, diese Woche, überfällig).
  - Anzeige-Menü für Gruppierung, Sortierung, Felder und Kind-Items.
  - Leiste „Ungespeicherte Änderungen“ mit Speichern, Als neue View und Verwerfen; Speichern nur mit dem Recht dazu.
- [ ] **Step 4: Listen-Layout bauen.**
  - Virtualisierte Liste (`@tanstack/react-virtual`), gruppiert und einklappbar, mit Anzahl je Gruppe.
  - Kind-Items eingerückt, Inline-Chips öffnen die Picker.
  - Bedienung mit `j`/`k`, Enter öffnet die Seite, Leertaste die Vorschau (`openPeek`).
- [ ] **Step 5: Tabellen-Layout bauen.**
  - Feste Kopfzeile und erste Spalte, Spaltenwahl mit Properties.
  - Zellen bearbeiten: Pfeiltasten wählen, Enter bearbeitet, Esc bricht ab.
- [ ] **Step 6: Auswahl und Mehrfachbearbeitung bauen.**
  - Auswahl mit `x`, `shift`-Bereichen und `mod+a`.
  - `BulkBar` ändert Status, Assignee, Priorität und Labels oder archiviert. Abgelehnte Items nennt ein Toast, die übrigen werden geändert.
- [ ] **Step 7: Leerzustände und Fehlerfall bauen.**
  - Leerzustände: Projekt ohne Items und View ohne Treffer (mit „Filter zurücksetzen“).
  - Fehlerzustand mit `api:fail`.
- [ ] **Step 8: Prüfen.**
  - `pnpm shots /projects/WEB /my-items /views/<id Studio Nordlicht> /views/<id Fällig diese Woche>`
  - Dazu einmal mit `api:fail`, eine leere View und ein Durchgang nur mit der Tastatur.
  - Danach der Guidelines-Review.
- [ ] **Step 9: Committen.** `feat(clickdummy): item lists with filters, list and table layouts, bulk edit`

### Task 7: Board und Timeline (Welle B, nach Task 6)

**Files:**
- `src/features/items/board/BoardLayout.tsx` und `BoardColumn.tsx`.
- `src/features/items/timeline/TimelineLayout.tsx` und `timelineScale.ts`.
- Test: `timeline/timelineScale.test.ts`.

**Interfaces:**
- Consumes: `LayoutProps` aus Task 6, `dropTargetState`, `rankBetween` und `effectiveGroupBy` aus Task 2, `ItemCard` aus Task 5, `useTransitionWorkItem` und `useUpdateWorkItem` aus Task 3.
- Produces: `dateToX(date, scale: { start: string, zoom: 'week'|'month'|'quarter', px_per_day: number }): number` und `xToDate(x, scale): string`.

- [ ] **Step 1: Failing tests schreiben** in `timelineScale.test.ts`:
  - `dateToX and xToDate round-trip at every zoom`
  - `month zoom with start 2026-09-01 places 2026-10-28 at 57 * px_per_day`
- [ ] **Step 2: Laufen lassen** (FAIL), dann bauen, bis die Tests grün sind.
- [ ] **Step 3: Board bauen.**
  - Spalten nach `effectiveGroupBy`. Bei gemischten Workflows gruppiert das Board nach Kategorie und zeigt einen Hinweis.
  - Ziehen mit dnd-kit:
    - Beim Ziehen sind unerlaubte Spalten gedimmt.
    - Ein Drop auf eine unerlaubte Spalte lässt die Karte zurückfedern, der Toast nennt den Grund (Review Focus 3).
    - Die Reihenfolge in der Spalte kommt über `rankBetween`.
  - Die Karte neigt sich beim Ziehen, wie in DESIGN.md beschrieben.
  - Schnellanlage oben in jeder Spalte, für andere Status mit Übergangsprüfung.
  - Tastatur:
    - Pfeiltasten wechseln zwischen Karten.
    - `shift+←/→` schiebt die Karte in die nächste erlaubte Spalte.
    - `s` öffnet den StatePicker.
- [ ] **Step 4: Timeline bauen.**
  - Nur Items von Typen mit `is_epic`, gruppiert nach Projekt.
  - Balken vom Start- bis zum Due-Date, Fortschritt über `childProgress`.
  - Ziehen verschiebt den Balken, Ziehen an den Kanten ändert die Dauer; per Tastatur mit `shift+←/→` (verschieben) und `alt+←/→` (Dauer).
  - Seitenliste „Ohne Datum“, von dort auf die Zeitachse ziehen.
  - Zoom Woche, Monat oder Quartal; Linie für heute.
- [ ] **Step 5: Prüfen.**
  - `pnpm shots /projects/WEB?layout=board /projects/APP?layout=board /views/<id Roadmap>`
  - Dazu ein unerlaubter Drop in APP von Todo nach Done, aufgenommen über einen kleinen Playwright-Aufruf in `scripts/` oder manuell im MCP-Browser.
  - Danach der Guidelines-Review.
- [ ] **Step 6: Committen.** `feat(clickdummy): board with transition-aware drag and drop, epic timeline`

### Task 8: Item-Detail, Anlegen-Dialog, Editor (Welle A)

**Files:**
- `src/features/item-detail/`: `ItemPeek.tsx`, `ItemPage.tsx`, `ItemHeader.tsx`, `FieldsPanel.tsx`, `Relations.tsx`, `Children.tsx`, `Attachments.tsx`, `Activity.tsx`, `CommentComposer.tsx`.
- `src/features/create-item/CreateItemDialog.tsx`.
- `src/features/editor/`: `RichTextEditor.tsx`, `presets.ts`, `mentions.tsx`, `slashMenu.tsx`, `pasteImages.ts`.
- Test: `src/features/editor/editor.test.tsx`.

**Interfaces:**
- Consumes: Hooks aus Task 3, Picker und `PropertyField` aus Task 5, `runWithUndo` und Host-Komponenten aus Task 4.
- Produces:
  - `RichTextEditor({ value: RichText|null, onChange(v), preset: 'comment'|'description'|'page', projectId: string, placeholder?: string, onSubmit?(), autoFocus? })`.
  - **Erwähnungen:** `@` sucht Personen und Bots des Projekts, `#` sucht Items und Seiten.
  - **Bilder:** Einfügen und Ablegen laden über `uploadAttachment` hoch, mit Platzhalter und Fortschritt.
  - **Slash-Menü:** `/` öffnet es mit Überschrift, Liste, Checkliste, Code, Zitat, Tabelle (nur Preset `page`) und Bild.
  - `ItemPeek({ itemId })` und `ItemPage()` teilen sich alle Bausteine.

- [ ] **Step 1: Failing tests schreiben** in `editor.test.tsx` (jsdom):
  - `typing "@ma" lists Mara Lindqvist and inserts a mention node with id u_mara`
  - `pasting an image file inserts an image node whose attachment id comes from uploadAttachment`
  - `mod+enter calls onSubmit and does not insert a line break`
- [ ] **Step 2: Laufen lassen** (FAIL), dann den Editor bauen, bis die Tests grün sind.
- [ ] **Step 3: Item-Detail bauen.**
  - **Kopf:** Reiter mit Typ und Key, Breadcrumb, Aktionen (Link kopieren, als Seite öffnen, Menü).
  - **Titel:** inline bearbeitbar (`e`).
  - **Felder-Panel:** Picker aus Task 5 und alle Properties des Typs; Pflichtfelder ohne Wert zeigen einen Hinweis.
  - **Blockiert-Hinweis** direkt unter dem Titel.
  - **Relationen:** hinzufügen mit `r`, Typwahl einschließlich „testet“, verborgene Items als „verborgenes Item“.
  - **Kinder** mit Fortschritt.
  - **Anhänge:** Dateiliste mit Hochladen und Löschen mit Rückgängig.
  - **Beschreibung:** mit Konfliktwarnung. Simuliert über einen zweiten Save mit veraltetem `base_description_version`; es gibt die Wahl „Neu laden“ oder „Meine Fassung übernehmen“.
- [ ] **Step 4: Aktivität bauen.**
  - Zeitleiste aus Kommentaren und Events, Filter Alles, Kommentare, Änderungen.
  - Events derselben Person innerhalb von 5 Minuten werden zusammengefasst.
  - Der Bot „Automation“ ist erkennbar, Gründe der Automatisierungen stehen dabei.
  - **Kommentare:** schreiben (`m`, absenden mit `mod+enter`), bearbeiten (Hinweis „bearbeitet“), löschen mit Rückgängig, Emoji-Reaktionen.
  - Beobachten-Schalter.
  - Archivieren nur für geschlossene Items. Löschen mit Rückgängig, nur mit `item.delete`.
- [ ] **Step 5: Anlegen-Dialog bauen** (`c`).
  - Felder: Projekt, Typ, Titel, Beschreibung, Properties des Typs, Vorlage anwenden.
  - Pflichtfelder sind markiert, die API-Fehler erscheinen am jeweiligen Feld.
  - „Weitere anlegen“ hält den Dialog offen. Absenden mit `mod+enter`.
- [ ] **Step 6: Prüfen.**
  - `pnpm shots /items/WEB-47 /items/WEB-30`
  - Dazu die Vorschau über `/projects/WEB` mit `--keys="j,Space"`, den Dialog mit `--keys="c"` und `api:fail` beim Kommentieren.
  - Danach der Guidelines-Review.
- [ ] **Step 7: Committen.** `feat(clickdummy): item detail, create dialog and rich text editor`

### Task 9: Inbox, Views-Übersicht, Projekte (Welle A)

**Files:**
- `src/features/inbox/`: `InboxScreen.tsx`, `NotificationRow.tsx`.
- `src/features/views-overview/ViewsScreen.tsx`.
- `src/features/projects/`: `ProjectsScreen.tsx`, `CreateProjectDialog.tsx`.
- Test: `src/features/projects/identifier.test.ts`.

**Interfaces:**
- Consumes: Hooks aus Task 3, `openPeek` aus `useUiStore`; `ItemPeek` liefert Task 8, bis dahin der Platzhalter.
- Produces: `suggestIdentifier(name: string, taken: string[]): string`.
  - Umlaute werden umgeschrieben (Ä → AE, Ö → OE, Ü → UE, ß → SS), dann in Großbuchstaben gesetzt; die Wörter trennt alles außer Buchstaben und Ziffern.
  - Kandidaten in dieser Reihenfolge; der erste, der nicht vergeben ist, gewinnt:
    1. die ersten 3 Zeichen des ersten Wortes
    2. die ersten 2 Zeichen des ersten Wortes und das erste des zweiten Wortes
    3. die Anfangsbuchstaben aller Wörter, mindestens 2
    4. Kandidat 1 mit angehängter Ziffer 2 bis 9

- [ ] **Step 1: Failing test schreiben** in `identifier.test.ts`:
  - `suggestIdentifier('Website-Relaunch', []) === 'WEB'`
  - `suggestIdentifier('Website-Relaunch', ['WEB']) === 'WER'`
  - `suggestIdentifier('Ärzte-Portal', []) === 'AER'`
- [ ] **Step 2: Laufen lassen** (FAIL), dann bauen, bis der Test grün ist.
- [ ] **Step 3: Inbox bauen.**
  - Benachrichtigungen gruppiert nach Item, Filter „Ungelesen“ und „Erwähnungen“.
  - Tastatur: `j`/`k` wählen, `e` markiert gelesen, `shift+e` markiert alle gelesen, `#` löscht mit Rückgängig, Enter öffnet die Vorschau.
  - Live-Zähler über `simulateRemoteChange`. Leerzustand „Inbox ist leer“.
- [ ] **Step 4: Views-Übersicht bauen.**
  - Alle Team-Views mit Ersteller, Darstellung und Stern für Favoriten.
  - Aktionen: duplizieren, löschen (Ersteller oder Admin, sonst gesperrt mit Grund), neue View.
- [ ] **Step 5: Projekte-Übersicht bauen.**
  - Karten mit Bild bzw. Initialen, Lead, Sichtbarkeit und offenen Items.
  - „Beitreten“ bei öffentlichen Projekten.
  - Dialog „Neues Projekt“: Name, Kennung mit Vorschlag, Sichtbarkeit, Workflow, Typen.
- [ ] **Step 6: Prüfen.**
  - `pnpm shots /inbox /views /projects`
  - Dazu als Ida (Member) und mit `api:fail`.
  - Danach der Guidelines-Review.
- [ ] **Step 7: Committen.** `feat(clickdummy): inbox, views overview and projects`

### Task 10: Wiki und Vorlagen (Welle B, nach Task 8)

**Files:**
- `src/features/wiki/`: `WikiScreen.tsx`, `PageTree.tsx`, `PageView.tsx`, `ConflictBanner.tsx`, `VersionsDialog.tsx`, `MovePageDialog.tsx`.
- `src/features/templates/`: `TemplatesScreen.tsx`, `TemplateEditor.tsx`, `ScheduleEditor.tsx`, `RunLog.tsx`.
- Test: `src/features/templates/scheduleText.test.ts`.

**Interfaces:**
- Consumes: `RichTextEditor` aus Task 8, `nextOccurrences` und `renderTitle` aus Task 2, Hooks aus Task 3.
- Produces: `describeSchedule(s: Schedule): string` als deutscher Satz.

- [ ] **Step 1: Failing tests schreiben** in `scheduleText.test.ts`:
  - `describeSchedule(firstMonday09) === 'Jeden ersten Montag im Monat um 09:00'`
  - `describeSchedule(everyOtherWed09) === 'Alle 2 Wochen am Mittwoch um 09:00'`
  - `describeSchedule(monthDay31at09) === 'Monatlich am 31. (oder letzten Tag) um 09:00'`
- [ ] **Step 2: Laufen lassen** (FAIL), dann bauen, bis die Tests grün sind.
- [ ] **Step 3: Wiki bauen.**
  - Seitenbaum per Drag & Drop umsortierbar, mit der Tastatur über den Dialog „Verschieben nach …“.
  - Seite mit Emoji-Titel und vollem Editor (Preset `page`); Autosave zeigt „Gespeichert vor …“.
  - Konfliktbanner bei 409, testbar mit „Seitenstruktur“: „Neu laden“ oder „Meine Fassung übernehmen“.
  - Versionen ansehen und wiederherstellen.
  - Löschen mit Teilbaum: zuerst nennen, wie viele Seiten mitgelöscht werden, dann mit Rückgängig.
- [ ] **Step 4: Vorlagen bauen.**
  - Liste mit dem nächsten Termin.
  - Editor mit den Feldern der Vorlage, Platzhalter-Hilfe und Live-Vorschau des Titels über `renderTitle`.
  - Zeitplan-Editor für Frequenz, Intervall, Wochentage, Monatstag oder n-ten Wochentag, Uhrzeit, Beginn, Ende und Pause.
  - Die nächsten 5 Termine über `nextOccurrences`.
  - „Jetzt ausführen“ (Toast mit Link zum neuen Item). Lauf-Protokoll mit dem gescheiterten Lauf.
- [ ] **Step 5: Prüfen.**
  - `pnpm shots /projects/WEB/wiki /projects/WEB/wiki/<id Seitenstruktur> /projects/APP/templates /projects/APP/templates/<id Monatsbericht>`
  - Dazu den Konflikt auslösen.
  - Danach der Guidelines-Review.
- [ ] **Step 6: Committen.** `feat(clickdummy): wiki with versions and conflicts, templates with schedules`

### Task 11: Einstellungen der Organisation (Welle A)

**Files:**
- `src/features/settings/org/`: `OrgSettings.tsx` (Unternavigation), `General.tsx`, `People.tsx`, `Bots.tsx`, `Workflows.tsx`, `WorkflowEditor.tsx`, `TransitionMatrix.tsx`, `StateMappingDialog.tsx`, `Types.tsx`, `Properties.tsx`, `Labels.tsx`, `RelationTypes.tsx`, `Resolutions.tsx`, `Webhooks.tsx`, `WebhookDeliveries.tsx`, `System.tsx`.
- Test: `src/features/settings/org/matrix.test.tsx`.

**Interfaces:**
- Consumes: `validateWorkflow`, `canTransition` und die Hooks aus Task 3.
- Produces: keine gemeinsamen Exporte.

- [ ] **Step 1: Failing tests schreiben** in `matrix.test.tsx`:
  - `toggling a matrix cell with the keyboard (arrow keys + space) adds and removes the transition`
  - `removing the last transition into Review shows "Review ist vom Startstatus aus nicht erreichbar"`
- [ ] **Step 2: Laufen lassen** (FAIL), dann bauen, bis die Tests grün sind.
- [ ] **Step 3: Allgemein, Personen und Bots bauen.**
  - **Allgemein:** Name, Logo, Sprache, Zeitzone, Wochenbeginn.
  - **Personen:**
    - Liste mit Rolle, Status und Einladungen.
    - Der Dialog „Einladen“ zeigt am Ende einen kopierbaren Link.
    - Rolle ändern; Deaktivieren und Reaktivieren, mit 409 `last_admin` als Meldung.
  - **Bots:**
    - Der Standard-Bot trägt ein Abzeichen und lässt sich nicht löschen.
    - Tokens mit Fähigkeiten; der Klartext erscheint einmal, beim Standard-Bot mit Warnung zu den Admin-Rechten.
- [ ] **Step 4: Workflows bauen.**
  - Liste mit Nutzung je Projekt.
  - **Editor:**
    - Status mit Name, Icon und Kategorie, sortierbar; Startstatus wählbar.
    - Schalter „frei“; sonst eine Übergangsmatrix, bedienbar per Tastatur.
    - Fehlerliste aus `validateWorkflow`.
  - Wird ein benutzter Status gelöscht, öffnet sich `StateMappingDialog`.
- [ ] **Step 5: Typen, Properties und Kataloge bauen.**
  - **Typen:** Icon, Ton, Epic-Häkchen, zugeordnete Properties mit Pflicht und Reihenfolge.
  - **Properties:** acht Feldtypen; Optionen mit Farbe, archivierbar; der Schlüssel ist nach dem Anlegen gesperrt.
  - **Labels, Relationstypen, Resolutions:** jeweils mit Standard-Markierung.
- [ ] **Step 6: Webhooks und System bauen.**
  - **Webhooks:**
    - Liste mit Status; der abgeschaltete Webhook ist deutlich markiert und lässt sich wieder aktivieren.
    - Formular mit Ereignisbaum, Geltungsbereich und Bot-Filter; das Geheimnis wird einmal angezeigt.
    - Zustellprotokoll mit Status, Dauer und Antwortausschnitt, dazu „erneut senden“ und Test-Ping.
  - **System:** Version, Queue, fehlgeschlagene Jobs mit „erneut versuchen“, Meilisearch, Testmail.
- [ ] **Step 7: Prüfen.**
  - `pnpm shots` für `/settings` und jede einzelne Section.
  - Dazu als Jonas (Member): Er bekommt die Meldung „Nur für Admins“.
  - Danach der Guidelines-Review.
- [ ] **Step 8: Committen.** `feat(clickdummy): organization settings`

### Task 12: Projekt- und persönliche Einstellungen (Welle A)

**Files:**
- `src/features/settings/project/`: `ProjectSettings.tsx`, `General.tsx`, `Members.tsx`, `Workflow.tsx`, `Types.tsx`, `Automations.tsx`, `DangerZone.tsx`.
- `src/features/settings/personal/`: `PersonalSettings.tsx`, `Profile.tsx`, `Security.tsx`, `Notifications.tsx`, `ApiAndMcp.tsx`.
- Test: `src/features/settings/personal/snippets.test.ts`.

**Interfaces:**
- Consumes: Hooks aus Task 3.
- Produces: `mcpSnippets(baseUrl: string, token: string): { claude_code: string, codex: string, json: string }`.

- [ ] **Step 1: Failing test schreiben** in `snippets.test.ts`:
  - `mcpSnippets('https://werkbuch.example.com', 'wb_xxx').claude_code === 'claude mcp add --transport http werkbuch https://werkbuch.example.com/mcp --header "Authorization: Bearer wb_xxx"'`
  - Das JSON-Snippet hat `url` und `headers.Authorization`.
- [ ] **Step 2: Laufen lassen** (FAIL), dann bauen, bis der Test grün ist.
- [ ] **Step 3: Projekt-Einstellungen bauen.**
  - **Allgemein:** Name, Kennung (beim Ändern ein Hinweis, dass alte Keys weiter funktionieren), Beschreibung, Bild, Lead, Sichtbarkeit.
  - **Mitglieder:** Personen und Bots mit Rollen.
  - **Workflow:** wechseln mit Zuordnungsdialog.
  - **Typen:** aktivieren und Standardtyp wählen.
  - **Automatisierungen:** vier Schalter mit Parametern; Auto-Close wählt einen Canceled-Status.
  - **Gefahrenzone:** archivieren; löschen erst nach Eintippen der Kennung.
- [ ] **Step 4: Persönliche Einstellungen bauen.**
  - **Profil:** Name, Handle, Avatar, Sprache, Zeitzone.
  - **Sicherheit:** Passwort ändern; 2FA einrichten mit QR-Attrappe, Code-Eingabe und Recovery-Codes.
  - **Benachrichtigungen:** Matrix aus Ereignissen und Kanälen, Standardwerte aus Spec 4.14.
  - **API & MCP:** Tokens verwalten; Einrichtungs-Snippets mit Kopieren.
- [ ] **Step 5: Prüfen.**
  - `pnpm shots` für alle Sections; als Theo prüfen, dass APP-Admin-Funktionen sichtbar sind, WEB nur lesend.
  - Danach der Guidelines-Review.
- [ ] **Step 6: Committen.** `feat(clickdummy): project and personal settings`

### Task 13: Durchgang, Flows, Feinschliff, Review-Build

**Files:**
- Flows: `e2e/flows.spec.ts`, `playwright.config.ts` (webServer `pnpm dev`).
- Review-Build: `scripts/artifact.mjs`, schreibt die gebaute `index.html` von `dist-review/` in ein Fragment um.
- Ändern: `vite.config.ts` (`build:review`: `base: './'`, `VITE_ROUTER=hash` → `HashRouter`), `README.md`, `.github/workflows/tests.yml` (neuer Job `clickdummy-e2e`, kein Pflicht-Check) und Aufräumarbeiten in allen Ordnern.

**Interfaces:**
- Consumes: alles.

- [ ] **Step 1: Flows schreiben** in `flows.spec.ts`; alle Schritte nur mit der Tastatur, außer dem Ziehen. Die Flows decken Spec 1, Erfolgskriterien 2–6 ab.
  1. `mod+k`, „kontakt“ tippen, Enter öffnet WEB-47. `s` → Done, die Resolution Done ist vorbelegt, Enter. Der Status ist Done.
  2. Ein APP-Board-Item von Todo auf Done ziehen. Die Karte bleibt in Todo, ein Toast meldet „nicht erlaubt“.
  3. `c` in APP, Typ Kundenwunsch ohne Kunde → Fehler am Feld. Kunde wählen, `mod+enter` → neues APP-25 in Backlog.
  4. Im Kommentar `@ma` tippen, Enter, `mod+enter`. Der Kommentar enthält eine Erwähnung von Mara.
  5. Die Seite „Seitenstruktur“ bearbeiten → Konfliktbanner. „Meine Fassung übernehmen“ → die Versionsliste hat einen Eintrag mehr.
  6. Vorlage „Monatsbericht“: Die Vorschau zeigt 02.11.2026, 07.12.2026, 04.01.2027, 01.02.2027 und 01.03.2027.
  7. Workflow „Agentur-Freigabe“: Den letzten Übergang nach Review entfernen → Fehlermeldung „nicht erreichbar“.
- [ ] **Step 2: Laufen lassen.** `pnpm e2e` schlägt anfangs dort fehl, wo noch Lücken sind. Die Lücken schließen, bis alles grün ist.
- [ ] **Step 3: Gesamtdurchgang mit Screenshots.**
  - `pnpm shots` über alle Routen, hell und dunkel, 1440/768/390.
  - Konsistenz prüfen: Abstände, Radien, Glas, Fokus, Leer- und Fehlerzustände.
  - Den Guidelines-Review über `src/` laufen lassen und alle MUST- und NEVER-Befunde fixen.
  - Feature-lokale Duplikate in die gemeinsamen Schichten ziehen.
- [ ] **Step 4: Review-Build bauen.**
  - `pnpm build:review && node scripts/artifact.mjs`
  - Ergebnis: `dist-review/index.html` beginnt mit `<title>werkbuch Klickdummy</title>`; `<html>`, `<head>` und `<body>` sind entfernt.
  - Der Orchestrator veröffentlicht das Ergebnis als privates Artifact mit `files` für `assets/`.
- [ ] **Step 5: README aktualisieren und Abweichungen festhalten.**
  - README mit Routen, Kürzeln, Demo-Rollen und Review-Build.
  - Abschnitt „Abweichungen von der Spec“: Status-Icons, zusätzliche Typ-Töne und alles Weitere aus den Tasks.
- [ ] **Step 6: Prüfen und committen.**
  - `pnpm typecheck && pnpm test && pnpm build && pnpm e2e` sind grün.
  - Commit `feat(clickdummy): flows, polish and review build`.
