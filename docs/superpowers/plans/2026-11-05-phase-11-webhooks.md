# Phase 11: Webhooks – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Org-Admins richten Webhooks ein (Spec 6.3): Name, URL, Geheimnis (einmal angezeigt, erneuerbar), Geltungsbereich Organisation oder ein Projekt, Ereignisse mit `gruppe.*`, optional nur für einen Bot, aktiv ja/nein. Jedes Ereignis des Katalogs (`EventType::webhook()`) geht nach dem Commit über einen eigenen Konsumenten an alle passenden Webhooks: Payload `{id, event, occurred_at, actor, project, data, changes}` mit `data` aus den Resources, signiert mit `X-Werkbuch-Signature: sha256=<HMAC über "timestamp.body">`, über spatie/laravel-webhook-server mit 10 s Timeout, ohne Weiterleitungen, 8 Versuchen über 24 Stunden, Protokoll je Versuch (Antwort 2 KB, 30 Tage), „erneut senden“, Test-Ping, SSRF-Schutz nach der DNS-Auflösung und Abschalten nach 24 Stunden ohne Erfolg mit Benachrichtigung `webhook_disabled` an die Org-Admins. Dazu `bot.assigned` (neu) und die Zustellung von `bot.mentioned`, die REST-Endpunkte, der Port des Abschnitts „Webhooks“ der Org-Einstellungen mit Zustellprotokoll und die Doku mit Signaturprüfung in Node, PHP und Python. Abnahme: Erfolgskriterium 2.5 („Ein Webhook kommt signiert beim Empfänger an“).

**Architecture:** Reine Regeln ohne Laravel in `app/Domain/Webhooks/` (Ereignismuster, gesperrte Adressen, Signatur, Wiederholplan, Abschaltregel). Drei Tabellen: `webhooks`, `webhook_deliveries` (eine Zeile je Ereignis × Webhook bzw. Ping, eindeutig `(event_id, webhook_id)`, Payload als Schnappschuss, ULID = `X-Werkbuch-Delivery`) und `webhook_attempts` (Protokoll je Versuch). Der Konsument `App\Webhooks\WebhookConsumer` (Queue `webhooks`) gibt jedes Event an `App\Actions\Webhooks\QueueDeliveries`: passende Webhooks lesen, Payload über `App\Webhooks\WebhookPayload` bauen (Leser: der Bot des Filters, sonst der Standard-Bot), Zustellungen per `insertOrIgnore` anlegen und je Zustellung `App\Jobs\DeliverWebhook` (Unterklasse von spatie `CallWebhookJob`) `afterCommit` einstellen. Jeder Versuch liest Webhook und Geheimnis frisch (`PrepareWebhookAttempt`), prüft das Ziel nach der DNS-Auflösung (`App\Webhooks\SafeTarget`), schickt an die geprüfte IP (`CURLOPT_RESOLVE`), signiert mit frischem Zeitstempel und protokolliert über die spatie-Events (`RecordWebhookAttempt`); ein Fehlschlag 24 Stunden nach dem ersten ohne Erfolg schaltet den Webhook ab (`DisableWebhook`, Event `webhook.disabled`, Benachrichtigung über `NotifyRecipients`). Ping und „erneut senden“ laufen als ein synchroner Versuch derselben Jobklasse. Im Browser portiert `features/settings/org/webhooks/` den Klickdummy.

**Tech Stack:** wie Phase 10; neu `spatie/laravel-webhook-server` 4.0 (siehe „Paketversionen“).

**Spec:** `docs/superpowers/specs/2026-10-28-werkbuch-design.md` (1 Erfolgskriterium 2.5; 2 Anti-Ziele „Webhooks gehen verloren“, „Datenlecks über Projektgrenzen … Webhooks“; 3 „Webhooks“; 4.2 Bots `bot.mentioned`/`bot.assigned`; 4.3 „Organisation, Personen, Bots, Webhooks verwalten“ nur Org-Admins; 4.14 „abgeschalteter Webhook (nur Org-Admins)“; 5.2 Org-Einstellungen „Webhooks“; 6.1 „Webhooks mit Zustellungen, ‚erneut senden‘ und Test-Ping“; 6.2 Agent-Szenario; **6.3 komplett**; 7.2 Queue `webhooks`, Aufräumen; 7.4 `webhooks`, `webhook_deliveries`; 7.5 „Tests auf Datenlecks … Webhooks“, „Webhook-Geheimnisse verschlüsselt“, SSRF; 8.2 `WEBHOOKS_ALLOW_PRIVATE`; 9 „Webhooks gegen einen lokalen Empfänger“; 10 Doku „Webhooks mit Ereignissen, Payload und Beispielcode zur Signaturprüfung“; 13 Webhook-Werte; „Änderungen vom 2026-10-31“ zu Webhooks (`project.restored` eigenes Ereignis, Events ohne Webhook), „Änderungen vom 2026-11-03“ (`bot.mentioned`), „Änderungen vom 2026-11-04“ (Seiten ohne `bot.mentioned`)), Master-Plan `docs/superpowers/plans/2026-10-30-werkbuch-app.md` (Global Constraints, Review Focus 1 und 3, Verträge „Events und Outbox“, „Resources“, „Queues“, „Konfiguration“, Phase 11), Rulings `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md` (A26, A27, A39, A62, A75, A106, A131, A227, A228, A243, A256, A259, A267–A272, A278, A282, A283, A286, A287, A290, A301, A306, A310, A313, A342, A346, A350; „Für spätere Phasen vorgemerkt“, Zeile Phase 11 → Tasks 2, 5, 6, 8, 9, 10, 11), Klickdummy `prototypes/clickdummy/{README.md,DESIGN.md}` und `src/{api/webhooks.ts,api/seed/inbox.ts (webhooks, webhookDeliveries, n_10, system),hooks/webhooks.ts,types.ts (Webhook, WebhookDelivery, WebhookSaved),features/settings/org/{Webhooks.tsx,WebhookDeliveries.tsx,webhookParts.tsx,EventTree.tsx,events.ts,SecretDialog.tsx,catalog.ts (EVENT_GROUPS, eventLabel),webhooks.test.tsx},features/inbox/NotificationRow.tsx (webhook_disabled)}`, Aufräumliste `docs/superpowers/plans/2026-10-28-werkbuch-clickdummy-deferred.md` (Task 11: „secret kept in SecretDialog ref/mutation observers“, „Escape/outside click closes one-time secret dialog“, „renew drops form edits (Webhooks.tsx:101)“, „truncated divider lines (WebhookDeliveries.tsx:135)“ → Tasks 13–15).

---

## Global Constraints

Es gelten alle Global Constraints des Master-Plans und alle Regeln aus `CLAUDE.md`. Für Phase 11 entscheidend:

- Branch `feat/phase-11-webhooks` von `main` nach dem Merge von Phase 10. Vor dem ersten Commit `git config user.email` → muss `rafael@hauss.dev` sein, sonst stoppen und nachfragen; nie `user.email`/`user.name` setzen, nie `rafael@lulububu.de`. Commits englisch, Conventional Commits, letzte Zeile `Co-Authored-By: <tatsächliches Modell> <noreply@anthropic.com>` (die Commit-Schritte nennen nur den Betreff).
- PHP, Composer, Artisan und pnpm der App nur in DDEV; `e2e/` auf dem Mac. Nur pnpm, nie npm oder npx. Einziges neues Paket: `spatie/laravel-webhook-server` (Task 2); `pnpm-lock.yaml` und `e2e/pnpm-lock.yaml` bleiben unverändert.
- **Nicht idempotente Wirkung (A39):** HTTP geht nie aus `consume()` und nie aus einer Transaktion. Der Konsument schreibt in der Claim-Transaktion nur Zeilen (`webhook_deliveries` per `insertOrIgnore` über `(event_id, webhook_id)`) und stellt den Job mit `->afterCommit()` ein; ein Event, das zweimal ankommt (Nachverteiler, `queue:retry`), stellt nichts doppelt ein (Review Focus 1 des Master-Plans). Ping und „erneut senden“ senden außerhalb jeder Transaktion.
- **Geheimnisse (Spec 7.5):** das Geheimnis eines Webhooks steht verschlüsselt in der Datenbank (`encrypted`-Cast mit `APP_KEY`), im Klartext nur in den Antworten von `POST /webhooks` und `POST /webhooks/{id}/rotate-secret`; nie in Events (`changes`, `meta`), Resources, Job-Payloads (`jobs`, `failed_jobs`), Protokollzeilen, Logs oder Fehlertexten. Ein Versuch liest es frisch aus der Zeile. Tests suchen den Klartext in `events`, `jobs`, `webhook_attempts` und im Log.
- **SSRF (Spec 6.3):** vor jedem Versuch (auch Ping und „erneut senden“) löst `SafeTarget` den Host auf, prüft **jede** A- und AAAA-Adresse gegen `App\Domain\Webhooks\Addresses` und schickt an die geprüfte IP (`CURLOPT_RESOLVE`, Host-Header und SNI bleiben); Weiterleitungen werden nie verfolgt (`allow_redirects: false`, ein 3xx ist ein Fehlschlag). `config('werkbuch.webhooks_allow_private')` hebt nur die Sperre privater Netze auf, nie die Pflicht zur Auflösung.
- **Keine Datenlecks (Spec 2, 7.5):** ein Projekt-Webhook bekommt nur Ereignisse seines Projekts; ein Webhook mit Bot bekommt nur, was der Bot sieht (Prüfung beim Konsum und vor jedem Versuch); `data` rechnet für einen Leser (Bot, sonst Standard-Bot) wie REST (verborgene Relationen und Verweise wie in der History, A131); `meta` eines Events verlässt den Server nie (`socket` A282, `on_behalf_of` A342, `mentioned`, `kept_version` …); `comment.deleted` und `comment.updated` eines inzwischen gelöschten Kommentars ohne Text (A228); Seiten-Events ohne Inhalt in `changes` (A306).
- **Jede schreibende Action schreibt ihr Event** in der Transaktion: neu `webhook.created|updated|deleted|secret_rotated|disabled` (alle `webhook()` false, Subjekt der Webhook, Morph `webhook`, `project_id` des Webhooks) und `bot.assigned` (Webhook). Protokoll-Buchhaltung (Zustellungen, Versuche, `failing_since`) schreibt kein Event (wie A355). `changes` eines `webhook.updated` nennen nie `secret`.
- Fachlogik nur in `app/Actions` und `app/Domain`; Konsument, Job, Listener, Controller rechnen nicht und schreiben keine Modelle (`ArchTest`: neue Regel für `App\Webhooks`). **Jede Action steht genau einmal in der Rechte-Matrix** (System-Actions mit `system`), **jede Route unter `api/v1` genau einmal in der Routen-Matrix**, beides im Commit, der sie anlegt. `MatrixWorld::webhook()` (frischer Webhook der Organisation, über die Factory).
- **Rechte (Spec 4.3):** Webhooks lesen und verwalten nur Konten mit `org.manage` (`OrganizationPolicy::manageWebhooks`; Org-Admins und der Standard-Bot über ein Token), sonst 403 `problem.detail.webhooks_admins_only` (403, nicht 404: die Seite gibt es für jeden, wie System).
- **Queues:** Konsument und Zustellung auf `webhooks`; der DDEV-Daemon `queue` hört schon darauf, der erste Worker der CI-e2e bekommt `webhooks` (`default,live,notifications,webhooks,bulk`), `ConfigTest` hält beide fest.
- Die UI liest nur über `/api/v1`. `resources/js/api/webhooks.ts`, `hooks/webhooks.ts` exportieren die Namen und Signaturen des Klickdummys (`listWebhooks`, `saveWebhook`, `deleteWebhook`, `listDeliveries`, `redeliver`, `pingWebhook`; `useWebhooks`, `useSaveWebhook`, `useDeleteWebhook`, `useDeliveries`, `useRedeliver`, `usePingWebhook`); Abweichungen nur nach A369 (`rotateWebhookSecret`/`useRotateWebhookSecret` statt `saveWebhook(…, { renew_secret })`) und A361 (`WebhookDelivery` mit `delivery_id`, `redeliver(delivery_id)` nimmt die ID der Zustellung).
- Texte: jeder deutsche Text des Klickdummys wird ein Schlüssel in `lang/de.json` (wörtlich) und `lang/en.json`, unter `settings.webhooks.*`, `webhooks.event.*` (Namen der Ereignisse, ohne Punkt im Schlüssel: `webhooks.event.work_item_state_changed`), Problem-Sätze unter `problem.detail.*`, Feldmeldungen unter `field.*`; Schlüssel ohne Ziffern, Plural `.one`/`.other`.
- Abdeckung 100 % Zeilen PHP und Frontend; Vitest-Schwelle neu für `resources/js/features/settings/org/webhooks/**` (100 % Zeilen) in `vitest.config.ts`.
- Tests müssen rot werden können: zu jeder Regel ein Fall, der ohne sie scheitert (RED zuerst belegen). HTTP in Feature-Tests nur über `Http::fake()`/`Http::preventStrayRequests()`, DNS nur über `Tests\Support\FakeResolver`; echte Verbindungen nur in `tests/Integration` (gegen Mailpit als beliebigen HTTP-Server, Task 4).
- **e2e:** der Empfänger läuft im Prozess des Tests (Node `http`, Port 0) unter `E2E_WEBHOOK_HOST` (A373). Webhooks einer Spec heißen `E2E <variant> <runId> …`, `finally` löscht sie. Keine festen Wartezeiten; auf Zustellungen wartet eine Spec mit `expect.poll` am Empfänger.
- Demo- und Testdaten nur fiktiv (Feldwerk, `*.example.com`, die drei Webhooks aus `seed/inbox.ts`).
- `CLAUDE.md` im selben Commit wie die Änderung, die eine Angabe dort ändert. Der Klickdummy bleibt unverändert.

