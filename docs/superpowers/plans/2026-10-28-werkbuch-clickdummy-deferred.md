# Klickdummy: zurückgestellte Befunde

Rohliste für 13b (Aufräumen) und 13c (Feinschliff) nach der Korrekturrunde, siehe R32 in `2026-10-28-werkbuch-clickdummy-rulings.md`.

- Die Zeilen stammen wörtlich aus dem Ledger der Umsetzung und sind deshalb Englisch. Datei- und Zeilenangaben beziehen sich auf den Stand ihres Tasks.
- Einen Teil haben 13a, 13d und die Fix-Welle nach dem Gesamt-Review schon erledigt. Welche, steht in der Triage am Ende (Stand 2026-10-29: „DONE“ = erledigt, „CAN WAIT“ = offen für 13b/13c).
- Vor 13b und 13c jeden Punkt gegen den Code prüfen.
- Die Kurzfassung des offenen Rests steht im README des Klickdummys unter „Bekannte Punkte nach der Korrekturrunde“.

## Aus den Tasks 1–12

- Task 1: minor (deferred): Calendar stale moveFocus flag pulls focus after no-op goTo (Calendar.tsx:63-82,166-170)
- Task 1: minor (deferred): EmojiPicker regex has literal U+FE0F/U+200D, rejects flags/keycaps (EmojiPicker.tsx:21)
- Task 1: minor (deferred): gallery prints token identifiers in UI text; ProgressBar/Calendar numbers without Intl
- Task 1: minor (deferred): DESIGN.md lacks decision lines for pending spinner and 16 px mobile inputs
- Task 1: minor (deferred): tests missing for toast pause/push-out, Calendar math/keyboard, Kbd sequences/non-Mac
- Task 1: minor (deferred): 500 kB chunk warning in CI logs; vite.config.ts and shots.mjs outside tsc; Textarea resize-none without field-sizing fallback; components-gallery.tsx 1103 lines
- Task 1: minor (deferred): error toasts use role=alert (assertive) without recorded deviation
- Task 1: minor (deferred): gallery useState initializer reads window.matchMedia (jsdom lacks it) (components-gallery.tsx:462)
- Task 1: minor (deferred): Select/Combobox spread all rest props onto DOM though types declare only aria-label (Select.tsx:46, Combobox.tsx:68)
- Task 1: minor (deferred): phone width keeps gallery submenu popup closed (components-gallery.tsx:462,516)
- Task 1: minor (deferred, out of scope): bare Input/Textarea wrap in Field only when error appears → live region created with error, remount loses focus (Input.tsx:23-28, Textarea.tsx:24-29) — relevant if later tasks add bare inputs with inline validation
- Task 2: minor (deferred): recurrence interval has no upper bound (1e9 throws RangeError); missedRunToCatchUp does not guard invalid lastRunAt (recurrence.ts:51,213)
- Task 2: minor (deferred, record in spec 12 later): {week}/{month} zero-padded (KW 05); same-category drop keeps status; type lacking property never matches incl. is_not/is_empty; interval weeks count from Monday regardless of week_start
- Task 2: minor (deferred): duplicated categoryOf helpers in tests; filter.test.ts:359 weak; sortItems hard-codes 'de' collator; Page.simulate_conflict_once prototype flag on API type
- Task 2: minor (deferred): filter.ts:54 new Date() on timestamps without Z reads host zone (all model timestamps carry Z) — document "timestamps carry Z"
- Task 2: minor (deferred): fixture ops12 in std_progress while moodboard shows OPS-12 Todo — Task 3 seed follows the moodboard
- Task 3: minor (deferred, fix in Task 13 as API owner): creating an item in a non-initial state skips move effects (no state_changed history, no assign-on-start, no close-parent) (itemRules.ts:197,357,358) — visible in board quick-add (Task 7)
- Task 3: minor (deferred, fix in Task 13): no notifications for type change, relations, attachments (spec 4.14 "sonstige Änderungen"); failed-template notifications bypass preferences (templates.ts:152)
- Task 3: minor (deferred): bulk {archived:true, priority} patches then rejects not_closed; {archived:false} restores before a refused patch (workItems.ts:221-228)
- Task 3: minor (deferred): unknown resolution_id: transition silently defaults, update returns 422 (workItems.ts:194, itemRules.ts:390)
- Task 3: minor (deferred): createBot id from mutable handle can collide (users.ts:140)
- Task 3: minor (deferred): optimistic archived_at uses new Date() not clock now() (hooks/workItems.ts:176,196)
- Task 3: minor (deferred): mutation.ts:9 comment wrong (pending lasts through refetch); live test leaves listener, resetApi doesn't reset connected; useResetDemo test checks only session; itemRules.ts 532 lines, api.test.ts 977 lines (seed-fact tests belong in seed test)
- Task 3: minor (deferred, Task 13): listNotifications filters only by recipient → removed members keep notifications with private item ids
- Task 3: minor (deferred): deleted partner items render as "verborgenes Item" in relation history; relation event shape changed without SCHEMA_VERSION bump (old-shape events render hidden)
- Task 3: minor (deferred, Task 8 must respect): removeRelation checks visibility/role against the source project only → Ida gets 404 removing inward hidden rel_1; Task 8 must not offer "remove" on hidden relation entries
- Task 3: minor (deferred): optimistic updates with a former project identifier don't match cache until reload
- Task 4: minor (deferred): keyboard checks for palette/drawer/peek focus return only in uncommitted scripts; no palette component test; event.code fallback untested
- Task 4: minor (deferred): Sidebar.tsx 409 lines with 15 components
- Task 4: minor (deferred): stale comments say only list/detail pause under dialogs (registry.ts:256-259, useShortcut.ts:38, Dialog.tsx:26, Shell.tsx:27); held g cancels g i (registry.ts:137,169); no tests for createItem guard, palette when, li structure
- Task 4: minor (deferred): md breakpoint helper duplicated with opposite matchMedia defaults (bindings.tsx:42, PeekHost.tsx:26); mobile top bar reachable beside preview, panel is aside not role=dialog
- Task 5: minor (deferred, Task 13): gallery FieldsSection opens 8 comboboxes by default → hides gallery from AT/axe; commands.ts 688 lines (split, keep re-export entry); test gaps (assignee filtering, type-change 422, date refusal)
- Task 5: minor (deferred, Task 13): item.parent loading toast for multi-target / cross-project cursor; catalog error keeps ready=false forever (commands.ts:488,544,585,780)
- Task 5: minor (deferred, Task 13): "0.500" parses as 500 (leading 0 group) (PropertyField.tsx:59); retry only if first failure transient (commands.ts:439-448); rich text normalisation of empty paragraphs/consecutive hardBreaks; no multi-item partial-failure test; no tests for findings 6–11
- Task 5: minor (deferred, Task 13): gallery DateField specimen defaultOpen holds a dialog layer → shortcuts paused on /_components
- Task 6: implementer DONE_WITH_CONCERNS, commit dcef6bb on worktree-agent-aa97be4f79f25088e (452 tests; only src/features/items). Extra files SaveView.tsx, display/grouping.ts, GroupIcon.tsx + 2 tests; 12 shared-layer gaps for Task 13 (lists max 100 items/no paging hook, no "beobachtet" filter field → "Beobachtet" not savable as view, duplicated helpers). Decisions: bulk bar replaces filter bar; click → preview, Enter → page; children nest only within own group; built-in lists: only filter changes count as unsaved; LayoutProps also has onPeek; grouped table group toggles extra Tab stops. Scratchpad shared between parallel agents (one overwrote another's helper).
- Task 9: minor (deferred, Task 13): double mod+enter submits twice (CreateProjectDialog.tsx:76,229-238; ViewDialog.tsx:39,114-125); inbox hint text wrong for read items (InboxScreen.tsx:510); "Alle als gelesen" in filter hits hidden entries without hint/test; no test for repeat:true; projects "Du liest nur mit." wrong for org admins (ProjectsScreen.tsx:94), members error shows Beitreten; item load errors always "gibt es nicht mehr"; row actions not tabbable, generic names, no palette commands; InboxScreen.tsx 544 lines; FavoriteStar belongs to components (imported across features); duplicated ?create=1 effect and dialog error pattern; ViewDialog doesn't clear field errors on change
- Task 6: minor (deferred, Task 13): 100-item cap truncates (counts/⌘A/x of N mean first 100; Beobachtet narrows client-side after cap) — fetch further cursor pages; focus lost when focused row scrolls out (rangeExtractor); grid group toggles extra Tab stops, list aria-setsize counts headings; filter draft dropped via operator menu; number "zwischen" chip removed on tab (ConditionEditor.tsx:447); display-only changes on built-in lists can't become view; skeleton shape same for all layouts; refetch errors replace filled list (use isLoadingError); `c` on Meine Items drops assignee default; read-only cells Enter no feedback; StickyToolbar stale top; decodeViewState returns patch (record in contract); duplication list/table helpers; ItemsScreen.tsx 698 lines; untested built-in filter-only rule and useSelection hook
- Task 11: minor (deferred, Task 13): secret kept in SecretDialog ref/mutation observers after display; Escape/outside click closes one-time secret dialog (needs shared Dialog option); 422 non-name swallowed in WorkflowEditor.tsx:384; truncated divider lines (WorkflowEditor.tsx:544, WebhookDeliveries.tsx:135); Bots/People text instead of skeleton; RelationTypes empty state without next action; renew drops form edits (Webhooks.tsx:101); member ?workflow=new empty form; STATE_ICONS and errors duplicated; three Usage components; WorkflowEditor.tsx 637 lines; promotion candidates FormDialog/CopyField/Sortable/parts.tsx; weak test assertions; curated 45 time zones (consider searchable combobox over Intl.supportedValuesOf)
- Task 9: fix round 1 implemented (commit f175f56, 562 tests); dialogs submit once (double mod+enter fixed too). Note for Task 13: toast.ts ends the undo toast when three newer toasts arrive (any screen). Re-review dispatched.
- Task 12: minor (deferred, Task 13): non-text controls use disabled (dimmed, unfocusable) instead of DESIGN.md:175 read-only look; recovery codes/setup key kept after confirm; token plain text in mutation cache 5 min (gcTime 0); one-time secrets close on Esc/outside click, no guard on codes step; Auto-Close reason not linked to disabled switch; username input type=hidden; focusNeighbour fails on last row; nav list role; silent 422 for undrawn fields; Members empty state without action; tests (readSquareImage, guard outside General); local duplicates (without, NumberFormat, read-only class, date formatter); 2FA state memory-only; profile avatar only in profile (shared Avatar ignores avatar_url)
- Task 9: minor (deferred, Task 13): ViewsScreen saved() navigates after unmount (theoretical); ViewDialog [errors] focus effect like old finding 4; send guard resets before dialog exit animation; per-call callback pattern also in components/fields/commands.ts (169, 205, 233) and app/ProfileMenu.tsx:69,88 → check in Task 13; other success toasts after delete can still push undo out
- Task 8: minor (deferred, Task 13): attachment registry stand-in (needs getAttachment API); "verborgenes Item" on 5xx (Activity.tsx:90-94); create dialog stale server error message and field errors under grid; viewers offered image upload; hard-coded Europe/Berlin (FieldsPanel.tsx:33, ItemHeader.tsx:494); file sizes CreateItemDialog 858/Activity 683/ItemHeader 523 lines; orphaned uploads after editor unmount; mentions only explicit members (Automation not mentionable); Task 10 tests must await preloadEditor()
- Task 6: minor (deferred, Task 13): phone sticky toolbar filter + wrapping bulk bar ~140–180 px (no shot); Safari jump on first selection; data-driven empty list not announced, identical messages not re-announced; row aria-label hides status/priority/assignee on landing; test nits; stale first-round report sections (bulk bar replaces filter bar) — don't copy into DESIGN/spec
- Task 12: minor (deferred, Task 13): Automations committing ref compares by value (45,46,45 within latency → double save); Escape during workflow switch → focus to blocked trigger → body
- Task 11: minor (deferred, Task 13): sortable.test Alt/Meta assertions combined (assert per key); TransitionMatrix effect depends on [states] new array each render; matrix.test uses node readFileSync (use ?raw); text.test source scan line-based; right-edge focus ring may clip (scroll-pr-2)
- Task 8: minor (deferred, Task 13): CreateForm swaps form for error/skeleton on catalog refetch failure → draft dropped silently; closing create dialog while pending parks a draft though item is created (no toast); kept stale item during outage not marked
- Task 8: minor (deferred, Task 13): stale-retry guard covers only one request ordering (deps [stored, item.updated_at] fixes it); failedSends records non-transient failures, never pruned; remote value equal to failed text treated stale; save.current used before declaration (FieldsPanel.tsx:84)
- Task 8: minor (deferred, Task 13, visible bug): Attachments.tsx:79-88 multi-file upload uses per-call mutate callbacks → first file's progress row stays forever, only last toast; Activity.tsx:395 reactions toggle loses earlier error toasts; mentions isHidden duplicates isGone
- Task 7: minor (deferred, Task 13): split BoardLayout.tsx (939 lines) / TimelineLayout.tsx (929); test gaps (pointer drops, ⌥↑/⌥↓, ResolutionPrompt cancel, focus after 1–4); equal ranks across projects fallback (rules.ts:139-141); timeline drags no Escape cancel, plan-drag window listeners survive unmount; Task 6 list-shaped Suspense fallback for board/timeline
- Rafael correction round: today chip in night theme uses yellow surface (moodboard) vs DESIGN.md glowing text
- Task 7: minor (deferred, Task 13): following not re-armed after server re-sort; nits (shadowed place, stale comment, createElement vs JSX, justDropped before declaration, header lacks palette commands); no tests for board command gating; layouts.ts:32 contract text should mention layout actions (R30)
- Task 10: minor (deferred, Task 13): tree.ts:123 doc/test mismatch for drops below collapsed page; 8 px depth threshold twitchy; saved time aria-hidden; duplicate watchLostFocus (WikiScreen.tsx:79, TemplateEditor.tsx:84); template property editors outside UploadOwnerContext; drag overlay default drop animation (DESIGN spring); test gaps (failed save keeps draft, typing during save); TemplateEditor 803 / PageView 604 lines (autosave hook)
- Task 10: minor (deferred, 13b/c): success-path page cache write can overwrite newer refetched page (guard by version, PageView.tsx:334); blanking only the title then leaving saves unchanged content (PageView.tsx:297-318); TemplateEditor mod+enter handler lacks event.repeat guard; „Meine Fassung übernehmen“ after undone reload overwrites own newer save without version (design limit); reviewer's collapsed.test.tsx still failing (doc/test mismatch, deferred)

## Aus 13a, 13d und dem Gesamt-Review

- Task 13a: minor (deferred): "Mehr laden" last-page focus lands on list tab stop (not first new row); disabledReason dev warning; lead notified twice on create in later state; linkAttachments has no uploader check (note for PHP port); abandoned comment draft leaves unowned uploads without cleanup; refusal dedupe ignores waiting toasts (BoardLayout.tsx:142, TimelineLayout.tsx:350); tests for ImageView states, page upload ownership
- Task 13a: minor (deferred): ungrouped board single column counts loaded only (footer discloses); table header allSelected vs loaded; grouped-count test asserts board only; mentions.tsx:228 comment
- Task 13d: minor (deferred → final review triage): table in-cell pickers ~24 px on phones (Picker.tsx:53 bare min-h-6, cells.tsx) inside 44 px rows — rules.md:16 MUST; listed again in README „Bekannte Punkte“ since the final fix wave; DESIGN.md:177 made list chips display-only on phones for this reason
- Final review: minor (deferred → 13b): move the spec 4.11 rules into src/domain/ (effectiveGrouping in features/items/display/grouping.ts, nearestAllowed/checkMove in features/items/board/rules.ts, the canonical filter comparison in viewState.ts) so the port list is the folder; add a cross-feature keyboard guard test (per route, with and without the preview: no key with two active winners in different features unless intended)
- Final review: minor (deferred → 13c): search stale ≤10 s after comments, template runs, new projects, renamed views or people (invalidate qk.search there too); template-command and `c` refusal toasts for viewers without a next step; `pnpm shots --keys` can press keys before data has loaded (wait for content in scripts/shots.mjs)
- Final review fix wave: minor (deferred → 13b): retry-all refetches inactive failed queries too (retry.ts:12, `type: 'active'` would do); previewKeysAct name plural after R40 and a fourth copy of the neutral-focus test (useSelection.ts:54, BoardLayout.tsx:162, TimelineLayout.tsx:100); ErrorState is the first data-layer import in components/ui; inline „Erneut versuchen“ in pickers/dialogs/panels retry only their own query; Sidebar SectionError refetches both queries of a section.

## Aus Korrekturrunde 1 (2026-10-29)

- Correction round 1: minor (deferred → 13c): the inbox header count can briefly show one too few after a read mark (`countUnread` mixes the unread-count query with the list's read state; store per mark whether the row was unread, drop the mark once the count query has reloaded)
- Correction round 1: minor (deferred → 13b): move the inbox read marks (`Mark`, `countUnread`, `inTurn`, `setRead`) out of `InboxScreen.tsx` (711 lines) into a `useReadMarks` hook
- Correction round 1: minor (deferred → 13c): „Kind-Item anlegen …“ in the item menu refuses with a toast because the menu has no disabled entry with a reason; `t` in a list before the project's items have loaded goes straight to the server, which refuses with a named toast
- Correction round 1: question for Rafael: a board column for every epic, so an epic's first child can be quick-added there (needs `quickAddFor` to take the project from the epic, `BoardLayout.tsx:742`)
- Correction round 1 part 2: minor (deferred → 13c): ⇧P can still be one render behind while a preview is open on a cross-project board (moving the cursor from a WEB to an APP card keeps WEB's items loaded → „Einen Moment“); notify the `targetSnapshot` listeners after a mount updates `latestOptions`, or keep the list cursor in `useUiStore` (`components/fields/commands.ts:705-718`, `:821`; `ItemsScreen.tsx:437-441`)
- Correction round 1 part 2: minor (deferred → 13b): the gallery hard-codes the bot word instead of `botWord` (`routes/components-gallery.tsx:112-113`); dead `?? 'Bot'` fallback at `Bots.tsx:404`; code comment at `Bots.tsx:2` still says "an agent"
- Correction round 1 part 2: minor (deferred → 13c): `ItemCard` hides the epic crumb from assistive tech and relies on the caller to add „Teil von …“ to the card's name (the board does, the gallery specimen does not); let `ItemCard` add it itself when `showParent` is on

## Aus der App (Phase 5, 2026-11-02)

- Phase 5, Task 22: minor (deferred → 13c): die Palette-Befehle `projects.create` („Neues Projekt“ auf `/projects`) und `views.create` („Neue View“ auf `/views`) des Klickdummys (`ProjectsScreen.tsx:229`, `ViewsScreen.tsx:157`) fehlen in der App; „Projekt anlegen“ und „View anlegen“ gehen über die Seitenleiste und die Knöpfe der Seiten. Beim Port: `useCommand` mit `when` = Recht da, `run` öffnet den Dialog wie `?create=1`.

### Finale Fix-Welle der Phase 5 (2026-11-02)

Minors des Final-Reviews, die laut Triage warten (deferred → 13c); Phase-Carries stehen in den Rulings unter „Für spätere Phasen vorgemerkt“.

- T2-M1: `DisplaySchema::read` fällt bei einem gespeicherten `fields`, das keine Liste ist, auf `[]` (nackte Zeilen); die Standardfelder des Klickdummys (`DEFAULT_FIELDS`) wären der bessere Rückfall (nur kaputte gespeicherte Daten).
- T2-M2: `FilterSchema` prüft „leerer Text“ nur mit ASCII-`trim`: ein Wert aus NBSP oder ideografischen Leerzeichen gilt als Text (`preg_match('/^[\s\p{Z}]*\z/u', …)`).
- T3-M2: die `scoped` `CatalogProperties` werden in einem Request bzw. Pest-Test nach `SaveProperty`/`DeleteProperty` nicht vergessen; heute speichert und liest kein Pfad im selben Request (bei Bedarf als Fallstrick oder `forgetInstance`).
- T5-M3: Items einer Seite von `ItemOrder::page` tragen die Attribute `sort_0`, `sort_1`, `_sig`; ein `save()` auf ihnen scheiterte an unbekannten Spalten (die Resource zählt ihre Felder einzeln auf, es leckt nichts).
- T5-M4: der Docblock von `ItemOrder::placeholder()` überzeichnet den Grund des Casts (er ist rein defensiv).
- T5-M5: `ItemOrder::ALIASES` begrenzt still auf zwei Wertschlüssel; eine Sortierung mit dreien liefe auf „undefined array key“ (Kommentar oder `sort_{$index}`).
- T7-M1/M3/M4/M7: Hygiene und Lesbarkeit der Tests von `ItemQueryInput`/`QueryWorkItems` (Mutationstabelle nachträglich, `sort_*`/`_sig` nur über `save()` eine Falle, wie T5-M3).
- T8-M7: Eltern-Gruppen ordnen nach `identifier`, dann `number`; der Klickdummy vergleicht Keys mit `Intl.Collator({numeric: true})` (`A2-1` vor `A10-1`), Randfall.
- T10-M1/M5/M6: Namen und Kommentare in `domain/` (`sortItems`-Testname umbenannt; `placeItems` sagt „zuletzt gecacht“, gewinnt tut der spätere Eintrag in `served`).
- T10-M4: `assignBlocker` verpackt `edit`/`assign` doppelt (fertiger Satz als `:reason`), funktioniert.
- T11-M6: `DateField` verliert beim Tausch `ReadOnlyTrigger` ↔ `DatePopover` (Rechte kommen nach) kurz den Fokus (`swap` des Pickers wiederverwenden).
- T11-M7/M8: Testzweige: „Ziel gewählt (outward), dann Art auf `:in`“ in `Relations` und der Rückweg Picker → nur lesen mit fokussiertem Picker (`fields.test.tsx`).
- T12-M5/M6: `items.test.tsx` prüft die Datums-Chips über einen losen Regex; `ItemRowBase.onOpen` ist Pflicht, wird aber nur mit `cursor` benutzt.
- T13-M4: `ListLayout` `rangeExtractor` hält nur die erste Zeile des Cursor-Items gerendert: ein per Pfeil fokussierter Gruppenkopf bzw. die zweite Zeile eines Items mit zwei Labels verliert beim Rad-Scrollen den Fokus.
- T14-M3: `useListState` `onSuccess` löscht `pending` nicht, wenn der Server eine Adresse mit anderen Zustandsparametern liefert (kaum erreichbar).
- T14-M4: `ListError retrying={false}` fest: „Erneut versuchen“ zeigt nie, dass es läuft.
- T14-M5/M7: `useListState` erfindet für `view` ohne View still eine Projektbasis (unerreichbar); `useListData(_, _, _options)` ungenutzt.
- T15-M6: der Bereich der `item.*`-Kürzel kommt vom Mount (`list`), der Katalog nennt `detail` (heute ohne Kollision; in der Tastatur-Doku klären).
- T15-M8: `archiveManyWithUndo` setzt optimistisch `archived_at` auch bei offenen sichtbaren Zielen, bis das Nachladen es zurücknimmt (nur die geschlossenen senden, die offenen gleich als `not_closed` nennen).
- T16-M2: Filter-Chips nennen ein deaktiviertes Konto oder einen Status eines gerade ungenutzten Workflows „Verborgen“, obwohl beide lesbar sind (P21 meint unbekannte IDs).
- T16-M4: × an einem Chip mit getipptem Text ändert die Adresse zweimal (Blur übernimmt erst den Text), eine überflüssige Anfrage; der Endstand stimmt.
- T16-M5: ein Ladefehler der Properties macht gültige Property-Chips zu „Unbekanntes Feld“ (besser: Chip mit Ladefehler und „Erneut versuchen“; die Liste schickt die Bedingung unverändert, getestet).
- T16-M6: kein Test geht den Datums-Popover des Filters mit der Tastatur (Schnellauswahl, Abstand, Kalender).
- T17-M3/M7: kurze falsche Sätze beim Laden: eine gültige Property-Sortierung heißt „Unbekanntes Feld“, solange die Properties laden; ein Org-Admin sieht kurz den Ersteller-Satz, solange die Rechte laden.
- T17-M4: `copyName` (K26) liegt im Bildschirm, T22 braucht dieselbe Regel; neben `VIEW_NAME_MAX` exportieren.
- T17-M5: ein echter Satz statt eines Musters im Test der gesperrten Speicherung.
- T17-M8/R1: `savableDisplay` mit `properties === undefined` behält eine Sortierung auf eine gelöschte Property (422 beim Speichern, Randfall); Kosmetik aus der Nachprüfung.
- T18-M3: `useFocusRescue` wartet bis zu 300 Frames auf jedes `[data-skeleton]` des Bildschirms, nicht nur auf das Skelett des Layouts.
- T18-M5: das lazy Board hat keine Fehlergrenze (gleiches Muster wie die lazy Dialoge): ein gescheiterter Chunk wirft bis zur nächsten Error-Boundary.
- T19-M3: die Schnellanlage in einer Spalte mit weiteren Seiten gibt Sehenden keine sichtbare Rückmeldung, wo das neue Item steht.
- T19-M5/M7: `drag.test.tsx` prüft beim Ablegen zwischen gleichen Rängen nur `'a2' < rank`, nicht die Stelle danach; `SortableContext` in `BoardColumn` nicht eingerückt.
- T20-M2: `startEditing` wiederholt `useEditReason` von Hand, `PropertyCell` `typeHasProperty` (kleine Helfer ohne Hook teilen).
- T20-M3: `focusAt` fokussiert immer erst im nächsten Frame: gehaltene Pfeile bzw. zwei Drücke im selben Frame verlieren Schritte.
- T20-M5: die Ablehnung einer Property-Zelle lebt im Zustand der Zelle und geht beim Wegscrollen verloren.
- T20-M6: Texte der Tabelle: `items.table.read_only.project` „… in der Tabelle nicht ändern“ suggeriert einen anderen Weg; `items.table.edit_hint*` „Esc bricht ab“ (das erste Esc nimmt nur das Getippte zurück) und ⌘↵ fest im Text.
- T20-M7: `table.test.tsx` prüft den Grund eines Viewers mit `/nur lesen|lesen/` statt mit dem ganzen Satz.
- T20-M9: mit dem Zeiger auf einem Steuerelement einer Zelle tun ↑/↓/←/→ nichts (j/k gehen).
- T20-M10: schließt das Popover einer getippten Zelle per Klick daneben mit unlesbarem Text, ist der Text still weg.
- T21-M5: eine leere Timeline wegen eines Filters bietet kein „Filter zurücksetzen“.
- T21-M6: kein Test für die Ablehnung eines Datums durch den Server auf der Timeline (Rollback des Balkens).
- T23-M6: Kleinkram in den Tests der Zählungen (`rowOf2` doppelt, die Projektkarte prüft „dann die Zahl“ nicht, kein Fall für 0 in der Bestätigung).
- T23-M7: `useSaveWorkItemType` macht `qk.workItems` nicht ungültig, die Property-Zählung hängt an den Typen (auf demselben Bildschirm unkritisch).
- T23-M8: jede Zeile hat beim Laden ihre eigene `role="status"`-Region (viele Ansagen); ein Status je Liste.
- T24-M3/M4: `ViewsSeederTest` vergleicht von der Darstellung nur `layout` (nicht Bedingungswerte, `group_by`, `sort`, `fields`, `created_at`); `FavoritesSeeder` liest den Ersteller über `ViewsSeeder::CREATORS`.
- T25-M1/M2/M4/M5/M6: `views-acceptance.spec.ts` kopiert `typeId`, `stateId`, `shown`, `range` aus `timeline.spec.ts`, überschattet `shown` lokal und wählt Text per `selectText()` statt per Tastatur; im `ViewsAcceptanceTest` fragt der `$item`-Closure den Typ doppelt, und die Timeline-Verknüpfung View-Filter ∧ Epic belegt nur e2e.

## Triage im Gesamt-Review (2026-10-29)

Aus dem Bericht des Gesamt-Reviews. „MUST FIX NOW“ war keiner der Punkte; die zwei neuen wichtigen Befunde des Reviews (`e` in der Inbox, „Vorlage anwenden“) sind behoben.

Judged against the brief's rule: MUST FIX NOW only for what would mislead or spoil the human's click-through (visible bug, data loss, broken keyboard path, a11y blocker, wrong German text).

- Task 1 group (Calendar stale moveFocus, EmojiPicker regex, gallery token text, DESIGN decision lines, missing component tests, chunk warning, role=alert deviation, gallery matchMedia, Select/Combobox rest props, phone gallery popup, bare Input remount): CAN WAIT (13b/13c). The role=alert point is already resolved (toasts are polite, README says so).
- Task 2 group (recurrence interval bound, week zero-padding and other precisions, duplicated test helpers, 'de' collator, timestamps carry Z, ops12 fixture): CAN WAIT; the precisions belong in the spec addendum after the round.
- Task 3: create in a non-initial state skips move effects: DONE in 13a (`itemRules.ts:createItem` ends in `moveItem`). No notifications for type change/relations/attachments: partly done (type change notifies, `workItems.ts:changeWorkItemType`); relations and attachments CAN WAIT. Bulk `{archived, priority}` ordering, unknown resolution_id: DONE (checks precede changes, `checkResolution`). createBot id collision, optimistic `archived_at` clock (DONE, uses `now()`), comment nits, file sizes: CAN WAIT. listNotifications visibility: DONE (`stillVisible`). Relation history shape, hidden inward relation remove (Relations.tsx offers no remove on hidden entries: DONE), former identifier in optimistic matches: CAN WAIT.
- Task 4 group (uncommitted keyboard checks, Sidebar size, stale comments, held `g`, md helper duplicated, mobile top bar beside the preview, aside not role=dialog): CAN WAIT. The mobile top bar point is a small a11y gap, not a blocker (the preview takes focus and `main` is inert).
- Task 5 group (gallery comboboxes, commands.ts size, test gaps, parent loading toast, catalog error ready=false (DONE: `failedCatalogs`), „0.500“ parsing (the field explains the comma, „3.5“ is refused with guidance, not misread), retry policy, rich-text normalisation): CAN WAIT.
- Task 6 implementer concerns (100-item cap: DONE via `useInfiniteWorkItems`; „Beobachtet“ not savable: documented; duplicated helpers): CAN WAIT.
- Task 6 minors (focus lost when the focused row scrolls out, grid toggle tab stops, filter draft lost via operator menu, „zwischen“ chip on Tab, display-only changes on built-in lists not savable, same skeleton for all layouts, refetch error replaces a filled list, `c` on Meine Items without assignee default, read-only cells silent on Enter, StickyToolbar top, phone bulk bar height, Safari jump, empty-list announcement, row aria-label): CAN WAIT; all are listed in README „Bekannte Punkte“ or are invisible with the seed.
- Task 9 (double mod+enter: DONE; inbox hint for read items: no longer present, `readCurrent` returns silently; „Alle als gelesen“ hits hidden entries; „Du liest nur mit.“ for org admins (only shows for a non-member admin, not with the seed); members error shows Beitreten; item load errors „gibt es nicht mehr“; row actions not tabbable (keys `e`/`#` exist); file sizes; FavoriteStar placement; ViewDialog errors): CAN WAIT.
- Task 11 (secret in refs, Esc on one-time dialogs: DONE via `confirmClose`; 422 non-name swallowed in WorkflowEditor; truncated dividers; text instead of skeleton; RelationTypes empty state; renew drops form edits; member `?workflow=new`; duplicates; test nits; 45 time zones): CAN WAIT. „Renew drops form edits“ loses unsaved edits on a secondary screen only when renewing mid-edit; note it in README if 13c slips.
- Task 12 (disabled instead of read-only look, codes kept after confirm, token in mutation cache (DONE: gcTime 0), one-time secrets guard (token DONE; 2FA codes step still unguarded), Auto-Close reason link, username type=hidden, focusNeighbour on last row, nav list role, silent 422 for undrawn fields, Members empty state, tests, duplicates, 2FA memory-only (documented), avatar only in profile, Automations double save edge, Escape during workflow switch): CAN WAIT.
- Task 7 (file sizes, test gaps, equal ranks across projects, timeline drag without Esc, plan-drag listeners, list-shaped fallback, following after server re-sort, nits, no gating tests, layouts.ts contract text): CAN WAIT.
- Task 8 (attachment registry stand-in, „verborgenes Item“ on 5xx, stale create-dialog errors, viewers offered upload, hard-coded Europe/Berlin, file sizes, orphaned uploads, mentions only members, CreateForm drops the draft on catalog refetch failure (api:fail only), closing while pending parks a draft (needs closing within the 150–450 ms latency), stale-retry guard, failedSends pruning, multi-file upload progress (DONE: `useSettle` in Attachments.tsx:75), reactions toast, isHidden duplicate): CAN WAIT.
- Task 10 (tree.ts doc/test mismatch, 8 px threshold (README question), saved time aria-hidden, duplicate watchLostFocus, template editors outside UploadOwnerContext, drop animation, test gaps, file sizes, page cache write by version, blank title then leave, mod+enter repeat guard in a field (registry already drops auto-repeat for the shortcut; only the in-field handler lacks it), „Meine Fassung übernehmen“ after undone reload): CAN WAIT.
- Rafael's question (today chip in the night theme): a question for the round, nothing to fix.
- Task 13a (last-page focus, disabledReason warning, lead notified twice, linkAttachments uploader check (PHP note), unowned uploads, refusal dedupe vs waiting toasts, ImageView/upload tests, ungrouped board counts, table header allSelected, tests, comment): CAN WAIT; all documented in README.
- Task 13d (README „replaces“ wording: DONE; `TimelineLayout.tsx:345` comment stale; `review.spec.ts` import alias; CI step name): CAN WAIT.
- Task 13d phone table pickers: CAN WAIT for the fix, but list it again in README „Bekannte Punkte“ (Minor 4 above).

Marked MUST FIX NOW: 0. Nothing on the deferred list spoils the correction round; the two Important findings above are new.
