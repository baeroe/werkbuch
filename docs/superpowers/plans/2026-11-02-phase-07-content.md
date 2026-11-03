# Phase 7: Editor, Kommentare, Anhänge – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rich Text vollständig machen: eigene Knoten in `Document` für Erwähnung (`@handle`), Verweis auf Items (Seiten ab Phase 9), Bild und Datei (`attachment:<ulid>`) mit Rundreise Markdown ↔ JSON und HTML für Mails; Kommentare mit Bearbeiten („bearbeitet“, alte Fassung in der History), Löschen und Reaktionen; Anhänge (`attachments` mit medialibrary, `inline` und `file`, Auslieferung mit Leserecht, Vorschaubilder in der Queue `media`, Aufräumen); automatisches Beobachten beim Kommentieren und Erwähnen, `bot.mentioned` als Event; Kommentare im Suchindex. Im Browser: der Editor komplett (`/`-Menü, Code mit Hervorhebung, `@`, `#`, Bilder und Dateien per Einfügen, Ziehen und Auswahl mit Fortschritt), Kommentar-Composer (`m`), Aktivität mit Kommentaren und Filter, Dateiliste mit Rückgängig, Uploads im Anlegen-Dialog; dazu die Überträge aus den Phasen 4–6.

**Architecture:** `App\RichText\Document` bleibt rein (kein `DB`, keine Actions): es liest und schreibt die neuen Knoten strukturell und nennt seine Fakten (`mentionedUserIds()`, `attachmentIds()`, `itemRefs()`, `pageRefs()`). Was ein Knoten **bedeutet** (darf der Schreiber diese Person erwähnen, sieht er dieses Item, gehört der Anhang zum Projekt), entscheidet `App\Support\RichTextRules` beim Speichern über die Schnittstelle `App\RichText\RichTextLookup` (Umsetzung `App\Support\RichTextLookups` mit `Visibility` und `Assignable`): Unerlaubtes wird Text, ein fremder Anhang ist eine 422. Gelesen wird pro Leser: `loadForResource` lädt Keys und Handles der Knoten mit fester Zahl Abfragen und gibt sie dem Markdown (`RichTextNames`); die JSON-Form nennt nur IDs (Verweise ohne Beschriftung), der Browser löst sie über `GET /api/v1/references` auf. Kommentare sind eine eigene Tabelle mit eigenen Actions; ihre Events tragen das **Item** als Subjekt (`meta.comment_id`), damit History, Suche, Benachrichtigungen (Phase 8) und Live-Kanäle (Phase 8) am Item hängen. Anhänge sind Datensätze mit genau einer medialibrary-Datei; die Auslieferung läuft wie `/media` über eine Web-Route mit `auth:sanctum` und prüft das Leserecht am Besitzer. Dateien gehen immer erst nach dem Commit.

**Tech Stack:** wie Phase 6, dazu die Tiptap-Erweiterungen `@tiptap/extension-mention`, `@tiptap/suggestion`, `@tiptap/extension-code-block-lowlight`, `@tiptap/extension-image`, `@tiptap/extension-file-handler` (je genau 3.32.0 wie `@tiptap/core`), `lowlight` 3.3.0 und `highlight.js` 11.11.2 (Task 15). Keine neuen Composer-Pakete. Versionen unter „Paketversionen“.

**Spec:** `docs/superpowers/specs/2026-10-28-werkbuch-design.md` (1 Erfolgskriterien 2.4 (Teil Erwähnung), 5, 6; 4.2 Bots (`bot.mentioned`); 4.3 Rechte „kommentieren, reagieren, beobachten“; 4.10 komplett; 4.14 (was Phase 8 aus den Events liest); 4.16 komplett; 4.17 Kommentare im Index; 5.1 Handy „kommentieren“; 5.3 `M`, ⌘⏎; 6.1 Kommentare, Reaktionen, Anhänge, 413; 6.3 `comment.*`, `bot.mentioned`; 7.2 Queue `media`, Aufräumen; 7.4 `comments`, `comment_reactions`, `attachments`; 7.5 Uploads; 10 Doku „Konzepte“), Master-Plan `docs/superpowers/plans/2026-10-30-werkbuch-app.md` (Global Constraints, Review Focus 5 „Markdown von außen“, Verträge „Rich Text“, „Resources“, „Events und Outbox“, Phase 7), Rulings `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md` (A26, A39, A106, A113, A121, A149–A154, A199–A226; „Für spätere Phasen vorgemerkt“, Zeile Phase 7 → Tasks 1–4, 13, 15–19), Ledger `.superpowers/sdd/2026-10-30-werkbuch-app/progress.md` (Übertrag Phase 5 → 7 „T6-M2“ → Task 2; neue Gate-Regel → „Gates“), Klickdummy `prototypes/clickdummy/{README.md,DESIGN.md}` und `src/{api/{comments,attachments,workItems}.ts,hooks/{comments,attachments}.ts,features/editor/**,features/item-detail/{Activity,CommentComposer,Attachments,Description}.tsx,lib/richtext.ts,components/ui/EmojiPicker.tsx,api/seed/{activity,files,items}.ts}`, Aufräumliste `docs/superpowers/plans/2026-10-28-werkbuch-clickdummy-deferred.md` (13c: „linkAttachments has no uploader check“ → Task 8; „abandoned comment draft leaves unowned uploads“, „orphaned uploads after editor unmount“ → Tasks 17, 18; „viewers offered image upload“ → A234/Task 17; „Activity.tsx:395 reactions toggle loses earlier error toasts“, „mentions isHidden duplicates isGone“ → Tasks 16, 19; „multi-file upload progress“ → Task 20; Master-Plan: „Entwurf nach fehlgeschlagenem Speichern, Tippen während des Speicherns“ → Task 18).

---

## Global Constraints

Es gelten alle Global Constraints des Master-Plans und alle Regeln aus `CLAUDE.md`. Für Phase 7 entscheidend:

- Branch `feat/phase-07-content` (von `main` nach dem Merge von PR #18). Vor dem ersten Commit `git config user.email` → muss `rafael@hauss.dev` sein, sonst stoppen und nachfragen; nie `user.email`/`user.name` setzen, nie `rafael@lulububu.de`. Commits englisch, Conventional Commits, letzte Zeile `Co-Authored-By: <tatsächliches Modell> <noreply@anthropic.com>` (die Commit-Schritte nennen nur den Betreff).
- PHP, Composer, Artisan und pnpm der App nur in DDEV; `e2e/` auf dem Mac. Nur pnpm, nie npm oder npx. Neue npm-Pakete nur in Task 15 (Liste „Paketversionen“, alle Tiptap-Pakete genau 3.32.0); keine neuen Composer-Pakete; `e2e/pnpm-lock.yaml` bleibt unverändert.
- **Nutzer-HTML wird nie ausgegeben** (Master Global Constraints): HTML entsteht nur aus Knoten (`Document::toHtml`, `toMailHtml`); Markdown liest HTML als Text. Kein Knoten trägt eine URL oder einen Pfad: Bilder und Dateien nur als Attachment-ID, Verweise nur als ID und Art.
- **Kein Leck über Rich Text** (Review Focus 5, Anti-Ziel Datenlecks): Das gespeicherte JSON nennt von einem Verweis nur `id` und `kind` (keinen Key, keinen Titel); `GET /api/v1/references` nennt nur, was der Leser sieht; Markdown schreibt für einen verborgenen Verweis `[hidden](item:<ulid>)`; ein Key eines unsichtbaren Items wird beim Schreiben nie ein Verweis; `attachment:<ulid>` eines anderen Projekts ist eine 422; ein Anhang wird nur ausgeliefert, wenn der Leser seinen Besitzer sieht (sonst 404, nie 403).
- **Dateien erst nach dem Commit:** Zeilen von `attachments` und `media` gehen in der Transaktion, Dateien per `DB::afterCommit` (Muster `ImageInput::apply`). Ein Rollback hinterlässt keine verlorene Datei einer bleibenden Zeile.
- Rich Text wird **vor jeder Sperre** gelesen (Markdown kann eine Sekunde dauern, Phase 4); die Regeln (`RichTextRules`) laufen ebenfalls vor der Sperre (nur Lesezugriffe über IDs), das Verknüpfen der Anhänge (`AttachmentLinks::link`) in der Transaktion unter der Sperre des Besitzers.
- Fachlogik nur in `app/Actions` und `app/Domain`; `App\RichText` bleibt final und ohne `App\Actions`, `App\Http`, `DB` (`ArchTest`). **Jede Action steht genau einmal in der Rechte-Matrix** (`tests/Feature/Access/matrix.php`), **jede Route unter `api/v1` genau einmal in der Routen-Matrix** (`tests/Feature/Api/routes.php`), beides im Commit, der sie anlegt. Neue Morph-Typen (`comment`, `attachment`) in die Morph-Map (`AppServiceProvider`, `MorphMapTest`).
- Jede schreibende Action schreibt ihr Event in der Transaktion (`EventRecorder`), Ausnahmen nur mit Ruling (Hochladen ohne Besitzer, Aufräumjobs: A238, A239).
- Kommentare, Reaktionen und Uploads im Text dürfen alle mit Lesezugriff auf das Projekt (Recht `item.comment`, auch Viewer und Außenstehende öffentlicher Projekte); die Dateiliste und Beschreibungen nur mit `item.edit`. Bots dürfen kommentieren (über Tokens), beobachten nie.
- Die UI liest nur über `/api/v1` (und die Datei-Route `/attachments/{id}`). `resources/js/api/{comments,attachments}.ts` exportieren die Namen und Signaturen des Klickdummys (`addComment`, `editComment`, `deleteComment`, `toggleReaction`, `getAttachment`, `uploadAttachment`, `deleteAttachment`); Abweichungen nur nach den Rulings dieses Plans (A243: `body_json`; A232: `uploadAttachment` ohne Besitzer für `inline`).
- Texte: jeder deutsche Text des Klickdummys wird ein Schlüssel in `lang/de.json` (wörtlich) und `lang/en.json`; Schlüssel ohne Ziffern, Platzhalter `:name`, Plural `.one`/`.other`. Neue `reason`-Codes (`payload_too_large`, `attachment_inline`, `unsupported_upload`) unter `problem.reason.*` in beiden Sprachen.
- Kürzel nur über den Katalog (A7): neu `item.comment` (`m`, Bereich `detail`); Tasten des Editors (`/`, `@`, `#`, Pfeile in den Listen) in `widgets.ts`; danach `ddev exec pnpm shortcuts:doc`.
- Abdeckung 100 % Zeilen PHP und Frontend; keine unerreichbaren Zweige (Seiten-Verweise ab Phase 9, Vorlagen-Anhänge ab Phase 10, Benachrichtigungen und Live ab Phase 8, Webhook `bot.mentioned` ab Phase 11 bleiben weg; `pageRefs()` und `kind: page` sind über Unit-Tests von `Document` erreichbar).
- Tests müssen rot werden können: zu jeder Regel ein Fall, der ohne sie scheitert.
- e2e: Daten einer Spec leben in eigenen Projekten `E2E <variant> <runId>` (`createE2eProject`), nie in WEB, APP, OPS; Dateien für Uploads erzeugt die Spec selbst (Buffer, `setInputFiles`, `DataTransfer` beim Einfügen), keine Binärdateien im Repo außer den drei Demo-Dateien (Task 14); Tastaturwege über `tabTo`/`arrowTo`/`pressMod`; kein `networkidle`.
- Demo- und Testdaten nur fiktiv (Feldwerk, `prototypes/clickdummy/src/api/seed/`, `@example.com`).
- `CLAUDE.md` im selben Commit wie die Änderung, die eine Angabe dort ändert. Der Klickdummy bleibt unverändert.

## Review Focus

- **Markdown von außen (Master Review Focus 5):** `@handle` in Code-Blöcken, Inline-Code oder Link-Texten erwähnt niemanden; ein unbekannter, deaktivierter oder projektfremder Handle bleibt Text; `WEB-123` eines unsichtbaren Items wird kein Verweis; `attachment:<ulid>` eines fremden Projekts ist 422; das alles über REST. → Task 5 (Rundreise mit genau diesen Fällen), Task 8 („…over REST“).
- **Verweis als Orakel:** Ein Verweis auf ein Item, das der Leser nicht sieht, verrät weder Key noch Titel, auch nicht über `description_json`, Markdown, History, `GET /references` oder die Mail-Darstellung; ein Schreiber kann über `item:<ulid>` keinen Verweis auf ein Item anlegen, das er nicht sieht (außer es stand schon im Text). → Tasks 4, 5, 8, 11.
- **Anhang über Projektgrenzen:** Ida (nicht in OPS) bekommt das Bild eines OPS-Kommentars weder über `/attachments/{id}` noch über `/preview` noch über `GET /api/v1/attachments/{id}` (404); ein Anhang ohne Besitzer gehört nur der hochladenden Person; das Verknüpfen prüft Projekt und hochladende Person (13c). → Tasks 6, 7, 8, 21.
- **Gefährliche Dateien:** SVG, HTML und alles außer PNG, JPEG, GIF, WebP, AVIF (nach Inhalt, nie nach der Angabe des Clients) kommt als Download mit `nosniff` und `Content-Security-Policy: default-src 'none'; sandbox`; Größe über `ATTACHMENTS_MAX_MB` ist 413, auch wenn PHP die Datei schon verworfen hat. → Task 6.
- **Dateien und Rollback:** Löschen von Item, Kommentar oder Projekt entfernt die Dateien erst nach dem Commit; ein Fehler in der Transaktion lässt Zeilen und Dateien stehen. → Task 13.
- **Nur neu Erwähnte:** Eine Bearbeitung, die eine schon erwähnte Person behält, nennt sie nicht noch einmal (`meta.mentioned`), eine Abmeldung vom Beobachten hebt nur eine neue Erwähnung auf, Kommentieren nicht. → Tasks 8, 9.
- **Entwürfe verlieren nichts:** Ein Kommentar, der beim Senden scheitert, bleibt im Editor; Tippen während des Sendens geht nicht verloren; ein verworfener Entwurf räumt seine Uploads ab; ungesendeter Text einer geschlossenen Ansicht überlebt im Modul-Speicher (A154/N2). → Tasks 17, 18.

## Gates

**Neue Regel ab Phase 7** (Rafael, 2026-11-02: weniger Warten auf Tests; Ruling A249):

- **G1 (PHP), je Task mit PHP:** `ddev artisan test --coverage --min=100` → `Total: 100.0 %` (enthält `tests/Integration`, braucht `meilisearch`); `ddev exec vendor/bin/phpstan analyse --memory-limit=1G` → `[OK] No errors`; `ddev exec vendor/bin/pint --test` → `PASS`. Gezielt `ddev artisan test --testsuite=Integration --filter=<Name>` in jeder Task mit Race-, Meilisearch- oder Dateitest.
- **G2 (Frontend), je Task mit `resources/js`:** `ddev exec pnpm typecheck && ddev exec pnpm test:coverage` → keine Typfehler, alle Vitest-Schwellen erfüllt (bei VM-Last `--maxWorkers=3`).
- **G3 gezielt, je Task mit Frontend oder e2e:** gegen den normalen Build (`ddev exec pnpm build`, vorher `pnpm dev` beenden) `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test <specs>` mit den Specs, die die Task nennt (alle vier Projekte, sofern die Task nichts anderes sagt). **Kein voller Coverage-Lauf am Ende einzelner Tasks.**
- **G3 voll, genau einmal je Phase:** nach der letzten Task (Task 23), im Hintergrund parallel zum Final-Review: `ddev exec pnpm build:coverage && pnpm --dir e2e test && ddev exec pnpm build` → alle vier Playwright-Projekte grün, `coverage:merge` meldet 100 % Zeilen über `resources/js/**`. Fehlende Zeilen oder rote Specs gehen in die finale Fix-Welle. Während des Laufs keine anderen DDEV-Projekte starten oder stoppen.

Jede Task, die Dateien unter `resources/js/pages/`, `resources/js/features/`, `resources/js/editor/` oder `resources/js/shell/` anlegt oder ändert, bringt Playwright-Abläufe (nur Tastatur, wo es geht) und Vitest-Tests (Lade-, Fehler- und Randzustände mit `mockApi`) mit, die ihre neuen Zeilen decken; sie nennt die Specs für ihren gezielten G3. Was nur Playwright deckt (Datei-Auswahl, echtes Einfügen), sagt die Task, damit der volle G3 es findet.

---

## Knoten (Tiptap 3.32, gespeichert wie `editor.getJSON()`)

| Knoten | Art | Attribute (gespeichert) | Markdown (Spec 4.16) | Text (`toText`) | HTML (`toHtml`) | Mail (`toMailHtml`) |
|---|---|---|---|---|---|---|
| `mention` | inline, atom | `id` (ULID, Pflicht), `label` (Handle zur Zeit des Schreibens, beim Speichern auf den aktuellen gesetzt), `mentionSuggestionChar` (`fixed` `@`) | `@<aktueller Handle>` | `@<label>` | `<span data-type="mention" data-id=… data-label=…>@label</span>` | `@<Name>` |
| `reference` | inline, atom | `id` (ULID, Pflicht), `kind` (`item`; `page` ab Phase 9), `label` (`fixed` `null`: nie gespeichert), `mentionSuggestionChar` (`fixed` `#`) | sichtbar: `WEB-123` (aktueller Key); verborgen: `[hidden](item:<ulid>)` | – (leer) | `<span data-type="reference" data-id=… data-kind=…></span>` | sichtbar `<a href="APP_URL/items/KEY">KEY Titel</a>`, verborgen `richtext.hidden` |
| `image` | Block | `attachmentId` (ULID, Pflicht), `alt` (Text oder `null`) | `![alt](attachment:<ulid>)` | `alt` | `<img data-attachment-id=… alt=…>` (ohne `src`) | Link `richtext.image` „Bild: :name“ auf `/attachments/<id>` |
| `attachment` | inline, atom | `attachmentId` (ULID, Pflicht), `filename` (beim Speichern aus der Zeile gesetzt) | `[filename](attachment:<ulid>)` | `filename` | `<span data-type="attachment" data-attachment-id=…>filename</span>` | Link `filename` auf `/attachments/<id>` |

`image` gehört zu `Schema::BLOCKS` (alle Stufen, auch `comment`, Spec 4.16); `mention`, `reference`, `attachment` stehen in den Kindern von `paragraph` und `heading` (nicht in `codeBlock`). Eine `image`-Zeile mit `src` (eingefügtes HTML, `![](https://…)`) wird kein Knoten: externe Bilder bleiben Text bzw. ihr Alt-Text (P5).

## Regeln beim Speichern (`RichTextRules::apply`, je Text)

| Knoten | Bedingung | Ergebnis |
|---|---|---|
| `mention` | Konto existiert, ist aktiv und darf im Projekt erwähnt werden (`Assignable::check`, Spec-Änderung 2026-10-29) **oder** stand schon im vorigen Text | Knoten mit `label` = aktueller Handle |
| `mention` | sonst | Text `@<label>` (P6) |
| `reference` `item` | Item existiert und der Schreiber sieht es (`Visibility::projectIds`, nicht in Löschung) **oder** die ID stand schon im vorigen Text | Knoten (`label` `null`) |
| `reference` | sonst (auch `kind: page` bis Phase 9) | Text = die gesendete Beschriftung (`label`), sonst nichts (A229) |
| `image`, `attachment` | Anhang existiert und gehört zum Projekt des Textes **und** (hat einen Besitzer **oder** `uploaded_by` = Schreiber) | Knoten; `attachment.filename` aus der Zeile |
| `image`, `attachment` | sonst | 422 `field.rich_text.attachment` an dem Schlüssel, der den Text schickte (13c) |

Markdown (`fromMarkdown`) löst beim Lesen selbst auf: `@handle` (Muster `Handle::PATTERN`, nicht in Code, Inline-Code oder Link-Text) über `RichTextLookup::mentionable($handle)`; ein Key (`ItemKey::PATTERN` als ganzes Wort, nicht in Code oder Link-Text) über `RichTextLookup::visibleItemByKey($key)` (auch frühere Kennung); `[x](item:<ulid>)` über `RichTextLookup::visibleItem($id)` oder `kept`; `![alt](attachment:<ulid>)` und `[x](attachment:<ulid>)` werden Knoten, die `RichTextRules` danach prüft. Danach laufen dieselben Regeln wie für JSON.

## Kommentare, Reaktionen, Anhänge (Datenmodell)

Migrationen `2026_11_02_001000_create_attachments_table` (Task 6) und `2026_11_02_001010_create_comments_tables` (Task 9, mit `comment_reactions`); die Nummern sortieren nach `…_000920`:

| Tabelle | Spalten |
|---|---|
| `comments` | `id` ULID, `work_item_id` FK Kaskade, `author_id` FK `users` `restrict`, `body` JSON, `body_text` mediumtext, `edited_at` timestamp nullable, Zeitstempel; Index (`work_item_id`, `created_at`, `id`) |
| `comment_reactions` | `id` ULID, `comment_id` FK Kaskade, `user_id` FK `users` `restrict`, `emoji` string(64) mit Kollation `utf8mb4_bin` (P14), Zeitstempel; unique (`comment_id`, `user_id`, `emoji`) |
| `attachments` | `id` ULID, `project_id` FK `projects` Kaskade, `attachable_type`/`attachable_id` nullable (`nullableUlidMorphs`, kein FK), `kind` string(8) (`inline`/`file`), `uploaded_by` FK `users` `restrict`, `filename` string(255), `mime` string(127) (nach Inhalt erkannt), `size` unsigned bigint, Zeitstempel; Index (`attachable_type`, `attachable_id`), (`project_id`, `attachable_id`, `created_at`) für das Aufräumen |

`work_item_subscribers.reason` (string 16) nimmt zusätzlich `mentioned` und `commented` (keine Migration). Morph-Map: `comment` → `Comment`, `attachment` → `Attachment`.

## Events (neu oder erweitert)

| Event | Subjekt | `changes` | `meta` | History | Webhook |
|---|---|---|---|---|---|
| `comment.created` | Item | `null` | `comment_id`, `mentioned` (neu Erwähnte, IDs) | nein (der Kommentar steht selbst in der Aktivität) | ab Phase 11 |
| `comment.updated` | Item | `body` `{old, new}` (Tiptap-JSON) | `comment_id`, `author_id`, `mentioned` | ja | ab Phase 11 |
| `comment.deleted` | Item | `null` (kein Text, A228) | `comment_id`, `author_id` | ja | ab Phase 11 |
| `comment.reaction_added` / `comment.reaction_removed` | Item | `null` | `comment_id`, `emoji` | nein | nein |
| `bot.mentioned` | Item | `null` | `bot_id`, `source` (`description`, `values`, `comment`), `comment_id` (bei Kommentaren) | nein | ab Phase 11 |
| `work_item.created` / `work_item.updated` (Beschreibung oder Rich-Text-Wert) | Item | wie bisher | dazu `mentioned` (neu Erwähnte, nur wenn nicht leer) | ja | wie bisher |
| `work_item.updated` (Dateiliste) | Item | `attachments` `{old: null, new: {id, filename}}` bzw. `{old: {id, filename}, new: null}` | – | ja | wie bisher |

`EventType` bekommt `CommentReactionAdded`, `CommentReactionRemoved` (`webhook()` falsch). `ListHistory` nimmt `comment.updated` und `comment.deleted` dazu (`LEFT_OUT` um `comment.created`, `comment.reaction_*`, `bot.mentioned` erweitert; der Typfilter wird `work_item.%` **oder** einer dieser zwei).

## REST

| Route | Action | Antwort |
|---|---|---|
| `GET /api/v1/work-items/{item}/comments` | `ListComments` | `{data: CommentResource[], links, meta}` älteste zuerst, `cursor`/`per_page` |
| `POST /api/v1/work-items/{item}/comments` | `AddComment` | 201 `{data: CommentResource}` |
| `GET /api/v1/comments/{comment}` | `GetComment` | `{data}` |
| `PATCH /api/v1/comments/{comment}` | `EditComment` | `{data}` |
| `DELETE /api/v1/comments/{comment}` | `DeleteComment` | 204 |
| `POST /api/v1/comments/{comment}/reactions` | `AddReaction` | `{data: CommentResource}` (idempotent) |
| `DELETE /api/v1/comments/{comment}/reactions?emoji=…` | `RemoveReaction` | `{data: CommentResource}` (idempotent) |
| `POST /api/v1/attachments` (multipart) | `UploadAttachment` | 201 `{data: AttachmentResource}` |
| `GET /api/v1/attachments/{attachment}` | `GetAttachment` | `{data: AttachmentResource}` |
| `DELETE /api/v1/attachments/{attachment}` | `DeleteAttachment` | 204 |
| `GET /api/v1/mentions?project=…&q=…&limit=…` | `ListMentionables` | `{data: UserResource[]}` |
| `GET /api/v1/references?items=…` | `ResolveReferences` | `{data: {items: WorkItemResource[] (schlank)}}` |
| `GET /api/v1/work-items/{item}?include=attachments` | `GetWorkItem` (`INCLUDES` + `attachments`) | `attachments: AttachmentResource[]` (nur `kind: file`, nach `created_at`, `id`) |
| `GET /attachments/{attachment}` (Web, `auth:sanctum` wie `/media`) | `ShowAttachment` | die Datei |
| `GET /attachments/{attachment}/preview` (Web) | `ShowAttachment` (`preview: true`) | das Vorschaubild oder 404 |

`CommentResource` `{id, work_item_id, author_id, body (Markdown), body_json, created_at, edited_at, reactions: [{emoji, user_ids}]}` (Reaktionen in der Reihenfolge ihrer ersten Reaktion, Personen darin nach Zeit). `AttachmentResource` `{id, project_id, owner: {type, id} | null, kind, filename, mime, size, inline (bool: sicheres Bildformat), url, preview_url (oder null), uploaded_by, created_at}`. `{comment}` und `{attachment}` binden über `Route::bind` nur per ULID (auch groß), ohne Sichtbarkeit (die prüft die Action), unbekannt → 404.

## Dateistruktur nach Phase 7

| Ort | Inhalt |
|---|---|
| `app/RichText/` | `Schema` (neue Knoten), `Document` (Knoten, Fakten, `toMailHtml`, Zusammenfassen von Textknoten), `Markdown` (`MentionsAndReferences`-Erweiterung, Ausgabe mit `RichTextNames`), `MarkdownContext` (`lookup`, `kept`), `RichTextLookup` (Interface), `RichTextNames` (final readonly), `Nodes/{Mention,Reference,AttachmentImage,AttachmentFile}.php` (tiptap-php) |
| `app/Support/` | `RichTextLookups` (Umsetzung mit `Visibility`/`Assignable`), `RichTextRules`, `AttachmentLinks`, `AttachmentFiles` (Löschen nach dem Commit), `Mentions` (neu Erwähnte, Beobachten, `bot.mentioned`) |
| `app/Domain/Emoji.php` | die eine Emoji-Regel (Views, Reaktionen) |
| `app/Models/{Comment,CommentReaction,Attachment}.php` | Modelle |
| `app/Actions/Comments/` | `ListComments`, `AddComment`, `GetComment`, `EditComment`, `DeleteComment`, `AddReaction`, `RemoveReaction` |
| `app/Actions/Attachments/` | `UploadAttachment`, `GetAttachment`, `ShowAttachment`, `DeleteAttachment`, `PruneUnownedAttachments`, `PruneAttachments` |
| `app/Actions/RichText/` | `ListMentionables`, `ResolveReferences` |
| `app/Policies/{CommentPolicy,AttachmentPolicy}.php` | Rechte |
| `app/Http/Controllers/Api/{CommentsController,ReactionsController,AttachmentsController,RichTextController}.php`, `app/Http/Controllers/AttachmentFileController.php` | dünne Controller |
| `app/Http/Resources/{CommentResource,AttachmentResource}.php` | Darstellungen |
| `app/Console/Commands/PruneAttachmentsCommand.php`, `app/Jobs/PruneUnownedAttachmentsJob.php` | Aufräumen |
| `resources/js/api/{comments,attachments,richText}.ts`, `resources/js/hooks/{comments,attachments,richText}.ts` | Datenschicht |
| `resources/js/editor/` | `codeBlocks.ts`, `slashMenu.tsx`, `suggestions.tsx` (geteilte Liste), `mentions.tsx`, `references.tsx`, `uploads.ts` (Einfügen, Ziehen, Platzhalter), `nodes.tsx` (Bild, Datei), `UploadContext.tsx` |
| `resources/js/lib/drafts.ts` | Modul-Speicher für ungesendeten Text (A251) |
| `resources/js/features/item-detail/` | `comments/{CommentComposer,CommentCard,CommentEditor,Reactions}.tsx`, `Attachments.tsx`, `activity/*` erweitert |
| `docs/{en,de}/concepts/rich-text.md` | Doku |

## Paketversionen

Geprüft am 2026-11-02: `ddev exec pnpm view <paket> version` (neueste) und `…@3.32.0 peerDependencies`, Root-`pnpm-lock.yaml` (dort schon über `prototypes/clickdummy` aufgelöst), `ddev composer show`.

| Paket | Version | Task | Hinweis |
|---|---|---|---|
| `@tiptap/extension-mention` | `3.32.0` (genau) | 15 | neueste 3.32.2; gepinnt wie `@tiptap/core` 3.32.0 (A248); Peer `@tiptap/suggestion` 3.32.0 |
| `@tiptap/suggestion` | `3.32.0` (genau) | 15 | Peer von Mention, auch direkt benutzt (Typen `SuggestionProps`) |
| `@tiptap/extension-code-block-lowlight` | `3.32.0` (genau) | 15 | Peers `lowlight ^2 \|\| ^3`, `highlight.js ^11`, `@tiptap/extension-code-block` 3.32.0 |
| `lowlight` | `^3.3.0` (3.3.0) | 15 | neueste 3.3.0 |
| `highlight.js` | `^11.11.2` (11.11.2 im Lockfile) | 15 | neueste 11.12.0; das Lockfile behält 11.11.2, `pnpm install` ohne Update |
| `@tiptap/extension-image` | `3.32.0` (genau) | 15 | |
| `@tiptap/extension-file-handler` | `3.32.0` (genau) | 15 | Peer `@tiptap/extension-text-style` 3.32.0 (im Lockfile); `allowBuilds` unverändert (keine Build-Skripte) |
| `spatie/laravel-medialibrary` | 11.23.11 (installiert) | 6, 7 | Konvertierungen über `spatie/image` 3.9.9 mit GD; DDEV-GD kann PNG, JPEG, GIF, WebP, AVIF; CI hat `gd` |
| `ueberdosis/tiptap-php` | 2.2.1 (installiert) | 4 | bringt `Nodes\Mention`, `Nodes\Image`; eigene Knoten-Klassen erweitern sie |
| `league/commonmark` | 2.10.7 (installiert) | 5 | `DocumentParsedEvent` für Erwähnungen und Keys |
| `league/html-to-markdown` | 5.2.3 (installiert) | 5 | eigene Konverter für die vier Knoten |

PHP in DDEV: `upload_max_filesize` und `post_max_size` 100M, `intl` (für `grapheme_*` in `Emoji`), `fileinfo`, `exif`. CI (`setup-php`) bekommt in beiden Jobs `ini-values: upload_max_filesize=30M, post_max_size=32M` (Task 6), sonst greift PHPs Standard von 2 MB vor der App.

## Port-Umfang aus `prototypes/clickdummy/src/`

| Portiert in Phase 7 | Ziel | Task |
|---|---|---|
| `api/comments.ts`, `api/attachments.ts` (Regeln) | `App\Actions\Comments\*`, `App\Actions\Attachments\*` | 6–10 |
| `api/comments.ts`, `api/attachments.ts`, `hooks/{comments,attachments}.ts` (Signaturen) | `resources/js/api/`, `resources/js/hooks/` | 14 |
| `features/editor/{codeBlocks.ts,slashMenu.tsx,mentions.tsx,pasteImages.ts,presets.ts,editor.css}` | `resources/js/editor/` (geteilt: `suggestions.tsx`, `mentions.tsx`, `references.tsx`, `uploads.ts`, `nodes.tsx`) | 15–17 |
| `lib/richtext.ts` (`mentionedIds`, `attachmentIds`) | `resources/js/lib/richtext.ts` | 14 |
| `features/item-detail/{CommentComposer,Activity (Kommentare, Reaktionen, Bearbeiten),Attachments}.tsx` | `resources/js/features/item-detail/{comments/*,activity/*,Attachments.tsx}` | 18–20 |
| `components/ui/EmojiPicker.tsx` (schon portiert) | Reaktionen | 19 |
| `api/seed/{activity,files,items}.ts` (Kommentare, Reaktionen, Dateien, Erwähnungen) | `database/seeders/Demo/{CommentsSeeder,AttachmentsSeeder}.php`, `ItemsSeeder` | 12 |

Nicht in Phase 7: Seiten-Verweise und Wiki-Uploads (Phase 9), Vorlagen-Uploads (Phase 10), Benachrichtigungen, Mails, Live (Phase 8; Phase 7 liefert `meta.mentioned`, `bot.mentioned` und `toMailHtml`), Webhook-Zustellung (Phase 11), MCP-Upload-URL (Phase 13), Speicher auf S3 (Phase 14).

## Abdeckung über die Tasks

- **PHP:** G1 in jeder PHP-Task. Neue Actions und Routen bekommen im selben Commit ihre Matrix-Zeilen (Kommentare: `allowed` alle Spalten mit Lesezugriff inklusive Viewer, `hidden` für Außenstehende privater Projekte; Löschen fremder Kommentare nur Projekt-Admins und Org-Admins). Die Datei-Route `/attachments/{id}` (Web) steht wie `/media` nicht in `routes.php`, sondern in `tests/Feature/Attachments/ShowAttachmentTest.php`.
- **Frontend, Vitest:** bestehende Schwellen decken `api/`, `hooks/`, `lib/`, `editor/`, `features/item-detail/**`, `features/create-item/`; keine neue Schwelle nötig. Neue Unterordner (`features/item-detail/comments/`) liegen unter `item-detail/**`.
- **Frontend, Playwright:** neue Specs `e2e/tests/{comments,attachments,editor}.spec.ts`, Abnahme in `e2e/tests/content-acceptance.spec.ts` (Task 22); Ergänzungen in `item-description.spec.ts`, `create-item.spec.ts`, `item-activity.spec.ts`. Was jsdom nicht kann (echtes Einfügen von Dateien, `<input type=file>`, Bild laden mit Cookie), decken diese Specs.

---

### Task 1: Überträge: `ConfigTest` ohne `.env`, Abmelden ohne vorheriges Beobachten

**Modell:** sonnet (mechanisch, Code vollständig)

**Files:**
- Modify: `phpunit.xml`, `tests/Feature/ConfigTest.php`, `app/Actions/WorkItems/SetSubscription.php`, `tests/Feature/WorkItems/SubscriptionTest.php`, `CLAUDE.md` (Archivieren, Löschen, Beobachten)

**Interfaces:**
- Produces:
  - `phpunit.xml`: `<env name="ATTACHMENTS_MAX_MB" value="25" force="true"/>` und `<env name="WEBHOOKS_ALLOW_PRIVATE" value="false" force="true"/>`; `ConfigTest` „has the documented defaults“ liest danach ohne `setEnv(…, null)` und ohne `refreshApplication()`; die Tests, die einen Wert setzen, bleiben über `setEnv()`.
  - `SetSubscription::handle($actor, $item, false)` ohne Zeile legt eine Zeile mit Grund `manual` und `unsubscribed_at = now()` an und schreibt `work_item.unsubscribed` (A250): eine spätere automatische Anmeldung (Kommentieren, Task 9) achtet die Abmeldung.

- [ ] **Step 1: Failing Tests** — `ConfigTest`: „has the documented defaults whatever .env says“ (vorher `ATTACHMENTS_MAX_MB=3` per `putenv` ohne `setEnv`, `refreshApplication()` → weiter 25). `SubscriptionTest`: „stores an opt-out for a person who never watched“ (Viewer ohne Zeile, `DELETE …/subscription` → Zeile mit `unsubscribed_at`, ein `work_item.unsubscribed`; ein zweites `DELETE` schreibt nichts).
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='ConfigTest|SubscriptionTest|RightsMatrixTest'`.
- [ ] **Step 3: `CLAUDE.md`** — unter „Archivieren, Löschen, Beobachten“: „aus → `unsubscribed_at` jetzt; ohne Zeile legt es eine Abmeldung an (A250)“.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `fix: pin the config defaults in phpunit and store an opt-out without a prior subscription`.

---

### Task 2: Die eine Emoji-Regel (`App\Domain\Emoji`, T6-M2)

**Modell:** opus

**Files:**
- Create: `app/Domain/Emoji.php`, `tests/Unit/Domain/EmojiTest.php`
- Modify: `app/Support/ViewInput.php` (`EMOJI` entfällt, `Emoji::is`), `tests/Feature/Views/SaveViewTest.php`, `resources/js/components/ui/EmojiPicker.tsx` (nur falls der Test einen Picker-Wert findet, den der Server ablehnt), `CLAUDE.md` (Views)

**Interfaces:**
- Produces: `final class Emoji { public const MAX_BYTES = 64; public static function is(string $text): bool }` — genau ein erweitertes Graphem (`grapheme_strlen($text) === 1`, `intl`), höchstens `MAX_BYTES`, und es ist ein Emoji: beginnt mit `\p{Extended_Pictographic}` (dann beliebig `\x{FE0F}`, Hautton `\x{1F3FB}-\x{1F3FF}`, ZWJ-Folgen), oder ein Flaggenpaar (zwei `\p{Regional_Indicator}`), oder eine Keycap (`[0-9#*]\x{FE0F}?\x{20E3}`), oder eine Subdivision-Flagge (`\x{1F3F4}` + Tags `\x{E0020}-\x{E007F}`). Text-Zeichen mit Emoji-Eigenschaft ohne `\x{FE0F}` (`©`, `‼`, `™`) sind keine Emojis. Rein, ohne Laravel (`ArchTest`).

- [ ] **Step 1: Failing Tests** — `EmojiTest`: nimmt `👍`, `👍🏽`, `👩‍💻`, `🇩🇪`, `🏴󠁧󠁢󠁳󠁣󠁴󠁿`, `1️⃣`, `❤️`, `🫠`; lehnt ab: `''`, `a`, `©`, `‼`, `™`, `👍👍`, `👍 `, `🇩` (eine Hälfte), `1⃣` ohne Ziffer davor ist trotzdem eine Keycap? → der Test legt fest: `1⃣` ja, `x⃣` nein; mehr als 64 Bytes nein. „accepts every emoji the picker offers“ (liest die Liste aus `resources/js/components/ui/EmojiPicker.tsx` per Regex über `repo_path()`, jedes Emoji `is()` wahr). `SaveViewTest`: „takes an emoji with a skin tone, a flag and a keycap as icon“, „refuses © as icon“.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='EmojiTest|SaveViewTest|ArchTest'`.
- [ ] **Step 3: `CLAUDE.md`** — Views: „`icon` … oder genau ein Emoji (`App\Domain\Emoji::is`, auch Hauttöne, Flaggen, Keycaps; `©`/`‼` nicht)“.
- [ ] **Step 4: Gates G1** (G2, falls `EmojiPicker.tsx` sich ändert)
- [ ] **Step 5: Commit** — `fix: accept skin tones, flags and keycaps as emoji and refuse text symbols`.

---

### Task 3: `Document` wie Tiptap: Textknoten zusammenfassen, Marken ordnen, Inhaltsausdrücke

**Modell:** opus

**Files:**
- Modify: `app/RichText/{Schema,Document}.php`, `tests/Unit/RichText/DocumentJsonTest.php`, `tests/Unit/RichText/MarkdownRoundTripTest.php`, `CLAUDE.md` (Rich Text)

**Interfaces:**
- Produces (Überträge T3 M4, T3 M6 aus Phase 4):
  - `Document::fromJson` fasst benachbarte Textknoten mit gleichen Marken zusammen und ordnet die Marken eines Textknotens in der Reihenfolge des Schemas (`Schema::MARKS`, wie ProseMirrors `Mark.sameSet`/`addToSet`); doppelte Marken gleichen Typs fallen auf eine (die erste).
  - `Schema::CONTENT` (neu): die Inhaltsausdrücke von Tiptap 3.32 als Regel je Knoten: `listItem` und `taskItem` = `paragraph block*` (erstes Kind ein Absatz), `blockquote`, `tableCell`, `tableHeader` = `block+`, `bulletList`/`orderedList`/`taskList` = `item+`, `table` = `tableRow+`, `tableRow` = `(tableCell|tableHeader)+`, `doc` = `block+` (ein leeres `doc` bleibt erlaubt: es heißt „leer“, `isEmpty`); ein Verstoß ist `InvalidDocument('shape')`. Tests decken jeden Ausdruck mit einem Gut- und einem Schlecht-Fall.
- Consumes: nichts Neues.

- [ ] **Step 1: Failing Tests** — `DocumentJsonTest`: „merges neighbouring text nodes with the same marks“, „orders marks like the editor“ (`[italic, bold]` → `[bold, italic]`), „drops a repeated mark“, „refuses a list item that starts with a list“, „refuses an empty blockquote“, „refuses a table row without cells“, „keeps an empty doc“. `MarkdownRoundTripTest`: „reads its own Markdown back to the same JSON“ für `RichTextFixtures::everyNode()` (bleibt grün, prüft jetzt mit zusammengefassten Knoten).
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='RichText|ItemValues|WorkItem'`.
- [ ] **Step 3: `CLAUDE.md`** — Rich Text: Zusammenfassen und `Schema::CONTENT`.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `fix: read rich text like Tiptap: merge text nodes, order marks, check content expressions`.

---

### Task 4: Eigene Knoten in `Document`: Erwähnung, Verweis, Bild, Datei; HTML für Mails

**Modell:** opus

**Files:**
- Create: `app/RichText/Nodes/{Mention,Reference,AttachmentImage,AttachmentFile}.php`, `app/RichText/RichTextNames.php`, `tests/Unit/RichText/DocumentNodesTest.php`, `tests/Unit/RichText/MailHtmlTest.php`
- Modify: `app/RichText/{Schema,Document}.php`, `tests/Support/RichTextFixtures.php` (`everyNode()` mit den vier Knoten; `withNodes()`), `lang/{en,de}.json` (`richtext.hidden` „verborgen“/„hidden“, `richtext.image` „Bild: :name“/„Image: :name“), `CLAUDE.md` (Rich Text)

**Interfaces:**
- Produces:
  - `Schema::NODES` + `mention`, `reference`, `image`, `attachment`; `BLOCKS` + `image`; `CHILDREN['paragraph']`/`['heading']` + `mention`, `reference`, `attachment`; `ATTRS` nach der Tabelle „Knoten“ (neue Arten `ulid` (Pflicht, `App\Domain\Ulid::is`, klein geschrieben gespeichert), `kind` (`item`/`page`), `fixed` für `mentionSuggestionChar` und `reference.label`); `INLINE_ATOMS` = `mention`, `reference`, `attachment` (kein `content`).
  - `Document`: `mentionedUserIds(): list<string>`, `attachmentIds(): list<string>`, `itemRefs(): list<string>`, `pageRefs(): list<string>` (je ohne Doppelte, in Dokumentreihenfolge; Vertrag des Master-Plans); `withNodes(callable $map): self` (baut ein neues Dokument, in dem `$map(array $node): array|null|string` jeden der vier Knoten ersetzt: Array = Knoten, Zeichenkette = Textknoten, `null` = weg; benachbarte Texte werden danach zusammengefasst — das Werkzeug für `RichTextRules`, Task 8); `toText()` nach der Tabelle; `isEmpty()`: `mention`, `reference`, `image`, `attachment` sind Inhalt; `toHtml()` nach der Tabelle (tiptap-php mit den eigenen Knoten); `toMailHtml(RichTextNames $names, string $appUrl): string` (eigene Renderer, Bilder nie eingebettet, Spec 4.14).
  - `final readonly class RichTextNames { /** @param array<string, string> $handles id → aktueller Handle; @param array<string, array{key: string, title: string}> $items id → sichtbares Item; @param array<string, string> $names id → Anzeigename */ public function __construct(public array $handles = [], public array $items = [], public array $names = []) {} }` — was ein Leser von den Knoten sehen darf; fehlt eine Item-ID, ist der Verweis verborgen.
  - Knoten-Klassen (tiptap-php): `Mention` (`data-type="mention"`), `Reference` (`data-type="reference"`, `data-kind`), `AttachmentImage` (`img[data-attachment-id]`, ohne `src`; `parseHTML` nimmt nur `img[data-attachment-id]`, ein `img[src]` wird kein Knoten), `AttachmentFile` (`span[data-type="attachment"]`).
- Consumes: Task 3.

- [ ] **Step 1: Failing Tests** — `DocumentNodesTest`: „reads a mention, a reference, an image and a file as the editor writes them“ (JSON aus `editor.getJSON()` mit `mentionSuggestionChar`; `reference.label` fällt weg, `mentionSuggestionChar` ist immer `@`/`#`); „lowers the ULIDs of the nodes“; „refuses a node without an id or with a bad ULID“ (`shape`); „refuses a mention in a code block and an image in a paragraph“ (`shape`); „names mentions, attachments, item and page references once each in order“; „counts a document with only an image as not empty“; „writes the text of the nodes“; „maps nodes with withNodes into nodes, text or nothing“; „renders HTML without src or path“. `MailHtmlTest`: „renders a visible reference as a link with key and title“, „renders a hidden reference as hidden, without key or id“, „renders an image as a link, never as img“, „renders a mention with the name“; „escapes names and titles“ (`<script>` im Titel).
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='RichText|ArchTest|TranslationKeysTest'`.
- [ ] **Step 3: `CLAUDE.md`** — Rich Text: die vier Knoten, Fakten, `withNodes`, `toMailHtml` mit `RichTextNames`.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: store mentions, references, images and files in rich text and render mail HTML`.

---

### Task 5: Markdown mit Erwähnungen, Verweisen und Anhängen (Review Focus 5)

**Modell:** opus

**Files:**
- Create: `app/RichText/RichTextLookup.php`, `app/RichText/MentionsAndReferences.php` (commonmark-Erweiterung), `tests/Support/FakeRichTextLookup.php`, `tests/Unit/RichText/MarkdownNodesTest.php`
- Modify: `app/RichText/{Markdown,MarkdownContext,Document}.php`, `tests/Unit/RichText/MarkdownRoundTripTest.php`, `CLAUDE.md` (Rich Text)

**Interfaces:**
- Produces:
  - `interface RichTextLookup { /** @return array{id: string, handle: string}|null an account the text may mention */ public function mentionable(string $handle): ?array; /** id of an item the writer sees, also over a former identifier */ public function visibleItemByKey(string $key): ?string; public function visibleItem(string $id): bool; }`
  - `MarkdownContext` (final readonly): `?Project $project = null`, `?RichTextLookup $lookup = null`, `list<string> $keptMentions = []`, `list<string> $keptRefs = []` (IDs aus dem vorigen Text: bleiben, auch wenn der Schreiber sie nicht mehr sieht, A229). Ohne `lookup` bleiben `@handle` und Keys Text (Phase-4-Verhalten, Seeder und Tests ohne Projekt).
  - `MentionsAndReferences` (commonmark `ExtensionInterface`): ein Listener auf `DocumentParsedEvent` geht die `Text`-Knoten durch, **außer** innerhalb von `Code`, `FencedCode`, `IndentedCode`, `HtmlInline`, `HtmlBlock` und `Link` (Link-Text), und ersetzt `@handle` (vor dem `@` kein Wortzeichen, `Handle::PATTERN` ohne Anker) bzw. einen Key (`ItemKey`-Form als ganzes Wort, vorn und hinten kein Wortzeichen und kein `-`) durch eigene Inline-Knoten, die als `<span data-type="mention" …>` / `<span data-type="reference" data-kind="item" …>` gerendert werden; nur was der `lookup` bestätigt. Links `item:<ulid>` werden ein Verweis, wenn `visibleItem($id)` oder die ID in `keptRefs` steht, sonst bleibt ihr Text; Links und Bilder mit `attachment:<ulid>` werden `attachment`- bzw. `image`-Knoten (geprüft erst in Task 8). `page:<ulid>` bleibt bis Phase 9 Text.
  - Ausgabe: `Document::toMarkdown(?RichTextNames $names = null)`: `mention` → `@<names->handles[id] ?? label>`, `reference` sichtbar → Key, verborgen → `[hidden](item:<ulid>)`, `image` → `![alt](attachment:<ulid>)`, `attachment` → `[filename](attachment:<ulid>)` (Escape wie Link-Text). `Markdown::fromHtml` bekommt dafür eigene Konverter (`league/html-to-markdown`), `Markdown::toHtml` die Erweiterung.
  - `tests/Support/FakeRichTextLookup` (Handles und Keys aus Arrays).
- Consumes: Task 4.

- [ ] **Step 1: Failing Tests** — `MarkdownNodesTest` (mit `FakeRichTextLookup`: `mara` erwähnbar, `kira` nicht, `WEB-47` sichtbar, `OPS-12` unsichtbar):
  - Review Focus 5 je ein Test: „mentions nobody in a code block, inline code or a link text“; „leaves an unknown, a disabled or a foreign handle as text“ (`@kira`, `@nobody`); „leaves the key of an invisible item as text“ (`OPS-12`); „leaves `WEB-47x`, `xWEB-47` and an email address as text“; „turns `[x](item:<ulid>)` into a reference only when the writer sees it or it was kept“; „reads `![alt](attachment:<ulid>)` as an image and `[a.pdf](attachment:<ulid>)` as a file“; „keeps `![x](https://…)` out of the document as a node“ (Alt-Text bleibt Text).
  - Rundreise: „writes a visible reference as its current key and a hidden one as `[hidden](item:…)`“; „writes a mention with the current handle“; „reads its own Markdown back to the same JSON“ für ein Dokument mit allen Knoten (mit `RichTextNames`, die jede ID kennen); „keeps a hidden reference through Markdown when it was kept“.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='RichText'`.
- [ ] **Step 3: `CLAUDE.md`** — Rich Text: Markdown-Konventionen der Knoten, `MarkdownContext` mit `lookup`/`kept*`, Ausgabe mit `RichTextNames`.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: read and write mentions, item keys and attachments in Markdown`.

---

### Task 6: Anhänge: Modell, Hochladen, Auslieferung mit Leserecht, 413

**Modell:** opus

**Files:**
- Create: Migration `2026_11_02_001000_create_attachments_table.php`, `app/Models/Attachment.php`, `database/factories/AttachmentFactory.php`, `app/Policies/AttachmentPolicy.php`, `app/Actions/Attachments/{UploadAttachment,GetAttachment,ShowAttachment}.php`, `app/Http/Controllers/Api/AttachmentsController.php`, `app/Http/Controllers/AttachmentFileController.php`, `app/Http/Resources/AttachmentResource.php`, `tests/Feature/Attachments/{UploadAttachmentTest,ShowAttachmentTest}.php`
- Modify: `app/Exceptions/{Problem,Rendering}.php` (`Problem::tooLarge()`, `PostTooLargeException` → 413 `payload_too_large`), `app/Providers/AppServiceProvider.php` (Morph-Map `attachment`), `routes/{api,web}.php` (`Route::bind('attachment')`), `config/media-library.php` (`max_file_size` = `max(2, attachments_max_mb)` MB, `queue_name` `env('MEDIA_QUEUE', 'media')`), `.github/workflows/tests.yml` (`ini-values` in beiden Jobs), `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `tests/Feature/MorphMapTest.php`, `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `Attachment` (`HasUlids`, `InteractsWithMedia`, Sammlung `file` `singleFile`, ohne MIME-Beschränkung; `project()`, `uploader()`, `attachable()` (morph); `INLINE_TYPES` = `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif`; `isInlineImage(): bool`; `KINDS` = `inline`, `file`).
  - `UploadAttachment::handle(Actor $actor, array $input, ?UploadedFile $file): Attachment` — `project_id` (ULID, Kennung oder frühere; unbekannt oder unsichtbar oder in Löschung → 404), `kind` (`inline`/`file`, sonst `field.kind.unknown`), bei `file` `work_item_id` (ULID oder Key, ein Item dieses Projekts, unsichtbar → 404, anderes Projekt → `field.work_item_id.project`); Recht: `inline` → `AttachmentPolicy::uploadInline` (`item.comment` im Projekt, A234), `file` → `Authorize::check($actor, 'update', $item)`; archiviertes Projekt 409 `project_archived`, archiviertes Item 409 `archived`; Datei: fehlt oder `UPLOAD_ERR_INI_SIZE`/`UPLOAD_ERR_FORM_SIZE` → 413 `payload_too_large` (`problem.detail.payload_too_large` mit `:max`), andere Upload-Fehler 422 `field.file.invalid`; größer als `attachments_max_mb` → 413; Name: `basename`, Steuerzeichen raus, auf 255 Zeichen gekürzt (Endung bleibt), leer → `datei`; `mime` per `finfo` aus dem Inhalt (nie der Angabe des Clients); in einer Transaktion: Zeile, `addMedia($file)->usingFileName(<ulid>.<endung>)->toMediaCollection('file')` (die Datei entsteht in der Transaktion; ein Rollback löscht sie per `DB::afterRollBack`-Rückruf), bei `file` Besitzer = Item und `work_item.updated` mit `changes.attachments` `{old: null, new: {id, filename}}` und neuem `updated_at` des Items (unter `ItemLock::take`); bei `inline` kein Besitzer und **kein Event** (A238). Drossel `attachments` (60 je Minute und Konto, `throttle:attachments` an der Route).
  - `GetAttachment::handle($actor, Attachment $attachment): Attachment` und `ShowAttachment::handle($actor, Attachment $attachment, bool $preview = false): Media` — Recht `AttachmentPolicy::view`: Besitzer `work_item` → `view` am Item; `comment` → `view` am Item des Kommentars (diesen Zweig legt erst Task 9 an, mit Test; bis dahin gibt es kein `Comment`-Modell); kein Besitzer → nur `uploaded_by`; Projekt in Löschung → 404; alles andere 404 (`denyAsNotFound`). `preview` ohne erzeugte Konvertierung → 404.
  - `AttachmentFileController` (Web-Gruppe wie `media.show`: `auth:sanctum`, Sanctums `AuthenticateSession`, `EnsureTokenAbility`): Antwort mit `Content-Type` = gespeicherter `mime` nur für `INLINE_TYPES`, sonst `application/octet-stream`; `Content-Disposition: inline` nur für `INLINE_TYPES`, sonst `attachment; filename*=UTF-8''…`; immer `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, max-age=3600`, `setPrivate()`; `?download=1` erzwingt `attachment`. Routen `attachments.show` und `attachments.preview`.
  - `AttachmentResource` nach „REST“ (`url` = `route('attachments.show')` relativ, `preview_url` nur bei erzeugter Konvertierung).
  - `Problem::tooLarge(string $detail)` (413, Reason `payload_too_large`); `Rendering`: `PostTooLargeException` (vor der Validierung, auch über REST) → dieselbe 413; neue Reasons in `lang/*.json` (`problem.reason.payload_too_large`).
  - CI: `ini-values: upload_max_filesize=30M, post_max_size=32M` an beiden `setup-php`.
- Consumes: `Visibility`, `Authorize`, `ItemLock`, `EventRecorder`, `Ids::normalize`, `ProjectInput` (Referenzen).

- [ ] **Step 1: Failing Tests** — `UploadAttachmentTest` (`Storage::fake('local')`): „stores an image for a text without owner and records nothing“; „lets a viewer upload into a text“ (A234); „refuses an outsider of a private project with 404“; „stores a file of the file list with an event and a new updated_at“; „refuses the file list to a viewer with 403“; „answers 413 above ATTACHMENTS_MAX_MB“ (`config(['werkbuch.attachments_max_mb' => 1])`, `UploadedFile::fake()->create('a.bin', 1100)`); „answers 413 when PHP dropped the file“ (`UploadedFile` mit Fehler `UPLOAD_ERR_INI_SIZE`); „answers 413 for a body above post_max_size“ (Request mit `CONTENT_LENGTH` über dem Limit → `PostTooLargeException`); „reads the type from the content, not from the client“ (SVG als `image/png` angekündigt → `mime` `image/svg+xml`, `inline` falsch); „cleans the file name“; „leaves no file behind when the transaction fails“ (Event-Recorder wirft per Fake → keine Zeile, keine Datei); „refuses an archived project and an archived item with 409“. `ShowAttachmentTest`: „serves a PNG inline with nosniff and the sandbox“; „serves an SVG and an HTML file as download, never inline“ (Review Focus „Gefährliche Dateien“); „serves the uploader an unowned upload and nobody else“; „hides the image of an item from an outsider with 404“ (Ida, privates Projekt); „hides an attachment of a project being deleted“; „forces a download with ?download=1“; „reads with a bearer token with read“. Matrix: Zeilen für `UploadAttachment` (inline und file), `GetAttachment`; Routen-Matrix: `POST /api/v1/attachments` (`'body'` mit `UploadedFile`), `GET /api/v1/attachments/{attachment}`.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Attachment|MorphMapTest|ProblemTest|RightsMatrixTest|RouteMatrixTest|TranslationKeysTest'`.
- [ ] **Step 3: `CLAUDE.md`** — Architektur „Anhänge“ (Modell, Rechte A234, Auslieferung, Header, 413, Drossel), Fallstrick „PHP verwirft Uploads über `upload_max_filesize` still: die Action meldet 413; CI setzt `ini-values`“.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: upload attachments and serve them only to readers of their owner`.

---

### Task 7: Dateiliste und Vorschaubilder: Löschen, `include=attachments`, Queue `media`

**Modell:** opus

**Files:**
- Create: `app/Actions/Attachments/DeleteAttachment.php`, `app/Support/AttachmentFiles.php`, `tests/Feature/Attachments/{DeleteAttachmentTest,AttachmentPreviewTest}.php`
- Modify: `app/Models/Attachment.php` (`registerMediaConversions`: `preview`), `app/Actions/WorkItems/GetWorkItem.php` (`INCLUDES` + `attachments`), `app/Models/WorkItem.php` (`attachments()` morph), `app/Http/Resources/WorkItemResource.php` (`attachments` mit Include), `app/Http/Controllers/Api/AttachmentsController.php`, `.github/workflows/tests.yml` (e2e-Worker `--queue=default,notifications,search,media`), `e2e/ci.env` (`MEDIA_QUEUE=media`), `tests/Feature/Api/WorkItemsApiTest.php`, `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `DeleteAttachment::handle($actor, Attachment $attachment): void` — `kind: file` mit Item: `Authorize::check(…, 'update', $item)`, `ItemLock::take`, archiviert 409; Zeile weg, Datei nach dem Commit (`AttachmentFiles::removeAfterCommit`), `work_item.updated` mit `changes.attachments` `{old: {id, filename}, new: null}`, neues `updated_at`. Ohne Besitzer: nur `uploaded_by` (sonst 404), kein Event. `inline` mit Besitzer → 409 `attachment_inline` (`problem.detail.attachment_inline`: „Bilder und Dateien im Text verschwinden mit dem Text; aufgeräumt wird mit app:prune-attachments.“, A238).
  - `AttachmentFiles::removeAfterCommit(Collection<int, Attachment> $attachments): void` — löscht die `media`-Zeilen (`deleteQuietly`) in der Transaktion und die Dateien per `DB::afterCommit` (`Filesystem::removeAllFiles`), die `attachments`-Zeilen löscht der Aufrufer. Einziger Weg für Tasks 9, 13.
  - Konvertierung `preview`: nur für `image/png`, `image/jpeg`, `image/webp` (A237), `Fit::Max` 1600 × 1600, `->queued()` (Queue aus `media-library.queue_name` = `media`), `nonOptimized()`; GIF (Animation) und AVIF ohne Vorschau.
  - `GetWorkItem::INCLUDES` = `children`, `type`, `workflow`, `relations`, `attachments`; `WorkItemResource` hängt `attachments` (AttachmentResource[], `kind: file`, nach `created_at`, `id`) an (A121 erfüllt).
- Consumes: Task 6.

- [ ] **Step 1: Failing Tests** — `DeleteAttachmentTest`: „deletes a file of the list with an event and removes the file after the commit“; „keeps row and file when the transaction rolls back“; „lets the uploader delete an unowned upload, nobody else (404)“; „refuses an image of a text with 409 attachment_inline“; „refuses a viewer with 403“. `AttachmentPreviewTest` (Queue `sync`, echtes PNG über GD): „makes a preview of a large PNG on the queue media“ (`Queue::fake` → Job auf `media`; dann ausgeführt → `preview_url` gesetzt, Bild ≤ 1600 px); „makes no preview of a GIF“; „answers 404 for a preview that does not exist“. `WorkItemsApiTest`: „embeds the files of the item with include=attachments“ (nur `kind: file`, nicht die Bilder der Beschreibung). Matrix-Zeilen `DeleteAttachment`; Routen-Matrix `DELETE /api/v1/attachments/{attachment}`.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Attachment|WorkItemsApiTest|GetWorkItemTest|RightsMatrixTest|RouteMatrixTest|CiEnvTest'`.
- [ ] **Step 3: `CLAUDE.md`** — Anhänge: Löschen, `AttachmentFiles`, Vorschau, `include=attachments`, CI-Worker auf `media`.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: delete files of the file list, embed them in the item and render previews on the queue media`.

---

### Task 8: Regeln beim Speichern: Erwähnungen, Verweise, Anhänge der Items

**Modell:** opus

**Files:**
- Create: `app/Support/{RichTextLookups,RichTextRules,AttachmentLinks,Mentions}.php`, `tests/Feature/RichText/{RichTextRulesTest,ItemRichTextTest}.php`, `tests/Feature/Api/RichTextApiTest.php`
- Modify: `app/RichText/RichTextInput.php` (Kontext durchreichen), `app/Support/{ItemInput,ItemValues}.php` (`documents()` mit Lookup und vorigem Text), `app/Actions/WorkItems/{CreateWorkItem,UpdateWorkItem,ChangeWorkItemType}.php`, `app/Models/WorkItem.php` (`loadForResource` lädt `RichTextNames` für nicht schlanke Items; öffentliche Eigenschaft `$rich_names`), `app/Http/Resources/WorkItemResource.php` (`description`, `values_markdown` mit `$rich_names`), `app/Events/EventType.php` (`BotMentioned` bleibt `webhook()` wahr), `tests/Feature/WorkItems/{CreateWorkItemTest,UpdateWorkItemTest}.php`, `lang/{en,de}.json` (`field.rich_text.attachment`), `docs/superpowers/plans/…` nicht, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `RichTextLookups implements RichTextLookup` — `__construct(Project $project, User $writer)`; `mentionable` (Handle → aktives Konto mit `Assignable::check`), `visibleItemByKey` (`ItemKey::parse` + `WorkItem::findByReference` + Projekt in `Visibility::projectIds($writer)`), `visibleItem`. Fragt je Aufruf höchstens eine Abfrage; `RichTextRules` bündelt (siehe unten).
  - `RichTextRules::apply(Document $doc, Project $project, User $writer, ?Document $before, string $field): Document` — die Tabelle „Regeln beim Speichern“, mit je **einer** Abfrage für alle Konten, alle Items und alle Anhänge des Dokuments; ein fremder Anhang → `ValidationException` an `$field` (`field.rich_text.attachment`). `RichTextRules::context(Project $project, User $writer, ?Document $before): MarkdownContext` (Lookup und `kept*` aus `$before`).
  - `RichTextInput::from($input, $field, MarkdownContext $ctx)` ruft danach `RichTextRules::apply` (wenn der Kontext ein Projekt und einen Schreiber trägt); `ItemInput::documents($input, $project, $actor, ?WorkItem $item)` liest den vorigen Text des Items (Beschreibung, Rich-Text-Werte) **vor** der Sperre und gibt ihn als `before` weiter.
  - `AttachmentLinks::link(Model $owner, Project $project, User $writer, Document ...$docs): void` — in der Transaktion: `update attachments set attachable = owner where id in (…) and attachable_id is null and uploaded_by = writer and project_id = project` (ein Statement; schon besessene bleiben, A233).
  - `Mentions::after(Actor $actor, WorkItem $item, array $before, array $after, string $source, ?string $commentId = null): list<string>` — neu Erwähnte = `$after − $before` (IDs); Personen beobachten mit Grund `mentioned` (eine Abmeldung wird aufgehoben, A113), je Bot ein `bot.mentioned` (Subjekt Item, `meta.bot_id`, `source`, `comment_id`); gibt die neu Erwähnten zurück, die der Aufrufer als `meta.mentioned` an sein Event hängt.
  - `CreateWorkItem`/`UpdateWorkItem`/`ChangeWorkItemType`: Rich Text vor der Sperre mit Regeln; in der Transaktion `AttachmentLinks::link($item, …)` für Beschreibung und Rich-Text-Werte; Erwähnungen aus Beschreibung **und** Rich-Text-Werten zusammen (A244); `meta.mentioned` am `work_item.created` bzw. `work_item.updated` (nur wenn nicht leer).
  - `WorkItem::loadForResource($items, $reader, $lean)`: für nicht schlanke Items je **eine** Abfrage für alle Handles und eine für alle sichtbaren Verweise aller Texte der Items → `$item->rich_names` (`RichTextNames`); `WorkItemResource` schreibt `description` und `values_markdown` damit (verborgene Verweise als `[hidden](item:…)`). Die feste Zahl Abfragen (`WorkItemsApiTest`) wächst um höchstens zwei.
- Consumes: Tasks 4–7, `Assignable`, `Visibility`, `WorkItemSubscriber`.

- [ ] **Step 1: Failing Tests**
  - `RichTextRulesTest`: „turns a mention of someone without access into text“; „keeps a mention that was in the text before, also of a person who left the project“; „turns a reference to an item the writer does not see into its label“; „keeps a hidden reference that was in the text before“; „refuses an image of another project with 422 at the field“; „refuses an unowned image somebody else uploaded“ (13c); „takes an image another text of the project owns“; „fills the file name of a file node from the row“; „asks the database a fixed number of times for any number of nodes“.
  - `ItemRichTextTest`: „links the unowned uploads of the writer when an item is created and when its description changes“; „subscribes a newly mentioned person and lifts their opt-out“; „names only newly mentioned people in meta.mentioned“ (Mara schon erwähnt, Lene neu → nur Lene); „records bot.mentioned for a mentioned bot member, nothing for the default bot unless it is a member“; „counts mentions in rich text values“ (A244).
  - `RichTextApiTest` (Review Focus 5 über REST, `PATCH /api/v1/work-items/{key}` mit `description` als Markdown): „mentions nobody inside code or a link text“, „leaves a foreign handle as text“, „makes no reference of the key of an invisible item“, „answers 422 for an attachment of another project“, „writes a hidden reference as `[hidden](item:…)` for a reader who does not see it and as the key for one who does“ (zwei Leser über `GET`), „shows no key and no title of a hidden reference in description_json“.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='RichText|WorkItems|WorkItemsApiTest|ArchTest'`.
- [ ] **Step 3: `CLAUDE.md`** — Architektur „Rich Text“: Regeln, Lookup, Verknüpfen, Erwähnungen, `rich_names` in `loadForResource`; Items: `meta.mentioned`, `bot.mentioned`.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: check mentions, references and attachments when an item's rich text is saved`.

---

### Task 9: Kommentare: Datenmodell, Actions, History, Beobachten

**Modell:** opus

**Files:**
- Create: Migration `2026_11_02_001010_create_comments_tables.php`, `app/Models/{Comment,CommentReaction}.php`, `database/factories/CommentFactory.php`, `app/Policies/CommentPolicy.php`, `app/Actions/Comments/{ListComments,AddComment,GetComment,EditComment,DeleteComment}.php`, `app/Http/Controllers/Api/CommentsController.php`, `app/Http/Resources/CommentResource.php`, `tests/Feature/Comments/{AddCommentTest,EditCommentTest,DeleteCommentTest,ListCommentsTest}.php`, `tests/Feature/Api/CommentsApiTest.php`
- Modify: `app/Providers/AppServiceProvider.php` (Morph-Map `comment`, Policy), `routes/api.php` (`Route::bind('comment')`, Routen in der Gruppe mit `RedirectFormerItemKey` für `{item}`), `app/Actions/WorkItems/ListHistory.php` (A227, A228), `app/Http/Resources/HistoryEntryResource.php` (`comment_id`, `author_id` aus `meta`), `app/Policies/AttachmentPolicy.php` (Besitzer `comment`), `app/Events/EventType.php`, `tests/Feature/WorkItems/ListHistoryTest.php`, `tests/Feature/Attachments/ShowAttachmentTest.php`, `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `tests/Feature/MorphMapTest.php`, `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - Tabellen nach „Datenmodell“ (die Reaktionen-Tabelle schon hier, Task 10 füllt sie).
  - `CommentPolicy`: `view` (wer das Item sieht), `create` (`item.comment` im Projekt, `problem.detail.comment_readers_only` für den unwahrscheinlichen Fall ohne), `update` (nur Autor oder Autorin mit `item.comment`; sonst 403 `problem.detail.comment_author_only`), `delete` (Autor/Autorin oder Projektrolle Admin, auch Org-Admins; sonst 403 `problem.detail.comment_delete_admins_only`, A241). Unsichtbares 404.
  - `AddComment::handle($actor, WorkItem $item, array $input): Comment` — Recht `create`; `body`/`body_json` vor der Sperre (`RichTextInput::from` mit `RichTextRules::context($project, $actor->user, null)`), leer → 422 `field.body.required`; Transaktion `DB::transaction(…, 3)`: `ItemLock::take` → archiviertes Projekt 409 `project_archived` → archiviertes Item 409 `archived` (A240) → Zeile (`body_text` = `toText()`) → `AttachmentLinks::link($comment, …)` → Kommentierende Person beobachtet (Grund `commented`, **ohne** eine Abmeldung aufzuheben; Bots nie) → `Mentions::after(…, [], <IDs>, 'comment', $comment->id)` → `comment.created` (Subjekt Item, `meta.comment_id`, `meta.mentioned`); `updated_at` des Items bleibt (ein Kommentar ändert das Item nicht, A227). Danach `loadForResource`-Gegenstück `Comment::loadForResource($comments, $reader)` (Reaktionen, `rich_names`).
  - `EditComment::handle($actor, Comment $comment, array $input): Comment` — Recht `update`; Text vor der Sperre mit dem gespeicherten als `before`; Transaktion: `ItemLock::take($comment->workItem)`, Kommentar `lockForUpdate` frisch (weg → 404), Archiv-Prüfungen, gleiches JSON → nichts (kein Event, `edited_at` bleibt); sonst `edited_at = now()`, Verknüpfen, `Mentions::after` mit den alten Erwähnungen, `comment.updated` mit `changes.body {old, new}` (JSON), `meta.comment_id`, `meta.author_id`, `meta.mentioned`.
  - `DeleteComment::handle($actor, Comment $comment): void` — Recht `delete`; Transaktion: `ItemLock::take`, Kommentar frisch (weg → 404), Archiv-Prüfungen; Anhänge des Kommentars über `AttachmentFiles::removeAfterCommit` (Master-Plan Phase 7), Zeile weg (Reaktionen per Kaskade), `comment.deleted` mit `changes` `null`, `meta.comment_id`, `meta.author_id` (A228).
  - `ListComments::handle($actor, WorkItem|string $item, array $query): ListResult` (Recht `view`; älteste zuerst, `created_at`, `id`; `PageArgs`; `Comment::loadForResource`), `GetComment::handle($actor, Comment $comment): Comment`.
  - `CommentResource` nach „REST“ (`body` Markdown mit `rich_names`).
  - `ListHistory`: Typen `work_item.%` außer `LEFT_OUT` **plus** `comment.updated`, `comment.deleted`; `HistoryEntryResource` reicht `changes.body` unverändert (JSON) und `meta.comment_id`/`meta.author_id` als `comment_id`/`comment_author_id` aus.
- Consumes: Tasks 6–8, `ItemLock`, `Mentions`, `AttachmentLinks`, `AttachmentFiles`.

- [ ] **Step 1: Failing Tests** — `AddCommentTest`: „lets a viewer comment and subscribes them“; „keeps the opt-out of a commenter who unsubscribed“ (Task 1 legt die Abmeldung an); „lifts the opt-out of a person the comment mentions“; „records comment.created on the item with the comment id and the newly mentioned“; „refuses an empty comment with 422 at body“; „refuses an archived item and an archived project with 409“; „links the writer's unowned uploads to the comment“; „hides the item of a private project from an outsider (404)“; „leaves updated_at of the item alone“. `EditCommentTest`: „marks the comment edited and keeps the old version in the history“; „records nothing for the same text“; „lets only the author edit (403 for an admin)“; „names only people the edit mentions newly“; „waits for a concurrent deletion and answers 404“ (Integration-Fall in `tests/Integration/CommentRaceTest.php` über `RaceConnections`: `hold` sperrt das Item, `second` editiert, `release` nach dem Löschen → 404). `DeleteCommentTest`: „lets the author and project admins delete, not a member (403)“; „removes the comment's attachments after the commit“; „records comment.deleted without the text“. `ListHistoryTest`: „shows comment edits and deletions, not the creation and not reactions“. `ShowAttachmentTest`: „serves the image of a comment to readers of its item only“. Matrix: fünf Zeilen (Viewer erlaubt für Liste, Anlegen, Lesen; Bearbeiten nur Autor: die Welt legt den Kommentar je Spalte selbst an; Löschen eines fremden Kommentars nur Projekt-Admin und Org-Admin); Routen-Matrix: fünf Routen.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Comment|ListHistoryTest|Attachment|RightsMatrixTest|RouteMatrixTest|MorphMapTest'`; `ddev artisan test --testsuite=Integration --filter=CommentRaceTest`.
- [ ] **Step 3: `CLAUDE.md`** — Architektur „Kommentare“ (Tabellen, Rechte A240/A241, Events A227/A228, Beobachten, History, Resource).
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: add comments with edit, delete, history and automatic watching`.

---

### Task 10: Reaktionen

**Modell:** sonnet (mechanisch, Regeln vollständig)

**Files:**
- Create: `app/Actions/Comments/{AddReaction,RemoveReaction}.php`, `app/Http/Controllers/Api/ReactionsController.php`, `tests/Feature/Comments/ReactionsTest.php`
- Modify: `app/Events/EventType.php` (`CommentReactionAdded`, `CommentReactionRemoved`, `webhook()` falsch), `app/Actions/WorkItems/ListHistory.php` (`LEFT_OUT`), `routes/api.php`, `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `lang/{en,de}.json` (`field.emoji.invalid`), `CLAUDE.md`

**Interfaces:**
- Produces: `AddReaction::handle($actor, Comment $comment, array $input): Comment` und `RemoveReaction::handle($actor, Comment $comment, array $input): Comment` — `emoji` Pflicht, `Emoji::is` (Task 2), sonst 422 `field.emoji.invalid`; Recht `CommentPolicy::react` (= `view` und `item.comment`); Transaktion mit `ItemLock::take($comment->workItem, false)` (ohne Organisation wie Beobachten), Kommentar frisch (weg → 404), archiviertes Projekt/Item 409 (A240); Hinzufügen per `insertOrIgnore` (vorhanden → kein Event), Entfernen nur einer vorhandenen Zeile (sonst kein Event); Events `comment.reaction_added`/`removed` (Subjekt Item, `meta.comment_id`, `meta.emoji`); Antwort der Kommentar mit Reaktionen (`Comment::loadForResource`). Gleiches Emoji in anderer Schreibweise ist ein anderes (`utf8mb4_bin`, P14).
- Consumes: Tasks 2, 9.

- [ ] **Step 1: Failing Tests** — `ReactionsTest`: „adds a reaction once per person and emoji“; „removes only the own reaction“; „keeps 👍 and 👍🏽 apart“; „refuses text as emoji with 422“; „lets a viewer react“; „refuses an archived item with 409“; „records the events, which the history leaves out“. Matrix- und Routen-Zeilen.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Reactions|ListHistoryTest|RightsMatrixTest|RouteMatrixTest'`.
- [ ] **Step 3: `CLAUDE.md`** — Kommentare: Reaktionen.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: react to comments with an emoji`.

---

### Task 11: `@`- und `#`-Grundlagen: `GET /mentions`, `GET /references`

**Modell:** opus

**Files:**
- Create: `app/Actions/RichText/{ListMentionables,ResolveReferences}.php`, `app/Http/Controllers/Api/RichTextController.php`, `tests/Feature/RichText/{ListMentionablesTest,ResolveReferencesTest}.php`
- Modify: `routes/api.php`, `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `ListMentionables::handle($actor, array $query): Collection<User>` — `project` (Referenz, unsichtbar/unbekannt/in Löschung → 404), `q` optional (getrimmt, höchstens 64 Zeichen), `limit` 1–50 (20, `field.limit.invalid`); Konten nach `Assignable::check` (aktive Mitglieder, Org-Admins als Personen, Bots nur als Mitglied), `q` trifft Name oder Handle (`like`, maskiert), Wortanfänge zuerst, Personen vor Bots, dann Name (wie `matchPeople` des Klickdummys); `{data: UserResource[]}` mit `media`.
  - `ResolveReferences::handle($actor, array $query): EloquentCollection<WorkItem>` — `items` (Komma oder Liste, 1–100 ULIDs, sonst `field.items.invalid`); nur sichtbare Items (`ItemQuery::for(…, include_archived: true)->whereKey(…)`), schlank über `loadForResource(…, lean: true)`; Reihenfolge wie gefragt; unsichtbare und unbekannte fehlen (A230). Antwort `{data: {items: WorkItemResource[]}}`.
  - Beide sind Lesezugriffe (Lese-Token).
- Consumes: `Assignable`, `ItemQuery`, `Visibility`.

- [ ] **Step 1: Failing Tests** — `ListMentionablesTest`: „lists members and org admins, bots only as members“, „leaves out the default bot unless it is a member“, „leaves out deactivated accounts“, „puts starts of words first and people before bots“, „answers 404 for an invisible project“. `ResolveReferencesTest`: „names the items the reader sees and leaves the others out“ (Ida: OPS-ID fehlt, keine Zahl, keine 404), „keeps the order asked for“, „includes archived items“, „refuses more than 100 ids“. Matrix- und Routen-Zeilen.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Mentionables|ResolveReferences|RightsMatrixTest|RouteMatrixTest'`.
- [ ] **Step 3: `CLAUDE.md`** — Rich Text: die zwei Endpunkte, A230.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: list who can be mentioned and resolve references for the reader`.

---

### Task 12: Kommentare im Suchindex

**Modell:** opus

**Files:**
- Modify: `app/Models/WorkItem.php` (`toSearchableArray`: `comments`; `makeAllSearchableUsing`: `comments:id,work_item_id,body_text`), `config/scout.php` (`searchableAttributes` `key`, `title`, `description`, `comments`), `app/Search/SearchConsumer.php` (`comment.created|updated|deleted` → `upsertItem(subject_id)`), `tests/Feature/Search/{SearchDocumentsTest,SearchConsumerTest}.php`, `tests/Integration/{SearchSettingsTest,SearchRelevanceTest}.php`, `tests/Support/ArraySearchEngine.php` (falls nötig), `docs/{en,de}/search.md` (Kommentare), `CLAUDE.md` (Suche: Index, Konsument)

**Interfaces:**
- Produces: Item-Dokument mit `comments` (die `body_text` aller Kommentare in Zeitordnung, durch `\n` getrennt, auf `SearchIndexer::COMMENTS_MAX` 65 536 Bytes gekürzt, ohne ein Zeichen zu zerschneiden; A245); der Konsument indexiert das Item bei jedem Kommentar-Event neu; Reaktionen und `bot.mentioned` übergeht er.
- Consumes: Task 9.

- [ ] **Step 1: Failing Tests** — `SearchDocumentsTest`: „puts the text of the comments into the item's document, cut at 64 KB“. `SearchConsumerTest`: „reindexes the item when a comment is added, edited or deleted“, „ignores reactions“. `SearchSettingsTest`: Einstellungen nennen `comments` nach `description`. `SearchRelevanceTest`: „finds an item by a word of a comment, after title and description matches“.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Search'`; `ddev artisan test --testsuite=Integration --filter='SearchSettingsTest|SearchRelevanceTest'`.
- [ ] **Step 3: `CLAUDE.md` und Doku** — Suche: `comments` im Dokument, Konsument auf `comment.*`; `search.md` en/de: Kommentare werden gefunden; Hinweis „nach dem Update `app:search-sync`“.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: find items by the text of their comments`.

---

### Task 13: Aufräumen: Löschen von Items und Projekten, Uploads ohne Besitzer, `app:prune-attachments`

**Modell:** opus

**Files:**
- Create: `app/Actions/Attachments/{PruneUnownedAttachments,PruneAttachments}.php`, `app/Jobs/PruneUnownedAttachmentsJob.php`, `app/Console/Commands/PruneAttachmentsCommand.php`, `tests/Feature/Attachments/PruneTest.php`, `tests/Feature/Console/PruneAttachmentsCommandTest.php`, `tests/Integration/AttachmentRollbackTest.php`
- Modify: `app/Actions/WorkItems/DeleteWorkItem.php`, `app/Actions/Projects/PurgeProject.php`, `routes/console.php` (Scheduler: Job stündlich, `withoutOverlapping`), `tests/Feature/WorkItems/DeleteWorkItemTest.php`, `tests/Feature/Api/DeleteProjectTest.php`, `tests/Feature/Access/matrix.php` (`system`-Zeilen), `docs/{en,de}/development.md` (Kommando), `CLAUDE.md`

**Interfaces:**
- Produces:
  - `DeleteWorkItem`: in der Transaktion nach den Relationen die Anhänge des Items und seiner Kommentare (`attachable` = Item oder ein Kommentar des Items) über `AttachmentFiles::removeAfterCommit`; Kommentare und Reaktionen gehen per Kaskade.
  - `PurgeProject`: alle Anhänge des Projekts (auch ohne Besitzer) über `AttachmentFiles` vor dem Löschen des Projekts.
  - `PruneUnownedAttachments::handle(Actor $actor, CarbonInterface $before): int` — löscht Anhänge ohne Besitzer, älter als 24 Stunden, in Blöcken zu 200 (`chunkById`), je Block eine Transaktion, Dateien nach dem Commit; kein Event (A239). Job `PruneUnownedAttachmentsJob` (Queue `default`) ruft es stündlich als `Actor::system(defaultBot, 'prune_attachments')`.
  - `PruneAttachments::handle(Actor $actor, int $minAgeDays, bool $dryRun): list<array{id, project, filename, size}>` — Anhänge `kind: inline` mit Besitzer, älter als `minAgeDays`, die der aktuelle Text ihres Besitzers nicht mehr nennt (Item: Beschreibung und Rich-Text-Werte; Kommentar: Text); ohne `dryRun` gelöscht (Dateien nach dem Commit); Bilder aus Texten der History zählen nicht (in der Doku gesagt).
  - `app:prune-attachments {--dry-run} {--min-age=30}` (Tage, ganze Zahl ≥ 1, sonst Fehler und Exitcode 1): gibt je Anhang eine Zeile und am Ende „Pruned N attachments (X MB).“ bzw. „Would prune …“ aus.
- Consumes: Tasks 6, 7, 9.

- [ ] **Step 1: Failing Tests** — `DeleteWorkItemTest`: „removes the files of the item and of its comments after the commit“. `DeleteProjectTest`: „purges the files of the project, also unowned uploads“. `PruneTest`: „removes unowned uploads older than a day, not younger ones and not owned ones“; „prunes images no text names any more and keeps those still named“; „keeps everything in a dry run“; „keeps files of the file list“. `PruneAttachmentsCommandTest`: Ausgabe, `--min-age=0` Fehler. `AttachmentRollbackTest` (Integration, ohne Test-Transaktion): „keeps rows and files when deleting an item fails after the attachments“ (eine Exception nach `removeAfterCommit` in der Transaktion → Dateien noch da). Matrix: `system`-Zeilen für beide Prune-Actions.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Prune|DeleteWorkItemTest|DeleteProjectTest|RightsMatrixTest'`; `ddev artisan test --testsuite=Integration --filter=AttachmentRollbackTest`.
- [ ] **Step 3: `CLAUDE.md` und Doku** — Kommandos: `ddev artisan app:prune-attachments --dry-run --min-age=30`; Scheduler; Architektur „Anhänge“: Aufräumen, A239.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: remove attachment files with their items and projects and prune unowned and unused uploads`.

---

### Task 14: Demo-Daten: Kommentare, Reaktionen, Dateien, Erwähnungen und Verweise als Knoten

**Modell:** opus

**Files:**
- Create: `database/seeders/Demo/{CommentsSeeder,AttachmentsSeeder}.php`, `database/seeders/Demo/files/{hero-entwurf.png,leistungsseiten-gliederung.pdf,postfix-main.cf.txt}` (aus den Data-URLs von `prototypes/clickdummy/src/api/seed/files.ts` dekodiert, je unter 1 KB), `tests/Feature/Seeders/CommentsSeederTest.php`
- Modify: `database/seeders/DemoSeeder.php`, `database/seeders/Demo/{ItemsSeeder,ActivitySeeder}.php`, `database/seeders/E2eSeeder.php`, `tests/Feature/{DemoSeederTest,E2eSeederTest}.php`, `CLAUDE.md` (Seeder)

**Interfaces:**
- Produces:
  - `ItemsSeeder`: Beschreibungen über `Document::fromMarkdown($md, new MarkdownContext($project, new RichTextLookups($project, $creator)))`: `@mara` wird Erwähnung, `WEB-42` ein Verweis (Rundreise der Demo-Texte, Vormerkung Phase 7); bestehende Items ändert er weiter nicht (K13): eine schon geseedete Datenbank behält ihre Texte, bis sie neu aufgesetzt wird.
  - `CommentsSeeder`: die Kommentare aus `seed/activity.ts` (`comment(…)`-Zeilen) mit Autor, Zeit (Berliner Wanduhr nach UTC wie `ItemsSeeder::at()`), Text über Markdown mit Lookup, Reaktionen; nur für Items ohne Kommentare (wie K14); Kommentierende und Erwähnte als Beobachter (`commented`/`mentioned`, `firstOrCreate`, nie Bots); keine Events außer, was `ActivitySeeder` schon schreibt (A86).
  - `AttachmentsSeeder`: die drei Dateien an ihren Items aus `seed/activity.ts` (Dateiliste, `kind: file`, Hochladende aus dem Seed), nur wenn das Item noch keine Datei dieses Namens hat; über medialibrary (`addMedia(copy)->preservingOriginal()`).
  - `E2eSeeder` räumt Kommentare und Anhänge der `E2E `-Projekte mit den Projekten ab (über `PurgeProject`, schon da) und Uploads ohne Besitzer der e2e-Konten (`PruneUnownedAttachments` mit `now()`).
  - `DemoSeeder` ruft die zwei neuen Seeder nach `ActivitySeeder` und baut danach den Suchindex neu (schon da).
- Consumes: Tasks 5, 8, 9, 10, 6.

- [ ] **Step 1: Failing Tests** — `CommentsSeederTest`: liest `seed/activity.ts` und vergleicht Zahl, Item, Autor und Text jedes Kommentars sowie die Reaktionen; „turns @mara and WEB-42 in the demo texts into nodes“; „subscribes commenters and mentioned people, never bots“; „adds nothing on a second run“. `DemoSeederTest`: drei Dateien mit Medien; `E2eSeederTest`: Uploads ohne Besitzer der e2e-Konten weg.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Seeder'`; `ddev artisan migrate:fresh --seed --seeder=DemoSeeder` läuft durch.
- [ ] **Step 3: `CLAUDE.md`** — Seeder: Comments-/AttachmentsSeeder.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: seed demo comments, reactions, files and mentions as nodes`.

---

### Task 15: Frontend-Datenschicht: Kommentare, Anhänge, Erwähnungen, Verweise; Pakete

**Modell:** opus

**Files:**
- Create: `resources/js/api/{comments,attachments,richText}.ts` (+ Tests), `resources/js/hooks/{comments,attachments,richText}.ts`
- Modify: `package.json`, `pnpm-lock.yaml` (Pakete aus „Paketversionen“, `ddev exec pnpm add -E @tiptap/extension-mention@3.32.0 @tiptap/suggestion@3.32.0 @tiptap/extension-code-block-lowlight@3.32.0 @tiptap/extension-image@3.32.0 @tiptap/extension-file-handler@3.32.0 && ddev exec pnpm add lowlight@^3.3.0 highlight.js@^11.11.2`), `resources/js/types.ts` (`Comment.body_json`, `body`; `Attachment` mit `inline`, `url`, `preview_url`, `uploaded_by`, `created_at`; `ItemEvent` mit `comment_id`, `comment_author_id`), `resources/js/api/workItems.ts` (`getWorkItem` mit `include=…,attachments`, `listActivity` bleibt die History), `resources/js/hooks/{keys.ts,workItems.ts}` (`useActivity` liest History und Kommentare, A247; `qk.comments`, `qk.references`, `qk.mentions`), `resources/js/lib/richtext.ts` (`mentionedIds`, `attachmentIds`, `referenceIds`, `docToText` mit Knoten), `resources/js/test/fixtures.ts` (`makeComment`, `makeAttachment`, `web47Comments`), `resources/js/hooks/data.test.tsx`, `CLAUDE.md` (Frontend-Datenschicht, Tech Stack)

**Interfaces:**
- Produces:
  - `api/comments.ts`: `listComments(itemRef, args?)` → `Page<Comment>`, `addComment(work_item_id, body: RichText)` (schickt `body_json`), `editComment(id, body)`, `deleteComment(id)`, `toggleReaction(comment_id, emoji, on: boolean)` (`POST`/`DELETE …?emoji=`; Abweichung vom Klickdummy: `on` statt Umschalten, weil der Server idempotent ist, A242).
  - `api/attachments.ts`: `getAttachment(id)`, `uploadAttachment(project_id, file, owner: { type: 'work_item'; id } | null, kind, { onProgress, signal })` (über `upload()` aus `http.ts`; `inline` immer ohne Besitzer, A232), `deleteAttachment(id)`, `attachmentUrl(attachment, { preview?, download? })`.
  - `api/richText.ts`: `listMentionables(project, q, limit?)`, `resolveReferences(ids)` (`GET /references?items=`).
  - Hooks: `useComments(itemId)` (alle Seiten), `useAddComment`, `useEditComment`, `useDeleteComment` (machen `comments`, `activity`, `workItems` ungültig), `useToggleReaction` (optimistisch auf den Kommentar im Cache; Fehler rollt zurück und meldet je Aufruf über `useSettle`, 13c „reactions toggle loses earlier error toasts“), `useAttachment(id)` (`staleTime: Infinity`), `usePrimeAttachments(list)`, `useUploadAttachment()` (schreibt die Antwort in `qk.attachments.detail`), `useDeleteAttachment`, `useMentionables(project, q, enabled)` (`keepPreviousData`), `useItemRef(id)` (ein Sammler fasst die IDs eines Ticks zu **einer** `resolveReferences`-Anfrage zusammen, je ID ein Cache-Eintrag `qk.references.item(id)`; fehlt eine ID in der Antwort, ist der Eintrag `hidden`), `primeItemRef(item)` (nach der Wahl im `#`-Menü).
  - `useActivity(itemId)`: `ActivityEntry[]` aus allen Seiten der History und aller Kommentare, nach `at` und bei Gleichstand Kommentar nach Event; `isError` nur, wenn eine Quelle ohne Daten scheitert.
- Consumes: Tasks 6–11 (REST-Formen).

- [ ] **Step 1: Failing Tests** — `api/comments.test.ts`, `api/attachments.test.ts` (Upload mit Fortschritt über einen falschen `XMLHttpRequest`, 413 wird `ApiError` mit `payload_too_large`), `api/richText.test.ts`; `hooks/data.test.tsx`: „merges comments and history in order“, „batches the references of one tick into one request“ (drei `useItemRef` → ein Aufruf), „marks a reference the server leaves out as hidden“, „rolls back a reaction the server refuses and reports each failure“.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/api resources/js/hooks resources/js/lib`.
- [ ] **Step 3: `CLAUDE.md`** — Tech Stack (neue Pakete, Pins), Frontend-Datenschicht (neue Dateien, A242, A247).
- [ ] **Step 4: Gates G2**
- [ ] **Step 5: Commit** — `feat: add the data layer for comments, attachments, mentions and references`.

---

### Task 16: Editor I: Überträge, Code-Hervorhebung, `/`-Menü, `@` und `#`

**Modell:** opus

**Files:**
- Create: `resources/js/editor/{codeBlocks.ts,suggestions.tsx,slashMenu.tsx,mentions.tsx,references.tsx,EditorEnv.tsx}`, `resources/js/editor/suggestions.test.tsx`
- Modify: `resources/js/editor/{RichTextEditor.tsx,RichTextView.tsx,presets.ts,editor.css,editor.test.tsx,lateTables.test.tsx}`, `resources/js/lib/shortcuts/widgets.ts` (Editor-Tasten), `docs/{en,de}/keyboard.md` (erzeugt), `lang/{en,de}.json` (`editor.slash.*`, `editor.mention.*`, `editor.reference.*`, neue Platzhalter mit `/`, `@`, `#`), `CLAUDE.md` (Editor)

**Interfaces:**
- Produces:
  - Überträge aus Phase 4 (T17): der Erweiterungs-Chunk (Tabellen **und** Code-Hervorhebung) wird nach einem Ladefehler beim nächsten Rendern neu versucht statt als abgelehntes Promise zu bleiben (M1); ein später `null` vom Eltern-Element setzt den Editor zurück (M2); `fitDoc` je Render nur bei geändertem Wert, `useLevel` ohne Tabellen-Chunk für `comment` (M6, M7).
  - `codeBlocks.ts` (Port): `lowlight` mit den 13 Sprachen des Klickdummys, `highlightedCodeBlock`; im Chunk mit den Tabellen (`preloadEditor()` lädt beides).
  - `EditorEnv` (React-Kontext und Ref): `projectId`, `owner` nicht mehr (A232), `onUploadError`; `RichTextEditor` nimmt `projectId?: string` (ohne Projekt: kein `@`, kein `#`, keine Uploads).
  - `suggestions.tsx`: `SuggestionMenu` und `popupRenderer` (Port, Combobox auf dem Editor mit `aria-controls`/`aria-activedescendant`, Escape schließt nur die Liste).
  - `slashMenu.tsx`: `/` am Zeilenanfang oder nach Leerraum; Einträge je Stufe: Überschrift 1–3, Liste, nummerierte Liste, Checkliste, Code, Zitat, Tabelle (nur `slashTable`), Bild/Datei (öffnet die Dateiauswahl, Task 17; ohne Projekt nicht da), Linie (nur `page`); Texte `editor.slash.*`.
  - `mentions.tsx`: `mentionExtension(env)` mit `@`-Liste über `useMentionables(projectId, query)` (Name, `@handle` bzw. `botWord`), speichert `{id, label}`; `MentionView` zeigt `@<aktueller Handle>` aus `useUserMap()`, ein deaktiviertes Konto mit „(deaktiviert)“.
  - `references.tsx`: `referenceExtension(env)` mit `#`-Liste über `useSearch(query, { types: ['items'], limit: 6 })` (A230; ohne Eingabe der Hinweis „Key oder Titel eingeben …“), speichert `{id, kind: 'item'}` und `primeItemRef(item)`; `ReferenceView` über `useItemRef(id)`: Typ-Glyph und Key (Titel für Screenreader), im Lesen ein Link `paths.item(key)`, verborgen „verborgen“ mit `EyeOff`, beim Laden „…“; `isGone` aus `features/item-detail/shared.tsx` statt einer Kopie (13c „isHidden duplicates isGone“).
  - `RichTextView` zeigt dieselben Knoten (Erwähnung, Verweis, Bild, Datei aus Task 17) und Code mit Hervorhebung.
  - Platzhalter nennen jetzt `/`, `@`, `#` (P15 aus Phase 4 aufgehoben).
- Consumes: Task 15, `useSearch`, `useUserMap`, `paths`.

- [ ] **Step 1: Failing Tests** — `editor.test.tsx` (bestehende Stubs, `await preloadEditor()`): „opens the / menu and turns the line into a heading“; „offers a table in / only on page“; „highlights a code block in its language“; „mentions a member with @ and stores id and handle“; „shows the current handle of a renamed account“; „refers to an item with # over the search and shows its key“; „shows a hidden reference as hidden“ (`resolveReferences` ohne die ID); „closes a suggestion list with Escape without closing the dialog“; „retries the extension chunk after a failed load“ (M1); „resets when the parent passes null later“ (M2). `editor.test.tsx` „knows no node or mark the server does not“ bleibt grün mit den neuen Knoten (liest `Schema.php`). `suggestions.test.tsx`: Pfeile, Enter/Tab, aktive Option, leere Liste.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/editor`; `ddev exec pnpm shortcuts:doc`.
- [ ] **Step 3: `CLAUDE.md`** — Editor: `/`, `@`, `#`, Code, Überträge.
- [ ] **Step 4: Gates G2** (G3 gezielt erst in Task 21, wo Specs den Editor fahren)
- [ ] **Step 5: Commit** — `feat: add the slash menu, code highlighting, mentions and references to the editor`.

---

### Task 17: Editor II: Bilder und Dateien per Einfügen, Ziehen und Auswahl mit Fortschritt

**Modell:** opus

**Files:**
- Create: `resources/js/editor/{uploads.ts,nodes.tsx,UploadContext.tsx}`, `resources/js/editor/uploads.test.tsx`, `e2e/tests/editor.spec.ts`
- Modify: `resources/js/editor/{RichTextEditor.tsx,RichTextView.tsx,presets.ts,editor.css}`, `lang/{en,de}.json` (`editor.upload.*`), `CLAUDE.md` (Editor)

**Interfaces:**
- Produces:
  - `nodes.tsx`: `AttachmentImage` (Port, `attachmentId`, `alt`, Block, ohne `src`; zeigt `preview_url` oder `url` aus `useAttachment(id)` als `<img loading="lazy">`, Alt-Text bearbeitbar per Doppelklick bzw. Enter auf dem ausgewählten Bild; nicht ladbar → Kasten „Bild nicht verfügbar“; ein Klick im Lesen öffnet das Original in neuem Tab) und `AttachmentFile` (Chip mit Name und Größe, Link mit `?download=1`).
  - `uploads.ts`: `uploadFiles(editor, files, pos, env)` — je Datei ein Platzhalter (Decoration mit Name und `role="progressbar"`, `aria-valuenow`), `uploadAttachment(projectId, file, null, 'inline', { onProgress, signal })`; danach Knoten an der Stelle des Platzhalters (`image` für `inline: true`, sonst `attachment`); Fehler: Platzhalter weg und `env.onUploadError(file, error)` (Toast mit dem Satz des Servers; 413 nennt die Grenze); `FileHandler` für Einfügen und Ziehen (auch mehrere Dateien), `<input type=file multiple>` für das `/`-Menü; laufende Uploads bricht das Aushängen des Editors ab (`AbortController`), schon hochgeladene, deren Knoten nicht mehr im Text steht, meldet der Editor über `onOrphanedUploads(ids)` (13c „orphaned uploads after editor unmount“).
  - `UploadContext`: zählt laufende Uploads je Editor (`useUploadsPending()`); Formulare sperren „Senden“, solange einer läuft (`items.upload.pending` als Grund).
  - Ohne `projectId` (Ansicht ohne Projekt) gibt es weder Einfügen noch Ziehen von Dateien; eingefügtes HTML mit `<img src>` wird kein Bild (A236 im Client wie im Server).
- Consumes: Tasks 15, 16.

- [ ] **Step 1: Failing Tests** — `uploads.test.tsx` (falscher `XMLHttpRequest` aus `test/`): „pastes an image and shows its progress, then the image“; „drops two files and uploads both“; „makes a file chip of a PDF“; „removes the placeholder and reports a 413“; „aborts running uploads when the editor goes away“; „reports uploads whose nodes left the text“; „ignores pasted images from the web“; „lets a reader edit the alt text of an image“. `e2e/tests/editor.spec.ts` (eigenes Projekt, Item per API): „pastes an image into the description and shows it after a reload“ (`ClipboardEvent` mit `DataTransfer` über `page.evaluate`), „chooses a file over / and downloads it“, „highlights code typed after ``` and a language“, „mentions over @ and refers over #“ (Tastatur).
- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/editor`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test editor`.
- [ ] **Step 3: `CLAUDE.md`** — Editor: Uploads, Knoten, Fallstrick „Einfügen von Dateien nur in Playwright prüfbar (jsdom kennt kein `ClipboardEvent`)“.
- [ ] **Step 4: Gates G2, G3 gezielt** (`editor item-description`)
- [ ] **Step 5: Commit** — `feat: paste, drop and choose images and files in the editor with progress`.

---

### Task 18: Kommentar-Composer und Entwürfe, die nichts verlieren

**Modell:** opus

**Files:**
- Create: `resources/js/lib/drafts.ts` (+ Test), `resources/js/features/item-detail/comments/CommentComposer.tsx`, `resources/js/features/item-detail/comments/comments.test.tsx`, `e2e/tests/comments.spec.ts`
- Modify: `resources/js/features/item-detail/{ItemBody.tsx,ItemDetailProvider (in shared.tsx oder eigener Datei),Description.tsx}`, `resources/js/lib/shortcuts/catalog.ts` (`item.comment` `m`), `docs/{en,de}/keyboard.md` (erzeugt), `lang/{en,de}.json` (`items.comments.*`), `CLAUDE.md`

**Interfaces:**
- Produces:
  - `lib/drafts.ts` (A251, A154/N2): `drafts.get(key)`, `drafts.set(key, doc | null)`, `drafts.subscribe(key, fn)`, `drafts.pending()` (Schlüssel mit ungesendetem Text); Schlüssel `comment:<itemId>`, `comment-edit:<commentId>`, `description:<itemId>`; ein `beforeunload` auf Modulebene fragt, solange `pending()` nicht leer ist (ersetzt den eigenen Guard der Beschreibung für ungesendeten Text; `syncLeaveGuard` bleibt für Konflikte). `Description` legt ungesendeten Text einer geschlossenen Ansicht nach einem 5xx hier ab und zeigt ihn beim nächsten Öffnen als Entwurf (N2 erledigt).
  - `CommentComposer({ item })` (Port): Knopf „Kommentar schreiben …“ mit `m` (Katalog `item.comment`, Bereich `detail`, über `ItemDetailProvider` mit `instance` wie `item.title`; in der Vorschau nur bei Fokus im Panel oder nirgends); der Editor (`preset` `comment`, `projectId`) mit „Später weiterschreiben“ und „Kommentieren“ (⌘↵, gesperrt, solange ein Upload läuft oder der Text leer ist); Senden über `useAddComment`: der gesendete Text bleibt im Editor sichtbar, bis die Antwort kommt; Getipptes während des Sendens bleibt (nur der gesendete Stand wird geleert, ist mehr da, bleibt der Rest als Entwurf); 5xx/keine Antwort → Text bleibt, Toast mit „Erneut versuchen“; 422 → Fehler am Editor; Erfolg → Editor leer, Entwurf weg, Fokus bleibt im Editor, Statusregion „Kommentar gesendet“; Verwerfen („Später weiterschreiben“ behält, Escape bei leerem Text schließt) löscht beim Verwerfen eines Entwurfs die Uploads ohne Besitzer, die der Entwurf hochlud (`deleteAttachment`, best effort, 13c). Ohne `item.comment` oder bei archiviertem Item/Projekt kein Composer, sondern der Grund (`useEditReason` für das Archiv, `usePermissions().reason('item.comment', …)`).
  - Am Handy (390 px) ist der Composer bedienbar (Spec 5.1): Knöpfe 44 px.
- Consumes: Tasks 15–17.

- [ ] **Step 1: Failing Tests** — `drafts.test.ts`: speichern, leeren, `pending`, `beforeunload`. `comments.test.tsx` (`mockApi`, `await preloadEditor()`): „opens with m and sends with mod+enter“; „keeps the text after a 500 and offers Try again“; „keeps what was typed while sending“ (Antwort hält per Promise); „keeps a draft when the preview closes and brings it back“; „deletes the uploads of a discarded draft“; „blocks sending while an upload runs“; „shows the reason instead of the composer on an archived item“; „lets a viewer comment“. `Description`-Test: „brings back text a closed view could not save after a 500“ (N2). `e2e/tests/comments.spec.ts`: „writes a comment with m and mod+enter“ (Tastatur), „keeps a draft over closing the preview“.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/item-detail resources/js/lib`; `ddev exec pnpm shortcuts:doc`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test comments item-description`.
- [ ] **Step 3: `CLAUDE.md`** — Abschnitte des Item-Details: Composer, `lib/drafts.ts`, `m`; „Nicht abgedeckt (Phase 7, A154)“ entfernen.
- [ ] **Step 4: Gates G2, G3 gezielt** (`comments item-description`)
- [ ] **Step 5: Commit** — `feat: write comments with m and keep unsent text across views and failures`.

---

### Task 19: Aktivität mit Kommentaren: Karten, Bearbeiten, Löschen, Reaktionen, Filter

**Modell:** opus

**Files:**
- Create: `resources/js/features/item-detail/comments/{CommentCard,CommentEditor,Reactions}.tsx`
- Modify: `resources/js/features/item-detail/activity/{Activity.tsx,timeline.ts,phrases.tsx,EventLine.tsx,activity.test.tsx}`, `resources/js/features/item-detail/comments/comments.test.tsx`, `e2e/tests/{comments,item-activity}.spec.ts`, `lang/{en,de}.json` (`items.activity.filter.comments`, `items.activity.field.comment_*`, `items.comments.*`), `CLAUDE.md` (Aktivität)

**Interfaces:**
- Produces:
  - `timeline.ts`: `ActivityFilter` = `all` | `comments` | `changes`; `TimelineEntry` um `{ kind: 'comment', key, at, comment }`; unter `comments` nur Kommentare, unter `changes` nur Events (wie bisher), unter `all` beides (ein Kommentar beendet eine Event-Zeile).
  - `Activity`: Filter „Alles“, „Kommentare“, „Änderungen“ (`?activity=comments`); `CommentComposer` am Ende (Task 18); „Mehr laden“ zählt Kommentare und Zeilen gleich.
  - `CommentCard({ comment, item })` (Port): Avatar, Name (Bot mit „Bot“), Zeit (`formatWhen`), „bearbeitet“ mit Tooltip der Zeit, Text über `RichTextView` (`comment`), Aktionen-Menü (Bearbeiten nur Autor/Autorin, Löschen Autor/Autorin oder Projekt-Admin über `usePermissions().can('item.delete', …)` als Näherung an die Projektrolle Admin); `article` mit Namen „Kommentar von :name“.
  - `CommentEditor` (Port): Bearbeiten im Editor, Entwurf in `drafts` (`comment-edit:<id>`), ⌘↵ speichert, Escape verwirft (eine offene `@`-Liste zuerst), Fehler bleiben im Editor, Erfolg schließt und gibt den Fokus dem Aktionen-Knopf.
  - Löschen über `runWithUndo` (5 s, ⌘Z): die Karte geht sofort, `DELETE` danach; ein Fehler bringt sie zurück; Fokus auf die nächste Karte, sonst den Composer-Knopf.
  - `Reactions({ comment, canReact })`: Chips mit Emoji, Zahl, `aria-pressed`, Name „:emoji, :count Reaktionen: :names“; „Reaktion hinzufügen“ öffnet den `EmojiPicker`; optimistisch (Task 15), ohne Recht nur Anzeige.
  - `phrases.tsx`: `comment.updated` → „hat einen Kommentar bearbeitet“ mit „Frühere Fassung anzeigen“ (aufklappbar, `RichTextView` der alten Fassung); `comment.deleted` → „hat einen Kommentar von :author gelöscht“; `changes.attachments` → „hat die Datei „:name“ angehängt/entfernt“.
- Consumes: Tasks 15, 16, 18, `EmojiPicker`, `runWithUndo`.

- [ ] **Step 1: Failing Tests** — `activity.test.tsx`: „shows comments and changes in order and filters them“, „reads an edit with its earlier version and a deletion“, „reads an added and a removed file“. `comments.test.tsx`: „edits an own comment and marks it edited“, „offers no edit on a foreign comment, delete only to admins“, „deletes with undo and brings the card back on failure“, „reacts and takes the reaction back“, „keeps each failed reaction's toast“ (13c). `e2e/tests/comments.spec.ts`: „edits and deletes a comment with undo (mod+z)“, „reacts with an emoji from the picker“. `item-activity.spec.ts`: „filters to comments“.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/item-detail`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test comments item-activity`.
- [ ] **Step 3: `CLAUDE.md`** — Aktivität: Kommentare, Filter, Phrasen.
- [ ] **Step 4: Gates G2, G3 gezielt** (`comments item-activity`)
- [ ] **Step 5: Commit** — `feat: show comments in the activity with edit, delete with undo and reactions`.

---

### Task 20: Dateiliste des Items

**Modell:** opus

**Files:**
- Create: `resources/js/features/item-detail/Attachments.tsx`, `resources/js/features/item-detail/attachments.test.tsx`, `e2e/tests/attachments.spec.ts`
- Modify: `resources/js/features/item-detail/ItemBody.tsx`, `resources/js/api/workItems.ts` (`attachments` aus der Antwort, `usePrimeAttachments`), `lang/{en,de}.json` (`items.attachments.*`), `CLAUDE.md`

**Interfaces:**
- Produces: `Attachments({ detail })` (Port): `Section` „Dateien“ mit Zahl; je Datei Icon bzw. Vorschau (Bild), Name (Link mit `?download=1`), Größe (`formatSize` mit `Intl` in `intlLocale()`), „Entfernen“ (nur mit `item.edit`, nicht archiviert) über `runWithUndo`; „Datei hochladen“ (`<input type=file multiple>`, nur mit Recht) und Ziehen auf den Abschnitt; je laufendem Upload eine Zeile mit Fortschritt, jede Datei mit eigenem Ergebnis (`useSettle` je Aufruf: keine hängende Zeile, ein Toast je Fehler, 13c „multi-file upload progress“); ohne Dateien und ohne Recht kein Abschnitt.
- Consumes: Task 15.

- [ ] **Step 1: Failing Tests** — `attachments.test.tsx`: „lists files with size and preview“, „uploads two files each with its own progress and result“, „removes a file with undo“, „shows nothing to a viewer without files“, „says why upload is not possible on an archived item“. `e2e/tests/attachments.spec.ts`: „uploads a file to the list and downloads it“ (`setInputFiles`), „removes it with undo and for good“.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/item-detail`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test attachments`.
- [ ] **Step 3: `CLAUDE.md`** — Abschnitte des Item-Details: Dateien.
- [ ] **Step 4: Gates G2, G3 gezielt** (`attachments`)
- [ ] **Step 5: Commit** — `feat: add the file list of an item with upload progress and undo`.

---

### Task 21: Uploads, `@` und `#` im Anlegen-Dialog und in Rich-Text-Properties

**Modell:** opus

**Files:**
- Modify: `resources/js/features/create-item/{CreateForm.tsx,draft.ts,create.test.tsx}`, `resources/js/features/item-detail/FieldsPanel.tsx` (Rich-Text-Properties mit `projectId`), `resources/js/components/fields/property/inputs.tsx` (Rich Text bleibt Textarea, R17), `e2e/tests/create-item.spec.ts`, `CLAUDE.md` (Anlegen-Dialog)

**Interfaces:**
- Produces: Der Editor der Beschreibung im Anlegen-Dialog bekommt `projectId` (das gewählte Projekt): `/`, `@`, `#`, Bilder; „Anlegen“ wartet auf laufende Uploads (`useUploadsPending`, Grund am Knopf); ein Projektwechsel mit Bildern im Entwurf sagt im Banner `items.create.images_other_project` („Bilder aus dem alten Projekt passen nicht: entferne sie oder wechsle zurück.“) und markiert die Beschreibung, weil der Server sie mit 422 ablehnte (A233); ein geparkter Entwurf behält seine Uploads (sie gehören bis zum Anlegen niemandem, 24 h); verworfen (Toast abgelaufen) löscht sie wie der Composer. Rich-Text-Properties im Detail bekommen `projectId`.
- Consumes: Tasks 16–18.

- [ ] **Step 1: Failing Tests** — `create.test.tsx`: „sends a pasted image with the item“ (Upload gemockt, Knoten im `description_json`), „waits for a running upload before creating“, „warns about images after a project change“, „deletes the uploads of a draft whose undo ran out“. `create-item.spec.ts`: „creates an item with a pasted image and a mention“.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/create-item resources/js/features/item-detail`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test create-item`.
- [ ] **Step 3: `CLAUDE.md`** — Anlegen-Dialog: Uploads und Projektwechsel.
- [ ] **Step 4: Gates G2, G3 gezielt** (`create-item`)
- [ ] **Step 5: Commit** — `feat: paste images and mention people in the create dialog`.

---

### Task 22: Abnahme: Flow 4, Bilder per Einfügen, kein Bild für Unbefugte

**Modell:** opus

**Files:**
- Create: `e2e/tests/content-acceptance.spec.ts`
- Modify: `e2e/helpers.ts` (`pasteFile(page, locator, { name, type, bytes })`, `pngBytes(width, height)` (ein kleines PNG im Speicher), `uploadViaApi(page, projectId, file, kind)`), `e2e/fixtures.ts` (`allowedErrors`: die erwartete 404 des Bilds für Ida), `CLAUDE.md` (e2e-Helfer)

**Interfaces:**
- Produces (je Test ein eigenes Projekt, `finally` räumt ab):
  - „Flow 4: mentions Mara with @ma in a comment, and Mara watches the item“ — e2e-Person öffnet ein Item, `m`, tippt `Hallo @ma`, Enter wählt Mara, ⌘↵; der Kommentar zeigt „@mara“; per API: Mara beobachtet das Item (`GET …/subscribers`), das letzte `comment.created` nennt sie in `meta.mentioned` (über `GET …/history` nicht sichtbar → über `GET /api/v1/work-items/{key}/comments` und Beobachter); Erfolgskriterium 2.4 bis zur Benachrichtigung (Phase 8).
  - „pastes an image into the description and into a comment“ (Erfolgskriterium 5 für Beschreibung und Kommentar): `pasteFile` mit PNG in die Beschreibung → Bild sichtbar, nach Reload noch da (`naturalWidth > 0`); dasselbe im Composer, senden, Bild in der Karte.
  - „gives Ida neither the image nor its preview“ (Abnahme „Bild für Unbefugte 403/404“): Bild eines Items im privaten Projekt; `signedInContext(browser, PEOPLE.ida)` → `request.get('/attachments/<id>')` und `/preview` 404, `GET /api/v1/attachments/<id>` 404; die Item-Seite selbst 404.
  - „downloads an SVG instead of showing it“: SVG per API hochgeladen, `GET /attachments/<id>` → `content-disposition: attachment`, `x-content-type-options: nosniff`, `content-security-policy` mit `sandbox`.
  - „comments on the phone“: Viewport 390 px (Projekt `mobile`), Composer öffnen, schreiben, senden (Spec 5.1).
- Consumes: alles Vorige.

- [ ] **Step 1: Tests schreiben, laufen lassen** — `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test content-acceptance` (alle vier Projekte).
- [ ] **Step 2: `CLAUDE.md`** — e2e-Helfer `pasteFile`, `pngBytes`, `uploadViaApi`.
- [ ] **Step 3: Gates G3 gezielt** (`content-acceptance comments attachments editor`)
- [ ] **Step 4: Commit** — `test: accept mentions in comments, pasted images and hidden attachments end to end`.

---

### Task 23: Doku, `CLAUDE.md`, Rulings, Spec

**Modell:** opus

**Files:**
- Create: `docs/en/concepts/rich-text.md`, `docs/de/concepts/rich-text.md`
- Modify: `docs/.vitepress/config.ts` (Konzepte „Rich text“/„Rich Text“), `docs/{en,de}/concepts/work-items.md` (Kommentare, Reaktionen, Dateien, Beobachten), `docs/{en,de}/development.md` (Queue `media`, `app:prune-attachments`, `ATTACHMENTS_MAX_MB`, PHP-Upload-Grenzen), `docs/{en,de}/search.md` (Kommentare, falls Task 12 es nicht schon tat), `CLAUDE.md`, `README.md` (Status), `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md`, `docs/superpowers/specs/2026-10-28-werkbuch-design.md`, `docs/superpowers/plans/2026-10-30-werkbuch-app.md`

**Interfaces:**
- Produces:
  - `concepts/rich-text` (en + de, gleiche Überschriften, `DocsTest`): Stufen des Editors, `/`-Menü, Markdown-Kürzel, `@` (wer erwähnt werden kann), `#` (was verborgen bleibt), Bilder und Dateien (Formate inline, Download sonst, Grenze, Vorschau), die Markdown-Konventionen der Spec 4.16 als Tabelle mit den Regeln beim Schreiben über REST (`@handle` ohne Zugriff bleibt Text, Key eines unsichtbaren Items bleibt Text, `[hidden](item:…)`, fremder Anhang 422), Beispiele mit `curl` (Kommentar mit Markdown, Upload per `curl -F`), Aufräumen (`app:prune-attachments`, Uploads ohne Besitzer nach 24 h).
  - `CLAUDE.md`: „Stand“ (Phase 7 umgesetzt, als Nächstes Phase 8), Tech Stack, Kommandos, Architektur (Rich Text, Anhänge, Kommentare, Editor, Aktivität, Datenschicht), Fallstricke (PHP-Upload-Grenzen, Dateien nach dem Commit, `Storage::fake('local')` in Tests mit Anhängen, Queue `media`, Einfügen nur in Playwright). Die Tasks haben ihre Teile eingetragen; hier ordnen und prüfen.
  - Rulings `A227`–`A251` (Liste „Vorschläge für neue Rulings“ unten, je mit Grund und „Falls falsch“, Anpassungen aus der Umsetzung eingearbeitet); „Für spätere Phasen vorgemerkt“: Zeile Phase 7 entfernen (erledigt); neu: Phase 8 (Benachrichtigungen aus `meta.mentioned`, `comment.created`; Mails mit `toMailHtml` und `RichTextNames` je Empfänger; Live für `comment.*` und `comment.reaction_*` am Kanal `work-item.{id}`), Phase 9 (Verweise `kind: page`, `page:<ulid>` in Markdown, `pageRefs()`, Uploads in Seiten, `AttachmentPolicy` für Besitzer `page`), Phase 10 (Besitzer `template`, Uploads in Vorlagen), Phase 11 (Webhook-`data` für `comment.*` aus `meta.comment_id`, für `comment.deleted` ohne Text; `bot.mentioned` zustellen), Phase 13 (MCP `get-upload-url`, Kommentare-Tools), Phase 14 (Worker auf `media`; `upload_max_filesize`/`post_max_size` und `client_max_body_size` im Image passend zu `ATTACHMENTS_MAX_MB`; S3), Phase 15 (Vorschaubilder für GIF/AVIF; Last mit großen Kommentar-Mengen im Index).
  - Spec „Änderungen vom <Tag der Umsetzung> (Phase 7)“ zur Bestätigung: Kommentare und Reaktionen an archivierten Items gesperrt (A240); fremde Kommentare löschen Projekt-Admins und Org-Admins (A241); Bilder im Text dürfen alle hochladen, die kommentieren dürfen, auch Viewer (A234); Uploads im Text gehören bis zum Speichern niemandem, Bilder im Text löscht nur das Aufräumen (A232, A238); verborgene Verweise in Markdown als `[hidden](item:<ulid>)` (A229); `comment.deleted` ohne Text (A228); `bot.mentioned` schon in Phase 7 als Event (A243); Vorschaubilder nur für PNG, JPEG, WebP (A237).
  - Master-Plan: Phase 7 im „Fortschritt“ erst nach dem Merge (Orchestrator); im Text von Phase 7 `GET /api/v1/references?project=…&q=…` → „`#` über `GET /api/v1/search`, `GET /api/v1/references?items=…` löst Verweise auf“ (A230); im Abschnitt „Wie dieser Plan ausgeführt wird“ die neue Gate-Regel (A249).

- [ ] **Step 1: Seiten und Tests** — `ddev artisan test --filter=DocsTest`; `ddev exec pnpm --dir docs build` → ohne tote Links.
- [ ] **Step 2: Abnahme der Phase** (ohne den vollen G3: der läuft danach im Hintergrund parallel zum Final-Review)

```bash
ddev artisan migrate:fresh --seed --seeder=DemoSeeder
ddev artisan app:search-sync && ddev artisan app:search-import
ddev artisan test --coverage --min=100
ddev artisan test --testsuite=Integration
ddev exec vendor/bin/phpstan analyse --memory-limit=1G && ddev exec vendor/bin/pint --test
ddev exec pnpm typecheck && ddev exec pnpm test:coverage
ddev exec pnpm build
E2E_COVERAGE=0 pnpm --dir e2e exec playwright test content-acceptance comments attachments editor create-item item-activity item-description
ddev exec pnpm --dir docs build
```

Expected: alles grün. Von Hand (Master-Abnahme, Erfolgskriterium 5 für Beschreibung und Kommentar): Mara fügt ein Bild per ⌘V in die Beschreibung von WEB-47 und in einen Kommentar ein; Ida (nicht in OPS) bekommt `https://werkbuch.ddev.site/attachments/<id>` eines OPS-Bilds als 404; `curl -H "Authorization: Bearer <Token>" -F project_id=WEB -F kind=inline -F file=@bild.png https://werkbuch.ddev.site/api/v1/attachments` liefert 201, danach `PATCH …/work-items/WEB-47` mit `description` „![x](attachment:<id>) @mara OPS-12“ als Ida: Erwähnung, `OPS-12` bleibt Text; `ddev artisan app:prune-attachments --dry-run` nennt nichts Unerwartetes.

- [ ] **Step 3: Commit** — `docs: add the rich text page, update CLAUDE.md, the rulings and the spec for phase 7`.

**Danach (Orchestrator):** Final-Review (opus, ganze Phase) und **parallel im Hintergrund der volle G3** (`ddev exec pnpm build:coverage && pnpm --dir e2e test && ddev exec pnpm build`); beide Ergebnisse gehen in die eine finale Fix-Welle.

---

## Vorschläge für neue Rulings (ab A227)

- **A227 · Kommentar-Events tragen das Item als Subjekt.** `comment.created|updated|deleted`, `comment.reaction_*` und `bot.mentioned` haben Subjekt = Work Item, `meta.comment_id`. *Grund:* History (`ListHistory` liest Events des Items), Suche (der Konsument baut das Item-Dokument neu), Benachrichtigungen (Beobachter des Items, Phase 8) und Live-Kanal `work-item.{id}` hängen alle am Item; ein Kommentar als Subjekt bräuchte eine eigene Spalte oder JSON-Suche in `meta`. Der Klickdummy macht es ebenso. *Falls falsch:* Subjekt = Kommentar mit `meta.work_item_id` und eine indizierte erzeugte Spalte `events.work_item_id` für die History.
- **A228 · `comment.deleted` speichert keinen Text, `comment.updated` alte und neue Fassung.** *Grund:* Spec 4.10 verlangt die alte Fassung nur beim Bearbeiten; gelöscht wird oft, was nicht stehen bleiben soll (eingefügtes Geheimnis), die History vermerkt nur das Löschen. *Falls falsch:* `changes.body.old` auch beim Löschen (wie der Klickdummy).
- **A229 · Verweise speichern nur `id` und `kind`; verborgene Verweise in Markdown als `[hidden](item:<ulid>)`.** Das JSON nennt keinen Key und keinen Titel (die Beschriftung des Editors fällt beim Lesen weg), der Leser löst über `GET /references` auf; Markdown schreibt für Sichtbares den aktuellen Key, sonst `[hidden](item:<ulid>)`, und liest das zurück, wenn die ID schon im Text stand. Erwähnungen speichern `id` und Handle (beim Speichern aktualisiert). *Grund:* Review Focus 5 und Anti-Ziel Datenlecks; ein Agent, der eine Beschreibung per Markdown liest und zurückschreibt, verliert keine verborgenen Verweise. *Falls falsch:* verborgene Verweise in Markdown weglassen (sie gehen bei einer Rundreise verloren).
- **A230 · `#` sucht über `GET /api/v1/search`, `GET /api/v1/references?items=` löst IDs auf.** Abweichung vom Master-Plan (`references?project=…&q=…`). *Grund:* die Suche aus Phase 6 findet schon Keys, frühere Kennungen und Tippfehler (wie das Relationen-Ziel, A225); für die Anzeige gespeicherter Verweise braucht es dagegen ein Auflösen vieler IDs in einer Anfrage. *Falls falsch:* zusätzlich `references?q=` als Hülle um `QuerySearch`.
- **A231 · Wer erwähnt werden kann, ist die Regel der Zuweisung** (`Assignable::check`: aktive Mitglieder, Org-Admins als Personen, Bots nur als Mitglied). Eine Erwähnung ohne diese Rechte wird Text, keine 422 (auch im JSON des Editors), außer sie stand schon im Text. *Grund:* Spec-Änderung 2026-10-29 („Items übernehmen und erwähnt werden …“); zwischen Wahl und Speichern kann sich die Mitgliedschaft ändern. *Falls falsch:* 422 `field.rich_text.mention` für JSON.
- **A232 · Uploads im Text gehören bis zum Speichern niemandem.** `kind: inline` hat beim Hochladen nie einen Besitzer; das Speichern des Textes verknüpft (nur Uploads derselben Person und desselben Projekts). `uploadAttachment` des Browsers schickt für `inline` immer `owner: null` (Abweichung vom Klickdummy, der den Besitzer schon beim Hochladen setzt). *Grund:* eine Regel für neue und bestehende Texte; die Beschreibung speichert ohnehin nach 1,2 s. *Falls falsch:* Besitzer beim Hochladen, wenn der Text schon existiert (braucht Rechte je Besitzerart beim Upload).
- **A233 · Ein Text darf jeden Anhang seines Projekts nennen, verknüpft werden nur eigene ohne Besitzer.** Ein Bild, das ein anderer Text desselben Projekts besitzt (kopierter Text), bleibt bei seinem Besitzer; ein Anhang eines anderen Projekts oder ein fremder ohne Besitzer ist 422 `field.rich_text.attachment`. *Grund:* Review Focus 5, 13c („die hochladende Person wird geprüft“); das Leserecht folgt dem Projekt. *Falls falsch:* beim Speichern eine Kopie für den neuen Besitzer anlegen (das Bild verschwindet sonst mit dem ersten Besitzer).
- **A234 · Hochladen in Texte darf, wer kommentieren darf (`item.comment`, auch Viewer); die Dateiliste nur mit `item.edit`.** Drossel 60 Uploads je Minute und Konto. *Grund:* Spec 4.3 („kommentieren“) und 4.16 (Kommentare mit Bildern); 13c „viewers offered image upload“ war im Klickdummy ein Fehler, weil er Uploads nur Membern erlaubte. *Falls falsch:* Uploads nur für Member (Viewer kommentieren ohne Bilder).
- **A235 · Dateien unter `/attachments/{id}` (Web, wie `/media`), Metadaten unter `/api/v1/attachments/{id}`.** *Grund:* `<img src>` schickt Cookies nur zuverlässig an eine Web-Route mit Sitzung; ein Bearer-Token wirkt dort auch (wie bei `/media`). *Falls falsch:* `GET /api/v1/attachments/{id}/file` mit Sanctums Stateful-Erkennung über `Referer`.
- **A236 · Inline nur nach erkanntem Inhalt.** `mime` kommt aus `finfo` über den Inhalt; nur PNG, JPEG, GIF, WebP, AVIF werden inline mit ihrem Typ ausgeliefert, alles andere als `application/octet-stream` zum Download; eingefügtes HTML mit `<img src>` und Markdown-Bilder mit URL werden kein Bild. *Grund:* Spec 4.16, 7.5; die Angabe des Clients ist frei wählbar. *Falls falsch:* den gemeldeten Typ für Downloads behalten (Browser zeigen PDFs dann eingebettet an, mit Sandbox).
- **A237 · Vorschaubilder nur für PNG, JPEG, WebP** (höchstens 1600 × 1600, Queue `media`); GIF behält seine Animation, AVIF wird ohne Vorschau gezeigt. *Grund:* GD verliert die Animation, AVIF-Kodierung ist langsam und je nach Build unsicher; Vorschauen lohnen bei großen Fotos. *Falls falsch:* Vorschau für alle fünf Formate (GIF erstes Bild).
- **A238 · Löschen von Anhängen:** Dateien der Dateiliste mit `item.edit` (Event `work_item.updated` mit `changes.attachments`), eigene Uploads ohne Besitzer durch die hochladende Person (ohne Event), Bilder und Dateien im Text gar nicht (409 `attachment_inline`; sie gehen mit dem Text oder über `app:prune-attachments`). Hochladen ohne Besitzer schreibt kein Event. *Grund:* Spec 4.16 („Aus dem Text entfernte Bilder bleiben erhalten …“); ein Upload ohne Besitzer ist noch nichts, was jemand sieht. *Falls falsch:* Events für Uploads ohne Besitzer (Rauschen in der Outbox ohne Konsumenten).
- **A239 · Uploads ohne Besitzer räumt ein stündlicher Job nach 24 h ab** (statt täglich 03:00 Org-Zeit); `app:prune-attachments --dry-run --min-age=30` (Tage) entfernt Bilder und Dateien, die der aktuelle Text ihres Besitzers nicht mehr nennt; beides ohne Event. *Grund:* Spec 4.16 nennt 24 h, eine Stunde Genauigkeit reicht und braucht keine Zeitzone; History-Fassungen zählen nicht (Sache des Betreibers, Doku). *Falls falsch:* täglich um 03:00 Org-Zeit im Scheduler.
- **A240 · Archivierte Items und Projekte nehmen keine Kommentare und Reaktionen** (409 `archived` bzw. `project_archived`), auch kein Bearbeiten und Löschen von Kommentaren; Beobachten bleibt erlaubt (P21 aus Phase 4). *Grund:* archiviert heißt schreibgeschützt (Spec 4.8), der Klickdummy nimmt keine Kommentare an archivierten Items. *Falls falsch:* Reaktionen auch an archivierten Items.
- **A241 · Fremde Kommentare löschen Projekt-Admins und Org-Admins** (Projektrolle Admin über `Visibility::roleIn`), bearbeiten nur Autor oder Autorin. *Grund:* Spec 4.10. *Falls falsch:* ein eigenes Recht `comment.moderate`.
- **A242 · Reaktionen: `POST …/reactions` fügt hinzu, `DELETE …/reactions?emoji=` nimmt weg, beides idempotent;** Events `comment.reaction_added|removed` ohne Webhook und ohne History (für Live in Phase 8); das Emoji prüft `App\Domain\Emoji` (ein Graphem), gespeichert in `utf8mb4_bin`. *Grund:* ein Umschalten per `POST` ist für Agenten nicht wiederholbar; `utf8mb4_unicode_ci` hielte 👍 und 👍🏽 für gleich. *Falls falsch:* `POST` schaltet um wie der Klickdummy.
- **A243 · Kommentare in der API als `body` (Markdown) und `body_json`; `bot.mentioned` schon ab Phase 7.** Der Browser-Typ `Comment` heißt `body_json` statt `body` (Abweichung vom Klickdummy). `bot.mentioned` (Subjekt Item, `meta.bot_id`, `source`, `comment_id`) entsteht mit der Erkennung der Erwähnungen; zugestellt wird es ab Phase 11 (`bot.assigned` bleibt Phase 11, A106). *Grund:* Spec 4.16 („Dasselbe gilt für Kommentare“), Master-Plan Phase 7 („Erwähnung eines Bots löst `bot.mentioned` aus“). *Falls falsch:* `bot.mentioned` erst mit Phase 11 aus `meta.mentioned` ableiten.
- **A244 · Erwähnungen eines Items stehen in Beschreibung und Rich-Text-Werten.** Neu erwähnt ist, wer in keinem der beiden vorher stand; `meta.mentioned` am Event der Änderung. *Grund:* Rich-Text-Properties sind Text des Items wie die Beschreibung. *Falls falsch:* nur die Beschreibung zählt (Spec 4.14 nennt „Beschreibung oder Kommentar“).
- **A245 · Kommentare im Suchindex als ein Feld `comments` des Item-Dokuments** (höchstens 64 KB, Gewicht nach der Beschreibung). *Grund:* Spec 4.17 (Klartext der Kommentare im Item-Index); ein Treffer führt zum Item. *Falls falsch:* eigener Index `comments` mit Treffern auf den Kommentar.
- **A246 · Kommentieren lässt beobachten, ohne eine Abmeldung aufzuheben;** Erwähnen hebt sie auf (Grund `mentioned`), Kommentieren nicht (Grund `commented`). *Grund:* Spec 4.10 („nur durch eine neue Erwähnung oder Zuweisung wieder angemeldet“). *Falls falsch:* jeder Kommentar meldet wieder an.
- **A247 · Die Aktivität mischt der Browser aus `/comments` und `/history`** (beide alle Seiten, nach Zeit). *Grund:* beide sind eigene Ressourcen der REST-API (Spec 6.1), `useActivity` liest schon alle Seiten. *Falls falsch:* ein Endpunkt `…/activity` auf dem Server.
- **A248 · Neue Tiptap-Erweiterungen genau 3.32.0** wie `@tiptap/core` (3.32.2 ist erschienen); ein Update aller Tiptap-Pakete ist eine eigene Änderung. *Grund:* Tiptap verlangt gleiche Versionen (Peers `@tiptap/core` 3.32.0 genau). *Falls falsch:* alle Tiptap-Pakete in Task 15 auf 3.32.2.
- **A249 · Gates ab Phase 7:** G3 je Task nur gezielt gegen den normalen Build; der volle G3 (Coverage-Build, vier Projekte, `coverage:merge`) einmal je Phase nach der letzten Task, im Hintergrund parallel zum Final-Review. *Grund:* Rafael (2026-11-02), weniger Wartezeit; Abdeckungslücken findet der eine volle Lauf und die finale Fix-Welle. *Falls falsch:* Lücken fallen später auf und kosten eine zweite Fix-Runde.
- **A250 · Abmelden ohne vorheriges Beobachten speichert eine Abmeldung.** *Grund:* sonst meldet das automatische Beobachten beim Kommentieren trotz Abmeldung an (Vormerkung Phase 7). *Falls falsch:* ein `DELETE` ohne Zeile bleibt ohne Wirkung.
- **A251 · Ein Modul-Speicher für ungesendeten Text** (`lib/drafts.ts`) für Kommentare, Kommentar-Bearbeitungen und die Beschreibung; er überlebt das Schließen der Ansicht für diesen Besuch und hält den Unload-Guard. *Grund:* A154/N2 (Beschreibung nach einem 5xx einer geschlossenen Ansicht), Kommentare brauchen dasselbe. *Falls falsch:* Entwürfe in `localStorage` (überleben Neuladen, aber auch fremde Sitzungen am selben Rechner).

## Entscheidungen dieses Phasenplans (ohne eigenes Ruling)

- **P1** Kommentare ändern `updated_at` des Items nicht (die Sortierung „geändert“ meint Felder); Dateien der Dateiliste schon (wie Relationen, Spec 4.14 „Anhänge“ sind Änderungen).
- **P2** Kommentar-Text höchstens `Schema::MAX_BYTES` wie jede Beschreibung; ein leerer Kommentar (nur Leerraum) ist 422 `field.body.required`, ein Kommentar nur mit Bild ist nicht leer.
- **P3** `ListComments` älteste zuerst mit Cursor; das Detail lädt alle Seiten (wie die History).
- **P4** `RichTextNames` lädt `loadForResource` nur für nicht schlanke Items; Listen bekommen kein Markdown (P17 aus Phase 5).
- **P5** Externe Bilder (URL) werden nie Knoten; ihr Alt-Text bleibt Text.
- **P6** Eine Erwähnung, die Text wird, behält `@label` als Text, damit der Satz lesbar bleibt.
- **P7** `toText()` lässt Verweise weg (kein Key ohne Leser im Suchtext und im Filter `value_text`).
- **P8** Der Composer bleibt auf dem Handy unten im Fluss (keine feste Leiste), 44-px-Ziele.
- **P9** Die Reihenfolge der Reaktionen folgt der ersten Reaktion je Emoji.
- **P10** Kommentare von Bots zeigen „Bot“ am Namen (Spec-Änderung 2026-10-29).
- **P11** Der Such-Konsument baut das Item bei jedem Kommentar-Event neu (kein Teil-Update in Meilisearch).
- **P12** Vorschaubilder entstehen nur in der Queue `media`; bis dahin zeigt der Browser das Original.
- **P13** `ShowAttachment` liefert über `response()->file()` mit `setPrivate()`; kein Streaming über Signaturen (keine geteilten Links, Spec 4.16 „Route prüft das Leserecht“).
- **P14** `comment_reactions.emoji` in `utf8mb4_bin` (siehe A242).

## Nicht in Phase 7 (vorgemerkt in Task 23)

- Phase 8: Benachrichtigungen aus `comment.created` und `meta.mentioned` (Personen), Mails mit `toMailHtml` je Empfänger, Live für Kommentare und Reaktionen.
- Phase 9: Verweise und Uploads in Wiki-Seiten (`kind: page`, `page:<ulid>`, Besitzer `page`).
- Phase 10: Besitzer `template` und Uploads in Vorlagen.
- Phase 11: Zustellung von `comment.*` und `bot.mentioned`, Webhook-`data` der Kommentare.
- Phase 13: MCP-Tools für Kommentare und `get-upload-url`.
- Phase 14: Worker auf `media`, Upload-Grenzen im Image, S3.
- Phase 15: Vorschauen für GIF/AVIF, Last mit vielen Kommentaren je Item im Index.