## Review Focus

- **Doppelt oder gar nicht (Review Focus 1 des Master-Plans):** ein Event, das der Nachverteiler ein zweites Mal verteilt, ein `ConsumeEvent`, der nach dem Claim wirft und wiederholt, und ein `queue:retry` ohne Claim ergeben je Webhook genau eine Zustellung und einen Job; ein Konsument, der vor dem Commit scheitert, hinterlässt weder Zeile noch Job; ein Absturz zwischen Senden und Protokoll darf doppelt senden, aber immer mit derselben `X-Werkbuch-Delivery`. → Task 6 (`tests/Feature/Webhooks/QueueDeliveriesTest.php`, `tests/Integration/WebhookDeliveryRaceTest.php`).
- **SSRF über DNS:** ein Name, der beim Speichern öffentlich auflöst und beim Versand auf `127.0.0.1`, `169.254.169.254`, `10.x`, `::1`, `fd00::/8`, `::ffff:127.0.0.1`, `64:ff9b::a9fe:a9fe` oder `2002:7f00:1::` zeigt, wird nicht angefragt; ein Name mit einer öffentlichen und einer privaten Adresse auch nicht; ein `302` auf `http://169.254.169.254/` wird nicht verfolgt; eine URL mit Zugangsdaten oder ein Schema außer `http`/`https` ist schon beim Speichern 422. → Tasks 1, 4, 7.
- **Zugriff verloren (Review Focus 3 des Master-Plans):** ein Webhook mit Bot, dessen Bot zwischen Ereignis und Versuch aus dem privaten Projekt entfernt oder deaktiviert wird, sendet nichts mehr (`cancelled`); ein Projekt-Webhook bekommt nie ein Ereignis eines anderen Projekts; `data` eines Items nennt keine Relation und keinen Verweis auf ein Item, das der Bot nicht sieht. → Tasks 5, 6, 7.
- **Abschalten an der Grenze:** ein Empfänger, der 23 h 59 min scheitert und dann antwortet, bleibt an; einer, der 24 h scheitert, geht beim nächsten Fehlschlag aus, genau einmal, mit genau einer Benachrichtigung je aktiver Org-Admin-Person, auch wenn zwei Zustellungen gleichzeitig scheitern; ein Ping, der scheitert, schaltet nie ab; offene Wiederholungen eines abgeschalteten Webhooks senden nicht mehr. → Tasks 7, 8 (`tests/Integration/WebhookDisableRaceTest.php`).
- **Geheimnis bleibt geheim:** nach Anlegen, Erneuern, Ping, Zustellung mit Fehler und „erneut senden“ steht der Klartext in keiner Tabelle außer verschlüsselt in `webhooks.secret`, in keinem Log, keiner Antwort außer den zwei vorgesehenen und keinem Fehlertext der System-Seite (T11-M7: URLs mit Query maskiert). → Tasks 3, 7, 10.

## Gates

Regel A249:

- **G1 (PHP), je Task mit PHP:** `ddev artisan test --coverage --min=100` → `Total: 100.0 %`; `ddev exec vendor/bin/phpstan analyse --memory-limit=1G` → `[OK] No errors`; `ddev exec vendor/bin/pint --test` → `PASS`. Gezielt `ddev artisan test --testsuite=Integration --filter=<Name>` in jeder Task mit Integration-Test.
- **G2 (Frontend), je Task mit `resources/js`:** `ddev exec pnpm typecheck && ddev exec pnpm test:coverage`.
- **G3 gezielt, je Task mit Frontend oder e2e:** gegen den normalen Build `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test <specs>` mit den Specs der Task. Nach PHP-Änderungen an Konsumenten oder Jobs vorher `ddev restart` (Daemons).
- **G3 voll, genau einmal je Phase:** nach Task 17, im Hintergrund parallel zum Final-Review: `ddev exec pnpm build:coverage && pnpm --dir e2e test && ddev exec pnpm build`.

---

## Datenmodell

Migration `database/migrations/2026_11_06_001400_create_webhooks_tables.php`:

| Tabelle | Spalten |
|---|---|
| `webhooks` | `id` ULID; `name` string(120); `url` string(2048); `secret` text (`encrypted`); `project_id` Fremdschlüssel `cascadeOnDelete` nullable (null = Organisation); `events` JSON (Normalform von `EventPatterns::normalize`); `bot_id` Fremdschlüssel auf `users` `restrictOnDelete` nullable; `active` boolean; `disabled_at` timestamp nullable (vom System abgeschaltet); `failing_since` timestamp(6) nullable (erster Fehlschlag seit dem letzten Erfolg, A366); `last_success_at` timestamp nullable; `created_by` Fremdschlüssel `restrictOnDelete`; `created_at`, `updated_at`. Index (`active`, `project_id`) |
| `webhook_deliveries` | `id` ULID (= `X-Werkbuch-Delivery`); `webhook_id` Fremdschlüssel `cascadeOnDelete`; `event_id` ULID nullable ohne Fremdschlüssel (`null` beim Ping); `event` string(64) (`work_item.state_changed`, `ping`); `body` mediumtext (der JSON-Body als Schnappschuss, A362); `status` string(16) `pending`/`succeeded`/`failed`/`cancelled`; `attempts` unsigned tinyint; `created_at` timestamp(6), `updated_at`. Eindeutig (`event_id`, `webhook_id`) (mehrere `null` erlaubt); Indizes (`webhook_id`, `created_at`), (`updated_at`) |
| `webhook_attempts` | `id` ULID; `delivery_id` Fremdschlüssel `cascadeOnDelete`; `webhook_id` ULID (für die Liste ohne Join, Index (`webhook_id`, `attempted_at`, `id`)); `attempt` unsigned tinyint (1 … 8, bei „erneut senden“ und Ping fortlaufend weiter); `kind` string(16) `scheduled`/`manual`/`ping`; `status_code` smallint nullable (null: keine Antwort); `duration_ms` unsigned int; `response_excerpt` text nullable (höchstens `ResponseExcerpt::MAX_BYTES` 2048, `mb_strcut`); `error` string(300) nullable (nur ohne Antwort; Code + maskierter erster Satz, A375); `attempted_at` timestamp(6) |

- Modelle `App\Models\Webhook` (Morph-Map `webhook`; Casts `secret` `encrypted`, `events` `array`, `active` bool, Stempel `immutable_datetime`; `$hidden = ['secret']`; `project()`, `bot()`, `creator()`, `deliveries()`; `matches(EventType $type): bool` über `EventPatterns`), `App\Models\WebhookDelivery` (`webhook()`, `attempts()` nach `attempt`), `App\Models\WebhookAttempt` (`$timestamps = false`, `delivery()`).
- Factories `WebhookFactory` (Organisation, `['work_item.*']`, `https://receiver.example.com/hook`, aktiv, Geheimnis `Webhook::newSecret()`; `forProject($p)`, `forBot($u)`, `disabled($at)`, `failingSince($at)`), `WebhookDeliveryFactory` (`pending`, Body `{}`), `WebhookAttemptFactory` (`status(200)`, `noAnswer($error)`).

## REST

| Route | Action | Antwort |
|---|---|---|
| `GET /api/v1/webhooks` | `ListWebhooks` | `{data: Webhook[], links, meta}` nach Name, ID |
| `POST /api/v1/webhooks` | `SaveWebhook` | 201 `{data: Webhook, secret}` (Body `{name, url, project_id, events, bot_id, active}`, alle Pflicht, nullable dürfen `null` sein, A75) |
| `GET /api/v1/webhooks/{webhook}` | `GetWebhook` | `{data: Webhook}` |
| `PUT /api/v1/webhooks/{webhook}` | `SaveWebhook` | `{data: Webhook}`; ersetzt ganz; gleicher Stand → kein Event; `active: true` an einem abgeschalteten leert `disabled_at` und `failing_since` |
| `DELETE /api/v1/webhooks/{webhook}` | `DeleteWebhook` | 204 (Zustellungen und Versuche per Kaskade; laufende Jobs finden nichts mehr) |
| `POST /api/v1/webhooks/{webhook}/rotate-secret` | `RotateWebhookSecret` | `{data: Webhook, secret}` |
| `POST /api/v1/webhooks/{webhook}/ping` | `PingWebhook` | `{data: WebhookDelivery}` (der Versuch, synchron, A367); Drossel `webhook-send` 6/min je Konto |
| `GET /api/v1/webhooks/{webhook}/deliveries` | `ListWebhookDeliveries` | `{data: WebhookDelivery[], links, meta}`: Versuche, neueste zuerst (`attempted_at`, `id`, roh als `attempted_cursor` wie `ListHistory`) |
| `POST /api/v1/webhooks/{webhook}/deliveries/{delivery}/redeliver` | `RedeliverWebhook` | `{data: WebhookDelivery}` (synchron, A367); dieselbe Drossel; eine Zustellung eines anderen Webhooks → 404 |

- `WebhookResource` `{id, name, url, project_id, events, bot_id, active, disabled_at, failing_since, last_success_at, created_by, created_at, updated_at}` (nie `secret`); `WebhookDeliveryResource` (ein **Versuch** in der Form `WebhookDelivery` des Klickdummys) `{id, delivery_id, webhook_id, event, attempt, kind, status_code, duration_ms, response_excerpt, error, created_at (= attempted_at)}`.
- `Route::bind('webhook')` und `Route::bind('delivery')` in `routes/api.php` nur per ULID (auch groß), sonst 404.
- Feldmeldungen (`App\Support\WebhookInput`): `field.name.required`/`field.name.max` (`:max` 120), `field.url.required`, `field.url.invalid` (kein `http`/`https`, kein Host, länger als 2048, Leer- oder Steuerzeichen), `field.url.credentials` (Benutzer oder Passwort in der URL), `field.url.private` (IP-Literal oder `localhost`/`*.localhost` in einem gesperrten Netz, solange `webhooks_allow_private` aus ist), `field.project_id.unknown` (kein Projekt oder in Löschung), `field.events.required`, `field.events.unknown` (`:name`), `field.bot_id.invalid` (kein aktiver Bot), `field.boolean`. Problem: 403 `forbidden` mit `problem.detail.webhooks_admins_only` („Webhooks verwalten nur Org-Admins.“), 429 `too_many_requests` (Drossel).

## Payload und Header

| Teil | Wert |
|---|---|
| Body | `{id: <event_id bzw. delivery_id beim Ping>, event, occurred_at (ISO mit Mikrosekunden, UTC), actor: {id, type, name, handle}, project: {id, identifier} \| null, data, changes \| null}` (Spec 6.3); `JSON_UNESCAPED_SLASHES \| JSON_UNESCAPED_UNICODE`, einmal beim Konsum gebaut (A362) |
| `X-Werkbuch-Event` | Name des Ereignisses (`ping` beim Ping) |
| `X-Werkbuch-Delivery` | ULID der Zustellung (gleich über alle Versuche und „erneut senden“) |
| `X-Werkbuch-Timestamp` | Unix-Sekunden des Versuchs |
| `X-Werkbuch-Signature` | `sha256=` + Hex von HMAC-SHA256(Geheimnis, `"{timestamp}.{body}"`) (`App\Domain\Webhooks\Signature`) |
| sonst | `Content-Type: application/json`, `User-Agent: werkbuch/<config('werkbuch.version')>`; kein `Webhook-Id`/`Signature` von spatie (`doNotSign()`, `withWebhookIdHeader(null)`) |

