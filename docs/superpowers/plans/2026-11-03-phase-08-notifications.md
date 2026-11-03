# Phase 8: Benachrichtigungen, Mail, Live-Updates – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wer etwas wissen muss, erfährt es: ein Konsument `notifications` macht aus den Events der Outbox Benachrichtigungen (Beobachter, Lead, neu Erwähnte, neue zuständige Person; nie der Auslöser, nie Bots, Deaktivierte oder Konten ohne Zugriff) nach den Einstellungen je Person, Art und Kanal; Mails werden je Person und Item `NOTIFICATION_MAIL_DELAY` Minuten gesammelt und beim Senden noch einmal gegen Zugriff, Lesestand und Einstellung geprüft; Erinnerungen „fällig/überfällig“ um 08:00 in der Zeitzone der Person; gelesene Benachrichtigungen gehen nach 90 Tagen. Reverb trägt Live-Updates über die Kanäle `project.{id}`, `presence-user.{id}` und `work-item.{id}` mit denselben Policies; ein Konsument `live` meldet Events dorthin, und wer den Zugriff verliert, wird getrennt und neu autorisiert. Im Browser: Laravel Echo in `resources/js/api/live.ts`, ein Cache-Abgleich ohne doppelte eigene Änderungen, das Live-Banner, die Inbox (gruppiert, `j`/`k`, `e`, `u`, ⇧E, `#`, Öffnen liest), das Badge live, die persönlichen Benachrichtigungseinstellungen und die System-Seite für Org-Admins; dazu die Überträge aus den Phasen 5–7.

**Architecture:** Die Outbox bleibt der einzige Weg von einer Änderung zu ihren Folgen (Spec 7.2). `App\Notifications\NotificationConsumer` (Queue `notifications`) ruft in der Claim-Transaktion die System-Action `App\Actions\Notifications\NotifyRecipients`: sie liest die Fakten des Events (Typ, Actor, Änderungen, `meta.mentioned`, Beobachter, Abmeldungen, Lead, Assignee), lässt die reine Regel `App\Domain\Notifications\Recipients` entscheiden, wer welche Art bekommt, filtert über `Visibility` (Zugriff), Kontoart und Aktivität und schreibt je Person höchstens eine Zeile in `notifications` (eindeutig über `(user_id, dedupe_key)`, zusätzlich zur Claim-Zeile). Will die Person dafür Mail, hängt die Zeile an eine offene Sammlung in `notification_mails` (eine je Person und Item); eine neue Sammlung stellt den Job `SendNotificationMail` mit Verzögerung `->afterCommit()` ein (A39: nicht idempotente Wirkung nur über einen eigenen Job mit eigener Dedupe-Zeile). Der Job sperrt die Sammlung, prüft jede Benachrichtigung beim Senden erneut (Review Focus 3) und baut die Mail in der Sprache der Person mit `Document::toMailHtml` und `ReaderNames::of(…, $empfänger)`. `App\Live\LiveConsumer` (neue Queue `live`) sendet je Event eine Nachricht nur mit IDs (`ShouldBroadcastNow`), schließt den auslösenden Tab über `meta.socket` aus und trennt bei Zugriffsverlust die Verbindungen der Betroffenen über Reverbs „terminate user connections“; die Inbox meldet ihre eigenen Änderungen ohne Event direkt an den Presence-Kanal der Person. Im Browser abonniert die Shell `presence-user.{me}` und `project.{id}` für jedes sichtbare Projekt, die Item-Ansicht `work-item.{id}`; `useLiveSync` macht die betroffenen Queries ungültig (gesammelt, entdoppelt, während einer eigenen Mutation nur „veraltet“). Die UI liest und schreibt weiter nur über `/api/v1` (dazu `/broadcasting/auth`).

**Tech Stack:** wie Phase 7, dazu im Browser `laravel-echo` 2.6.3 und `pusher-js` 8.6.0 (Task 13). Keine neuen Composer-Pakete: `laravel/reverb` 1.12.0 und `pusher/pusher-php-server` 7.3.0 sind installiert. Versionen unter „Paketversionen“.

**Spec:** `docs/superpowers/specs/2026-10-28-werkbuch-design.md` (1 Erfolgskriterium 2.4 komplett; 4.2 Bots (keine Benachrichtigungen); 4.10 Beobachten; 4.14 komplett; 5.2 Seitenleiste (Inbox mit Badge), Persönlich „Benachrichtigungen“, Organisation „System“; 5.3 `G I`, Inbox-Tasten (Änderungen vom 2026-10-29); 6.1 „Benachrichtigungen und Einstellungen“; 7.2 Queue, Scheduler, Live-Updates; 7.4 `notifications`, `notification_preferences`; 7.5 Live-Kanäle im Lecktest; 8.2 `MAIL_*`, `NOTIFICATION_MAIL_DELAY`; 14 „Reverb hinter Proxys … die UI warnt sichtbar“), Master-Plan `docs/superpowers/plans/2026-10-30-werkbuch-app.md` (Global Constraints, Review Focus 1 und 3 und 4, Verträge „Events und Outbox“, „Queues“, „Konfiguration“, Frontend „Live“, Phase 8), Rulings `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md` (A26, A39, A106, A113, A126, A151, A199, A200, A227, A228, A243, A246, A249, A250, A251, A258, A259; „Für spätere Phasen vorgemerkt“, Zeile Phase 8 → Tasks 1, 5, 7, 11, 14, 15), Ledger `.superpowers/sdd/2026-10-30-werkbuch-app/progress.md` (Übertrag „Phase 5 → later carry … Phase 8 T11-M1/M2/M3, T9-N2“ → Task 15), Klickdummy `prototypes/clickdummy/{README.md,DESIGN.md}` und `src/{api/{notifications,events,live,system}.ts,hooks/{notifications,live,system}.ts,features/inbox/**,features/settings/personal/Notifications.tsx,features/settings/personal/matrix.ts,features/settings/org/System.tsx,app/LiveIndicator.tsx,api/seed/inbox.ts,types.ts (Notification, NotificationPreference, SystemStatus)}`, Aufräumliste `docs/superpowers/plans/2026-10-28-werkbuch-clickdummy-deferred.md` (13c: „inbox hint text wrong for read items“, „row actions not tabbable“, „item load errors always ‚gibt es nicht mehr‘“ → Tasks 16, 17; „‚Alle als gelesen‘ in filter hits hidden entries“ → Task 6/17 (A291); „inbox header count can briefly show one too few“ und 13b „move the inbox read marks … into a `useReadMarks` hook“ → Task 17; „listNotifications filters only by recipient“ → Task 6; „no notifications for relations and attachments“ → Task 5).

---

## Global Constraints

Es gelten alle Global Constraints des Master-Plans und alle Regeln aus `CLAUDE.md`. Für Phase 8 entscheidend:

- Branch `feat/phase-08-notifications` (von `main` 2c8b810 nach dem Merge von PR #19). Vor dem ersten Commit `git config user.email` → muss `rafael@hauss.dev` sein, sonst stoppen und nachfragen; nie `user.email`/`user.name` setzen, nie `rafael@lulububu.de`. Commits englisch, Conventional Commits, letzte Zeile `Co-Authored-By: <tatsächliches Modell> <noreply@anthropic.com>` (die Commit-Schritte nennen nur den Betreff).
- PHP, Composer, Artisan und pnpm der App nur in DDEV; `e2e/` auf dem Mac. Nur pnpm, nie npm oder npx. Neue npm-Pakete nur in Task 13 (`laravel-echo`, `pusher-js`, genau gepinnt); keine neuen Composer-Pakete; `e2e/pnpm-lock.yaml` bleibt unverändert.
- **Konsumenten (A39):** `consume()` schreibt nur in die Datenbank und wirkt nach außen nur idempotent; eine Mail geht nie aus `consume()` heraus, sondern aus `SendNotificationMail` mit Zeilensperre auf der Sammlung (eigene Dedupe-Zeile), eingestellt `->afterCommit()`. Ein doppelter `ConsumeEvent` (spätes Original neben dem Nachverteiler) erzeugt keine zweite Benachrichtigung und keine zweite Mail (Review Focus 1). Beide Konsumenten vertragen die Events der Migrationen (`bot.created`, Katalog-Events, A39).
- **Zugriff zur Lese- und Sendezeit (Review Focus 3):** Inbox, Badge, Mail und Erinnerung prüfen über `Visibility::projectIds` (und aktive Person, kein Bot) erst, wenn gelesen bzw. gesendet wird; eine Benachrichtigung zu einem Projekt, das die Person nicht mehr sieht, erscheint nirgends und geht in keine Mail. Live-Kanäle werden über dieselben Policies autorisiert und nach Zugriffsverlust neu autorisiert (A281).
- **Kein Leck über Live (Anti-Ziel Datenlecks, Spec 7.5):** Live-Nachrichten tragen nur IDs und den Typ (A279), nie Titel, Text oder Werte; der Browser liest danach über die API, die das Leserecht prüft. Kanäle nur für die Sitzung der Oberfläche (A283).
- **Kein Leck über Mail und Inbox:** Auszüge aus Kommentaren und Beschreibungen entstehen beim Lesen bzw. Senden aus dem aktuellen Text, je Empfänger über `ReaderNames` (verborgene Verweise bleiben verborgen, A229); gespeichert wird nur `comment_id` (A272). Ein gelöschter Kommentar hat keinen Auszug (A228).
- Fachlogik nur in `app/Actions` und `app/Domain`; `App\Notifications\NotificationConsumer` und `App\Live\*` rechnen nicht und schreiben keine Modelle (`ArchTest`: `App\Live` final, ohne `EventRecorder`, `DB`, Modell-Schreibzugriffe). **Jede Action steht genau einmal in der Rechte-Matrix** (`tests/Feature/Access/matrix.php`, System-Actions als `system`-Zeile), **jede Route unter `api/v1` genau einmal in der Routen-Matrix** (`tests/Feature/Api/routes.php`), beides im Commit, der sie anlegt. Kanäle stehen nicht in `routes.php`, sondern in `tests/Feature/Live/ChannelAuthorizationTest.php` mit allen Spalten von `MatrixWorld`. Neuer Morph-Typ `notification` in die Morph-Map (`MorphMapTest`).
- Jede schreibende Action schreibt ihr Event in der Transaktion, außer mit Ruling: Inbox-Aktionen und Einstellungen (A277), die System-Actions des Konsumenten (`NotifyRecipients`, `SendNotificationMail`, `SendDueReminders`, `PruneNotifications`, `DispatchDueMails`: Arbeit von Jobs ohne eigenes Event, wie `PurgeProject`).
- **Zeit:** nur `now()`; „heute“ und 08:00 für Erinnerungen in der Zeitzone der Person (`User::effectiveTimezone()`, A275); Tests mit `$this->travelTo()` über Sommerzeitwechsel und Zonen mit halben Stunden. Zeitstempel der Benachrichtigungen `timestamp(6)`, Cursor roh (Fallstrick `occurred_cursor`).
- Die UI liest nur über `/api/v1` und `/broadcasting/auth`. `resources/js/api/{notifications,system,live}.ts` exportieren die Namen und Signaturen des Klickdummys (`listNotifications`, `markRead`, `markUnread`, `markAllRead`, `deleteNotification`, `getPreferences`, `savePreferences`, `NOTIFICATION_EVENTS`, `getSystemStatus`, `retryFailedJobs`, `sendTestMail`, `subscribeLive`, `isLiveConnected`, `subscribeLiveStatus`); Abweichungen nur nach den Rulings dieses Plans (A291: `markAllRead({ mentions_only })`; `resetDemo`, `simulateRemoteChange`, `setLiveConnected` gibt es nicht, Master-Plan „Nur im Klickdummy“).
- Texte: jeder deutsche Text des Klickdummys wird ein Schlüssel in `lang/de.json` (wörtlich) und `lang/en.json`; Mails unter `mail.notifications.*`, Inbox unter `inbox.*`, Einstellungen unter `settings.notifications.*`, System unter `settings.system.*`; Schlüssel ohne Ziffern, Platzhalter `:name`, Plural `.one`/`.other`. Neue `reason`-Codes (`mail_not_configured`, `mail_failed`) unter `problem.reason.*` in beiden Sprachen und im Frontend.
- Kürzel nur über den Katalog (A7): neu `inbox.read` (`e`), `inbox.unread` (`u`), `inbox.read_all` (`shift+e`), `inbox.delete` (`#`), Bereich `list`, Gruppe `shortcuts.group.inbox`; `j`/`k`, Enter, Leertaste über die vorhandenen `list.*`-Einträge; danach `ddev exec pnpm shortcuts:doc`.
- Abdeckung 100 % Zeilen PHP und Frontend; keine unerreichbaren Zweige: `template_run_failed` und `webhook_disabled` sind Werte von `NotificationKind` mit Einstellungen, aber ohne Erzeuger bis Phase 10/11 (A290); ihr Zweig in Inbox und Mail ist über Factory-Zeilen erreichbar.
- Tests müssen rot werden können: zu jeder Regel ein Fall, der ohne sie scheitert (RED zuerst belegen).
- e2e: Daten einer Spec leben in eigenen Projekten `E2E <variant> <runId>`; Inbox-Specs arbeiten mit den Konten `inbox-<variante>@example.com` (A289), nie mit der geteilten Inbox von Erik oder Mara; Tastaturwege über `tabTo`/`arrowTo`/`pressMod`; kein `networkidle`; auf Live wartet eine Spec mit `expect.poll`/`toBeVisible({ timeout })`, nie mit `waitForTimeout`.
- Demo- und Testdaten nur fiktiv (Feldwerk, `prototypes/clickdummy/src/api/seed/`, `@example.com`).
- `CLAUDE.md` im selben Commit wie die Änderung, die eine Angabe dort ändert. Der Klickdummy bleibt unverändert.

## Review Focus

- **Outbox doppelt oder gar nicht (Master Review Focus 1):** Ein Event, das zweimal beim Konsumenten ankommt (Original und Nachverteiler, oder `queue:retry` nach einem Fehler hinter dem Claim), ergibt genau eine Benachrichtigung je Person und genau eine Mail; zwei Jobs derselben Sammlung senden einmal; ein Absturz zwischen Commit und Dispatch verliert nichts (der Kehrer `app:send-notification-mails` holt eine Sammlung ohne Job nach). → Tasks 5, 7 (Pest mit doppeltem `consume`, `tests/Integration/NotificationMailRaceTest.php`).
- **Zugriff verloren, während etwas unterwegs ist (Master Review Focus 3):** Ida wird aus OPS entfernt, nachdem eine Benachrichtigung entstand und bevor die Sammelmail geht: keine Mail, kein Eintrag in Inbox und Badge; dasselbe für ein privat gestelltes Projekt, ein deaktiviertes Konto und einen Org-Admin, der Member wird; ihr Live-Kanal `project.{OPS}` wird nach dem Trennen abgelehnt (403). → Tasks 6, 7, 8, 9, 10, 20.
- **Empfänger:** nie der Auslöser (auch nicht über eine Selbst-Erwähnung, A259), nie Bots, deaktivierte Konten oder Konten ohne Zugriff; eine Abmeldung vom Beobachten hält Benachrichtigungen fern, außer Erwähnung und Zuweisung (A113, A246); der Lead bekommt jedes Ereignis seines Projekts (A269); je Person und Event höchstens ein Eintrag (A267). → Tasks 3, 5.
- **Zeitzonen (Master Review Focus 4):** Erinnerung um 08:00 für Personen in Berlin, New York und Kolkata (+05:30) am Tag der Zeitumstellung, eine je Person, Item und Tag, auch wenn der Job zweimal in der Stunde läuft; „überfällig“ nach dem Kalender der Person. → Task 8.
- **Verweis und Text als Orakel:** Inbox-Auszug und Mail eines Kommentars mit `OPS-12` nennen für Ida (ohne OPS) weder Key noch Titel; ein gelöschter Kommentar steht nicht mehr im Auszug; Live-Nachrichten nennen nur IDs. → Tasks 6, 7, 10.
- **Eigene Änderungen nicht doppelt:** Die eigene optimistische Änderung wird nicht durch das eigene Live-Event zurück- und wieder vorgespielt (eigener Tab ausgeschlossen über `X-Socket-ID`); ein anderer Tab derselben Person sieht sie; ein Live-Event während einer eigenen Mutation am selben Item verwirft deren optimistischen Stand nicht. → Tasks 9, 10, 14.

## Gates

Regel A249 (seit Phase 7):

- **G1 (PHP), je Task mit PHP:** `ddev artisan test --coverage --min=100` → `Total: 100.0 %` (enthält `tests/Integration`, braucht `meilisearch` und ab Task 7 Mailpit, in DDEV `127.0.0.1:1025`/`:8025` im Web-Container); `ddev exec vendor/bin/phpstan analyse --memory-limit=1G` → `[OK] No errors`; `ddev exec vendor/bin/pint --test` → `PASS`. Gezielt `ddev artisan test --testsuite=Integration --filter=<Name>` in jeder Task mit Race- oder Mailpit-Test.
- **G2 (Frontend), je Task mit `resources/js`:** `ddev exec pnpm typecheck && ddev exec pnpm test:coverage` → keine Typfehler, alle Vitest-Schwellen erfüllt (bei VM-Last `--maxWorkers=3`).
- **G3 gezielt, je Task mit Frontend oder e2e:** gegen den normalen Build (`ddev exec pnpm build`, vorher `pnpm dev` beenden) `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test <specs>` mit den Specs, die die Task nennt (alle vier Projekte, sofern die Task nichts anderes sagt). Reverb läuft als DDEV-Daemon; nach PHP-Änderungen an Kanälen oder Broadcasts vorher `ddev restart` (Reverb liest Code nur beim Start, Fallstrick). **Kein voller Coverage-Lauf am Ende einzelner Tasks.**
- **G3 voll, genau einmal je Phase:** nach der letzten Task (Task 21), im Hintergrund parallel zum Final-Review: `ddev exec pnpm build:coverage && pnpm --dir e2e test && ddev exec pnpm build` → alle vier Playwright-Projekte grün, `coverage:merge` meldet 100 % Zeilen über `resources/js/**`. Fehlende Zeilen oder rote Specs gehen in die finale Fix-Welle. Während des Laufs keine anderen DDEV-Projekte starten oder stoppen.

Jede Task, die Dateien unter `resources/js/pages/`, `resources/js/features/` oder `resources/js/shell/` anlegt oder ändert, bringt Playwright-Abläufe (nur Tastatur, wo es geht) und Vitest-Tests (Lade-, Fehler- und Randzustände mit `mockApi`) mit, die ihre neuen Zeilen decken; sie nennt die Specs für ihren gezielten G3. Was nur Playwright deckt (echte Websocket-Verbindung, Wiederverbinden, zwei Kontexte), sagt die Task.

---

## Benachrichtigungsarten (`App\Domain\Notifications\NotificationKind`)

Werte und Reihenfolge wie `NOTIFICATION_EVENTS` des Klickdummys; `rank()` ist die Stärke für A267 (kleiner = stärker); Mail-Standard nach Spec 4.14.

| Art | Entsteht aus | Wer | Inbox-Standard | Mail-Standard | `data` (gespeichert) | Rang |
|---|---|---|---|---|---|---|
| `mentioned` | `meta.mentioned` an `work_item.created`, `work_item.updated`, `comment.created`, `comment.updated` | die neu erwähnten **Personen** (A258, A259) | an | an | `source` (`description`, `values`, `comment`), `comment_id` | 1 |
| `assigned` | `work_item.assigned` mit `changes.assignee_id.new`, `work_item.created` mit Assignee | nur die neue zuständige Person (A268) | an | an | – | 2 |
| `comment` | `comment.created` | Beobachter, Lead | an | an | `comment_id` | 3 |
| `state_changed` | `work_item.state_changed` | Beobachter, Lead | an | aus | `from`, `to` (Schnappschuss `{id, name, category}` aus `meta.states`) | 4 |
| `item_changed` | `work_item.updated` (ohne nur `rank`), `work_item.assigned` (für alle außer der neuen Person), `work_item.relation_added`, `work_item.relation_removed` | Beobachter, Lead | an | aus | `fields` (Liste: `title`, `description`, `priority`, `start_date`, `due_date`, `label_ids`, `parent_id`, `type_id`, `resolution_id`, `assignee_id`, `relation`, `attachment`, `values.<key>`) | 5 |
| `due` | Erinnerung (Task 8), kein Event | die zuständige Person | an | an | `due_date`, `overdue` (bool) | 6 |
| `item_created` | `work_item.created` | nur der Lead | an | aus | – | 7 |
| `template_run_failed` | ab Phase 10 | Lead, Ersteller der Vorlage | an | aus | `template_id`, `error` | 8 |
| `webhook_disabled` | ab Phase 11 | Org-Admins | an | aus | `webhook_id` | 9 |

**Keine Benachrichtigung** (A270): `work_item.archived|restored|deleted|subscribed|unsubscribed`, ein `work_item.updated` nur mit `rank`, `comment.deleted`, `comment.reaction_*`, `bot.*`, alle Projekt-, Katalog-, Konten-, Token-, View- und Favoriten-Events. `comment.updated` nur für neu Erwähnte.

**Empfängerregel** (`Recipients::of(EventFacts $f): list<Recipient>`, rein): Kandidaten je Art wie oben; Beobachter = Zeilen in `work_item_subscribers` ohne `unsubscribed_at`; der Lead zählt als Beobachter jedes Items seines Projekts, außer er hat das Item abbestellt (A269); wer abbestellt hat, bekommt nur `mentioned` und `assigned`; der Actor fällt immer heraus. Je Person entsteht **eine** `Recipient(userId, kinds)` mit allen Arten, die auf sie zutreffen, nach `rank()` sortiert. Danach (nicht rein, `NotifyRecipients`): nur aktive Personen, die das Projekt sehen (`Visibility::projectIds`); die erste Art mit mindestens einem eingeschalteten Kanal (`Preferences::enabled`) wird die Zeile, ihre Kanäle gelten (A267).

## Datenmodell

Migration `2026_11_03_001100_create_notifications_tables` (Task 4); die Nummer sortiert nach `…_001020`:

| Tabelle | Spalten |
|---|---|
| `notifications` | `id` ULID, `user_id` FK `users` `restrict` (Konten werden nie gelöscht), `kind` string(32), `event_id` FK `events` nullable `nullOnDelete`, `project_id` FK `projects` Kaskade, `work_item_id` FK `work_items` nullable Kaskade (A286), `actor_id` FK `users` nullable `restrict`, `data` JSON, `inbox` bool (A271), `mail_id` FK `notification_mails` nullable `nullOnDelete`, `dedupe_key` string(120), `read_at` timestamp(6) nullable, `created_at`/`updated_at` timestamp(6); unique (`user_id`, `dedupe_key`); Index (`user_id`, `inbox`, `created_at`, `id`), (`user_id`, `read_at`), (`work_item_id`), (`read_at`) fürs Aufräumen |
| `notification_mails` | `id` ULID, `user_id` FK `users` `restrict`, `scope` string(80) (`item:<ulid>` bzw. `due:<Y-m-d>`), `open_key` string(120) nullable unique (`<user_id>:<scope>`, solange offen; beim Senden `null`), `due_at` timestamp, `sent_at` timestamp nullable, `outcome` string(16) nullable (`sent`, `skipped`), Zeitstempel; Index (`sent_at`, `due_at`) für den Kehrer |
| `notification_preferences` | `id` ULID, `user_id` FK `users` Kaskade, `kind` string(32), `channel` string(8) (`inbox`, `mail`), `enabled` bool, Zeitstempel; unique (`user_id`, `kind`, `channel`) |

`dedupe_key`: für Events `event:<event_id>`, für Erinnerungen `due:<work_item_id>:<Y-m-d>` (Tag der Person). Modelle `App\Models\{Notification,NotificationMail,NotificationPreference}` (Achtung: `App\Models\Notification` immer importieren, nie mit `Illuminate\Notifications\Notification` verwechseln; `App\Notifications\*` sind Laravel-Notifications der Auth-Mails). Morph-Map: `notification`.

## Mail

- **Sammeln:** `NotifyRecipients` legt für eine Zeile mit Kanal `mail` (und `MailSetup::configured()`, A274) die offene Sammlung `(user, item:<work_item_id>)` per `insertOrIgnore` über `open_key` an (Rennen zweier Konsumenten derselben Person: der Index entscheidet) und liest sie danach `lockForUpdate`; neu → `due_at = now() + notification_mail_delay` Minuten und `SendNotificationMail::dispatch($mailId)->onQueue('notifications')->delay($dueAt)->afterCommit()`. Eine Zeile, die zu einer schon fälligen, aber noch nicht gesendeten Sammlung käme, kommt in diese (sie geht gleich mit).
- **Senden** (`App\Actions\Notifications\SendNotificationMail::handle($actor, string $mailId)`, `DB::transaction`): Sammlung `lockForUpdate`; `sent_at` gesetzt → nichts (Dedupe); `open_key = null` (eine neue Zeile eröffnet ab jetzt eine neue Sammlung), dann je Zeile prüfen: Person aktiv und kein Bot, Projekt in `Visibility::projectIds($person)` (ohne Projekte in Löschung), Item da, `read_at` leer (A273: eine gelesene Benachrichtigung braucht keine Mail), Mail für die Art noch an; übrig bleibt nichts → `outcome = skipped`; sonst `Mail::to($person)->locale($person->effectiveLocale())->send(new NotificationDigest(…))` und `outcome = sent`, `sent_at = now()`. Scheitert SMTP, rollt alles zurück und der Job wiederholt (`tries` 5, `backoff` 60/300/900/3600 s). Ein Absturz zwischen SMTP und Commit kann eine Mail doppelt senden (mindestens einmal, A273).
- **Inhalt** (`App\Mail\NotificationDigest`, eigene Blade-Ansichten `resources/views/mail/notifications/{digest,digest-text}.blade.php`, kein Markdown-Mail-Template): Betreff `mail.notifications.subject` („[:key] :title“, bei einer Erinnerungsmail `mail.notifications.reminders.subject`); je Benachrichtigung eine Zeile mit Satz der Art (`mail.notifications.kind.<art>` mit `:actor`), Zeit in der Zeitzone der Person, bei `comment`/`mentioned` der aktuelle Text als `Document::toMailHtml(ReaderNames::of([$doc], $person), config('app.url'))`, gekürzt auf die ersten 2000 Zeichen Klartext (dann „…“ und Link); Link zum Item `APP_URL/items/<KEY>`, im Fuß Link zu `APP_URL/me/notifications` (`mail.notifications.footer`); keine Anhänge, keine eingebetteten Bilder (Bilder sind in `toMailHtml` Links).
- **Erinnerungen** (Task 8) sammeln in `scope = due:<Y-m-d>`: eine Mail je Person und Tag mit allen fälligen und überfälligen Items (A275).
- **Kehrer:** `app:send-notification-mails` (jede Minute, `withoutOverlapping(5)`) stellt für Sammlungen ohne `sent_at`, deren `due_at` mehr als 2 Minuten zurückliegt, den Job erneut ein (der Job ist idempotent); mit `--now` schickt er alle offenen sofort (A288, Betrieb und e2e).
- **Testmail** (System-Seite): synchron an die Adresse des Org-Admins, `mail.test.*`.

## Live

| Kanal | Name im Browser | Autorisierung | Was dort ankommt |
|---|---|---|---|
| `project.{projectId}` (privat) | `Echo.private('project.<id>')` | `ProjectChannel::join`: aktive Person, `Visibility::roleIn` nicht `null`, Projekt nicht in Löschung | `work_item.*` (ohne `subscribed`/`unsubscribed`), `project.*` des Projekts |
| `work-item.{itemId}` (privat) | `Echo.private('work-item.<id>')` | `WorkItemChannel::join`: `Authorize::allows($actor, 'view', $item)` | `comment.created|updated|deleted`, `comment.reaction_added|removed` (A227) |
| `user.{userId}` (Presence) | `Echo.join('user.<id>')` | `UserChannel::join`: nur das eigene Konto, aktiv, Person; Antwort `['id' => $user->id]` | `work_item.subscribed|unsubscribed` des Kontos, `notifications.changed` (Konsument `notifications` und Inbox-Aktionen) |

- **Nachricht** (`App\Live\LiveMessage`, `ShouldBroadcastNow`, `broadcastAs()` `live`): `{event_id, type, project_id, item_id, comment_id, actor_id}` (fehlende als `null`; `notifications.changed` mit `event_id: null`, `type`, `unread_changed: true`). Der Tab, der die Änderung auslöste, bekommt sie nicht: `Actor::fromRequest` liest `X-Socket-ID` (`/^\d+\.\d+\z/`), `Actor::meta()` schreibt `socket`, `LiveMessage::$socket = $event->meta['socket'] ?? null` (A282).
- **Zugriff verloren** (A281): auf `project.member_removed` (das Konto aus `changes.member.old.user_id`), `project.updated` mit `changes.visibility` öffentlich → privat (alle aktiven Personen ohne Mitgliedschaft, keine Org-Admins), `user.role_changed` von `admin` zu `member`, `user.deactivated` ruft `App\Live\Disconnect::users($ids)` → `Broadcast::connection()->getPusher()->terminateUserConnections($id)` (Reverb `POST /apps/{app}/users/{user}/terminate_connections`; Reverb trennt jede Verbindung, deren Presence-Daten die ID tragen). Echo verbindet neu, jeder Kanal wird neu autorisiert, ein verlorener `project.{id}` antwortet 403.
- **Fehler** (A284): wirft der Broadcaster (Reverb nicht erreichbar), meldet `LiveConsumer` das höchstens einmal je 10 Minuten (`Cache::add('live-report', …, 600)` + `report()`) und endet ohne Exception (kein Retry, kein `failed_jobs`); Clients laden beim Wiederverbinden neu.
- **Browser** (Task 14): `features.live` (Shared Props) = `{key, host, port, scheme}` aus `config('broadcasting.connections.reverb')`, wenn `config('broadcasting.default') === 'reverb'`, sonst `null` (A285). `useLiveSync()` (Shell): Presence-Kanal der Person, `project.{id}` für jedes Projekt aus `useProjects({ include_archived: true })` (Unterschiede an- und abmelden), je Nachricht: Entdoppeln über `event_id` (die letzten 1000), Sammeln für 300 ms, dann je Typ ungültig machen (`qk.workItems.all` und `qk.activity` bei `work_item.*`, `qk.comments` und `qk.activity` bei `comment.*`, `qk.projects.all` bei `project.*`, `qk.notifications.all` bei `notifications.changed`), mit `refetchType: 'none'`, solange `queryClient.isMutating()` > 0 (die eigene Mutation lädt danach ohnehin, A282); `flash(item_id)` wie im Klickdummy. Wiederverbunden nach einer Unterbrechung → alles Obige ungültig (`live.reconnected`). `useLiveItem(itemId)` (Item-Seite, Vorschau): `work-item.{id}`. Status: verbunden, verbindet, getrennt; das Banner erst nach 3 s ohne Verbindung (Laden der Seite zählt als „verbindet“).

## REST

| Route | Action | Antwort |
|---|---|---|
| `GET /api/v1/notifications?unread_only=&mentions_only=&cursor=&per_page=` | `ListNotifications` | `{data: NotificationResource[], links, meta}` neueste zuerst (`created_at`, `id`), nur `inbox = true`, nur sichtbare Projekte |
| `POST /api/v1/notifications/read` | `MarkNotificationsRead` | `{updated}` ohne `data`; Body `{ids: string[]}` (1–100, eigene; fremde und unbekannte übergangen) **oder** `{all: true, mentions_only?: bool}` (A291) |
| `POST /api/v1/notifications/unread` | `MarkNotificationsUnread` | `{updated}`; Body `{ids}` |
| `DELETE /api/v1/notifications/{notification}` | `DeleteNotification` | 204; fremde oder unsichtbare 404 |
| `GET /api/v1/notification-preferences` | `GetNotificationPreferences` | `{data: NotificationPreference[]}` (9 Arten × 2 Kanäle, Reihenfolge von `NotificationKind`) |
| `PUT /api/v1/notification-preferences` | `SaveNotificationPreferences` | `{data: NotificationPreference[]}` (ganze Matrix); Body `{preferences: [{event, channel, enabled}]}` |
| `GET /api/v1/system` | `GetSystemStatus` | `{data: SystemStatus}` |
| `POST /api/v1/system/failed-jobs/retry` | `RetryFailedJobs` | `{retried}`; Body `{ids?: string[]}` (UUIDs, ohne: alle) |
| `POST /api/v1/system/test-mail` | `SendTestMail` | `{sent_to}`; 409 `mail_not_configured`, 503 `mail_failed` |
| `GET|POST /broadcasting/auth` (Web, `web` + `auth` + `EnsureAccountIsActive`) | Kanalklassen | Pusher-Signatur bzw. 403 als JSON |

`NotificationResource` `{id, event (= kind, Name des Klickdummys), event_id, project_id, work_item_id, actor_id, data, excerpt (Text oder null, A272), read_at, mailed_at (sent_at der Sammlung oder null), created_at, item (schlankes WorkItemResource über loadForResource oder null)}`. `NotificationPreference` `{user_id, event, channel, enabled}`. `SystemStatus` `{version, queued_jobs, delayed_jobs, queues: [{queue, pending, oldest_at}], failed_jobs: [{id, queue, job, error, failed_at}] (neueste 50, error nur die erste Zeile, höchstens 300 Zeichen), failed_jobs_total, search: 'ok'|'down', search_tasks: {enqueued, processing, failed_last_day}|null, mail_configured, live: 'ok'|'down'|'off'}`. `{notification}` bindet `Route::bind` nur per ULID (auch groß), ohne Besitzprüfung (die macht die Action), unbekannt → 404.

## Dateistruktur nach Phase 8

| Ort | Inhalt |
|---|---|
| `app/Domain/Notifications/` | `NotificationKind`, `Channel`, `Preferences` (Standards, `enabled`), `EventFacts` (final readonly), `Recipient`, `Recipients`, `Reminders` (`isReminderHour`, `dueKind`) |
| `app/Models/{Notification,NotificationMail,NotificationPreference}.php` | Modelle |
| `app/Notifications/NotificationConsumer.php` | Konsument `notifications` |
| `app/Actions/Notifications/` | `ListNotifications`, `MarkNotificationsRead`, `MarkNotificationsUnread`, `DeleteNotification`, `GetNotificationPreferences`, `SaveNotificationPreferences`, `NotifyRecipients`, `SendNotificationMail`, `DispatchDueMails`, `SendDueReminders`, `PruneNotifications` |
| `app/Actions/System/` | `GetSystemStatus`, `RetryFailedJobs`, `SendTestMail` |
| `app/Support/NotificationFacts.php` | liest die Fakten eines Events aus der Datenbank (Beobachter, Lead, Abmeldungen) für `Recipients` |
| `app/Mail/{NotificationDigest,TestMail}.php`, `resources/views/mail/notifications/*.blade.php`, `resources/views/mail/test*.blade.php` | Mails |
| `app/Jobs/{SendNotificationMailJob,SendDueRemindersJob,PruneNotificationsJob}.php`, `app/Console/Commands/SendNotificationMailsCommand.php` | Jobs, Kehrer |
| `app/Live/` | `LiveConsumer`, `LiveMessage`, `NotificationsChanged`, `Disconnect` |
| `app/Broadcasting/{ProjectChannel,WorkItemChannel,UserChannel}.php`, `routes/channels.php` | Kanäle |
| `app/Policies/NotificationPolicy.php`, `OrganizationPolicy::viewSystem` | Rechte |
| `app/Http/Controllers/Api/{NotificationsController,NotificationPreferencesController,SystemController}.php`, `app/Http/Resources/{NotificationResource,NotificationPreferenceResource,SystemStatusResource}.php` | dünne Schicht |
| `resources/js/api/{notifications,system,live}.ts`, `resources/js/hooks/{notifications,system,live}.ts` | Datenschicht, Echo |
| `resources/js/features/inbox/` | `InboxScreen`, `NotificationCard`, `NotificationRow`, `useReadMarks`, `notifications.ts` (Gruppen, Zeit, Felder) |
| `resources/js/features/settings/personal/notifications/` | `Notifications.tsx`, `matrix.ts` |
| `resources/js/features/settings/org/system/` | `System.tsx` |
| `resources/js/shell/` | `LiveIndicator` (echt), `InboxBadge`, `LiveHost` |
| `docs/{en,de}/concepts/notifications.md` | Doku |

## Paketversionen

Geprüft am 2026-11-03: `ddev exec pnpm view <paket> version`, `… dependencies`, `… peerDependencies`, `… scripts.postinstall`; `ddev composer show <paket>`; Root-`pnpm-lock.yaml` (beide npm-Pakete fehlen dort noch, auch im Klickdummy).

| Paket | Version | Task | Hinweis |
|---|---|---|---|
| `laravel-echo` | `2.6.3` (genau) | 13 | neueste; Peers `pusher-js` und `socket.io-client` optional; Broadcaster `reverb`; eigene Typen |
| `pusher-js` | `8.6.0` (genau) | 13 | neueste; Abhängigkeit `tweetnacl ^1.0.3`; keine Install-Skripte, `allowBuilds` bleibt unverändert; eigene Typen |
| `laravel/reverb` | v1.12.0 (installiert) | 2, 10 | `UsersTerminateController` (A281), `accept_client_events_from` nimmt außer `all`/`members` alles als „keine“ |
| `pusher/pusher-php-server` | 7.3.0 (installiert, über Reverb) | 10 | `terminateUserConnections()` |
| `laravel/framework` | v13.39.0 (installiert) | – | `InteractsWithSockets::$socket`, `ShouldBroadcastNow`, `Mail::to()->locale()` |
| Mailpit | `axllent/mailpit:v1.32.0@sha256:0790692be935ea4420d085694f7985b1f692ca6a8771ab0e0bd8ba75ac180498` | 7 | derselbe Digest wie im Job `e2e`; neu als Service im Job `tests` (Integration) |

`@laravel/echo-react` (2.6.3) wird nicht benutzt: die Hooks sind eigene (Kanäle je sichtbarem Projekt, Entdoppeln, Mutationsschutz).

## Port-Umfang aus `prototypes/clickdummy/src/`

| Portiert in Phase 8 | Ziel | Task |
|---|---|---|
| `api/events.ts` (`notifyPeople`, `channelEnabled`, `MAIL_BY_DEFAULT`), Aufrufer in `itemRules.ts`, `comments.ts`, `relations.ts`, `attachments.ts`, `workItems.ts` | `App\Domain\Notifications\*`, `NotifyRecipients` | 3, 5 |
| `api/notifications.ts` (Regeln: `stillVisible`, Filter) | `ListNotifications`, `Mark…`, `DeleteNotification`, Einstellungen | 4, 6 |
| `api/notifications.ts`, `api/system.ts`, `hooks/{notifications,system}.ts` (Signaturen) | `resources/js/api/`, `resources/js/hooks/` | 13 |
| `api/live.ts`, `hooks/live.ts` (`useLiveSync`), `app/LiveIndicator.tsx` | `resources/js/api/live.ts` (Echo), `hooks/live.ts`, `shell/LiveIndicator.tsx` | 14 |
| `features/inbox/**` | `resources/js/features/inbox/**` (geteilt: `useReadMarks`, 13b) | 16, 17 |
| `features/settings/personal/{Notifications.tsx,matrix.ts}` | `resources/js/features/settings/personal/notifications/` | 18 |
| `features/settings/org/System.tsx` | `resources/js/features/settings/org/system/System.tsx` | 19 |
| `api/seed/inbox.ts` (Benachrichtigungen von Mara) | `database/seeders/Demo/NotificationsSeeder.php` | 12 |

Nicht in Phase 8: Erzeuger von `template_run_failed` (Phase 10) und `webhook_disabled` (Phase 11), Webhooks (Phase 11), MCP-Tools für die Inbox (Phase 13), Worker-Container und nginx-Weiterleitung an Reverb (Phase 14).

## Abdeckung über die Tasks

- **PHP:** G1 in jeder PHP-Task. Neue Actions und Routen bekommen im selben Commit ihre Matrix-Zeilen (Inbox: alle Spalten erlaubt, fremde Benachrichtigung `hidden`; Einstellungen: Personen erlaubt, Standard-Bot 403; System: nur `org_admin` erlaubt, alle anderen 403; System-Actions des Konsumenten als `system`-Zeilen ohne Event). Kanäle prüft `tests/Feature/Live/ChannelAuthorizationTest.php` je Spalte von `MatrixWorld`.
- **Frontend, Vitest:** neue Schwellen `resources/js/features/inbox/**`, `resources/js/features/settings/personal/notifications/**`, `resources/js/features/settings/org/system/**` (je 100 % Zeilen) in `vitest.config.ts`; `api/`, `hooks/`, `lib/`, `shell/sidebar/**` haben schon Schwellen. `shell/LiveIndicator.tsx`, `shell/LiveHost.tsx`, `shell/InboxBadge.tsx` decken Vitest und Playwright zusammen (K22: `shell/` außer `sidebar/` hat keine eigene Schwelle).
- **Frontend, Playwright:** neue Specs `e2e/tests/{inbox,notification-settings,system,live}.spec.ts`, Abnahme `e2e/tests/notifications-acceptance.spec.ts` (Task 20); Ergänzungen in `shell.spec.ts` (Badge, Banner), `create-item.spec.ts` (Task 15). Was jsdom nicht kann (echter Websocket, Trennen und Wiederverbinden, zwei Kontexte), decken diese Specs.

---

### Task 1: Überträge Server: Reset-Mail mit Wiederholungen, JSON-Antworten auf Web-Routen

**Modell:** opus

**Files:**
- Modify: `app/Actions/Auth/SendPasswordResetLink.php`, `app/Notifications/ResetPasswordNotification.php` (`ShouldQueue`, Queue `notifications`, `tries`/`backoff`, `afterCommit`), `app/Models/User.php` (`sendPasswordResetNotification` reicht die Notification nur durch), `app/Exceptions/Rendering.php` (`respond()` lässt `expectsJson()` in Ruhe), `tests/Feature/Auth/PasswordResetTest.php`, `tests/Feature/ErrorPagesTest.php`, `CLAUDE.md` (Anmeldung, Fallstricke)

**Interfaces:**
- Produces:
  - Vormerkung Phase 8 „eine fehlgeschlagene Reset-Mail wird nicht erneut gesendet“: `SendPasswordResetLink` (Job, Queue `notifications`) ruft den Broker genau einmal (Token geschrieben, `tries = 1`, weil ein zweiter Lauf ein neues Token schriebe); die `ResetPasswordNotification` geht selbst über die Queue `notifications` mit `tries = 5`, `backoff = [60, 300, 900, 3600]`: ein SMTP-Fehler wiederholt nur die Mail mit demselben Link.
  - `Rendering::register`: der `respond()`-Callback gibt die Antwort unverändert zurück, wenn `$request->expectsJson()` gilt (Vormerkung: `/broadcasting/auth` antwortet einem `fetch` mit `Accept: application/json` 403 als JSON, nie als Inertia-Seite).
- Consumes: nichts Neues.

- [ ] **Step 1: Failing Tests** — `PasswordResetTest`: „retries a failed reset mail with the same link“ (`Mail` wirft beim ersten Versuch, `Queue::fake` nicht; der Job der Notification läuft zweimal, beide Mails nennen dasselbe Token, `password_reset_tokens` hat eine Zeile); „writes the token once“. `ErrorPagesTest`: „keeps a JSON 403 on a web route for a JSON request“ (Web-Route, die `Problem::forbidden()` wirft, mit `Accept: application/json` → JSON, ohne → Inertia `Errors/Error`).
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='PasswordReset|ErrorPages|LoginThrottle'`.
- [ ] **Step 3: `CLAUDE.md`** — Anmeldung („Reset-Mail mit eigenen Wiederholungen“), Fallstricke (Mails über `notifications`).
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `fix: retry a failed reset mail with the same link and keep JSON refusals on web routes`.

---

### Task 2: Reverb, Broadcasting und Queue `live` verdrahten

**Modell:** sonnet (mechanisch, Code und Werte vollständig unten)

**Files:**
- Modify: `bootstrap/app.php`, `config/reverb.php`, `config/werkbuch.php` (Kommentar zu `event_consumers`, neu `queues`), `app/Http/Middleware/HandleInertiaRequests.php` (`features.live`), `resources/js/lib/page.ts` (Typ), `resources/js/lib/page.test.ts`, `.ddev/config.yaml` (Daemon `queue`), `.env.example`, `e2e/ci.env`, `.github/workflows/tests.yml` (Job `e2e`: Reverb starten, Worker-Queues), `tests/Feature/InertiaTest.php` (Shared Props), `tests/Feature/ConfigTest.php`, `CLAUDE.md` (Kommandos, Ports, Shared Props, Fallstricke)

**Interfaces:**
- Produces:
  - `bootstrap/app.php`: `channels:` aus `withRouting` entfernen und `->withBroadcasting(__DIR__.'/../routes/channels.php', ['middleware' => ['web', 'auth', EnsureAccountIsActive::class]])`; `routes/channels.php` bleibt bis Task 9 leer (Kommentar „channels arrive in Task 9“ ersetzt den alten).
  - `config/reverb.php`, App-Eintrag: `'allowed_origins' => [parse_url((string) env('APP_URL'), PHP_URL_HOST) ?: 'localhost']`, `'accept_client_events_from' => 'none'` (kein Whisper; Reverb nimmt außer `all`/`members` keine Client-Events).
  - `config/werkbuch.php`: `'queues' => ['default', 'live', 'notifications', 'webhooks', 'search', 'media', 'bulk']` (Reihenfolge des Workers, A278; die System-Seite liest sie).
  - `features.live` in `HandleInertiaRequests::share`: `config('broadcasting.default') === 'reverb' ? ['key' => config('broadcasting.connections.reverb.key'), 'host' => config('broadcasting.connections.reverb.options.host'), 'port' => (int) config('broadcasting.connections.reverb.options.port'), 'scheme' => config('broadcasting.connections.reverb.options.scheme')] : null` (A285). `page.ts`: `live: { key: string; host: string; port: number; scheme: 'http' | 'https' } | null`.
  - `.ddev/config.yaml`, Daemon `queue`: `--queue=default,live,notifications,webhooks,search,media,bulk`.
  - `e2e/ci.env`: `BROADCAST_CONNECTION=reverb`, `REVERB_HOST=127.0.0.1`, `REVERB_PORT=8080`, `REVERB_SCHEME=http`, `REVERB_SERVER_HOST=127.0.0.1`, `REVERB_SERVER_PORT=8080`. `.env.example` bleibt bei DDEV-Werten (Port 6001, https).
  - `tests.yml`, Job `e2e`: nach „Server“ ein Schritt „Reverb“: `php artisan reverb:start --host=127.0.0.1 --port=8080 > reverb.log 2>&1 &` und `curl -fsS --retry 30 --retry-delay 1 --retry-all-errors http://127.0.0.1:8080/up`; „Queue worker“ mit `--queue=default,live,notifications,search,media,bulk`; `reverb.log` im Artefakt `e2e-results`. Bis Task 14 meldet der Stub im Browser weiter „verbunden“.
- Consumes: nichts Neues.

- [ ] **Step 1: Failing Tests** — `InertiaTest`: „shares the live settings when Reverb is the broadcaster“, „shares no live settings for the log broadcaster“. `ConfigTest`: „lists the queues in the worker's order“, „lets Reverb take client events from nobody and only the host of APP_URL“. `page.test.ts`: Typ mit `live`.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='InertiaTest|ConfigTest'`; `ddev exec pnpm test -- resources/js/lib/page`; `ddev restart` (Daemons mit der neuen Queue).
- [ ] **Step 3: `CLAUDE.md`** — Kommandos (Worker-Queues), Ports (Reverb 6001 in DDEV, 8080 in der CI), Shared Props (`features.live`), Fallstricke („nach Änderungen an Kanälen oder Broadcasts `ddev restart`“ steht schon; Queue `live` ergänzen).
- [ ] **Step 4: Gates G1, G2**
- [ ] **Step 5: Commit** — `chore: wire up Reverb, the broadcasting routes and the live queue`.

---

### Task 3: Die reinen Regeln: Arten, Standards, Empfänger, Erinnerungen

**Modell:** opus

**Files:**
- Create: `app/Domain/Notifications/{NotificationKind,Channel,Preferences,EventFacts,Recipient,Recipients,Reminders}.php`, `tests/Unit/Domain/Notifications/{RecipientsTest,PreferencesTest,RemindersTest}.php`
- Modify: `tests/Unit/ArchTest.php` (nur falls `App\Domain` eine neue Liste braucht), `CLAUDE.md` (Architektur „Benachrichtigungen: Regeln“)

**Interfaces:**
- Produces (rein, ohne Laravel und Carbon, `ArchTest`):
  - `enum NotificationKind: string` mit den neun Werten der Tabelle „Benachrichtigungsarten“, `rank(): int`, `mailByDefault(): bool` (`mentioned`, `assigned`, `comment`, `due`), `ORDER` (Reihenfolge des Klickdummys); `enum Channel: string { Inbox = 'inbox'; Mail = 'mail'; }`.
  - `Preferences::enabled(NotificationKind $kind, Channel $channel, array $stored): bool` (`$stored` = `"<kind>:<channel>" => bool`; fehlt der Eintrag: Inbox immer an, Mail nach `mailByDefault()`).
  - `final readonly class EventFacts` (`type` string, `actorId`, `projectId`, `itemId` nullable, `changedFields` list<string> (aus `changes`, ohne `rank`; `relation` für `relation_*`, `attachment` für `changes.attachments`), `mentioned` list<string> (nur Personen, schon ohne den Actor), `assignee` nullable (die neue zuständige Person bei `assigned`/`created`), `watchers` list<string>, `optedOut` list<string>, `leadId` nullable, `stateSnapshot` nullable array).
  - `Recipients::of(EventFacts $facts): list<Recipient>` nach der Empfängerregel oben; `Recipient(string $userId, list<NotificationKind> $kinds)` (nach `rank()`), sortiert nach `userId`. Ein Event ohne Art (A270) → `[]`.
  - `Reminders::isReminderHour(DateTimeImmutable $nowUtc, DateTimeZone $zone): bool` (Stunde 8 in der Zone), `Reminders::localDay(…): string` (`Y-m-d`), `Reminders::dueKind(string $dueDate, string $today): ?bool` (`false` fällig heute, `true` überfällig, `null` später).
- Consumes: nichts.

- [ ] **Step 1: Failing Tests** — `RecipientsTest` (je Event der Tabelle mindestens ein Fall, Namen wie die Regel): „tells watchers and the lead about a comment, never its writer“; „names the mentioned people mentioned, not again as comment“ (beide Arten in `kinds`, `mentioned` zuerst); „tells only the new assignee assigned, the others item_changed“ (A268); „tells the lead about a new item, the assignee assigned“; „tells nobody about a change of rank alone“; „tells watchers about relations and attachments“ (13c); „keeps an opt-out away except for a mention and an assignment“ (A113); „treats the lead as watcher unless the lead opted out“ (A269); „passes archived, restored, deleted, subscribed, reactions, comment.deleted, bot and catalog events“ (A270); „tells only newly mentioned people about an edited comment“. `PreferencesTest`: „has the inbox on and mail on for assigned, mentioned, comment and due by default“, „takes a stored choice over the default“. `RemindersTest`: „finds 08:00 in Berlin on the day the clocks go back“ (2026-10-25), „finds 08:30 in Kolkata in the hour of 03:00 UTC“, „is not the hour at 07:59“, „reads due today and overdue in the person's calendar“.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Domain\\\\Notifications|ArchTest'`.
- [ ] **Step 3: `CLAUDE.md`** — Architektur „Benachrichtigungen: Regeln“ (Arten, Standards, Empfängerregel, A267–A270).
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: add the pure rules of notifications: kinds, defaults, recipients and reminders`.

---

### Task 4: Datenmodell und Einstellungen (REST)

**Modell:** opus

**Files:**
- Create: Migration `2026_11_03_001100_create_notifications_tables.php`, `app/Models/{Notification,NotificationMail,NotificationPreference}.php`, `database/factories/{NotificationFactory,NotificationMailFactory}.php`, `app/Policies/NotificationPolicy.php`, `app/Actions/Notifications/{GetNotificationPreferences,SaveNotificationPreferences}.php`, `app/Http/Controllers/Api/NotificationPreferencesController.php`, `app/Http/Resources/NotificationPreferenceResource.php`, `tests/Feature/Notifications/PreferencesTest.php`, `tests/Feature/Api/NotificationPreferencesApiTest.php`
- Modify: `app/Providers/AppServiceProvider.php` (Morph-Map `notification`, Policy), `routes/api.php`, `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `tests/Feature/MorphMapTest.php`, `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - Tabellen nach „Datenmodell“; `Notification` (Casts `data` array, `inbox` bool, `kind` `NotificationKind`; Beziehungen `user`, `project`, `workItem`, `actor`, `mail`, `event`), `NotificationMail` (`notifications()`), `NotificationPreference`; `User::notificationPreferences()`. `NotificationFactory` (`forItem($item)`, `read()`, `kind($kind)`, `mailOnly()`).
  - `NotificationPolicy`: `view`/`update`/`delete` nur die eigene (`denyAsNotFound` sonst); `managePreferences($user)`: nur Personen, sonst 403 `problem.detail.persons_only_notifications`.
  - `GetNotificationPreferences::handle($actor): list<array{user_id, event, channel, enabled}>` (Matrix aus gespeicherten Zeilen und `Preferences::enabled`, Reihenfolge `NotificationKind::ORDER` × `inbox`, `mail`); Bots: leere Liste.
  - `SaveNotificationPreferences::handle($actor, array $input)`: Recht `managePreferences`; `preferences` eine Liste von `{event, channel, enabled}` (unbekannte Art `field.preferences.event`, Kanal `field.preferences.channel`, `enabled` boolean, an `preferences.<n>.*`; Doppelte: der letzte gilt); in einer Transaktion `upsert` auf (`user_id`, `kind`, `channel`); kein Event (A277); Antwort die ganze Matrix.
  - REST nach „REST“ (zwei Routen).
- Consumes: Task 3.

- [ ] **Step 1: Failing Tests** — `PreferencesTest`: „answers the defaults of the spec for a new person“, „stores a choice and answers the whole matrix“, „refuses an unknown event and channel at their row“, „refuses a bot with 403“, „writes no event“. `NotificationPreferencesApiTest`: Lese-Token liest, Schreiben braucht `write`. Matrix: zwei Zeilen (Personen erlaubt, `default_bot` 403); Routen-Matrix: zwei Zeilen; `MorphMapTest`.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Preferences|RightsMatrixTest|RouteMatrixTest|MorphMapTest'`.
- [ ] **Step 3: `CLAUDE.md`** — Architektur „Benachrichtigungen: Datenmodell und Einstellungen“.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: add the notification tables and the notification preferences`.

---

### Task 5: Konsument `notifications`: wer was bekommt

**Modell:** opus

**Files:**
- Create: `app/Notifications/NotificationConsumer.php`, `app/Actions/Notifications/NotifyRecipients.php`, `app/Support/NotificationFacts.php`, `tests/Feature/Notifications/{NotifyRecipientsTest,NotificationConsumerTest}.php` (Sammlungen und Mail-Job kommen in Task 7)
- Modify: `config/werkbuch.php` (`event_consumers` + `NotificationConsumer`), `tests/Feature/Access/matrix.php` (`system`-Zeile), `tests/Unit/ArchTest.php` (`App\Notifications\NotificationConsumer` schreibt keine Modelle), `CLAUDE.md`

**Interfaces:**
- Produces:
  - `NotificationConsumer implements EventConsumer, RetriesConsumption` (`key()`/`queue()` `notifications`; 8 Versuche, 10/60/300/900/3600 s wie `SearchConsumer`): `consume($event)` → `NotifyRecipients::run(Actor::system(User::defaultBot(), 'notifications'), $event)`.
  - `NotificationFacts::of(Event $event): ?EventFacts` (`null` für Events ohne Item und ohne Art; lädt Item, Projekt (nicht in Löschung, sonst `null`), Beobachter und Abmeldungen in je einer Abfrage, `meta.mentioned` nur Personen, die nicht der Actor sind).
  - `NotifyRecipients::handle($actor, Event $event): int` (Anzahl geschriebener Zeilen): `Recipients::of`, dann je Kandidat aktiv, Person, `Visibility::projectIds` enthält das Projekt (eine Abfrage je Kandidat über den `RoleIndex`; `Visibility::forget()` vor dem Lesen, A35), gespeicherte Einstellungen in einer Abfrage; erste Art mit einem eingeschalteten Kanal; `Notification` per `insertOrIgnore` über (`user_id`, `dedupe_key` = `event:<event_id>`) mit `inbox`, `data` (Tabelle oben; `fields` aus `changes`, `from`/`to` aus `meta.states`, `comment_id`, `source`); `created_at` = `occurred_at` des Events (P2). Ob die Zeile Mail will, steht nur über den Kanal fest; Sammlungen hängt Task 7 an (`NotifyRecipients::collect()` als eigene Methode, hier noch nicht). Eine Zeile mit nur dem Kanal `mail` entsteht hier schon (`inbox = false`, A271), damit Task 7 nur sammeln muss.
- Consumes: Tasks 3, 4, `Visibility`, `Outbox`.

- [ ] **Step 1: Failing Tests** — `NotifyRecipientsTest` gegen echte Actions (`consumers(NotificationConsumer::class)`, `Queue::fake([SendNotificationMailJob::class])`): „notifies Mara when Ida comments on an item Mara watches“; „notifies Mara mentioned in a comment once, as mentioned“; „notifies nobody about their own change“; „never notifies a bot, a deactivated person or one who lost the project“; „notifies the lead about a new item“; „leaves out a person whose inbox and mail are off for the kind, and falls back to the next kind that is on“ (A267); „stores a mail-only notification hidden from the inbox“ (A271); „takes the state names of meta.states“; „takes the fields of the change, not the values“. `NotificationConsumerTest`: „writes one notification for an event that arrives twice“ (`Outbox::consume` zweimal, auch nach einem gescheiterten ersten Versuch hinter dem Claim: `FailingOnceConsumer`-Muster); „takes the events of the migrations without notifications“; „passes an event of a project being deleted“. Matrix: `NotifyRecipients` als `system`-Zeile ohne Event.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Notif|RightsMatrixTest|ArchTest|Outbox'`.
- [ ] **Step 3: `CLAUDE.md`** — Architektur „Benachrichtigungen: Konsument“ (Queue, Versuche, Dedupe, Sammlung, `event_consumers`), Fallstricke (Tests schalten ihn mit `consumers(NotificationConsumer::class)` zu).
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: turn events into notifications for watchers, leads, assignees and mentioned people`.

---

### Task 6: Inbox über REST: Liste, gelesen, ungelesen, löschen

**Modell:** opus

**Files:**
- Create: `app/Actions/Notifications/{ListNotifications,MarkNotificationsRead,MarkNotificationsUnread,DeleteNotification}.php`, `app/Http/Controllers/Api/NotificationsController.php`, `app/Http/Resources/NotificationResource.php`, `tests/Feature/Notifications/{ListNotificationsTest,MarkNotificationsTest,DeleteNotificationTest}.php`, `tests/Feature/Api/NotificationsApiTest.php`
- Modify: `routes/api.php` (`Route::bind('notification')`, vier Routen), `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `ListNotifications::handle($actor, array $query): ListResult` — nur eigene mit `inbox = true`; `unread_only`, `mentions_only` (`boolean`, sonst `field.boolean`); `whereIn('project_id', Visibility::projectIds($user))` (13c „listNotifications filters only by recipient“, Review Focus 3); neueste zuerst über `created_at` roh (`created_cursor`) und `id`, `PageArgs`; `Notification::loadForResource($list, $reader)` (Items schlank über `WorkItem::loadForResource(…, lean: true)`; Kommentare der Auszüge in einer Abfrage, `excerpt` = die ersten 160 Zeichen von `toText()` des aktuellen Kommentars, `null`, wenn er fehlt (A272); `mailed_at` aus der Sammlung).
  - `MarkNotificationsRead::handle($actor, array $input): int` — `ids` (Liste aus 1–100 ULIDs, `field.ids.invalid`) **oder** `all: true` mit optional `mentions_only` (A291); setzt `read_at = now()` nur für eigene, ungelesene, sichtbare; kein Event (A277). `MarkNotificationsUnread` (`ids`): `read_at = null`. `DeleteNotification($actor, Notification $n)`: Recht `delete` (fremd → 404), Zeile weg. Alle vier melden ab Task 10 `notifications.changed` (hier noch nicht).
  - `NotificationResource` nach „REST“.
- Consumes: Tasks 4, 5.

- [ ] **Step 1: Failing Tests** — `ListNotificationsTest`: „lists my notifications newest first and pages them without losing one in the same second“; „hides the notifications of a project I lost, and shows them again when I am back“; „hides mail-only notifications“; „filters unread and mentions“; „shows the current comment as excerpt, nothing once it is deleted“; „gives Ida no key or title of an item she cannot see in the excerpt“ (Verweis `OPS-12` im Kommentar eines WEB-Items); „lists an empty inbox for a bot“; „asks the database a fixed number of times for 5 and 50 notifications“. `MarkNotificationsTest`: „marks my own as read and skips foreign ids“, „marks all, or all mentions, as read“ (A291), „marks unread again“, „refuses more than 100 ids“. `DeleteNotificationTest`: „deletes my own“, „answers 404 for a foreign one“. Matrix: vier Zeilen; Routen-Matrix: vier Zeilen (Lese-Token liest die Liste).
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Notification|RightsMatrixTest|RouteMatrixTest'`.
- [ ] **Step 3: `CLAUDE.md`** — Architektur „Benachrichtigungen: Inbox“.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: list, read, unread and delete notifications over REST`.

---

### Task 7: Sammelmail: Senden mit Prüfung, Kehrer, Mailpit

**Modell:** opus

**Files:**
- Create: `app/Actions/Notifications/{SendNotificationMail,DispatchDueMails}.php`, `app/Mail/NotificationDigest.php`, `resources/views/mail/notifications/{digest,digest-text}.blade.php`, `app/Jobs/SendNotificationMailJob.php` (Queue `notifications`, `tries` 5, `backoff` 60/300/900/3600, ruft die Action), `app/Console/Commands/SendNotificationMailsCommand.php`, `tests/Feature/Notifications/{SendNotificationMailTest,DispatchDueMailsTest}.php`, `tests/Support/Mailpit.php`, `tests/Integration/{NotificationMailTest,NotificationMailRaceTest}.php`
- Modify: `app/Actions/Notifications/NotifyRecipients.php` (Sammlungen: `collect()` nach „Mail“, `insertOrIgnore` über `open_key`, `lockForUpdate`, neu → `SendNotificationMailJob::dispatch($id)->delay($dueAt)->afterCommit()`, `mail_id` an der Zeile), `tests/Feature/Notifications/NotifyRecipientsTest.php`, `routes/console.php` (Kehrer jede Minute, `withoutOverlapping(5)`), `phpunit.xml` (`MAILPIT_URL` Standard `http://127.0.0.1:8025`, nicht `force`), `.github/workflows/tests.yml` (Job `tests`: Service `mailpit` mit dem Digest des Jobs `e2e`, Ports 1025/8025, `MAILPIT_URL`), `tests/Feature/Access/matrix.php`, `lang/{en,de}.json` (`mail.notifications.*`), `CLAUDE.md`

**Interfaces:**
- Produces:
  - `SendNotificationMail::handle($actor, string $mailId): string` (`sent`, `skipped`, `already`) nach „Mail“; Inhalt über `NotificationDigest` (Mailable, `->locale()` der Person; Ansichten ohne Tailwind, Inline-Stile nach `DESIGN.md`-Farben; HTML der Texte nur aus `toMailHtml`).
  - `DispatchDueMails::handle($actor, bool $now = false): int` (Kehrer, A288); Befehl `app:send-notification-mails {--now}`.
  - `Tests\Support\Mailpit` (`use()`: SMTP `127.0.0.1:1025`, Mailer `smtp`, leert Mailpit über `DELETE /api/v1/messages`; `messagesTo($email)`, `html($id)`, `text($id)`).
- Consumes: Tasks 4, 5, `Document::toMailHtml`, `ReaderNames`, `MailSetup`.

- [ ] **Step 1: Failing Tests** — `NotifyRecipientsTest` (ergänzt): „opens one mail per person and item and joins later ones“; „dispatches the mail job once, after the commit“ (`Queue::fake([SendNotificationMailJob::class])`, Rollback → kein Job); „opens no mail without a mail server“ (A274); „joins a collection that is due but not sent yet“. `SendNotificationMailTest` (`Mail::fake()`): „sends one mail with every unread notification of the item“; „sends nothing once every notification is read, and marks the collection skipped“; „leaves out a person who lost the project before the mail“ (Review Focus 3: Ida aus OPS entfernt), „… a deactivated person“, „… a project made private“, „… an org admin who became a member“; „leaves out a kind whose mail was switched off meanwhile“; „sends a collection only once, even when its job runs twice“; „writes the mail in the person's language with the link to the item and to the settings“; „shows Ida no key of an item she cannot see in the comment text“; „sends no attachment and no embedded image“; „opens a new collection for a notification that arrives after the send“. `DispatchDueMailsTest`: „dispatches the job again for a collection left behind“, „sends everything open with --now“. `Integration/NotificationMailTest` (Mailpit): „delivers the digest over SMTP“ (Betreff, HTML mit Link, Text-Teil). `Integration/NotificationMailRaceTest` (`RaceConnections`): „sends one mail when two jobs take the same collection“ (`hold` sperrt die Sammlung, `second` wartet, findet `sent_at`). Matrix: `SendNotificationMail`, `DispatchDueMails` als `system`-Zeilen.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='NotificationMail|DispatchDueMails|RightsMatrixTest'`; `ddev artisan test --testsuite=Integration --filter='NotificationMail'`.
- [ ] **Step 3: `CLAUDE.md`** — Architektur „Benachrichtigungen: Mail“ (Sammeln, Senden, Kehrer, `--now`), Kommandos (`app:send-notification-mails`), Fallstricke (Mailpit in `tests/Integration`, `Mail::fake` in Feature-Tests).
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: collect notification mails per person and item and check access when sending`.

---

### Task 8: Erinnerungen „fällig/überfällig“ und Aufräumen

**Modell:** opus

**Files:**
- Create: `app/Actions/Notifications/{SendDueReminders,PruneNotifications}.php`, `app/Jobs/{SendDueRemindersJob,PruneNotificationsJob}.php`, `tests/Feature/Notifications/{SendDueRemindersTest,PruneNotificationsTest}.php`
- Modify: `routes/console.php` (beide stündlich, `withoutOverlapping(60)`), `resources/views/mail/notifications/*` (Erinnerungsmail), `tests/Feature/Access/matrix.php`, `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `SendDueReminders::handle($actor): int`: Zonen aller aktiven Personen (`effectiveTimezone()`), je Zone, für die `Reminders::isReminderHour` gilt: deren Personen mit zugewiesenen Items (nicht archiviert, Projekt nicht archiviert und nicht in Löschung, Status nicht Completed/Canceled, `due_date` ≤ heute der Person, Projekt sichtbar) → je Item eine `Notification` `due` (`dedupe_key` `due:<item>:<Tag>`, `actor_id` `null`, `event_id` `null`, `data` `{due_date, overdue}`) nach den Einstellungen; Mail in der Sammlung `due:<Tag>` der Person (eine Mail je Tag, A275). Fester Satz Abfragen je Zone (kein N+1 je Person).
  - `PruneNotifications::handle($actor): int`: gelesene mit `read_at` älter als 90 Tage, Nur-Mail-Zeilen, deren Sammlung gesendet ist, und gesendete Sammlungen älter als 90 Tage (A276); in Blöcken zu 1000.
- Consumes: Tasks 3–5, 7.

- [ ] **Step 1: Failing Tests** — `SendDueRemindersTest`: „reminds Mara at 08:00 in Berlin about an item due today and one overdue“; „reminds a person in New York at her 08:00, not at Berlin's“; „reminds a person in Kolkata in the hour of 08:30“; „reminds on the day the clocks change“; „reminds once per day although the job runs twice“; „does not remind about closed or archived items or items of archived projects“; „does not remind a person without access or a bot assignee“; „sends one reminder mail per person and day“; „follows the reminder preferences“. `PruneNotificationsTest`: „deletes read notifications after 90 days, keeps unread ones“, „deletes sent mail-only rows and old collections“. Matrix: zwei `system`-Zeilen.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='DueReminders|PruneNotifications|RightsMatrixTest'`.
- [ ] **Step 3: `CLAUDE.md`** — Architektur „Benachrichtigungen: Erinnerungen und Aufräumen“ (A275, A276), Scheduler-Liste.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: remind assignees of due items at 08:00 in their time zone and prune old notifications`.

---

### Task 9: Kanäle und ihre Autorisierung, der eigene Tab

**Modell:** opus

**Files:**
- Create: `app/Broadcasting/{ProjectChannel,WorkItemChannel,UserChannel}.php`, `tests/Feature/Live/ChannelAuthorizationTest.php`, `tests/Feature/Live/SocketTest.php`
- Modify: `routes/channels.php`, `app/Support/Actor.php` (`?string $socket`, `fromRequest` liest `X-Socket-ID`, `meta()` mit `socket`), `tests/Feature/ActorTest.php`, `tests/Unit/ArchTest.php` (`App\Broadcasting` final, nur Policies und `Visibility`), `CLAUDE.md`

**Interfaces:**
- Produces:
  - `Broadcast::channel('project.{projectId}', ProjectChannel::class)`, `('work-item.{itemId}', WorkItemChannel::class)`, `('user.{userId}', UserChannel::class)`; jede Klasse `join(User $user, string $id): bool|array` über `Actor::system($user, 'live')` und `Authorize::allows`/`Visibility::roleIn` (nach „Live“); ein Bot oder deaktiviertes Konto → `false`; unbekannte IDs → `false` (nie ein 500). `UserChannel` antwortet `['id' => $user->id]` (Presence).
  - `Actor::$socket` (nur aus der Sitzung der Oberfläche, nur `/^\d+\.\d+\z/`, sonst `null`); `Actor::meta()` hängt `socket` nur an, wenn gesetzt (History und Resources lesen es nicht; Vormerkung Phase 11: Webhooks geben `meta.socket` nie aus).
- Consumes: Task 2.

- [ ] **Step 1: Failing Tests** — `ChannelAuthorizationTest` (Reverb-Konfiguration im Test, `POST /broadcasting/auth` mit `socket_id`/`channel_name`, je Spalte von `MatrixWorld`): `private-project.<WEB>`: erlaubt für alle mit Lesezugriff, 403 für Außenstehende privater Projekte und für ein Projekt in Löschung; `private-work-item.<id>`: wie `view`; `presence-user.<id>`: nur das eigene Konto, 403 für ein fremdes, für einen Bot und ohne Sitzung (401/403 als JSON, Task 1); „answers 403 for an unknown project id“; „refuses a token“ (A283). `SocketTest`: „records the socket of the request in the event's meta“, „ignores a malformed socket id“, „leaves the history without the socket“.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Live|Actor|ArchTest|ListHistory'`.
- [ ] **Step 3: `CLAUDE.md`** — Architektur „Live: Kanäle“ (A280, A282, A283), Actor (`socket`).
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: authorize the live channels with the policies and remember the socket of a change`.

---

### Task 10: Konsument `live`, Inbox-Meldungen und Trennen bei Zugriffsverlust

**Modell:** opus

**Files:**
- Create: `app/Live/{LiveConsumer,LiveMessage,NotificationsChanged,Disconnect}.php`, `tests/Support/RecordingBroadcaster.php`, `tests/Feature/Live/{LiveConsumerTest,NotificationsChangedTest,DisconnectTest}.php`
- Modify: `config/werkbuch.php` (`event_consumers` + `LiveConsumer`), `app/Actions/Notifications/{NotifyRecipients,MarkNotificationsRead,MarkNotificationsUnread,DeleteNotification}.php` (nach dem Commit `NotificationsChanged`), `tests/Pest.php` (`broadcasts()`: schaltet auf `RecordingBroadcaster` und gibt ihn zurück), `tests/Unit/ArchTest.php` (`App\Live`), `CLAUDE.md`

**Interfaces:**
- Produces:
  - `LiveConsumer implements EventConsumer, RetriesConsumption` (`key()`/`queue()` `live`, `tries()` 1, `backoff()` `[]`): je Event nach der Tabelle „Live“ ein `broadcast(new LiveMessage(...))` (sofort, `ShouldBroadcastNow`); Events ohne Kanal gehen durch; Broadcast-Fehler nach A284; Zugriffsverlust nach A281 über `Disconnect::users($ids)` (die Liste der Personen eines privat gestellten Projekts liest es über `Visibility` in einer Abfrage).
  - `LiveMessage` (`public ?string $socket`, `broadcastOn()` der eine Kanal, `broadcastAs()` `live`, `broadcastWith()` nach „Live“).
  - `NotificationsChanged::dispatchFor(list<string> $userIds, ?string $socket)` → je Person ein `LiveMessage` auf `presence-user.{id}` mit `type` `notifications.changed`, `->afterCommit()` über `DB::afterCommit`; aus `NotifyRecipients` (neue Inbox-Zeilen, kein Socket) und aus den drei Inbox-Actions (der eigene Socket ist ausgeschlossen, andere Tabs der Person laden neu).
  - `Disconnect::users(list<string> $ids): void` (nur mit Broadcaster `reverb`; Fehler wie A284).
  - `Tests\Support\RecordingBroadcaster` (`Broadcast::extend('recording')`; `sent()` → Liste von `{channels, event, payload, socket}`; `terminated()` → IDs).
- Consumes: Tasks 5, 6, 9.

- [ ] **Step 1: Failing Tests** — `LiveConsumerTest` (`consumers(LiveConsumer::class)`, `broadcasts()`): „sends a work item change to its project with ids only“ (Payload hat genau die sechs Schlüssel, kein Titel); „sends a comment and a reaction to the item's channel“; „sends a subscription to the person's channel“; „leaves out the tab that made the change“ (`socket`); „sends nothing for catalog, view and token events“; „keeps going when Reverb is down and reports once in ten minutes“; „sends an event once although its job arrives twice“ (Claim der Outbox; das Entdoppeln im Browser über `event_id` fängt den Rest, etwa nach einem Wiederverbinden). `NotificationsChangedTest`: „tells a person whose inbox grew“, „tells the other tabs of a person who marked read“, „tells nobody when nothing changed“, „tells only after the commit“ (Rollback → nichts). `DisconnectTest`: „disconnects a removed member“, „… everybody without membership when a project turns private“, „… an org admin who became a member“, „… a deactivated account“, „does nothing for the log broadcaster“.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Live|Notification|ArchTest'`; danach `ddev restart` (Reverb und Worker mit dem neuen Code).
- [ ] **Step 3: `CLAUDE.md`** — Architektur „Live: Konsument“ (Queue `live`, Tabelle der Kanäle, A279, A281, A284, `RecordingBroadcaster`), Fallstricke.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: announce events on the live channels and disconnect people who lost access`.

---

### Task 11: System-Seite über REST

**Modell:** opus

**Files:**
- Create: `app/Actions/System/{GetSystemStatus,RetryFailedJobs,SendTestMail}.php`, `app/Mail/TestMail.php`, `resources/views/mail/{test,test-text}.blade.php`, `app/Http/Controllers/Api/SystemController.php`, `app/Http/Resources/SystemStatusResource.php`, `tests/Feature/System/{GetSystemStatusTest,RetryFailedJobsTest,SendTestMailTest}.php`, `tests/Feature/Api/SystemApiTest.php`, `tests/Integration/SystemStatusTest.php` (Meilisearch)
- Modify: `app/Policies/OrganizationPolicy.php` (`viewSystem`, `problem.detail.system_admins_only`), `app/Events/EventType.php` (`SystemFailedJobsRetried` = `system.failed_jobs_retried`, `webhook()` falsch), `routes/api.php`, `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `lang/{en,de}.json` (`problem.reason.mail_not_configured`, `mail_failed`, `mail.test.*`), `resources/js/api/client.ts` (falls dort Reason-Codes stehen), `CLAUDE.md`

**Interfaces:**
- Produces:
  - `GetSystemStatus::handle($actor): array` (Recht `viewSystem`): `version` (`config('werkbuch.version')`), je Queue aus `config('werkbuch.queues')` die fälligen Jobs (`jobs.available_at <= now`, nicht reserviert) und den ältesten, `delayed_jobs` (später fällige: Sammelmails, A287), `failed_jobs` (neueste 50 aus `failed_jobs`: `uuid`, `queue`, `displayName` aus dem Payload, erste Zeile der Exception, höchstens 300 Zeichen, `failed_at`), `failed_jobs_total`, Meilisearch (`health()` und `getTasks` mit `statuses` `enqueued`/`processing` und `failed` der letzten 24 h, 2 s Timeout, jeder Fehler → `search: 'down'`, `search_tasks: null`; Vormerkung Phase 6), `mail_configured` (`MailSetup`), `live` (`off` ohne Reverb, sonst `GET /up` des Reverb-Servers mit 2 s Timeout → `ok`/`down`).
  - `RetryFailedJobs::handle($actor, array $input): int` (`ids` optional, UUIDs; unbekannte übergangen): je Job der Payload zurück in seine Queue (`Queue::connection($c)->pushRaw($payload, $queue)` mit neuem `attempts` 0 wie `queue:retry`), `failer->forget($uuid)`, in einer Transaktion mit Event `system.failed_jobs_retried` (`meta.count`, `meta.ids`, Subjekt die Organisation).
  - `SendTestMail::handle($actor): string` (Adresse): ohne Mailserver 409 `mail_not_configured`; synchron über `Mail::to($user)->locale(…)->send(new TestMail)`, SMTP-Fehler → `report()` und 503 `mail_failed` (`Problem::unavailable`); kein Event (nichts in der Datenbank).
  - REST nach „REST“ (drei Routen).
- Consumes: Task 2 (`werkbuch.queues`).

- [ ] **Step 1: Failing Tests** — `GetSystemStatusTest`: „shows version, backlog per queue and delayed jobs apart“; „lists the newest failed jobs with the first line of the error only“; „says search is down when Meilisearch does not answer“ (`searchEngine()->failWith`); „says live is off for the log broadcaster“; „refuses members and bots with 403“. `RetryFailedJobsTest`: „puts all failed jobs back and records one event“, „puts back only the named ones“. `SendTestMailTest`: „sends the test mail to the admin in their language“, „answers 409 without a mail server“, „answers 503 when the server refuses“. `Integration/SystemStatusTest`: „reads the tasks of Meilisearch“. Matrix: drei Zeilen (nur `org_admin` erlaubt, Retry mit Event); Routen-Matrix: drei Zeilen.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='System|RightsMatrixTest|RouteMatrixTest'`; `ddev artisan test --testsuite=Integration --filter=SystemStatusTest`.
- [ ] **Step 3: `CLAUDE.md`** — Architektur „System“ (A287), `reason`-Codes.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: add the system status with queue backlog, failed jobs, search, mail and live`.

---

### Task 12: Demo- und e2e-Daten: Maras Inbox, Inbox-Konten je Variante

**Modell:** opus

**Files:**
- Create: `database/seeders/Demo/NotificationsSeeder.php`, `tests/Feature/Seeders/NotificationsSeederTest.php`
- Modify: `database/seeders/DemoSeeder.php`, `database/seeders/E2eSeeder.php`, `tests/Feature/DemoSeederTest.php`, `tests/Feature/E2eSeederTest.php`, `e2e/helpers.ts` (`PEOPLE.inbox[variant]`), `CLAUDE.md` (Seeder, e2e-Helfer)

**Interfaces:**
- Produces:
  - `NotificationsSeeder`: die 14 Benachrichtigungen von Mara aus `prototypes/clickdummy/src/api/seed/inbox.ts` (Arten, Items per Key, Actor per Handle, `comment_id` über den Kommentar des `CommentsSeeder` (ID-Zuordnung wie dort), Zeiten als Berliner Wanduhr über `ItemsSeeder::at()`, `read_at` wie im Seed), `inbox = true`, `dedupe_key` `seed:<n_id>`; schreibt direkt ohne Events und ohne Sammlungen; legt nur fehlende an (Muster K13). `NotificationsSeederTest` liest `inbox.ts` und vergleicht Zahl, Arten, Keys, gelesen/ungelesen (3 ungelesen).
  - `E2eSeeder`: je Variante ein Konto `inbox-<variante>@example.com` (Person, Org-Member, Name `Inge Inbox <Variante>`, Sprache `en`, Zeitzone `Europe/Berlin`), jeder Lauf löscht dessen Benachrichtigungen, Sammlungen und Einstellungen (A289). `PEOPLE.inbox` in `e2e/helpers.ts`.
- Consumes: Task 4.

- [ ] **Step 1: Failing Tests** — `NotificationsSeederTest`: „seeds Mara's inbox like the clickdummy“, „adds nothing on a second run“. `E2eSeederTest`: „creates an inbox account per variant and empties its inbox on every run“.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Seeder'`; `ddev artisan db:seed --class=DemoSeeder` zweimal ohne Fehler.
- [ ] **Step 3: `CLAUDE.md`** — Seeder (`NotificationsSeeder`), e2e (`PEOPLE.inbox`, A289).
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: seed Mara's inbox and an inbox account per e2e variant`.

---

### Task 13: Frontend-Datenschicht: Benachrichtigungen, Einstellungen, System; Pakete

**Modell:** opus

**Files:**
- Create: `resources/js/api/{notifications,system}.ts` (+ Tests), `resources/js/hooks/{notifications,system}.ts` (+ Tests)
- Modify: `package.json`, `pnpm-lock.yaml` (`laravel-echo` 2.6.3, `pusher-js` 8.6.0, genau), `resources/js/types.ts` (`Notification`, `NotificationEvent`, `NotificationChannel`, `NotificationData`, `NotificationPreference`, `SystemStatus`, `FailedJob`), `resources/js/hooks/keys.ts` (`notifications`, `preferences`, `system`), `resources/js/api/http.ts` (`webPost` ohne `/api/v1` für `/broadcasting/auth`; Kopf `X-Socket-ID` aus einem Setter `setSocketId(id | null)`), `resources/js/api/http.test.ts`, `resources/js/test/fixtures.ts` (`makeNotification`, `maraInbox`, `makeSystemStatus`), `CLAUDE.md` (Tech Stack, Datenschicht)

**Interfaces:**
- Produces:
  - `api/notifications.ts` mit den Namen des Klickdummys: `listNotifications(args: ListNotificationsArgs)` (`GET /notifications`, `getPage`), `markRead(ids)`, `markUnread(ids)`, `markAllRead(options?: { mentions_only?: boolean })` (A291), `deleteNotification(id)`, `getPreferences()`, `savePreferences(preferences)` (Body `{preferences}`), `NOTIFICATION_EVENTS`; `api/system.ts`: `getSystemStatus()`, `retryFailedJobs(ids?)`, `sendTestMail()`.
  - `hooks/notifications.ts`: `useNotifications(args)`, `useUnreadCount()` (`unread_only: true, per_page: 1` → `total`), `useMarkRead()`, `useMarkUnread()`, `useMarkAllRead()`, `useDeleteNotification()`, `usePreferences()`, `useSavePreferences()`; `hooks/system.ts`: `useSystemStatus()`, `useRetryFailedJobs()`, `useSendTestMail()`.
  - `http.ts`: `webPost<T>(path, body)` (CSRF, 419-Wiederholung, JSON wie `post`), `setSocketId`; jeder API-Aufruf schickt `X-Socket-ID`, solange eine gesetzt ist.
- Consumes: Tasks 4, 6, 11.

- [ ] **Step 1: Failing Tests** — `notifications.test.ts`: je Funktion Pfad, Query, Body und Form der Antwort (`mockApi`); `system.test.ts`; `hooks/notifications.test.tsx`: „counts the unread from the total of one row“, „makes the notifications stale after a mark“; `http.test.ts`: „sends the socket id while one is set“, „posts to a web path with CSRF“.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm install` (nur der Container), `ddev exec pnpm test -- resources/js/api resources/js/hooks`.
- [ ] **Step 3: `CLAUDE.md`** — Tech Stack (Pakete), Frontend-Datenschicht (Benachrichtigungen, System, `webPost`, `X-Socket-ID`).
- [ ] **Step 4: Gates G2**
- [ ] **Step 5: Commit** — `feat: add the frontend data layer for notifications, preferences and the system page`.

---

### Task 14: Live im Browser: Echo, Cache-Abgleich ohne Doppelungen, Banner

**Modell:** opus

**Files:**
- Create: `resources/js/shell/LiveHost.tsx`, `e2e/tests/live.spec.ts`
- Modify: `resources/js/api/live.ts` (+ `live.test.ts`), `resources/js/hooks/live.ts` (+ Test), `resources/js/shell/{Shell.tsx,LiveIndicator.tsx,LiveIndicator.test.tsx}`, `resources/js/features/item-detail/shared.tsx` (`ItemDetailProvider` ruft `useLiveItem`), `resources/js/store/ui.ts` (nur falls `flash` erweitert wird), `lang/{en,de}.json`, `CLAUDE.md` (Frontend „Live“)

**Interfaces:**
- Produces:
  - `api/live.ts`: `connectLive(config: LiveConfig | null, me: string)` (einmal aus `LiveHost`; `null` → nichts, `isLiveConnected()` bleibt wahr, kein Banner, A285), `subscribeLive(callback)`, `isLiveConnected()`, `subscribeLiveStatus(callback)`, `watchProjects(ids: string[])` (Unterschied an- und abmelden), `watchItem(id): () => void` (Zähler je ID), `socketId()`; Echo mit `broadcaster: 'reverb'`, `wsHost`/`wsPort`/`wssPort`/`forceTLS` aus der Konfiguration, `enabledTransports: ['ws', 'wss']`, eigener `authorizer` über `webPost('/broadcasting/auth', …)`; `setSocketId` bei `connected`, `null` bei Unterbrechung; Status `connecting`/`connected`/`unavailable`; „getrennt“ für das Banner erst nach 3 s ohne `connected`; nach einer Unterbrechung meldet `connected` an alle `{ type: 'live.reconnected' }`; `subscription_error` (403 nach Zugriffsverlust) macht `qk.projects.all` ungültig.
  - `LiveEvent` `{event_id, type, project_id, item_id, comment_id, actor_id}` (Erweiterung des vorhandenen Typs).
  - `hooks/live.ts`: `useLiveConnected()`, `useLiveSync()` (nach „Live“, Browser; entdoppelt, sammelt 300 ms, `refetchType: 'none'` bei laufenden Mutationen), `useLiveItem(itemId)`.
  - `LiveHost` (in `Shell.tsx`): `connectLive(useSharedProps().features.live, auth.user.id)`, `useLiveSync()`, `watchProjects` aus `useProjects({ include_archived: true })`.
  - `LiveIndicator`: unverändert im Aussehen, liest den echten Status; Vormerkung: `vi.unstubAllGlobals()` in `afterEach` von `LiveIndicator.test.tsx`.
- Consumes: Tasks 2, 9, 10, 13.

- [ ] **Step 1: Failing Tests** — `live.test.ts` (Echo per `vi.mock('laravel-echo')` mit einem falschen Connector, der Ereignisse und Status auslöst): „connects with the settings of the page and authorizes over the web route“; „does nothing without live settings“; „says disconnected only after three seconds“; „announces reconnected after an interruption“; „joins and leaves project channels as the list changes“; „counts watchers of an item channel“; „sets and clears the socket id“. `hooks/live.test.tsx`: „makes items and activity stale once for a burst of events“; „drops an event it has seen“; „marks only stale while a mutation runs, and the mutation's own refetch wins“; „makes the inbox stale on notifications.changed“; „flashes the changed item“. `LiveIndicator.test.tsx` (mit `unstubAllGlobals`). `e2e/tests/live.spec.ts` (zwei Kontexte über `signedInContext`: Erik und `PEOPLE.inbox[variant]`, beide Mitglied eines eigenen Projekts): „shows a status change of the other person in the list without a reload“, „updates the comments of an open item live“, „does not apply the own change twice“ (eigene Prioritätsänderung, danach genau ein `PATCH` und keine zweite Anzeige im Verlauf), „shows the banner after Reverb went away and hides it when it is back“ (nur Projekt `desktop`: `page.route('**/app/**', route => route.abort())` vor dem Laden, dann `unroute` und Neuladen).
- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/api/live resources/js/hooks/live resources/js/shell`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test live shell`.
- [ ] **Step 3: `CLAUDE.md`** — Frontend „Live“ (Verbindung, Kanäle, Abgleich, Banner, A282, A285), Fallstricke (Playwright und Websocket: `page.route` auf `/app/**`).
- [ ] **Step 4: Gates G2, G3 gezielt** (`live shell`)
- [ ] **Step 5: Commit** — `feat: connect the browser to Reverb and refresh the cache from live events without doubling own changes`.

---

### Task 15: Überträge Frontend aus Phase 5 (jetzt über Live erreichbar)

**Modell:** opus

**Files:**
- Modify: `resources/js/features/create-item/{CreateForm.tsx,CreateItemDialog.tsx,draft.ts,create.test.tsx}`, `resources/js/hooks/workItems.ts` (+ `workItems.test.tsx`), `e2e/tests/create-item.spec.ts`, `CLAUDE.md` (Anlegen-Dialog, Frontend-Datenschicht)

**Interfaces:**
- Produces (Vormerkung Phase 8 aus der finalen Fix-Welle der Phase 5):
  - T11-M1: fällt bei offenem Anlegen-Dialog das letzte Projekt mit `item.create` weg, parkt der Dialog den Entwurf (`park`, Toast mit „Rückgängig“) statt `FormBody` mit dem getippten Titel auszuhängen; der Hinweis `items.create.none.*` steht darunter.
  - T11-M2: der Rückfall auf ein anderes Projekt oder den Standardtyp leert `errors` und `blocked` wie `changeProject`/`changeType`.
  - T11-M3: das Banner `items.create.draft_gone` verschwindet nach einem eigenen Wechsel von Projekt oder Typ und nach „Weitere anlegen“.
  - T9-N2: `useInfiniteWorkItems` hält den Zustand des K15-Neuaufbaus am Query-Key (Modul-Map je `hashKey`) statt an der Komponente; hängt eine Liste mitten im Neuaufbau aus und gleich wieder ein, setzt die neue Instanz die laufende Kette fort, statt dass die alte Schleife Cursor abräumt, die die neue braucht.
- Consumes: Task 14 (Live macht diese Fälle im Alltag erreichbar).

- [ ] **Step 1: Failing Tests** — `create.test.tsx`: „parks the draft when the last project goes away“, „clears errors and the blocked reason on the fallback“, „drops the draft_gone banner after an own change and after create another“. `workItems.test.tsx`: „continues a rebuild after the list unmounts and mounts again mid-way“. `create-item.spec.ts`: „keeps the typed title when the project is archived in another tab“ (zweiter Kontext archiviert das Projekt per API, Live macht die Liste ungültig).
- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/create-item resources/js/hooks/workItems`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test create-item`.
- [ ] **Step 3: `CLAUDE.md`** — Anlegen-Dialog (Parken beim Wegfall, Banner), Frontend-Datenschicht (Neuaufbau am Query-Key).
- [ ] **Step 4: Gates G2, G3 gezielt** (`create-item`)
- [ ] **Step 5: Commit** — `fix: keep the create draft when its project goes away and continue list rebuilds across remounts`.

---

### Task 16: Inbox I: Seite, Gruppen, Karten, Zustände

**Modell:** opus

**Files:**
- Create: `resources/js/pages/Inbox/Index.tsx`, `resources/js/features/inbox/{InboxScreen,NotificationCard,NotificationRow,notifications}.tsx|ts`, `resources/js/features/inbox/{inbox.test.tsx,notifications.test.ts}`, `tests/Feature/Pages/InboxPageTest.php` (oder ein Fall in `tests/Feature/ShellRoutesTest.php`), `e2e/tests/inbox.spec.ts`
- Modify: `routes/web.php` (`Route::inertia('/inbox', 'Inbox/Index')->name('inbox')`), `vitest.config.ts` (Schwelle `features/inbox/**`), `lang/{en,de}.json` (`inbox.*`), `CLAUDE.md`

**Interfaces:**
- Produces (Port von `features/inbox/**`, 13b: geteilt):
  - `notifications.ts`: `groupNotifications` (Port), `opensElsewhere` (Port), `timeAgo(iso, at, timeZone)` über `intlLocale()` und Schlüssel (`inbox.time.*`), `changedFields(fields, propertyLabel)` über `items.fields.row.*`/Property-Labels mit `Intl.ListFormat`.
  - `InboxScreen`: Kopf „Inbox“ mit Zahl der ungelesenen, Filter „Ungelesen“ und „Erwähnungen“ (`ToggleGroup`, in der Adresse `?unread=1&mentions=1` über `useSearchParam`), „Alle als gelesen“; je Gruppe eine `IndexCard` mit Typ-Reiter, Key, Titel (Link auf die Item-Seite), Projekt (`ProjectBadge`); darin die Zeilen neueste zuerst (`NotificationRow`: Punkt für ungelesen, Avatar und Name des Actors (Bot mit „Bot“, `null` → „werkbuch“ bei Erinnerungen), Satz der Art (`inbox.kind.<art>`, mit Status-Namen aus `data.from/to`, Feldern aus `changedFields`, Due-Date mit `formatDay`), Auszug, Zeit `timeAgo` mit `<time>`); Gruppen ohne Item (Vorlage, Webhook) mit Projekt bzw. Organisation; die neuesten 50 (P1); Skelett, leer (`inbox.empty.*` je Filter), Fehler mit „Erneut versuchen“ (ohne Daten; ein gescheitertes Nachladen behält die Liste).
  - 13c „Ladefehler eines Items“: fehlt `item` einer Benachrichtigung (Projekt in Löschung zwischen Zählen und Lesen), steht die Karte mit `inbox.item.unavailable` („Nicht mehr verfügbar“) statt „gibt es nicht mehr“; ein Fehler beim Nachladen des Details in der Vorschau sagt den Grund aus `ApiError` (404 „gibt es nicht mehr“, sonst „Nicht geladen“ mit „Erneut versuchen“).
  - 13c „Hinweistext bei gelesenen Einträgen“: der Hinweis unter einer gelesenen Zeile nennt „u: wieder ungelesen“, unter einer ungelesenen „e: als gelesen“ (Schlüssel `inbox.hint.*`), nur für die Zeile mit Cursor.
- Consumes: Tasks 12, 13, 14 (Live lädt die Liste).

- [ ] **Step 1: Failing Tests** — `InboxPageTest`: „renders the inbox page for people and redirects guests“. `notifications.test.ts`: Port der Fälle des Klickdummys (Gruppen, Zeit über Tagesgrenzen der Organisation, Felder). `inbox.test.tsx`: „groups Mara's inbox by item, newest first“; „filters unread and mentions from the address“; „names a reminder's due date and a state change by name“; „shows a card whose item is no longer available“; „shows the skeleton, the empty inbox per filter and the error with retry“; „keeps the list when a reload fails“; „shows a new notification after a live event“ (`subscribeLive` gemockt). `e2e/tests/inbox.spec.ts` (Konto `PEOPLE.inbox[variant]`; Benachrichtigungen entstehen, indem Erik per API in einem eigenen Projekt kommentiert, zuweist, erwähnt; Warten über `expect.poll` auf `GET /notifications`): „groups notifications by item and filters unread“.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/inbox`; `ddev artisan test --filter=InboxPageTest`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test inbox`.
- [ ] **Step 3: `CLAUDE.md`** — neuer Abschnitt „Inbox“ (Seite, Gruppen, Zustände).
- [ ] **Step 4: Gates G1, G2, G3 gezielt** (`inbox`)
- [ ] **Step 5: Commit** — `feat: add the inbox page with notifications grouped by item`.

---

### Task 17: Inbox II: Tastatur, Öffnen liest, Lesemarken, Löschen mit Rückgängig

**Modell:** opus

**Files:**
- Create: `resources/js/features/inbox/useReadMarks.ts` (+ Test)
- Modify: `resources/js/features/inbox/{InboxScreen,NotificationRow,NotificationCard,inbox.test.tsx}`, `resources/js/lib/shortcuts/catalog.ts`, `resources/js/lib/shortcuts/catalog.test.ts`, `docs/{en,de}/keyboard.md` (erzeugt), `e2e/tests/inbox.spec.ts`, `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - Katalog: `inbox.read` `e`, `inbox.unread` `u`, `inbox.read_all` `shift+e`, `inbox.delete` `#` (Bereich `list`, Gruppe `shortcuts.group.inbox`); `j`/`k`/↓/↑ über `useSelection` (`list.next`/`list.prev`), Enter (`list.open`) öffnet die Vorschau (`openPeek`), nicht die Seite (Klickdummy: „In der Inbox öffnet Enter die Vorschau“); `e` mit Fokus in der Vorschau bleibt `item.title` (`previewKeysAct`).
  - Öffnen liest (Spec-Änderung 2026-10-29): Enter, Klick (Vorschau), ⌘/Strg/⇧-Klick und Mittelklick (neuer Tab, `opensElsewhere`), der Titel der Karte (alle Zeilen der Karte); im Filter „Ungelesen“ verlässt die Zeile die Liste, Cursor und Fokus gehen weiter wie nach dem Löschen, die Vorschau bleibt.
  - `useReadMarks()` (13b: aus `InboxScreen` gelöst): `Mark { read, call, wasUnread }`; die Aufrufe gehen nacheinander (`inTurn`), der Server endet, wo die letzte Taste stand; `countUnread(total, marks, …)` zählt je Marke nur, wenn sie vom Gespeicherten abweicht, und vergisst eine Marke erst, wenn die Zählung des Servers nach ihr neu geladen ist (13c: „header count can briefly show one too few“); eine Ablehnung stellt den alten Stand her und meldet über `notifyError`.
  - `#` löscht mit 5 s Rückgängig (`runWithUndo`, ⌘Z), der Fokus geht auf die Nachbarzeile, sonst auf „Alle als gelesen“; ⇧E und „Alle als gelesen“ achten den Filter „Erwähnungen“ (A291) und sagen im Toast, wie viele.
  - 13c „Zeilenaktionen per Tab“: je Zeile ein Tab-Stopp (Roving-Fokus über `data-nav-target`), dahinter die Knöpfe „Als gelesen markieren“/„Als ungelesen markieren“ und „Löschen“ mit Namen „… :key“ (`inbox.row.*`), per Tab erreichbar; dazu Palette-Befehle für die Zeile mit Cursor (`inbox.read`, `inbox.unread`, `inbox.delete`, `inbox.read_all`).
- Consumes: Task 16.

- [ ] **Step 1: Failing Tests** — `useReadMarks.test.ts`: „keeps the count right between the mark and the reload“ (13c), „sends marks one after another and ends where the last key left it“, „restores the state when the server refuses“. `inbox.test.tsx`: „marks read with e and unread with u“, „marks all read with shift+e, only mentions in the mentions filter“, „deletes with # and brings it back with mod+z“, „opens the preview with Enter and reads it“, „reads on a click with mod and on a middle click“, „moves on when a read row leaves the unread filter“, „reaches the row actions with Tab“, „offers the row commands in the palette“. `catalog.test.ts` (neue Einträge, `shortcuts:doc`). `inbox.spec.ts`: „works the inbox with the keyboard only“ (j, e, u, #, mod+z, shift+e, Enter).
- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/inbox resources/js/lib/shortcuts`; `ddev exec pnpm shortcuts:doc`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test inbox`.
- [ ] **Step 3: `CLAUDE.md`** — „Inbox“ (Tasten, Öffnen liest, Lesemarken, A291), Tastatur (neue Katalog-Einträge).
- [ ] **Step 4: Gates G2, G3 gezielt** (`inbox`)
- [ ] **Step 5: Commit** — `feat: work the inbox with the keyboard, read on open and delete with undo`.

---

### Task 18: Badge live und persönliche Benachrichtigungseinstellungen

**Modell:** opus

**Files:**
- Create: `resources/js/shell/InboxBadge.tsx`, `resources/js/features/settings/personal/notifications/{Notifications.tsx,matrix.ts,notifications.test.tsx}`, `e2e/tests/notification-settings.spec.ts`
- Modify: `resources/js/shell/{Sidebar.tsx,MobileBar.tsx,Shell.test.tsx}`, `resources/js/features/settings/personal/PersonalSettings.tsx` (Abschnitt `notifications` zwischen `security` und `api`), `vitest.config.ts` (Schwelle `features/settings/personal/notifications/**`), `e2e/tests/shell.spec.ts`, `lang/{en,de}.json` (`settings.notifications.*`, `shell.nav.inbox_unread`), `CLAUDE.md`

**Interfaces:**
- Produces:
  - `InboxBadge({ look: 'full' | 'rail' | 'bar' })` (`useUnreadCount`): Zahl ab 1 (über 99 „99+“), `aria-label` der Inbox-Links wird `shell.nav.inbox_unread` („Inbox, :count ungelesen“); in Seitenleiste, eingeklappter Leiste und `MobileBar`; aktualisiert sich über `notifications.changed` (Task 14).
  - `Notifications` (Port, `/me/notifications`): Matrix Arten × Kanäle als Checkboxen in einer Tabelle (Spaltenköpfe „In-App“, „E-Mail“, Zeilen mit Name und Hinweis aus `EVENT_TEXT` als Schlüssel), „Standardwerte“, „Speichern“ (`useSaveShortcut`, ⌘↵), `LeaveGuard` mit eigenem `what`; ohne Mailserver (`features.mail` falsch) ist die Spalte „E-Mail“ gesperrt mit Grund `settings.notifications.no_mail`; Skelett, Fehler mit „Erneut versuchen“; `matrix.ts` (Port: `cellKey`, `toChoices`, `changedPreferences`, `defaultEnabled` aus denselben Standards wie `Preferences`).
- Consumes: Tasks 13, 14.

- [ ] **Step 1: Failing Tests** — `Shell.test.tsx`: „shows the unread count on the inbox in the sidebar, the rail and the mobile bar“, „hides the badge at zero and says 99+ above 99“. `notifications.test.tsx`: „shows the defaults of the spec“, „saves only the changes and keeps the rest“, „puts the defaults back“, „locks the mail column without a mail server and says why“, „guards unsaved changes“. `notification-settings.spec.ts` (Konto `PEOPLE.inbox[variant]`): „switches mail off for comments with the keyboard and keeps it after a reload“. `shell.spec.ts`: „counts a new notification up live“ (Erik kommentiert per API, das Badge der Inbox-Person zählt hoch ohne Neuladen).
- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/shell resources/js/features/settings/personal`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test notification-settings shell`.
- [ ] **Step 3: `CLAUDE.md`** — Persönliche Einstellungen (Benachrichtigungen), Shell (Badge).
- [ ] **Step 4: Gates G2, G3 gezielt** (`notification-settings shell`)
- [ ] **Step 5: Commit** — `feat: show the unread count live and add the notification settings`.

---

### Task 19: Einstellungen System

**Modell:** opus

**Files:**
- Create: `resources/js/features/settings/org/system/{System.tsx,system.test.tsx}`, `e2e/tests/system.spec.ts`
- Modify: `resources/js/features/settings/org/{sections.ts,OrgSettings.tsx}` (Gruppe `operations` „Betrieb“ mit `system`, `permission: 'org.manage'`, `members: 'blocked'`; Webhooks folgen in Phase 11), `vitest.config.ts` (Schwelle `features/settings/org/system/**`), `lang/{en,de}.json` (`settings.system.*`, `settings.org.group.operations`, `settings.org.section.system`), `CLAUDE.md`

**Interfaces:**
- Produces (Port von `features/settings/org/System.tsx`): Panel „Instanz“ (Version, Rückstand je Queue mit ältestem Job in der Zeitzone der Organisation, verzögerte Jobs getrennt, Meilisearch `ok`/`down` mit offenen und gescheiterten Aufgaben, Mail eingerichtet, Live `ok`/`down`/`off` mit Hinweis auf „Websockets Support“ im Proxy (Spec 14)); Panel „Fehlgeschlagene Jobs“ (Liste mit Queue, Job, erster Zeile des Fehlers, Zeit; „Alle erneut versuchen“, Toast mit der Zahl, danach neu geladen; leer `settings.system.no_failed`); Panel „Testmail“ (Knopf „Testmail an :email“; ohne Mailserver nicht angeboten, `settings.system.no_mail`; 503 `mail_failed` als Fehler-Toast mit „Erneut versuchen“); Members sehen „Nur für Admins“.
- Consumes: Tasks 11, 13.

- [ ] **Step 1: Failing Tests** — `system.test.tsx`: „shows version, backlog, search, mail and live“, „lists failed jobs and retries them all“, „sends a test mail and says to whom“, „offers no test mail without a mail server“, „says search is down and live is off“, „blocks members“, Skelett und Fehler. `system.spec.ts` (Erik, Org-Admin): „opens the system page with the keyboard and sends a test mail that arrives in Mailpit“ (über `mailpit.idsTo`).
- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/settings/org`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test system settings-organization`.
- [ ] **Step 3: `CLAUDE.md`** — Einstellungen der Organisation (Gruppe „Betrieb“, System).
- [ ] **Step 4: Gates G2, G3 gezielt** (`system settings-organization`)
- [ ] **Step 5: Commit** — `feat: add the system page to the organization settings`.

---

### Task 20: Abnahme: Erwähnung live in der fremden Inbox, Mail, Zugriff verloren, REST

**Modell:** opus

**Files:**
- Create: `e2e/tests/notifications-acceptance.spec.ts`, `tests/Feature/Api/NotificationsAcceptanceTest.php`
- Modify: `e2e/helpers.ts` (`waitForNotification(page, predicate, timeout = 20 s)` über `GET /api/v1/notifications`), `e2e/fixtures.ts` (`allowedErrors`: die erwartete 403 von `/broadcasting/auth` nach dem Entfernen), `CLAUDE.md` (e2e-Helfer)

**Interfaces:**
- Produces (je Test ein eigenes Projekt, `finally` räumt ab):
  - „Erfolgskriterium 2.4: a comment mentions a person, who sees it live in the inbox and gets a mail“ — zwei Kontexte: Erik (Kommentar per Tastatur, `m`, `@` + Name der Inbox-Person, Enter, ⌘↵) und `PEOPLE.inbox[variant]` (steht auf `/inbox`); ohne Neuladen erscheint die Karte mit „hat dich erwähnt“ und das Badge zählt hoch; danach `artisan('app:send-notification-mails', '--now')` und eine neue Mail in Mailpit an die Inbox-Person mit dem Key im Betreff und dem Link zum Item.
  - „opening the notification reads it, and the other tab of the same person follows“ — dritter Kontext derselben Person: das Badge sinkt dort ohne Neuladen.
  - „a removed member loses the live channel and the notifications“ — Erik entfernt die Inbox-Person aus dem (privaten) Projekt; ihr Kontext: die Karte verschwindet nach dem nächsten Laden, ein Statuswechsel danach kommt nicht mehr live an (`expect.poll` über eine Sekunde ohne Änderung, dann Neuladen zeigt sie nicht), ihr `subscription_error` ist erwartet.
  - `NotificationsAcceptanceTest` (REST, Erfolgskriterium 2.4 „in REST“): ein Token von Ida kommentiert per `POST …/comments` mit `@mara` in Markdown, `consumers(NotificationConsumer::class)`; Mara liest `GET /api/v1/notifications` mit der Erwähnung, `POST /notifications/read` markiert sie, `Mail::fake` zeigt nach `DispatchDueMails --now` keine Mail (gelesen), eine zweite ungelesene Erwähnung ergibt genau eine Mail.
- Consumes: alles Vorige.

- [ ] **Step 1: Tests schreiben, laufen lassen** — `ddev artisan test --filter=NotificationsAcceptanceTest`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test notifications-acceptance` (alle vier Projekte).
- [ ] **Step 2: `CLAUDE.md`** — e2e-Helfer `waitForNotification`, Fallstricke (Live in e2e: Reverb muss laufen, in der CI Port 8080).
- [ ] **Step 3: Gates G1, G3 gezielt** (`notifications-acceptance inbox live shell`)
- [ ] **Step 4: Commit** — `test: accept mentions live in another person's inbox, the mail and lost access end to end`.

---

### Task 21: Doku, `CLAUDE.md`, Rulings, Spec

**Modell:** opus

**Files:**
- Create: `docs/en/concepts/notifications.md`, `docs/de/concepts/notifications.md`
- Modify: `docs/.vitepress/config.ts` (Konzepte „Notifications“/„Benachrichtigungen“), `docs/{en,de}/development.md` (Reverb in DDEV und CI, Mailpit, Queues mit `live`, `app:send-notification-mails`, Scheduler-Liste), `docs/{en,de}/concepts/work-items.md` (Beobachten → Verweis auf Benachrichtigungen), `CLAUDE.md`, `README.md` (Status), `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md`, `docs/superpowers/specs/2026-10-28-werkbuch-design.md`, `docs/superpowers/plans/2026-10-30-werkbuch-app.md`

**Interfaces:**
- Produces:
  - `concepts/notifications` (en + de, gleiche Überschriften, `DocsTest`): wer benachrichtigt wird (Tabelle der Arten, Lead, Abmeldung, nie der Auslöser), Kanäle und Standards, Inbox (Filter, Tasten, Öffnen liest, Rückgängig), Mail (Sammeln, Verzögerung, Sprache, Prüfung beim Senden, ohne Mailserver), Erinnerungen (08:00 der Person, fällig/überfällig, eine Mail je Tag), Aufräumen (90 Tage), Live (was live erscheint, Banner, Proxy mit Websockets, Trennen bei Zugriffsverlust), REST mit `curl` (Liste, gelesen, Einstellungen), System-Seite.
  - `CLAUDE.md`: „Stand“ (Phase 8 umgesetzt, als Nächstes Phase 9), Tech Stack, Kommandos, Architektur (Benachrichtigungen, Live, System, Inbox), Fallstricke. Die Tasks haben ihre Teile eingetragen; hier ordnen und prüfen.
  - Rulings `A267`–`A291` (Liste „Vorschläge für neue Rulings“ unten, je mit Grund und „Falls falsch“, Anpassungen aus der Umsetzung eingearbeitet); „Für spätere Phasen vorgemerkt“: Zeile Phase 8 entfernen (erledigt); neu: Phase 10 (`template_run_failed` über `NotifyRecipients` mit Lead und Ersteller der Vorlage, A290), Phase 11 (`webhook_disabled` an Org-Admins; Webhooks geben `meta.socket` nie aus), Phase 13 (MCP-Tools für die Inbox über `ListNotifications`/`MarkNotificationsRead`), Phase 14 (Worker auf `live` und `notifications`, nginx leitet `/app` und `/apps` an Reverb, Reverb-Schlüssel im Entrypoint, `REVERB_*` für den Browser aus `APP_URL`; Scheduler läuft für Kehrer, Erinnerungen, Aufräumen), Phase 15 (Last: viele Beobachter je Item, Bulk mit 100 Items und je Person 100 Benachrichtigungen zusammenfassen; Erinnerungen nachholen, wenn der Scheduler um 08:00 stand).
  - Spec „Änderungen vom <Tag der Umsetzung> (Phase 8)“ zur Bestätigung: ein Eintrag je Person und Ereignis (A267); `assigned` nur für die neue zuständige Person (A268); der Lead und die Abmeldung (A269); keine Benachrichtigung für Archivieren, Wiederherstellen, Löschen (A270); Erinnerungen in der Zeitzone der Person mit einer Mail je Tag (A275); Aufräumen stündlich (A276); Inbox-Aktionen ohne Events (A277); Trennen bei Zugriffsverlust (A281); „Alle als gelesen“ achtet den Filter (A291).
  - Master-Plan: Phase 8 im „Fortschritt“ erst nach dem Merge (Orchestrator); „Queues“ um `live` ergänzen (A278).

- [ ] **Step 1: Seiten und Tests** — `ddev artisan test --filter=DocsTest`; `ddev exec pnpm --dir docs build` → ohne tote Links.
- [ ] **Step 2: Abnahme der Phase** (ohne den vollen G3: der läuft danach im Hintergrund parallel zum Final-Review)

```bash
ddev artisan migrate:fresh --seed --seeder=DemoSeeder
ddev artisan app:search-sync && ddev artisan app:search-import
ddev restart
ddev artisan test --coverage --min=100
ddev artisan test --testsuite=Integration
ddev exec vendor/bin/phpstan analyse --memory-limit=1G && ddev exec vendor/bin/pint --test
ddev exec pnpm typecheck && ddev exec pnpm test:coverage
ddev exec pnpm build
E2E_COVERAGE=0 pnpm --dir e2e exec playwright test notifications-acceptance inbox live notification-settings system shell create-item
ddev exec pnpm --dir docs build
```

Expected: alles grün. Von Hand (Master-Abnahme, Erfolgskriterium 2.4 in UI und REST): zwei Fenster, Mara und Ida; Ida erwähnt Mara in einem Kommentar zu WEB-47; Maras Inbox zeigt es sofort, das Badge zählt hoch; nach 5 Minuten (oder `ddev artisan app:send-notification-mails --now`) liegt in `ddev mailpit` eine Mail auf Deutsch mit Link zu WEB-47 und zu den Einstellungen; `curl -H "Authorization: Bearer <Token von Mara>" https://werkbuch.ddev.site/api/v1/notifications?unread_only=1` nennt die Erwähnung; Ida aus OPS entfernen, danach erscheint nichts aus OPS mehr in ihrer Inbox; `/settings/system` zeigt Version, Queues, Meilisearch, Mail und Live.

- [ ] **Step 3: Commit** — `docs: add the notifications page, update CLAUDE.md, the rulings and the spec for phase 8`.

**Danach (Orchestrator):** Final-Review (opus, ganze Phase) und **parallel im Hintergrund der volle G3** (`ddev exec pnpm build:coverage && pnpm --dir e2e test && ddev exec pnpm build`); beide Ergebnisse gehen in die eine finale Fix-Welle.

---

## Vorschläge für neue Rulings (ab A267)

- **A267 · Ein Eintrag je Person und Event, die stärkste Art.** Treffen mehrere Arten auf eine Person zu (erwähnt und beobachtend), entsteht eine Benachrichtigung der stärksten Art (`mentioned` > `assigned` > `comment` > `state_changed` > `item_changed` > `due` > `item_created`), deren Inbox oder Mail an ist; ist für die stärkste beides aus, gilt die nächste. *Grund:* Spec 4.14 zählt Ereignisse auf, eine Erwähnung im Kommentar soll nicht zweimal in der Inbox stehen; der Klickdummy zog Erwähnte aus den Kommentar-Empfängern ab. *Falls falsch:* eine Zeile je Art (doppelte Einträge für dieselbe Änderung).
- **A268 · `assigned` geht nur an die neue zuständige Person;** andere Beobachter und der Lead bekommen `item_changed` mit dem Feld „Assignee“. *Grund:* Mail ist für `assigned` standardmäßig an; wer ein Item beobachtet, soll nicht bei jeder fremden Zuweisung eine Mail bekommen. Der Klickdummy meldete allen `assigned`. *Falls falsch:* `assigned` an alle Beobachter (mehr Mails).
- **A269 · Der Lead zählt als Beobachter jedes Items seines Projekts, außer er hat das Item abbestellt.** `item_created` bekommt nur der Lead. *Grund:* Spec 4.14 („der Project Lead bei jedem Ereignis des Projekts“) und 4.10 (Abmeldung); eine bewusste Abmeldung soll auch für den Lead gelten. *Falls falsch:* der Lead bekommt alles, auch abbestellte Items.
- **A270 · Keine Benachrichtigung für Archivieren, Wiederherstellen, Löschen, Beobachten, Reaktionen, gelöschte Kommentare und eine Änderung nur des Rangs;** ein bearbeiteter Kommentar meldet nur neu Erwähnte. *Grund:* Spec 4.14 zählt diese Ereignisse nicht auf; ein gelöschtes Item hätte kein Ziel, Rang und Reaktionen sind Rauschen. *Falls falsch:* `item_changed` für Archivieren und Wiederherstellen.
- **A271 · Nur Mail, keine Inbox:** eine Benachrichtigung, deren Inbox aus und deren Mail an ist, ist eine Zeile mit `inbox = false`; Inbox und Badge zeigen sie nie, das Aufräumen nimmt sie nach dem Versand mit. *Grund:* die Mail braucht etwas zum Sammeln und Prüfen; ein zweites Modell nur für Mails verdoppelt die Regeln. *Falls falsch:* Mail nur für Ereignisse mit Inbox (Spec: „einstellbar pro Person und Ereignis“ wäre eingeschränkt).
- **A272 · Auszüge entstehen beim Lesen und Senden aus dem aktuellen Text, gespeichert wird nur `comment_id`.** Ein gelöschter Kommentar hat keinen Auszug mehr, Verweise werden je Leser aufgelöst. *Grund:* A228 (ein gelöschtes Geheimnis bliebe sonst 90 Tage in Inboxen und in späteren Mails), Review Focus „Verweis als Orakel“. *Falls falsch:* `data.excerpt` als Klartext beim Anlegen (schneller, aber mit Text gelöschter Kommentare).
- **A273 · Sammelmail je Person und Item:** die erste Benachrichtigung eröffnet eine Sammlung, fällig nach `NOTIFICATION_MAIL_DELAY` Minuten; der Job sperrt die Sammlung, prüft beim Senden Zugriff, Aktivität, Lesestand und Einstellung (gelesen heißt: keine Mail dafür) und sendet höchstens einmal; ein Absturz zwischen SMTP und Commit kann eine Mail doppelt senden (mindestens einmal). *Grund:* Spec 4.14, A39, Review Focus 1 und 3. *Falls falsch:* höchstens einmal (Stempel vor dem Senden; eine gescheiterte Mail ginge verloren).
- **A274 · Ohne Mailserver entstehen keine Sammlungen, auch nicht nachträglich.** *Grund:* Spec 4.14 („ohne konfigurierten Mailserver bleibt es bei der Inbox“); wer später einen einrichtet, bekäme sonst einen Schwall alter Mails. *Falls falsch:* Sammlungen immer anlegen und ohne Mailserver als `skipped` schließen.
- **A275 · Erinnerungen in der Zeitzone der Person, eine Mail je Tag.** Der Job läuft stündlich und erinnert jede Person in der Stunde, in der es bei ihr 08:xx ist (Konto, sonst Organisation); fällig heißt Due-Date heute, überfällig davor, nach dem Kalender der Person (abweichend von A126, wo Listen den Kalender der Organisation nutzen); täglich, solange das Item offen ist; nicht für archivierte Items und Items archivierter Projekte; die Mail fasst alle Erinnerungen des Tages zusammen. *Grund:* Spec 4.14 („täglich um 08:00 in der Zeitzone der Person“); zehn überfällige Items wären sonst zehn Mails jeden Morgen. *Falls falsch:* eine Mail je Item wie bei anderen Ereignissen, bzw. Kalender der Organisation.
- **A276 · Aufräumen stündlich statt um 03:00 Org-Zeit:** gelesene Benachrichtigungen nach 90 Tagen, gesendete Sammlungen nach 90 Tagen, Nur-Mail-Zeilen nach dem Versand. *Grund:* wie A239, keine Zeitzone im Scheduler nötig (die Organisationszeile beim Booten des Schedulers zu lesen scheitert vor der ersten Migration). *Falls falsch:* `dailyAt('03:00')` mit der Zone der Organisation.
- **A277 · Inbox-Aktionen und Benachrichtigungseinstellungen schreiben keine Events;** sie melden die eigenen anderen Tabs direkt über `notifications.changed` nach dem Commit. *Grund:* der Lesestand ist persönlich und keine History; jedes Öffnen einer Benachrichtigung wäre sonst ein Event mit drei Konsumenten-Jobs. *Falls falsch:* Events `notification.read|unread|deleted` ohne Webhook, die der Live-Konsument meldet.
- **A278 · Neue Queue `live`,** Worker-Reihenfolge `default,live,notifications,webhooks,search,media,bulk` (Erweiterung des Vertrags „Queues“). *Grund:* ein Live-Update hinter Mails und Suchindex käme zu spät; Broadcasts sind kurz. *Falls falsch:* Live in `default` (dann warten Live-Updates hinter `DispatchEvent` und Aufräumjobs).
- **A279 · Live-Nachrichten tragen nur IDs und den Typ,** nie Titel, Text oder Werte; der Browser lädt über die API nach. *Grund:* Anti-Ziel Datenlecks, Review Focus 3: ein Kanal, den jemand trotz Zugriffsverlust noch hört, verrät so nur, dass sich etwas änderte; die API prüft das Leserecht. *Falls falsch:* Resources in der Nachricht (schneller, aber jede Kanal-Lücke ist ein Datenleck).
- **A280 · Kanäle:** `project.{id}` für Items und Projekte, `work-item.{id}` für Kommentare und Reaktionen, `user.{id}` als Presence-Kanal für Benachrichtigungen und das eigene Beobachten; der Browser abonniert jedes sichtbare Projekt. Katalog-, Konten-, View- und Favoriten-Events haben in v1 kein Live-Update. *Grund:* Spec 7.2; Presence, weil Reverb Verbindungen nur über Presence-Daten trennen kann (A281); ein Kanal je sichtbarem Projekt hält die Prüfung bei den Policies. *Falls falsch:* privater `user.{id}` und Trennen über eine eigene Mitteilung, oder ein Organisationskanal für Kataloge.
- **A281 · Zugriff verloren heißt getrennt:** auf `project.member_removed`, ein privat gestelltes Projekt, `user.role_changed` von Admin zu Member und `user.deactivated` trennt der Live-Konsument die Verbindungen der Betroffenen über Reverbs „terminate user connections“; Echo verbindet neu und autorisiert jeden Kanal neu, ein verlorener antwortet 403. *Grund:* Master Review Focus 3 („Live-Kanal wird neu autorisiert“); Pusher-Kanäle prüfen sonst nur beim Abonnieren. *Falls falsch:* nur eine Mitteilung an den Browser, sich neu anzumelden (ein manipulierter Client hörte weiter, mit A279 ohne Inhalt).
- **A282 · Eigene Änderungen nicht doppelt:** der Browser schickt `X-Socket-ID`, `Actor` und `meta.socket` tragen sie, Reverb schließt diesen Tab aus; andere Tabs derselben Person bekommen das Event. Der Browser entdoppelt über `event_id`, sammelt 300 ms und markiert während einer eigenen Mutation nur als veraltet. *Grund:* Spec 7.2 („eigene Änderungen werden nicht doppelt angewendet“); die optimistische Änderung lädt nach ihrem Ende ohnehin. *Falls falsch:* Events des eigenen Kontos ganz übergehen (andere Tabs blieben alt).
- **A283 · Live nur für die Sitzung der Oberfläche:** `/broadcasting/auth` ist eine Web-Route mit `auth`, Tokens abonnieren keine Kanäle. *Grund:* REST- und MCP-Clients bekommen Änderungen über Webhooks (Phase 11); Bearer-Tokens auf einer Websocket-Autorisierung bräuchten eigene Fähigkeiten. *Falls falsch:* `/api/v1/broadcasting/auth` mit `read`.
- **A284 · Live-Fehler wiederholen nicht:** ist Reverb nicht erreichbar, meldet der Konsument das höchstens einmal je 10 Minuten und endet ohne Exception (kein Retry, kein `failed_jobs`); der Browser lädt beim Wiederverbinden neu. *Grund:* ein verspätetes Live-Update ist wertlos, und ein Ausfall von Reverb füllte sonst `failed_jobs` mit jedem Event. *Falls falsch:* Wiederholungen mit kurzer Pause (mehr Jobs, späte Updates).
- **A285 · Live-Einstellungen zur Laufzeit über `features.live`,** keine `VITE_REVERB_*`-Variablen; ohne Reverb (`null`) verbindet der Browser nicht und zeigt kein Banner; das Banner erscheint erst nach 3 s ohne Verbindung. *Grund:* das Docker-Image wird einmal gebaut und läuft unter beliebigen Adressen (Spec 8.1); Laden der Seite soll kein Banner aufblitzen lassen. *Falls falsch:* Vite-Variablen (Image je Adresse).
- **A286 · Benachrichtigungen gehen mit ihrem Item und ihrem Projekt** (Kaskade); sichtbar sind sie nur, solange die Person das Projekt sieht (zur Lesezeit). *Grund:* eine Benachrichtigung ohne Item hätte kein Ziel; das Leserecht entscheidet beim Lesen (Review Focus 3, 13c). *Falls falsch:* Zeilen behalten mit „gelöscht“.
- **A287 · System-Seite nur für Org-Admins** (403 mit Grund, nicht 404: die Seite gibt es für jeden); Testmail synchron (409 `mail_not_configured`, 503 `mail_failed`); „erneut versuchen“ schreibt `system.failed_jobs_retried`; verzögerte Jobs (Sammelmails) zählen nicht als Rückstand. *Grund:* Spec 5.2; der Admin soll den Fehler des Mailservers sofort sehen; ein Rückstand aus geplanten Mails ist kein Problem. *Falls falsch:* Testmail über die Queue (der Fehler stünde nur im Log).
- **A288 · `app:send-notification-mails --now` schickt alle offenen Sammlungen sofort.** *Grund:* Betrieb (vor einer Wartung) und e2e, das nicht 5 Minuten warten kann und `NOTIFICATION_MAIL_DELAY` der DDEV-`.env` nicht ändern soll. *Falls falsch:* ein eigener Test-Weg (Verzögerung in Sekunden über die Env der CI).
- **A289 · e2e-Konten `inbox-<variante>@example.com`** für Inbox- und Live-Specs. *Grund:* die vier Varianten teilen Erik und Mara; „Alle als gelesen“ in einer Variante leerte die Inbox der anderen. *Falls falsch:* Inbox-Specs nur in einer Variante.
- **A290 · Die Einstellungen kennen alle neun Arten;** `template_run_failed` und `webhook_disabled` entstehen erst mit Phase 10 bzw. 11. Bots haben keine Einstellungen (403) und eine leere Inbox. *Grund:* die Matrix ist der Vertrag mit Klickdummy und API; Bots bekommen nie Benachrichtigungen (Spec 4.14). *Falls falsch:* die zwei Zeilen erst mit ihren Phasen zeigen.
- **A291 · „Alle als gelesen“ achtet den Filter „Erwähnungen“** (`POST /notifications/read` mit `all: true, mentions_only: true`); Abweichung vom Klickdummy, wo `markAllRead()` keine Argumente nimmt. *Grund:* 13c („‚Alle als gelesen‘ in filter hits hidden entries“): wer Erwähnungen filtert, meint die sichtbaren. *Falls falsch:* immer alle, mit Hinweis im Toast.

## Entscheidungen dieses Phasenplans (ohne eigenes Ruling)

- **P1** Die Inbox zeigt die neuesten 50 ohne Blättern (wie der Klickdummy); ältere rücken nach, wenn neuere gelöscht werden. Die REST-Liste blättert per Cursor.
- **P2** `created_at` einer Benachrichtigung ist `occurred_at` ihres Events (die Reihenfolge der Inbox folgt den Ereignissen, nicht der Queue).
- **P3** Eine Bulk-Änderung von 100 Items ergibt je Beobachter bis zu 100 Einträge; die Inbox gruppiert sie nach Item, die Mails sammeln je Item (Phase 15 prüft die Last).
- **P4** Das Anlegen in einem anderen Status (Phase 4, P32) ergibt für den Lead `item_created` und `state_changed`; kein Sonderfall.
- **P5** Erinnerungen haben `actor_id` `null`; die Zeile nennt „werkbuch“ als Absender.
- **P6** Die Mail nutzt eigene Blade-Ansichten statt Laravels Markdown-Mail, weil das HTML aus `toMailHtml` nicht durch einen zweiten Markdown-Lauf gehen darf.
- **P7** `X-Socket-ID` gilt nur für die Sitzung; ein Token-Request trägt nie einen Socket.
- **P8** Der Browser abonniert `project.{id}` auch für archivierte Projekte (sie bleiben lesbar und können wiederhergestellt werden).
- **P9** Die System-Seite liest `failed_jobs` direkt (Tabelle des Frameworks) über eine lesende Action; Retry nutzt den Failer des Frameworks.
- **P10** Kein Snooze (Spec 4.14), kein Zusammenfassen von Benachrichtigungen derselben Person in der Inbox (die Gruppe je Item reicht).

## Nicht in Phase 8 (vorgemerkt in Task 21)

- Phase 10: `template_run_failed` erzeugen (Lead und Ersteller der Vorlage, A290).
- Phase 11: `webhook_disabled` an Org-Admins; Webhooks geben `meta.socket` nie aus.
- Phase 13: MCP-Tools für die Inbox (lesen, gelesen markieren).
- Phase 14: Worker auf `live` und `notifications`, Scheduler-Container, nginx leitet `/app` und `/apps` an Reverb, Reverb-Schlüssel im Entrypoint.
- Phase 15: Last mit vielen Beobachtern und Bulk-Änderungen; Erinnerungen nachholen, wenn der Scheduler um 08:00 stand.