`data` je Ereignis (`App\Webhooks\EventData`):

| Ereignis | `data` |
|---|---|
| `project.created|updated|archived|restored|member_added|member_removed` | `ProjectResource` |
| `project.deleted` | `{id, identifier, name}` aus `meta` |
| `work_item.*` außer `deleted` | `WorkItemResource` (voll, `loadForResource($item, $leser)`) |
| `work_item.deleted` | `{id, key, title}` aus `meta` |
| `comment.created|updated` | `CommentResource` (`Comment::loadForResource`) samt `work_item` (schlank) |
| `comment.deleted` | `{id: meta.comment_id, work_item_id, author_id: meta.author_id}`, kein Text |
| `page.created|updated|moved` | `PageResource` (voll) |
| `page.deleted` | `{id, title: meta.title, page_ids: meta.page_ids}` |
| `bot.mentioned` | `{bot: UserResource, item: WorkItemResource, source, comment: CommentResource \| null}` |
| `bot.assigned` | `{bot: UserResource, item: WorkItemResource}` |
| `template.run_failed` | `TemplateRunResource` + `template` (`TemplateResource`) |
| Subjekt inzwischen weg | `null` (die Zustellung geht trotzdem, A362) |

`changes` = `events.changes`, außer: `changes.relation.old|new` wird für den Leser aufgelöst wie in `ListHistory` (`{label, item_id, key}` bzw. `{label, hidden: true}`), `comment.updated` ohne `changes.body`, wenn der Kommentar nicht mehr existiert (A228), `page.*` haben keinen Text (A306, steht schon so).

## Wiederholplan und Abschalten (`App\Domain\Webhooks`)

| Regel | Wert |
|---|---|
| Versuche | `Backoff::TRIES` 8; Versuch n läuft `Backoff::OFFSETS[n-1]` Sekunden nach dem ersten: `[0, 60, 360, 2160, 9360, 30960, 74160, 86400]` (Abstände 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 3 h 24 min; wie die Demo-Daten, A365) |
| Erfolg | 2xx; alles andere (auch 3xx), Timeout, Verbindungsfehler, gesperrte Adresse sind Fehlschläge |
| Timeout | 10 s gesamt (`timeoutInSeconds(10)`, `connect_timeout` 5) |
| Abschalten | Fehlschlag eines geplanten Versuchs und `failing_since` ≤ jetzt − `DisableRule::AFTER_SECONDS` 86 400 → aus (A366) |
| Erfolg danach | `failing_since` null, `last_success_at` jetzt |
| Ping, „erneut senden“ | ein Versuch, keine Wiederholung; Fehlschlag ändert `failing_since` nicht, Erfolg leert es |
| Protokoll | 30 Tage nach der letzten Änderung der Zustellung (`PruneWebhookDeliveries`, stündlich) |

## Dateistruktur nach Phase 11

| Ort | Inhalt |
|---|---|
| `app/Domain/Webhooks/` | `EventPatterns`, `Addresses`, `Signature`, `Backoff`, `DisableRule` |
| `app/Models/{Webhook,WebhookDelivery,WebhookAttempt}.php`, `database/factories/*` | Modelle |
| `app/Support/{WebhookInput,ResponseExcerpt,Redact}.php` | Eingaben, Kürzen, Maskieren |
| `app/Webhooks/` | `WebhookConsumer`, `WebhookPayload`, `EventData`, `SafeTarget`, `Target`, `UnsafeTarget`, `Resolver` (Interface), `DnsResolver` |
| `app/Actions/Webhooks/` | `ListWebhooks`, `GetWebhook`, `SaveWebhook`, `DeleteWebhook`, `RotateWebhookSecret`, `ListWebhookDeliveries`, `PingWebhook`, `RedeliverWebhook`, `QueueDeliveries`, `PrepareWebhookAttempt`, `RecordWebhookAttempt`, `DisableWebhook`, `PruneWebhookDeliveries` |
| `app/Jobs/{DeliverWebhook,PruneWebhookDeliveriesJob}.php`, `app/Listeners/RecordWebhookCall.php` | Zustellung, Aufräumen, Protokoll aus den spatie-Events |
| `app/Http/Controllers/Api/WebhooksController.php`, `app/Http/Resources/{WebhookResource,WebhookDeliveryResource}.php` | dünne Schicht |
| `database/seeders/Demo/WebhooksSeeder.php` | Demo |
| `resources/js/api/webhooks.ts`, `resources/js/hooks/webhooks.ts` | Datenschicht |
| `resources/js/features/settings/org/webhooks/` | `Webhooks`, `WebhookList`, `WebhookCard`, `WebhookDialog`, `EventTree`, `events.ts`, `catalog.ts`, `SecretDialog`, `WebhookDeliveries`, `webhookParts.tsx` |
| `docs/{en,de}/webhooks.md`, `docs/snippets/webhooks/verify.{mjs,php,py}` | Doku |

## Paketversionen

Geprüft am 2026-11-05 auf Packagist:

| Paket | Version | Task | Hinweis |
|---|---|---|---|
| `spatie/laravel-webhook-server` | `^4.0` (4.0.0 vom 2026-10-20; verlangt PHP ^8.4, illuminate ^13, guzzle ^7.8.2) | 2 | A1 nannte die 4.0 „ganz frisch“: in Task 2 Changelog und `CallWebhookJob` gegen diese Planung prüfen. Wichtig aus dem Quelltext: die Signatur rechnet spatie **beim Einstellen** ohne Zeitstempel (`WebhookCall::getAllHeaders`), darum `doNotSign()` und eigene Signatur je Versuch in `DeliverWebhook::createRequest()`; `requestOptions()` ist `protected` (dort `allow_redirects`, `curl[CURLOPT_RESOLVE]`, `connect_timeout`); Wiederholungen über `release($backoff)` mit `$tries`; Events `WebhookCallSucceededEvent`, `WebhookCallFailedEvent`, `FinalWebhookCallFailedEvent` tragen `meta`, `response`, `transferStats`, `errorMessage`; `throwExceptionOnFailure(false)` (nichts in `failed_jobs`). Config nicht veröffentlichen, alles am Aufruf setzen. |
| PHP `dns_get_record`, `inet_pton` | PHP 8.4 | 1, 4 | IPv6-Regeln über `inet_pton` und Präfixvergleich der Bytes, kein Paket |
| Node `node:crypto`, `node:http` | Node 24 | 16, 17 | Empfänger und Snippet ohne Paket |

## Port-Umfang aus `prototypes/clickdummy/src/`

| Portiert in Phase 11 | Ziel | Task |
|---|---|---|
| `api/webhooks.ts` (Regeln: Ereignisse, Pflichtfelder, Bot, private Ziele) | `WebhookInput`, `EventPatterns`, `Addresses` | 1, 3 |
| `api/seed/inbox.ts` (drei Webhooks, 18 Versuche, `n_10`) | `WebhooksSeeder`, `NotificationsSeeder` (`webhook_id`) | 11 |
| `api/webhooks.ts`, `hooks/webhooks.ts` (Signaturen) | `resources/js/api/webhooks.ts`, `resources/js/hooks/webhooks.ts` | 12 |
| `features/settings/org/{Webhooks.tsx,EventTree.tsx,events.ts,catalog.ts (EVENT_GROUPS),SecretDialog.tsx}` | `features/settings/org/webhooks/*` (13c: Geheimnis nicht im Mutation-Cache, Dialog schließt nicht per Escape/Klick daneben, Erneuern unabhängig vom Formular) | 13 |
| `features/settings/org/{WebhookDeliveries.tsx,webhookParts.tsx}` | `WebhookDeliveries`, `webhookParts.tsx` (13c: Trennlinien) | 14 |
| `features/settings/org/webhooks.test.tsx` | `features/settings/org/webhooks/*.test.tsx`, `e2e/tests/{webhooks,webhooks-acceptance}.spec.ts` | 13–16 |

Nicht in Phase 11: MCP-Tools `webhooks`/`manage-webhooks` (Phase 13); ein Worker auf `webhooks` im Docker-Image (Phase 14); Webhooks für Katalog-, Vorlagen- und Automatisierungs-Events (A62, A346: ohne Webhook; die Vormerkung „Feed für Katalog-Events filtert `meta.projects`“ entfällt damit, A376).

---

### Task 1: Reine Regeln der Webhooks

**Modell:** opus

**Files:**
- Create: `app/Domain/Webhooks/{EventPatterns,Addresses,Signature,Backoff,DisableRule}.php`, `tests/Unit/Domain/Webhooks/{EventPatternsTest,AddressesTest,SignatureTest,BackoffTest,DisableRuleTest}.php`

**Interfaces:**
- Produces:
  - `final class EventPatterns { static normalize(list<string> $patterns, list<string> $catalog): list<string> /* wirft InvalidInput mit 'events' => 'unknown:<name>'; Gruppe ganz gewählt → nur `gruppe.*`; Reihenfolge des Katalogs; ohne Doppelte */; static matches(list<string> $patterns, string $event): bool; static expand(list<string> $patterns, list<string> $catalog): list<string>; }` (`$catalog` = Werte der `EventType` mit `webhook()`, der Aufrufer übergibt sie).
  - `final class Addresses { static isBlocked(string $ip): bool; static isIp(string $host): bool; }`: gesperrt IPv4 `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`, `224/4`, `240/4`; IPv6 `::/128`, `::1/128`, `fc00::/7`, `fe80::/10`, `ff00::/8`, `100::/64`, `2001:db8::/32`, `fec0::/10`; eingebettetes IPv4 prüfen bei `::ffff:0:0/96`, `::/96` (kompatibel), `64:ff9b::/96`, `64:ff9b:1::/48`, `2002::/16` (Bytes 2–5); kein gültiges Literal → `true`. Ohne Laravel, über `inet_pton` und Byte-Präfixe.
  - `final class Signature { public const PREFIX = 'sha256='; static sign(string $secret, int $timestamp, string $body): string /* 'sha256=' . hex */; static verify(string $secret, int $timestamp, string $body, string $header, int $now, int $tolerance = 300): bool /* hash_equals, Zeitfenster */; }`
  - `final class Backoff { public const TRIES = 8; public const OFFSETS = [0, 60, 360, 2160, 9360, 30960, 74160, 86400]; static delayAfter(int $attempt): int /* OFFSETS[attempt] − OFFSETS[attempt−1], 1 ≤ attempt ≤ 7, sonst InvalidArgumentException */; }`
  - `final class DisableRule { public const AFTER_SECONDS = 86400; static disables(?DateTimeImmutable $failingSince, DateTimeImmutable $now): bool; }`
- Consumes: `App\Domain\Filter\InvalidInput` (Phase 5).

- [ ] **Step 1: Failing Tests** — `EventPatternsTest`: „stores a fully ticked group as its wildcard“, „keeps single events in the order of the catalog“, „refuses an event outside the catalog“ (`workflow.updated`, `page.*x`, `nope.*`, `work_item`), „matches a wildcard and a single name“, „does not let comment.* match comment.reaction_added“ (nicht im Katalog). `AddressesTest`: je Netz der Liste eine gesperrte und die Nachbaradresse außerhalb (`9.255.255.255`, `11.0.0.0`, `100.63.255.255`, `172.32.0.0`), Metadata `169.254.169.254`, `fd00:ec2::254`, `::ffff:127.0.0.1`, `::ffff:7f00:1`, `::127.0.0.1`, `64:ff9b::a9fe:a9fe`, `2002:a9fe:a9fe::1`, `2002:0808:0808::1` frei, `2606:4700::1111` frei, `8.8.8.8` frei, `example.com` (kein Literal) gesperrt. `SignatureTest`: ein fester Vektor (Geheimnis `whsec_test`, Zeit `1767225600`, Body `{"id":"x"}` → der Hex-Wert, im Test aus `hash_hmac` dokumentiert), falsches Geheimnis, verändertes Byte im Body, Zeit außerhalb von 300 s, Header ohne Präfix. `BackoffTest`: Summe der Abstände = 86 400, Werte je Versuch. `DisableRuleTest`: `null` → nein, 23:59:59 → nein, genau 24 h → ja.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Domain\\Webhooks|ArchTest'`.
- [ ] **Step 3: Gates G1**
- [ ] **Step 4: Commit** — `feat: add the pure rules of webhooks: patterns, blocked addresses, signature, backoff`.

---

### Task 2: Paket, Datenmodell, Rechte, Event-Typen

**Modell:** opus

**Files:**
- Create: `database/migrations/2026_11_06_001400_create_webhooks_tables.php`, `app/Models/{Webhook,WebhookDelivery,WebhookAttempt}.php`, `database/factories/{WebhookFactory,WebhookDeliveryFactory,WebhookAttemptFactory}.php`, `tests/Feature/Webhooks/{WebhookModelTest,WebhookPolicyTest}.php`
- Modify: `composer.json`/`composer.lock` (`ddev composer require spatie/laravel-webhook-server:^4.0`), `app/Events/EventType.php` (`WebhookCreated`, `WebhookUpdated`, `WebhookDeleted`, `WebhookSecretRotated`, `WebhookDisabled`, alle `webhook()` false), `tests/Unit/EventTypeTest.php`, `app/Policies/OrganizationPolicy.php` (`manageWebhooks`), `app/Providers/AppServiceProvider.php` (Morph-Map `webhook`), `tests/Feature/Access/MatrixWorld.php` (`webhook()`), `tests/Unit/ArchTest.php` (Regel für `App\Webhooks`: final, ohne `EventRecorder`, `DB`, `Schema` und Schreibaufrufe, wie `App\Search`), `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces: Modelle und Factories wie „Datenmodell“; `Webhook::newSecret(): string` (`'whsec_'` + 43 Zeichen base64url aus 32 Zufallsbytes, A369); `Webhook::catalog(): list<string>` (Werte aller `EventType` mit `webhook()`, Reihenfolge des Enums); `OrganizationPolicy::manageWebhooks(User $user): Response` (`org.manage`, sonst `problem.detail.webhooks_admins_only`); `MatrixWorld::webhook(): Webhook`.
- Consumes: `EventPatterns` (Task 1).

- [ ] **Step 1: Failing Tests** — `WebhookModelTest`: „stores the secret encrypted“ (Rohwert der Spalte ≠ Klartext, `Crypt::decryptString` ergibt ihn), „never serializes the secret“ (`toArray()`, `toJson()`), „takes its deliveries and attempts with it“, „goes with its project“ (Projekt löschen per `PurgeProject` → Webhook weg), „keeps a bot from being deleted“ (FK `restrict`), „matches its patterns“ (`work_item.*` trifft `work_item.assigned`). `WebhookPolicyTest`: Org-Admin und Standard-Bot erlaubt, Member 403 mit Satz, deaktiviertes Konto 404 wie überall. `EventTypeTest`: die fünf neuen Typen ohne Webhook; `bot.assigned` mit.
- [ ] **Step 2: Paket installieren** — `ddev composer require spatie/laravel-webhook-server:^4.0`; `composer.lock` prüfen (nur das Paket und `spatie/laravel-package-tools`, falls noch nicht da). Changelog der 4.0 gegen die Tabelle „Paketversionen“ lesen; Abweichungen als Notiz für Task 7 in den Commit-Text.
- [ ] **Step 3: Rot, implementieren, grün** — `ddev artisan test --filter='Webhook|EventTypeTest|ArchTest'`.
- [ ] **Step 4: Gates G1**
- [ ] **Step 5: Commit** — `feat: add webhooks, their deliveries and attempts, with the right to manage them`.

---

### Task 3: Webhooks verwalten (REST)

**Modell:** opus

**Files:**
- Create: `app/Support/WebhookInput.php`, `app/Actions/Webhooks/{ListWebhooks,GetWebhook,SaveWebhook,DeleteWebhook,RotateWebhookSecret}.php`, `app/Http/Controllers/Api/WebhooksController.php`, `app/Http/Resources/WebhookResource.php`, `tests/Feature/Webhooks/{SaveWebhookTest,DeleteWebhookTest,RotateWebhookSecretTest,ListWebhooksTest}.php`, `tests/Feature/Api/WebhooksApiTest.php`
- Modify: `routes/api.php` (Routen, `Route::bind('webhook')`), `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `WebhookInput::validate(array $input, ?Webhook $current): array{name: string, url: string, project_id: ?string, events: list<string>, bot_id: ?string, active: bool}` (alle Meldungen aus „REST“ in **einer** `ValidationException`; `Str::trim` für Name und URL; ULIDs über `Ids::normalize` und `Str::isUlid`; das Projekt unter der Sperre gelesen, in Löschung → `field.project_id.unknown`; der Bot aktiv und `type` `bot`).
  - `SaveWebhook::handle(Actor $actor, array $input, ?Webhook $webhook = null): array{webhook: Webhook, secret: ?string}` (Recht `manageWebhooks`; ohne Webhook: `created_by`, neues Geheimnis, `webhook.created` mit `changes.name`; mit: `lockForUpdate` frisch (weg → 404), `webhook.updated` mit `CatalogInput::changes` über `name`, `url`, `project_id`, `events`, `bot_id`, `active` nur bei Änderung; `active` von aus nach an leert `disabled_at` und `failing_since` (`changes.disabled_at`)).
  - `DeleteWebhook::handle(Actor $actor, Webhook $webhook): void` (`webhook.deleted`, `meta.name`).
  - `RotateWebhookSecret::handle(Actor $actor, Webhook $webhook): array{webhook: Webhook, secret: string}` (`webhook.secret_rotated` ohne `changes`).
  - `ListWebhooks::handle(Actor $actor, array $query): ListResult`, `GetWebhook::handle(Actor $actor, Webhook $webhook): Webhook`.
  - `WebhookResource` wie „REST“; Controller `index`, `store` (201 `{data, secret}` per `additional`), `show`, `update`, `destroy`, `rotateSecret`.
- Consumes: Task 1, 2; `CatalogInput::changes`, `PageArgs`, `ListResult`, `ApiList`.

- [ ] **Step 1: Failing Tests** — `SaveWebhookTest`: jede Feldmeldung mit Pfad, alle in einer 422; „normalizes the events“ (alle neun `work_item.*` einzeln → `['work_item.*']`); „refuses a URL with user and password“; „refuses http://127.0.0.1, http://[::1], http://localhost, http://169.254.169.254 while private targets are off“ und „takes them with webhooks_allow_private“; „takes a host name without asking DNS“ (kein Resolver-Aufruf, A368); „refuses a project being deleted“; „refuses a person or a deactivated bot as bot“; „answers the secret only on create“ (`PUT` ohne `secret`); „writes no event for the same state“; „switches a disabled webhook on again and clears its failing“; „never puts the secret into an event“ (`events`-Tabelle per `like '%whsec_%'`). `RotateWebhookSecretTest`: neues Geheimnis ≠ altes, Event ohne `changes`. `WebhooksApiTest`: Lese-Token liest die Liste und bekommt nie `secret`; Member 403; `POST` mit Schreib-Token 201 `{data, secret}`; unbekannte ID 404; Abfragezahl der Liste gleich für 5 und 50.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Webhooks|RightsMatrixTest|RouteMatrixTest'`.
- [ ] **Step 3: Gates G1**
- [ ] **Step 4: Commit** — `feat: manage webhooks over REST with a secret shown once`.

---

### Task 4: Sicheres Ziel: DNS, Adressen, Anfrage an die geprüfte IP

**Modell:** opus

**Files:**
- Create: `app/Webhooks/{Resolver,DnsResolver,SafeTarget,Target,UnsafeTarget}.php`, `tests/Support/FakeResolver.php`, `tests/Feature/Webhooks/SafeTargetTest.php`, `tests/Integration/WebhookTargetTest.php`
- Modify: `app/Providers/AppServiceProvider.php` (`Resolver` → `DnsResolver`, `scoped`), `tests/Pest.php` (`resolver(array $map): FakeResolver`)

**Interfaces:**
- Produces:
  - `interface Resolver { /** @return list<string> */ public function addresses(string $host): array; }`; `DnsResolver` (A und AAAA über `dns_get_record`, CNAME folgt das System; ein IP-Literal gibt sich selbst zurück; nichts → `[]`).
  - `final readonly class Target { public string $url; public string $host; public int $port; public string $ip; public function curlResolve(): string /* "host:port:ip", IPv6 in Klammern */; }`
  - `final class UnsafeTarget extends RuntimeException { public string $reason /* 'scheme' | 'credentials' | 'unresolvable' | 'private_address' */; }` (Meldung ohne die URL: nur Host und Grund).
  - `SafeTarget::check(string $url): Target` (Schema, Zugangsdaten, Host; Auflösung; ist **eine** Adresse gesperrt und `webhooks_allow_private` aus → `private_address`; gewählt wird die erste Adresse; Port aus der URL oder 80/443).
  - `resolver(['receiver.example.com' => ['93.184.216.34']])` in Tests (bindet `FakeResolver`, unbekannte Namen → `[]`).
- Consumes: `Addresses` (Task 1).

- [ ] **Step 1: Failing Tests** — `SafeTargetTest`: „pins the first checked address“, „refuses a name that points at a private address“ (je eine Adresse aus Review Focus 2), „refuses a name with one public and one private address“, „refuses a name that resolves to nothing“, „takes private addresses when allowed“, „keeps the port and brackets an IPv6 address“ (`curlResolve()` = `"[2606:4700::1111]"`-Form wie curl sie verlangt), „never names the URL in its message“ (Query mit `?token=geheim`). `WebhookTargetTest` (Integration, echte Verbindung): `resolver(['receiver.test' => ['127.0.0.1']])`, `webhooks_allow_private` an, ein `Http::withOptions(['curl' => [CURLOPT_RESOLVE => [$target->curlResolve()]], 'allow_redirects' => false])->get("http://receiver.test:8025/api/v1/info")` gegen Mailpit (`MAILPIT_URL`-Port) antwortet mit einem Status: der Name, den kein DNS kennt, ging an die geprüfte IP.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter=SafeTargetTest`; `ddev artisan test --testsuite=Integration --filter=WebhookTargetTest`.
- [ ] **Step 3: Gates G1**
- [ ] **Step 4: Commit** — `feat: check webhook targets after DNS and send to the checked address`.

---

### Task 5: Payload aus den Resources

**Modell:** opus

**Files:**
- Create: `app/Webhooks/{WebhookPayload,EventData}.php`, `app/Support/RelationChanges.php`, `tests/Feature/Webhooks/WebhookPayloadTest.php`
- Modify: `app/Actions/WorkItems/ListHistory.php` (die Auflösung von `changes.relation` nach `RelationChanges::forReader` ausgelagert, Verhalten gleich, `ListHistoryTest` unverändert grün)

**Interfaces:**
- Produces:
  - `WebhookPayload::for(Event $event, User $reader): array` (die Form aus „Payload und Header“; Resources über einen Request, dessen `user()` der Leser ist, damit `my_role`, `is_member`, `subscribed` für ihn gelten (A363); `meta` nie; `JSON` wird erst in Task 6 kodiert).
  - `WebhookPayload::ping(Webhook $webhook, User $actor, string $deliveryId): array` (`event` `ping`, `data` `{webhook: {id, name}}`, `changes` `null`).
  - `EventData::of(Event $event, User $reader): ?array` (Tabelle „`data` je Ereignis“; jede Abfrage über `loadForResource` mit fester Zahl).
  - `RelationChanges::forReader(list<Event> $events, User $reader): void` (setzt `Event::$history_changes` wie bisher; eine Abfrage je Seite).
- Consumes: alle Resources und `loadForResource`-Methoden der Phasen 2–10.

- [ ] **Step 1: Failing Tests** — `WebhookPayloadTest` je Zeile der Tabelle ein Fall aus einer echten Action (Factory-Welt, `actor($admin)`): „sends the item as REST reads it, Markdown and JSON“ (`description` und `description_json`), „hides a relation to an item the bot cannot see“ (Leser Bot, anderes Ende in privatem Projekt → `{label, hidden: true}`, Key und ID fehlen), „answers my_role for the reader“, „sends no text of a deleted comment“ (`comment.updated`, Kommentar danach gelöscht → `changes` ohne `body`, `data` `null`), „sends work_item.deleted from meta“, „sends page.deleted with all page_ids“, „sends bot.mentioned with source and comment“, „sends template.run_failed with its template“, „never sends meta“ (Event mit `socket`, `on_behalf_of`, `mentioned` → kein Schlüssel davon irgendwo im JSON), „answers data null when the subject is gone“. Abfragezahl: ein `work_item.updated` mit 1 und mit 20 Relationen fragt gleich oft.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='WebhookPayloadTest|ListHistoryTest'`.
- [ ] **Step 3: Gates G1**
- [ ] **Step 4: Commit** — `feat: build webhook payloads from the resources for a reader`.

---

### Task 6: Konsument `webhooks`: Zustellungen einstellen

**Modell:** opus

**Files:**
- Create: `app/Webhooks/WebhookConsumer.php`, `app/Actions/Webhooks/QueueDeliveries.php`, `app/Jobs/DeliverWebhook.php` (nur die Hülle: Konstruktion über `WebhookCall`, Queue, `afterCommit`; das Senden kommt in Task 7), `tests/Feature/Webhooks/{QueueDeliveriesTest,WebhookConsumerTest}.php`, `tests/Integration/WebhookDeliveryRaceTest.php`
- Modify: `config/werkbuch.php` (`event_consumers` + `WebhookConsumer::class`), `tests/Feature/ConfigTest.php`, `tests/Feature/Access/matrix.php` (`QueueDeliveries` mit `system`), `CLAUDE.md`

**Interfaces:**
- Produces:
  - `WebhookConsumer` (`EventConsumer`, `RetriesConsumption`; `key()`/`queue()` `webhooks`; 8 Versuche, 10/60/300/900/3600 s wie Suche und Benachrichtigungen) → `QueueDeliveries::run(Actor::system(User::defaultBot(), 'webhooks'), $event)`.
  - `QueueDeliveries::handle(Actor $actor, Event $event): int` (Zahl neuer Zustellungen): `null` ohne Abfrage für Typen ohne `webhook()`; sonst die aktiven, nicht abgeschalteten Webhooks in einer Abfrage, dann je Webhook: `EventPatterns::matches`; Projekt-Webhook nur bei gleichem `project_id`, nie für ein Projekt in Löschung (also nie `project.deleted`, A370), Org-Webhook bei einem Projekt in Löschung nur `project.deleted`; mit Bot: der Bot aktiv und `Visibility::roleIn($bot, $project) !== null` (nach `Visibility::forget()`), und das Ereignis betrifft den Bot (A364: `bot.*` mit `meta.bot_id`, `work_item.*`/`comment.*` eines Items mit `assignee_id` = Bot beim Konsum); Body je Leser einmal gebaut (alle Webhooks ohne Bot teilen einen); `insertOrIgnore` aller Zeilen (`status` `pending`, `attempts` 0, `body` JSON); die ULIDs vergibt die Action vor dem Einfügen, danach liest `whereKey($ids)` genau die neu eingefügten Zeilen (eine schon vorhandene trägt eine andere ID), und je Zeile `DeliverWebhook::queue($delivery)`.
  - `DeliverWebhook::queue(WebhookDelivery $delivery): void` (`WebhookCall::create()->useJob(self::class)->url($webhook->url)->sendRawBody($delivery->body)->doNotSign()->withWebhookIdHeader(null)->meta(['delivery_id' => …])->maximumTries(Backoff::TRIES)->useBackoffStrategy(WebhookBackoff::class)->timeoutInSeconds(10)->onQueue('webhooks')->throwExceptionOnFailure(false)->dispatch()->afterCommit()`); `App\Webhooks\WebhookBackoff implements BackoffStrategy` (über `Backoff::delayAfter`).
- Consumes: Tasks 1, 2, 5; `Outbox`, `Visibility`.

- [ ] **Step 1: Failing Tests** — `QueueDeliveriesTest` (`Queue::fake([DeliverWebhook::class])`, `consumers(WebhookConsumer::class)`, echte Actions): „queues one delivery per matching webhook“, „skips an event the webhook did not choose“, „gives a project webhook only events of its project“ (zwei Projekte, je ein Item), „sends project.deleted to organization webhooks only“, „skips events without a webhook“ (`workflow.updated`, `comment.reaction_added`, `webhook.created`), „filters by bot: its own bot.assigned, events of its items, nothing of an item of another account“, „sends nothing to a bot webhook once the bot lost the private project“, „skips an inactive and a disabled webhook“, „consumes twice and queues once“ (`Outbox::consume` zweimal, auch ohne Claim: `insertOrIgnore` hält), „queues nothing when the claim rolls back“ (Fehler nach dem Einfügen → keine Zeile, kein Job, `config(['queue.default' => 'database'])` und Zeilen in `jobs`). `WebhookConsumerTest`: Schlüssel, Queue, Versuche; „takes the events of the migrations“ (`bot.created`, Katalog → nichts). `WebhookDeliveryRaceTest` (zwei Verbindungen, `RaceConnections`): zwei Konsumenten desselben Events gleichzeitig → eine Zeile je Webhook, einer wartet am Claim.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='QueueDeliveriesTest|WebhookConsumerTest|ConfigTest|RightsMatrixTest'`; Integration gezielt.
- [ ] **Step 3: Gates G1**
- [ ] **Step 4: Commit** — `feat: consume events into one webhook delivery each, queued after the commit`.

---

### Task 7: Zustellen, signieren, protokollieren, abschalten

**Modell:** opus

**Files:**
- Create: `app/Actions/Webhooks/{PrepareWebhookAttempt,RecordWebhookAttempt,DisableWebhook}.php`, `app/Listeners/RecordWebhookCall.php`, `app/Support/{ResponseExcerpt,Redact}.php`, `tests/Feature/Webhooks/{DeliverWebhookTest,DisableWebhookTest}.php`, `tests/Integration/WebhookDisableRaceTest.php`
- Modify: `app/Jobs/DeliverWebhook.php`, `app/Providers/AppServiceProvider.php` (`Event::listen` für `WebhookCallSucceededEvent`, `WebhookCallFailedEvent`), `tests/Feature/Access/matrix.php` (drei System-Actions), `CLAUDE.md`

**Interfaces:**
- Produces:
  - `PrepareWebhookAttempt::handle(Actor $actor, string $deliveryId): ?array{target: Target|UnsafeTarget, secret: string, url: string}` (Zustellung und Webhook frisch; Zustellung weg, nicht `pending`, Webhook weg → `null`; Webhook aus oder abgeschaltet, Bot nicht mehr aktiv oder ohne Sicht → Zustellung `cancelled`, `null`; sonst das geprüfte Ziel bzw. die `UnsafeTarget`, die als Fehlschlag protokolliert wird).
  - `DeliverWebhook` überschreibt `handle()` (Prepare; `null` → `delete()`; sonst `parent::handle()`), `getWebhookUrl()` (die frische URL), `createRequest()` (Header `X-Werkbuch-Event`, `-Delivery`, `-Timestamp` = `now()->timestamp`, `-Signature` = `Signature::sign`, `User-Agent`; eine `UnsafeTarget` wird hier geworfen und von spatie als Fehlschlag behandelt) und `requestOptions()` (`allow_redirects: false`, `connect_timeout: 5`, `curl: [CURLOPT_RESOLVE => [$target->curlResolve()]]`). Das Geheimnis lebt nur in einer Eigenschaft, die erst in `handle()` gesetzt wird; `release()` stellt den ursprünglich eingestellten Payload neu ein, der es nie enthielt (Test: Zeile in `jobs` nach einem 500).
  - `RecordWebhookCall` (Listener) → `RecordWebhookAttempt::run(Actor::system(defaultBot, 'webhooks'), $deliveryId, ?int $status, int $durationMs, ?string $body, ?string $error, string $kind)`: unter `lockForUpdate` von Webhook (dann Zustellung) eine `webhook_attempts`-Zeile (`attempt` = bisherige + 1), `attempts`, Status der Zustellung (`succeeded`; `failed` erst beim letzten geplanten Versuch); Erfolg → `failing_since` null, `last_success_at`; Fehlschlag eines geplanten Versuchs → `failing_since ??= now()`, dann `DisableRule::disables` → `DisableWebhook::run`.
  - `DisableWebhook::handle(Actor $actor, Webhook $locked): void` (nur, wenn noch aktiv: `active` false, `disabled_at` jetzt, alle `pending`-Zustellungen `cancelled`, Event `webhook.disabled` mit `changes.active`, Subjekt Webhook, `project_id` des Webhooks).
  - `ResponseExcerpt::of(?string $body): ?string` (`MAX_BYTES` 2048, `mb_strcut`, ungültiges UTF-8 per `mb_scrub`); `Redact::text(string $text): string` (in jeder URL Benutzer, Passwort und Query durch `…` ersetzt; erster Satz, höchstens 300 Zeichen).
  - `error` steht nur ohne Antwort: `private_address`, `unresolvable`, `timeout` (cURL 28), `connection` (sonst), je mit `Redact::text` des Fehlers dahinter.
- Consumes: Tasks 1, 2, 4, 6.

- [ ] **Step 1: Failing Tests** — `DeliverWebhookTest` (`Http::fake`, `Http::preventStrayRequests()`, `resolver([...])`, Queue `database` und `queue:work --once --queue=webhooks --sleep=0`): „signs timestamp and body the way the docs verify it“ (Header lesen, `Signature::verify` mit dem Geheimnis aus der Zeile → wahr), „sends the four werkbuch headers and no spatie header“, „sends the same body and delivery id on every attempt with a new timestamp“, „retries on 500 after one minute, then five“ (`travel`, `available_at` der Zeile in `jobs`), „stops after eight attempts and marks the delivery failed“ (nichts in `failed_jobs`), „counts a 302 as a failure and does not follow it“, „records a timeout without a status“, „cuts the answer to 2 KB without breaking a character“, „never logs or stores the secret“ (Log-Kanal `array`, alle Tabellen), „does not send to a name that now points at 127.0.0.1“ (Zeile mit `error` `private_address`, kein HTTP), „cancels when the webhook was switched off, deleted or the bot lost access“, „uses a secret rotated between two attempts“. `DisableWebhookTest` (Uhr gestellt): „keeps a webhook on after 23 h 59 min of failures“, „switches it off at the first failure after 24 hours“ (Event `webhook.disabled`, offene Zustellungen `cancelled`), „starts the clock anew after a success“, „never switches off on a failed ping“ (Kind `ping`, kommt mit Task 9: hier über `RecordWebhookAttempt` direkt). `WebhookDisableRaceTest`: zwei Versuche zweier Zustellungen scheitern gleichzeitig nach 24 h → ein Event, `releaseBeforeLock('webhooks')`.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='DeliverWebhookTest|DisableWebhookTest|RightsMatrixTest'`; Integration gezielt.
- [ ] **Step 3: Gates G1**
- [ ] **Step 4: Commit** — `feat: deliver webhooks signed per attempt, log every attempt and switch failing ones off`.

---

### Task 8: `webhook_disabled` an die Org-Admins

**Modell:** sonnet

**Files:**
- Modify: `app/Support/NotificationFacts.php` (`webhook.disabled` in `TELLING`, `ofWebhook()`), `app/Domain/Notifications/{EventFacts,Recipients}.php` (`orgAdmins`, Regel `webhook.disabled` → `WebhookDisabled`), `app/Actions/Notifications/{NotifyRecipients,SendNotificationMail}.php` (Zeile ohne Projekt; Sammlung `webhook:<id>`), `app/Mail/NotificationDigest.php` + `resources/views/mail/notifications/digest*.blade.php` (Betreff und Link auf `/settings/webhooks?deliveries=<id>`), `tests/Feature/Notifications/{NotifyRecipientsTest,SendNotificationMailTest}.php`, `tests/Unit/Domain/Notifications/RecipientsTest.php`, `lang/{en,de}.json`

**Interfaces:**
- Produces: `NotificationFacts::of` für `webhook.disabled`: ohne Projekt, `orgAdmins` = aktive Personen mit Org-Rolle Admin (eine Abfrage über `RoleIndex`), Actor = Standard-Bot; `data` `{webhook_id, name}`; `inbox` nach Einstellung, Mail standardmäßig aus (`mailByDefault` unverändert), Sammlung `webhook:<webhook_id>`; Betreff `mail.notifications.webhook.subject` („Webhook „:name“ abgeschaltet“).
- Consumes: Task 7; Phase 8 (`NotifyRecipients`, `Notification::visibleTo` für `project_id` null, K5).

- [ ] **Step 1: Failing Tests** — `RecipientsTest`: „tells every org admin of a disabled webhook“, „tells no member“. `NotifyRecipientsTest`: „writes one row per active admin person, no bot, no deactivated admin“, „writes nothing twice for an event that comes twice“, „sends a mail only to admins who switched it on“. `SendNotificationMailTest`: „skips a disabled-webhook mail for a person no longer admin“ (Herabstufen zwischen Sammeln und Senden).
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Notif|Recipients'`.
- [ ] **Step 3: Gates G1**
- [ ] **Step 4: Commit** — `feat: tell org admins when the system switches a webhook off`.

---

### Task 9: Protokoll, Test-Ping, „erneut senden“ (REST)

**Modell:** sonnet

**Files:**
- Create: `app/Actions/Webhooks/{ListWebhookDeliveries,PingWebhook,RedeliverWebhook}.php`, `app/Http/Resources/WebhookDeliveryResource.php`, `tests/Feature/Webhooks/{ListWebhookDeliveriesTest,PingWebhookTest,RedeliverWebhookTest}.php`
- Modify: `app/Http/Controllers/Api/WebhooksController.php` (`deliveries`, `ping`, `redeliver`), `routes/api.php` (`Route::bind('delivery')`, Drossel `webhook-send` in `AppServiceProvider`: 6 je Minute und Konto, 429 als `too_many_requests`), `tests/Feature/Access/matrix.php`, `tests/Feature/Api/{routes.php,WebhooksApiTest.php}`, `CLAUDE.md`

**Interfaces:**
- Produces:
  - `ListWebhookDeliveries::handle(Actor $actor, Webhook $webhook, array $query): ListResult` (Versuche des Webhooks, `attempted_at` roh als `attempted_cursor`, dann `id`, absteigend, mit `delivery:id,event`; feste Abfragezahl).
  - `PingWebhook::handle(Actor $actor, Webhook $webhook): WebhookAttempt` (Recht; Zustellung `event` `ping`, `event_id` null, Body `WebhookPayload::ping` in einer kurzen Transaktion; danach **außerhalb** jeder Transaktion `DeliverWebhook::sendNow($delivery, 'ping')` = derselbe Job mit `maximumTries(1)` über `dispatchSync`; Antwort der protokollierte Versuch).
  - `RedeliverWebhook::handle(Actor $actor, Webhook $webhook, WebhookDelivery $delivery): WebhookAttempt` (Zustellung eines anderen Webhooks → 404; Status zurück auf `pending`, ein Versuch `manual` mit demselben Body und derselben `X-Werkbuch-Delivery`; danach `succeeded` oder `failed`).
  - `WebhookDeliveryResource` wie „REST“.
- Consumes: Tasks 5–7.

- [ ] **Step 1: Failing Tests** — `PingWebhookTest`: „pings and answers the attempt“ (Status, Dauer, Auszug), „answers a failed ping with 200 and the attempt“, „pings an inactive webhook too“, „never switches off and never starts the clock on failure“, „clears failing_since on success“, „sends to no private address“ (Versuch mit `error`), „throttles the seventh ping in a minute“, „never sends inside a transaction“ (`DB::transactionLevel()` im `Http::fake`-Callback = 0). `RedeliverWebhookTest`: gleiche `X-Werkbuch-Delivery` und gleicher Body, neuer Zeitstempel, Versuchsnummer läuft weiter; fremde Zustellung 404. `ListWebhookDeliveriesTest`: neueste zuerst, zwei Versuche in derselben Sekunde, Cursor, gleiche Abfragezahl für 5 und 50.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Webhook|RightsMatrixTest|RouteMatrixTest'`.
- [ ] **Step 3: Gates G1**
- [ ] **Step 4: Commit** — `feat: list webhook attempts, ping a webhook and send a delivery again`.

---

### Task 10: `bot.assigned`, Aufräumen, Betrieb

**Modell:** sonnet

**Files:**
- Create: `app/Actions/Webhooks/PruneWebhookDeliveries.php`, `app/Jobs/PruneWebhookDeliveriesJob.php`, `tests/Feature/Webhooks/{BotAssignedTest,PruneWebhookDeliveriesTest}.php`
- Modify: `app/Actions/WorkItems/{UpdateWorkItem,CreateWorkItem}.php` (`announceAssignedBot`), `routes/console.php` (Prune stündlich, `withoutOverlapping(60)`), `app/Actions/System/GetSystemStatus.php` (Fehlerzeilen über `Redact::text`, T11-M7), `tests/Feature/System/GetSystemStatusTest.php`, `.github/workflows/tests.yml` (erster e2e-Worker mit `webhooks`, `E2E_WEBHOOK_HOST=127.0.0.1`), `e2e/ci.env` (`WEBHOOKS_ALLOW_PRIVATE=true`), `.ddev/config.yaml` (`web_environment: WEBHOOKS_ALLOW_PRIVATE=true`, A373), `tests/Feature/ConfigTest.php`, `tests/Feature/Access/matrix.php` (`PruneWebhookDeliveries` `system`; `'events'` der Zeilen, die einen Bot zuweisen), `CLAUDE.md`

**Interfaces:**
- Produces:
  - `UpdateWorkItem::announceAssignedBot(Actor $actor, WorkItem $item): void` (öffentlich statisch wie `announceBots`): nach `work_item.assigned`, wenn der neue Assignee ein Bot ist und nicht der Actor selbst (A371), `bot.assigned` mit Subjekt Item, `meta.bot_id`; gerufen aus `UpdateWorkItem::apply` (deckt Mehrfachbearbeitung) und `CreateWorkItem` (deckt Vorlagen).
  - `PruneWebhookDeliveries::handle(Actor $actor): int` (Zustellungen nicht `pending` mit `updated_at` älter als 30 Tage samt Versuchen, in Blöcken zu 500).
- Consumes: Tasks 2, 7.

- [ ] **Step 1: Failing Tests** — `BotAssignedTest`: „records bot.assigned when a bot becomes the assignee“ (Patch, Anlegen, Bulk, Vorlage), „not for a person“, „not when the bot assigns itself“, „not when the same bot stays“. `PruneWebhookDeliveriesTest`: 30 Tage − 1 s bleibt, 30 Tage geht samt Versuchen, `pending` bleibt. `GetSystemStatusTest`: „masks the query and the user of a URL in a failed job“. `ConfigTest`: CI-Worker hören `webhooks`, DDEV erlaubt private Ziele, `phpunit.xml` zwingt sie aus.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='BotAssignedTest|PruneWebhook|GetSystemStatusTest|ConfigTest|RightsMatrixTest'`.
- [ ] **Step 3: Gates G1** und `ddev restart` (Daemon-Umgebung).
- [ ] **Step 4: Commit** — `feat: announce bot.assigned, prune the webhook log and hear the queue webhooks in e2e`.

---

### Task 11: Demo-Daten, e2e-Helfer, Empfänger

**Modell:** sonnet

**Files:**
- Create: `database/seeders/Demo/WebhooksSeeder.php`, `tests/Feature/Seeders/WebhooksSeederTest.php`, `e2e/webhookReceiver.ts`
- Modify: `database/seeders/DemoSeeder.php` (vor `NotificationsSeeder`), `database/seeders/Demo/NotificationsSeeder.php` (`n_10` mit `webhook_id` und `name` von „Altes CRM“), `tests/Feature/Seeders/NotificationsSeederTest.php`, `database/seeders/E2eSeeder.php` (Webhooks mit Namen `E2E ` über `DeleteWebhook` mit `Actor::automation('e2e_reset')`), `e2e/helpers.ts` (`createE2eWebhook`, `removeE2eWebhook`), `CLAUDE.md`

**Interfaces:**
- Produces:
  - `WebhooksSeeder`: „Deploy-Bot“, „Kira“ (Bot Kira, `bot.*`), „Altes CRM“ (APP, aus, `disabled_at` 2026-10-22 08:00:30 UTC) mit den 18 Versuchen aus `seed/inbox.ts` (Zeiten über `ItemsSeeder::at()` bzw. die UTC-Stempel, je Ereignis eine Zustellung, `body` `{}`), Geheimnis je Lauf neu; legt nur fehlende Namen an (wie K13); ohne Events.
  - `startReceiver({ status?: number | ((n: number) => number) }): Promise<{ url: string; requests: ReceivedRequest[]; close(): Promise<void> }>` (`node:http` auf `0.0.0.0`, Port 0; `url` = `http://${process.env.E2E_WEBHOOK_HOST ?? 'host.docker.internal'}:<port>/hook`; `ReceivedRequest` `{headers, body}` mit rohem Body).
  - `createE2eWebhook(page, { name, url, events, project_id?, bot_id? }): Promise<{ id: string; secret: string }>`, `removeE2eWebhook(page, id)` (204 oder 404).
- Consumes: Tasks 2, 3.

- [ ] **Step 1: Failing Tests** — `WebhooksSeederTest` liest `webhooks` und `webhookDeliveries` aus `inbox.ts` (Namen, URL, Ereignisse, Bot, Zustand, Zahl, Status, Versuchsnummer und Zeit je Versuch); „runs twice without change“. `NotificationsSeederTest`: `n_10` nennt den Webhook.
- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='Seeder'`; `ddev artisan migrate:fresh --seed --seeder=DemoSeeder`.
- [ ] **Step 3: Gates G1**
- [ ] **Step 4: Commit** — `feat: seed the demo webhooks and add a local receiver for e2e`.

---

### Task 12: Datenschicht im Browser

**Modell:** sonnet

**Files:**
- Create: `resources/js/api/webhooks.ts`, `resources/js/hooks/webhooks.ts`, `resources/js/api/webhooks.test.ts`, `resources/js/hooks/webhooks.test.tsx`
- Modify: `resources/js/types.ts` (`Webhook` + `failing_since`, `last_success_at`, `created_by`, `updated_at`; `WebhookDelivery` + `delivery_id`, `kind`; `WebhookSaved.secret`), `resources/js/test/fixtures.ts` (`makeWebhook`, `makeDelivery`, `demoWebhooks`), `CLAUDE.md` („Frontend-Datenschicht“)

**Interfaces:**
- Produces: `listWebhooks(args?)` (alle Seiten über `allPages`), `saveWebhook(input: WebhookInput): Promise<WebhookSaved>` (ohne `id` `POST`, mit `PUT`, die `id` nie im Body; `PUT` antwortet `secret: null`), `rotateWebhookSecret(id): Promise<WebhookSaved>`, `deleteWebhook(id)`, `listDeliveries(webhook_id, args?)` (`getPage`), `pingWebhook(webhook_id): Promise<WebhookDelivery>`, `redeliver(webhook_id, delivery_id): Promise<WebhookDelivery>`; Hooks `useWebhooks()`, `useSaveWebhook()` und `useRotateWebhookSecret()` (`gcTime: 0`, das Geheimnis bleibt nicht im Cache), `useDeleteWebhook()` (`webhooks`, `deliveries`), `useDeliveries(webhookId)`, `usePingWebhook()`, `useRedeliver()` (`deliveries`, `webhooks`: `failing_since` und Zustand ändern sich).
- Consumes: Tasks 3, 9.

- [ ] **Step 1: Failing Tests** mit `mockApi`: Pfade, Bodies, `{data, secret}` entpackt, 403 als `ApiError`, Geheimnis nach `reset()` nicht mehr in `getMutationCache()`.
- [ ] **Step 2: Rot, implementieren, grün; G2**
- [ ] **Step 3: Commit** — `feat: add the webhook API and hooks to the browser`.

---

### Task 13: Abschnitt „Webhooks“: Liste, Formular, Geheimnis

**Modell:** opus

**Files:**
- Create: `resources/js/features/settings/org/webhooks/{Webhooks.tsx,WebhookList.tsx,WebhookCard.tsx,WebhookDialog.tsx,EventTree.tsx,events.ts,catalog.ts,SecretDialog.tsx,webhooks.test.tsx,events.test.ts}`
- Modify: `resources/js/features/settings/org/{sections.ts,OrgSettings.tsx}` (Abschnitt `webhooks` in `operations` vor `system`, `org.manage`, `members: 'blocked'`, Icon `Webhook`), `vitest.config.ts` (Schwelle), `lang/{en,de}.json`, `CLAUDE.md`

**Interfaces:**
- Produces: `Webhooks({ readOnlyReason })` (`?deliveries=<id>` zeigt `WebhookDeliveries`, Task 14); Karten wie der Klickdummy (Zustand `Aktiv`/`Aus`/`Abgeschaltet`, URL `translate="no"`, Geltungsbereich, drei Ereignisse und „+N weitere“, Bot, Angelegt); `WebhookDialog` (`FormDialog`, ⌘↵ einmal je Druck; Name, URL mit Hinweis, Geltungsbereich (`Select` mit Projekten `include_archived`, Organisation zuerst), „Nur für einen Bot“ (aktive Bots), `EventTree` (Gruppe = `gruppe.*`, gemischt `indeterminate`; Liste aus `catalog.ts`, gleich `EventType::webhook()` per `?raw`-Test gegen `app/Events/EventType.php`), „Aktiv“; 422 je Feld mit Fokus, andere als Banner, 5xx Toast mit „Erneut versuchen“); „Neues Geheimnis erzeugen“ steht neben dem Formular als eigene Aktion mit `AlertDialog` und ruft nur `rotateWebhookSecret` (der Formularentwurf bleibt, 13c); `SecretDialog` auf `Dialog` mit `confirmClose` (Escape und Klick daneben schließen nicht, 13c), `CopyField`, das Geheimnis nur im State, nach dem Schließen weg; Löschen über `useRemoval` mit Rückgängig; leer `EmptyState`; Members „Nur für Admins“.
- Consumes: Task 12; `features/settings/frame/*`, `components/ui/{Dialog,FormDialog,CopyField,AlertDialog,Select,Switch,Checkbox}`.

- [ ] **Step 1: Failing Tests** (`mockApi`): Anlegen mit Tastatur zeigt das Geheimnis einmal, Kopieren, Escape schließt nicht; Bearbeiten ohne Geheimnis; Erneuern behält getippte Änderungen im offenen Formular; `EventTree` speichert `work_item.*` für eine ganze Gruppe und Einzelnamen sonst (Port von `events.ts` mit Tests); 422 an `url` (`field.url.private`) am Feld; Member sieht den Hinweis und lädt nichts; Löschen mit ⌘Z; Katalog gleich dem Server.
- [ ] **Step 2: Rot, implementieren, grün; G2**
- [ ] **Step 3: Commit** — `feat: port the webhook settings with a secret shown once`.

---

### Task 14: Zustellprotokoll, Ping, erneut senden, Inbox-Link

**Modell:** sonnet

**Files:**
- Create: `resources/js/features/settings/org/webhooks/{WebhookDeliveries.tsx,webhookParts.tsx,deliveries.test.tsx}`
- Modify: `resources/js/features/inbox/NotificationRow.tsx` (`hrefOf` für `webhook_disabled` → `paths.webhookDeliveries(webhook_id)`, ohne ID `paths.settings('webhooks')`; Satz mit Namen aus `data.name`), `resources/js/lib/links.ts` (`webhookDeliveries(id)` = `/settings/webhooks?deliveries=<id>`), `resources/js/features/inbox/{notifications.test.ts,inbox.test.tsx}`, `lang/{en,de}.json`

**Interfaces:**
- Produces: `WebhookDeliveries({ webhookId })` (Kopf „Zustellungen von :name“ mit Link „Alle Webhooks“, Test-Ping; `DisabledNotice` mit „Wieder aktivieren“ = `saveWebhook` mit `active: true`; Liste der Versuche mit Ereignisname über `webhooks.event.*`, Zeit in der Zone der Organisation, „Versuch :n“, Status-Badge (`Keine Antwort`, Code), Dauer (`formatDuration` mit `intlLocale()`), Auszug bzw. Fehler, „Erneut senden“ je Zeile mit Namen für Screenreader; alle Seiten per „Mehr laden“; leer mit „Test-Ping senden“; unbekannte ID „Diesen Webhook gibt es nicht“); `toastDelivery(subject, webhook, attempt)`.
- Consumes: Tasks 12, 13.

- [ ] **Step 1: Failing Tests**: Ping-Toast „angekommen“/„fehlgeschlagen“ mit Code und Dauer; erneut senden zeigt den neuen Versuch oben; „Wieder aktivieren“ nimmt den Hinweis weg; Inbox-Zeile `webhook_disabled` führt zum Protokoll des Webhooks; Trennlinien nicht abgeschnitten (13c, Klasse statt fester Breite).
- [ ] **Step 2: Rot, implementieren, grün; G2**
- [ ] **Step 3: Commit** — `feat: show the webhook log with test ping and send again`.

---

### Task 15: e2e: Einstellungen per Tastatur

**Modell:** sonnet

**Files:**
- Create: `e2e/tests/webhooks.spec.ts`

**Interfaces:**
- Produces: „creates a webhook with the keyboard, copies its secret once and pings the receiver“ (Erik, `startReceiver()`, Anlegen über Tab/Pfeile, Geheimnis aus `CopyField` per Zwischenablage, Ping → Toast „angekommen“, Empfänger hat eine Anfrage mit gültiger Signatur), „renews the secret without losing the form“, „shows a switched-off webhook in the inbox and turns it on again“ (`artisanEval` setzt `failing_since` des eigenen Webhooks auf vor 25 h und den Empfänger auf 500; ein Ereignis → `waitForNotification` bei Erik (Org-Admin; nur lesen, A289), Klick auf die Inbox-Zeile führt zum Protokoll, „Wieder aktivieren“), am Handy: Liste lesbar, Ping per Tippen.
- Consumes: Tasks 11, 13, 14.

- [ ] **Step 1: Spec schreiben, gezielt laufen lassen** — `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test webhooks inbox` (`inbox` wegen `hrefOf`).
- [ ] **Step 2: Gates G1, G2, G3 gezielt**
- [ ] **Step 3: Commit** — `test: manage webhooks with the keyboard end to end`.

---

### Task 16: Abnahme: Erfolgskriterium 2.5 und Agent-Szenario

**Modell:** opus

**Files:**
- Create: `tests/Feature/Api/WebhooksAcceptanceTest.php`, `e2e/tests/webhooks-acceptance.spec.ts`, `docs/snippets/webhooks/{verify.mjs,verify.php,verify.py}` (Form siehe Task 17, „Snippets“; Task 17 testet und bindet sie ein)
- Modify: `CLAUDE.md` (e2e)

**Interfaces:**
- Produces:
  - `WebhooksAcceptanceTest` (REST, `consumers(WebhookConsumer::class)`, Queue `database`, `Http::fake`, `resolver`): ein Org-Admin-Token legt einen Webhook mit Bot Kira und `bot.*` an; ein Member weist Kira ein Item zu → genau eine Zustellung `bot.assigned`, Body mit `data.item.key`, `actor`, `project.identifier`, kein `meta`; die Signatur prüft `docs/snippets/webhooks/verify.php` (eingebunden, Funktion aufgerufen); ein Kommentar mit `@kira` → `bot.mentioned` mit `comment`; Kira aus dem privaten Projekt entfernt → nächstes Ereignis keine Zustellung; ein Projekt-Webhook eines anderen Projekts bekommt nichts; zweimaliges Verteilen → eine Zustellung.
  - `webhooks-acceptance.spec.ts`: „Erfolgskriterium 2.5: a webhook arrives signed“ (eigenes Projekt, `startReceiver()`, `createE2eWebhook` für `work_item.*` des Projekts, Status per UI ändern → `expect.poll` am Empfänger: genau eine Anfrage `work_item.state_changed`, Signatur geprüft mit `docs/snippets/webhooks/verify.mjs` (importiert), Body `data.key` = Key, `changes.state_id`; Protokoll in der UI zeigt den Versuch mit 200); „a bot assignment reaches the agent“ (Webhook mit Bot, Item per Palette dem Bot zuweisen → `bot.assigned` am Empfänger).
- Consumes: alles Vorige.

- [ ] **Step 1: Snippets anlegen, Tests schreiben, laufen lassen** — `ddev artisan test --filter=WebhooksAcceptanceTest`; `E2E_COVERAGE=0 pnpm --dir e2e exec playwright test webhooks-acceptance`.
- [ ] **Step 2: Gates G1, G3 gezielt** (`webhooks-acceptance webhooks inbox items`)
- [ ] **Step 3: Commit** — `test: accept signed webhooks and the bot scenario end to end`.

---

### Task 17: Doku, `CLAUDE.md`, Rulings, Spec

**Modell:** opus

**Files:**
- Create: `docs/{en,de}/webhooks.md`, `tests/Feature/Docs/WebhookSnippetsTest.php`, `scripts/webhook-snippets.test.mjs`
- Modify: `docs/.vitepress/config.ts`, `docs/{en,de}/concepts/{notifications,permissions,bots}.md` (abgeschalteter Webhook, Recht, `bot.assigned`), `docs/{en,de}/development.md` (Empfänger in e2e, `WEBHOOKS_ALLOW_PRIVATE` in DDEV), `CLAUDE.md`, `README.md` (Status), `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md`, `docs/superpowers/specs/2026-10-28-werkbuch-design.md`, `docs/superpowers/plans/2026-10-30-werkbuch-app.md`

**Interfaces:**
- Produces:
  - **Snippets:** je Sprache eine Funktion `verify(secret, timestamp, body, signatureHeader, now?) → bool` (Node `node:crypto` `timingSafeEqual`, PHP `hash_equals`, Python `hmac.compare_digest`), Toleranz 300 s, Body roh (vor JSON-Parsen). `WebhookSnippetsTest` ruft `verify.php` mit einer Signatur aus `Signature::sign` (wahr) und einem veränderten Body (falsch), und `python3 verify.py` per `Process` (fehlt `python3`, `markTestSkipped` mit Grund; die CI hat es); `scripts/webhook-snippets.test.mjs` (Vitest) dasselbe für `verify.mjs` mit dem Vektor aus `SignatureTest`.
  - `webhooks.md` (en + de, gleiche Überschriften, `DocsTest`): Einrichten (Rechte, Geltungsbereich, Bot-Filter, aktiv), Ereignisse (Tabelle aus `EventType::webhook()`; ein Test vergleicht die Tabelle mit dem Enum), Payload mit Beispiel und `data` je Ereignis, Header, Signatur prüfen (`<<< @/snippets/webhooks/verify.mjs` usw.), Wiederholungen (Plan, 2xx, keine Weiterleitungen, gleiche `X-Werkbuch-Delivery`: Empfänger deduplizieren, Reihenfolge nicht garantiert), Abschalten und Wiederaktivieren, Protokoll (30 Tage, 2 KB), Test-Ping und erneut senden, SSRF und `WEBHOOKS_ALLOW_PRIVATE`, REST mit `curl`, Agent-Szenario (`bot.assigned` → MCP folgt in Phase 13).
  - `CLAUDE.md`: „Stand“ (Phase 11 umgesetzt, als Nächstes Phase 12), Architektur „Webhooks: Konsument, Zustellung, Ziel, Payload“, Kommandos, Fallstricke (Empfänger in e2e und macOS-Firewall; `Http::fake` umgeht `CURLOPT_RESOLVE`, nur `WebhookTargetTest` prüft die echte Verbindung; Geheimnis nie in Tests ausgeben).
  - Rulings `A361`–`A376` (Liste unten, Anpassungen aus der Umsetzung); „Für spätere Phasen vorgemerkt“: Zeile Phase 11 entfernen; Phase 13 (MCP-Tools `webhooks`/`manage-webhooks` mit `ping`, `redeliver`, `rotate-secret`; das Geheimnis nur in der Antwort des Tools), Phase 14 (Worker auf `webhooks` im Image; `PruneWebhookDeliveriesJob` im Scheduler-Container; Betriebsdoku: ausgehende Verbindungen, `WEBHOOKS_ALLOW_PRIVATE`), Phase 15 (Last: 50 Webhooks × Bulk von 100 Items; Payload-Größe bei großen Beschreibungen; Reihenfolge je Item).
  - Spec „Änderungen vom <Tag> (Phase 11)“ zur Bestätigung: A361, A362, A364, A365, A366, A367, A370, A371.
- [ ] **Step 1: Seiten und Tests** — `ddev artisan test --filter='DocsTest|WebhookSnippetsTest'`; `ddev exec pnpm vitest run scripts/webhook-snippets.test.mjs`; `ddev exec pnpm --dir docs build` → ohne tote Links.
- [ ] **Step 2: Abnahme der Phase** (ohne vollen G3)

```bash
ddev artisan migrate:fresh --seed --seeder=DemoSeeder
ddev restart
ddev artisan test --coverage --min=100
ddev artisan test --testsuite=Integration
ddev exec vendor/bin/phpstan analyse --memory-limit=1G && ddev exec vendor/bin/pint --test
ddev exec pnpm typecheck && ddev exec pnpm test:coverage
ddev exec pnpm build
E2E_COVERAGE=0 pnpm --dir e2e exec playwright test webhooks-acceptance webhooks inbox items
ddev exec pnpm --dir docs build
```

Expected: alles grün. Von Hand: `/settings/webhooks` als Erik → drei Webhooks, „Altes CRM“ abgeschaltet mit Hinweis; Protokoll von „Altes CRM“ zeigt acht Versuche über 24 Stunden; Maras Inbox-Zeile `webhook_disabled` (als Org-Admin Erik nachgestellt) führt dorthin; ein Webhook auf `http://127.0.0.1/` wird mit dem Satz zu privaten Netzen abgelehnt, solange `WEBHOOKS_ALLOW_PRIVATE` aus ist.

- [ ] **Step 3: Commit** — `docs: add webhooks, update CLAUDE.md, the rulings and the spec for phase 11`.

**Danach (Orchestrator):** Final-Review (opus, ganze Phase) und **parallel im Hintergrund der volle G3**; beide Ergebnisse gehen in die eine finale Fix-Welle.

---

## Vorschläge für neue Rulings (ab A361)

- **A361 · Drei Tabellen statt zwei:** `webhook_deliveries` ist eine Zustellung (Ereignis × Webhook bzw. Ping, eindeutig `(event_id, webhook_id)`, Body-Schnappschuss, ULID = `X-Werkbuch-Delivery`), `webhook_attempts` das Protokoll je Versuch. Die API liefert unter `…/deliveries` die Versuche in der Form `WebhookDelivery` des Klickdummys, ergänzt um `delivery_id` und `kind`. *Grund:* Spec 7.4 legt Versuchsfelder in `webhook_deliveries`; die Dedupe-Zeile (A39) und der wiederholte Body brauchen eine Zeile je Zustellung, das Protokoll eine je Versuch. *Falls falsch:* eine Tabelle mit einer Zeile je Versuch und Body in jeder Zeile.
- **A362 · Die Payload entsteht beim Konsum und bleibt.** `data` ist der Stand der Ressource Sekunden nach dem Ereignis (nicht exakt zum Ereigniszeitpunkt); `changes` sind die des Events; der Body wird einmal gespeichert und von allen Versuchen und „erneut senden“ unverändert geschickt; Zeitstempel und Signatur sind je Versuch neu. Ein inzwischen gelöschtes Subjekt ergibt `data: null`; Löschereignisse haben eine feste kleine Form aus `meta`; `meta` geht nie hinaus. *Grund:* Wiederholungen über 24 Stunden dürfen den Inhalt nicht wechseln (Empfänger deduplizieren über die Delivery-ID), und ein Bild der Ressource zur Ereigniszeit gibt es ohne Versionen nicht. *Falls falsch:* Payload je Versuch neu bauen (aktueller Stand, andere Bytes je Versuch).
- **A363 · Der Leser der Payload ist der Bot des Filters, sonst der Standard-Bot.** Kontobezogene Felder (`my_role`, `is_member`, `subscribed`) und verborgene Enden von Relationen und Verweisen gelten für ihn; Org- und Projekt-Webhooks ohne Bot sehen wie ein Org-Admin (sie richten nur Org-Admins ein). *Grund:* Resources kennen keinen Leser (A131), ein Webhook braucht einen; der Bot-Filter ist der Weg, einem Agenten nur seine Sicht zu geben. *Falls falsch:* Leser = wer den Webhook anlegte.
- **A364 · Bot-Filter:** ein Webhook mit Bot bekommt `bot.mentioned`/`bot.assigned` dieses Bots und `work_item.*`/`comment.*` von Items, denen der Bot beim Konsum zugewiesen ist, und nur, solange der Bot aktiv ist und das Projekt sieht (beim Konsum und vor jedem Versuch, sonst `cancelled`). *Grund:* Spec 6.3 „nur für einen bestimmten Bot“, Agent-Szenario 6.2 (der Agent braucht die Kommentare seiner Items), Review Focus 3 des Master-Plans. *Falls falsch:* nur `bot.*`.
- **A365 · Wiederholplan:** acht Versuche zu festen Zeiten nach dem ersten (0, 1 min, 6 min, 36 min, 2 h 36 min, 8 h 36 min, 20 h 36 min, 24 h), ohne Jitter, ohne `Retry-After`; nur 2xx ist Erfolg, 3xx wird nicht verfolgt; ein Absturz zwischen Senden und Protokoll kann einen Versuch doppelt senden (gleiche Delivery-ID). *Grund:* Spec 6.3 „8 Versuche über etwa 24 Stunden“, die Zeiten der Demo-Daten des Klickdummys; der letzte Versuch fällt so genau auf die 24-Stunden-Grenze des Abschaltens. *Falls falsch:* spatie `ExponentialBackoffStrategy` mit Grenze.
- **A366 · Abschalten über `failing_since`:** der erste Fehlschlag eines geplanten Versuchs nach einem Erfolg setzt den Zeitpunkt, jeder Erfolg (auch Ping, „erneut senden“) leert ihn; ein Fehlschlag mit `failing_since` ≤ jetzt − 24 h schaltet ab (`active` false, `disabled_at`), einmal, mit Event `webhook.disabled` (ohne Webhook) und `webhook_disabled` an alle aktiven Org-Admin-Personen (Mail standardmäßig aus, Sammlung `webhook:<id>`); offene Zustellungen werden `cancelled`; Wiederaktivieren holt nichts nach. Ein gescheiterter Ping oder ein gescheitertes „erneut senden“ zählt nicht. *Grund:* Spec 6.3 meint den Webhook, nicht eine Zustellung; ein Test-Ping gegen einen noch nicht laufenden Empfänger darf nichts abschalten. *Falls falsch:* Abschalten, wenn eine Zustellung alle acht Versuche verbraucht.
- **A367 · Test-Ping und „erneut senden“ synchron:** ein Versuch in der Anfrage (10 s, außerhalb jeder Transaktion, gleiche Prüfungen und Signatur), Antwort 200 mit dem protokollierten Versuch, auch wenn er scheiterte; Drossel 6 je Minute und Konto; „erneut senden“ schickt denselben Body mit derselben Delivery-ID, auch an einen abgeschalteten Webhook. *Grund:* der Klickdummy sagt im Toast sofort, was der Empfänger antwortete; ein Test, der erst im Protokoll steht, ist für die Einrichtung zu langsam. *Falls falsch:* `202` und das Protokoll lädt nach.
- **A368 · SSRF:** gesperrt sind die Netze aus `App\Domain\Webhooks\Addresses` (privat, Loopback, Link-local, CGNAT, Dokumentation, Benchmark, Multicast, reserviert; IPv6 ULA, Link-local, Multicast, Loopback; eingebettetes IPv4 in v4-mapped, NAT64 und 6to4 wird geprüft). Vor jedem Versuch werden alle A- und AAAA-Adressen geprüft, eine gesperrte genügt zur Ablehnung; die Anfrage geht per `CURLOPT_RESOLVE` an die erste geprüfte Adresse. Beim Speichern prüft der Server nur Form, Zugangsdaten (422) und IP-Literale bzw. `localhost` (DNS kann sich bis zum Versand ändern, und ein Name ohne Eintrag ist beim Einrichten erlaubt). *Grund:* Spec 6.3 „nach der DNS-Auflösung; die Anfrage geht an die geprüfte IP“; DNS-Rebinding und Weiterleitungen sind die üblichen Umgehungen. *Falls falsch:* zusätzlich beim Speichern auflösen und ablehnen.
- **A369 · Geheimnis:** `whsec_` + 43 Zeichen base64url (32 Zufallsbytes), HMAC-Schlüssel ist der ganze Text; verschlüsselt mit `APP_KEY`, Klartext nur in den Antworten von Anlegen und `rotate-secret`; jeder Versuch liest es frisch (ein erneuertes gilt sofort, auch für laufende Wiederholungen), kein Übergangsfenster mit zwei Geheimnissen. Im Browser ist „Neues Geheimnis erzeugen“ ein eigener Aufruf (`rotateWebhookSecret`), unabhängig vom Formular (13c „renew drops form edits“). *Grund:* Spec 6.3/7.5; ein Geheimnis im Job-Payload stünde im Klartext in `jobs`. *Falls falsch:* zwei gültige Geheimnisse für 24 Stunden nach dem Erneuern.
- **A370 · Projekt-Webhooks enden mit dem Projekt:** sie gehen per Kaskade mit `PurgeProject`; Ereignisse eines Projekts in Löschung erreichen keinen Projekt-Webhook, `project.deleted` nur Org-Webhooks. *Grund:* der Konsument (`webhooks`) und `PurgeProject` (`bulk`) laufen unabhängig; ohne Regel hinge die Zustellung am Zufall. *Falls falsch:* `PurgeProject` wartet, bis die Zustellungen des Projekts erledigt sind.
- **A371 · `bot.assigned`** entsteht, wenn ein Bot neuer Assignee wird (Anlegen, Ändern, Mehrfachbearbeitung, Vorlage), nach `work_item.assigned`, Subjekt Item, `meta.bot_id`; nicht, wenn der Bot sich selbst zuweist (wie A259). *Grund:* Spec 4.2; ein Agent, der sich selbst nimmt, braucht keinen Weckruf und erzeugte sonst Schleifen. *Falls falsch:* auch bei Selbstzuweisung.
- **A372 · Rechte und Events der Webhooks:** lesen und verwalten nur `org.manage` (Org-Admins, Standard-Bot per Token), Members 403 `webhooks_admins_only`; Events `webhook.created|updated|deleted|secret_rotated|disabled` ohne Webhook und ohne Live-Nachricht (A280), `changes` nie mit dem Geheimnis. *Grund:* Spec 4.3; ein Webhook, der Webhook-Änderungen meldet, wäre eine Schleife für Integrationen. *Falls falsch:* `webhook.*` mit Webhook.
- **A373 · Lokaler Empfänger in e2e:** der Test startet ihn selbst (`node:http`, Port 0) unter `E2E_WEBHOOK_HOST` (DDEV `host.docker.internal`, CI `127.0.0.1`); `WEBHOOKS_ALLOW_PRIVATE=true` nur in `.ddev/config.yaml` (`web_environment`) und `e2e/ci.env`, `phpunit.xml` zwingt es aus. *Grund:* Spec 9 „Webhooks gegen einen lokalen Empfänger“; ein eigener Dienst wäre in DDEV und CI doppelt zu pflegen. *Falls falsch:* ein Empfänger-Container in DDEV und ein Service in der CI.
- **A374 · Beispielcode der Signaturprüfung ist getesteter Code:** `docs/snippets/webhooks/verify.{mjs,php,py}`, VitePress bindet die Dateien ein, Pest (PHP, Python) und Vitest (Node) führen sie gegen `Signature::sign` aus; die e2e-Abnahme prüft mit dem Node-Snippet. *Grund:* Master-Plan Phase 11 „Signatur gegen Beispielcode der Doku“. *Falls falsch:* Code nur in Markdown, Tests mit eigener Kopie.
- **A375 · Protokoll:** Antwort auf 2048 Bytes gekürzt (UTF-8-sicher), `error` nur ohne Antwort (Code und maskierter erster Satz, höchstens 300 Zeichen), Zustellungen samt Versuchen 30 Tage nach ihrer letzten Änderung gelöscht (stündlicher Job); Fehlertexte der System-Seite maskieren Benutzer, Passwort und Query jeder URL (T11-M7). *Grund:* Spec 6.3; eine URL mit Token in der Query stünde sonst im Protokoll und auf der System-Seite. *Falls falsch:* Fehler ungekürzt, Aufräumen täglich um 03:00.
- **A376 · Keine Webhooks für Kataloge, Vorlagen-Verwaltung und Automatisierungen in v1:** die Vormerkung „Feed oder Webhook für Katalog-Events filtert `meta.projects`/`meta.types`“ entfällt, solange A62 und A346 gelten. *Grund:* Spec 6.3 nennt sie nicht. *Falls falsch:* Gruppe `catalog` mit Filter der Projektlisten über `Visibility`.

## Entscheidungen dieses Phasenplans (ohne eigenes Ruling)

- **P1** Webhook-Namen sind nicht eindeutig; höchstens 120 Zeichen; URL höchstens 2048.
- **P2** Ein Webhook ohne passendes Ereignis bekommt nichts; die Reihenfolge der Zustellungen ist nicht garantiert (Doku).
- **P3** `X-Werkbuch-Delivery` des Pings ist die ID seiner Zustellung, `id` im Body ebenso (es gibt kein Event).
- **P4** `failed` heißt: alle acht geplanten Versuche gescheitert; `cancelled`: der Webhook ging aus oder der Bot verlor die Sicht.
- **P5** Die Liste der Webhooks zählt keine Zustellungen je Zeile (Abfragen je Webhook); Zustand und `failing_since` genügen.
- **P6** Die UI zeigt den Katalog der Ereignisse aus einer festen Liste (`catalog.ts`), ein Vitest hält sie gegen `EventType.php`; ein eigener Endpunkt entfällt.

## Nicht in Phase 11 (vorgemerkt in Task 17)

- Phase 13: MCP-Tools `webhooks`/`manage-webhooks` über dieselben Actions.
- Phase 14: Worker auf `webhooks` und `PruneWebhookDeliveriesJob` im Image; Betriebsdoku zu ausgehenden Verbindungen.
- Phase 15: Last mit vielen Webhooks je Ereignis und großen Payloads; Reihenfolge je Item.
