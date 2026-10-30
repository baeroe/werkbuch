# werkbuch App Implementation Plan (Master)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die echte werkbuch-App nach der Spec bauen: Laravel-Backend mit Actions und Outbox, die Oberfläche des Klickdummys auf echter REST-API, dazu MCP, Webhooks, Live-Updates, Suche, Docker-Image und zweisprachige VitePress-Doku, bis v0.1.0 freigegeben werden kann.

**Architecture:** Laravel 13 im Repo-Root. Jeder Anwendungsfall ist eine Action in `app/Actions/<Bereich>/`, reine Regeln liegen ohne Laravel in `app/Domain/`. Jede schreibende Action legt in ihrer Transaktion Events in `events` an (History und Outbox); nach dem Commit verteilen Queue-Jobs sie an Benachrichtigungen, Webhooks, Suche, Live und Automatisierungen. UI (Inertia-Seiten mit TanStack Query auf `/api/v1`), REST und MCP sind dünne Schichten über denselben Actions und denselben Resources. Das Frontend ist ein Port des Klickdummys: `src/api/*` wird durch HTTP-Aufrufe mit denselben Namen und Typen ersetzt, Hooks und Komponenten bleiben.

**Tech Stack:** PHP 8.4, Laravel 13, MariaDB 11.4, Inertia v3, laravel/fortify, laravel/sanctum, laravel/mcp, laravel/reverb, laravel/scout + Meilisearch v1, lorisleiva/laravel-actions, spatie/laravel-permission (Teams), spatie/laravel-medialibrary, spatie/laravel-query-builder v7, spatie/laravel-webhook-server, dedoc/scramble, ueberdosis/tiptap-php, league/commonmark, league/html-to-markdown; React 19, TypeScript, Tailwind 4, Vite, Base UI, Tiptap 3.32, TanStack Query und Virtual, Zustand, dnd-kit, Laravel Echo, Lucide, fontsource; Pest 5, Larastan (Level 8), Pint, Vitest, Playwright, Istanbul; DDEV, Docker (serversideup/php 8.4 fpm-nginx), VitePress.

**Spec:** `docs/superpowers/specs/2026-10-28-werkbuch-design.md` (bindend, inklusive „Änderungen vom …“). Dazu `prototypes/clickdummy/DESIGN.md` (Gestaltung, bindend), `prototypes/clickdummy/README.md` („Abweichungen von der Spec“, „Wo die echte API andockt“, „Bekannte Punkte“), `docs/superpowers/plans/2026-10-28-werkbuch-clickdummy-rulings.md` und `docs/superpowers/plans/2026-10-28-werkbuch-clickdummy-deferred.md`. Vorbild für Aufbau, Betrieb und Tests ist `~/development/baeroe/openbill` (dort `CLAUDE.md`, `Dockerfile`, `docker/`, `.ddev/`, `.github/workflows/`, `tests/Pest.php`, `e2e/`).

## Wie dieser Plan ausgeführt wird

Dieser Master-Plan legt Phasen, Verträge zwischen den Phasen und die Abnahme fest. **Je Phase** läuft (wie in openbill):

1. **Planungs-Agent** schreibt `docs/superpowers/plans/2026-10-30-phase-NN-<name>.md` im Format von superpowers:writing-plans (Tasks mit Tests, Signaturen, Werten aus der Spec), gegen den aktuellen Stand von `main`, diesen Master-Plan und die betroffenen Klickdummy-Dateien.
2. **Umsetzung** nach superpowers:subagent-driven-development auf Branch `feat/phase-NN-<name>`: je Task ein Implementer und ein Reviewer, TDD, häufige Commits.
3. **Phasen-Review** auf dem stärksten Modell gegen Phasenplan, Spec, „Verträge“ und die Abnahme unten; Befunde werden in Fix-Runden behoben.
4. **PR** gegen `main`; der Orchestrator merged nach grüner CI (`gh pr merge --squash --admin --delete-branch`), hakt unten den Fortschritt ab, aktualisiert `CLAUDE.md` („Stand“) und startet die nächste Phase.

Entscheidet der Orchestrator unterwegs etwas, das weder Spec noch dieser Plan festlegt, kommt es als `A1`, `A2`, … mit Grund und „Falls falsch“ in `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md` (Muster wie die Rulings des Klickdummys). Was die Fachlichkeit ändert, kommt zusätzlich als „Änderungen vom …“ in die Spec und wartet auf Rafaels Bestätigung, blockiert aber die Phase nicht.

## Global Constraints

- Git-Identität kommt aus `~/.gitconfig` und muss `rafael@hauss.dev` sein; nie `user.email` setzen, nie `rafael@lulububu.de`, auch nicht als Co-Author. Commits enden mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (Subagents nennen ihr tatsächliches Modell, R7), PR-Beschreibungen mit `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Ein Branch je Änderung (`feat/…`, `fix/…`, `docs/…`), PR gegen `main`, Conventional Commits.
- PHP, Composer, Artisan und pnpm für die App nur in DDEV: `ddev composer …`, `ddev artisan …`, `ddev exec pnpm …`. Kein PHP auf dem Host, nie über mise oder brew. Playwright (`e2e/`) läuft auf dem Mac gegen DDEV.
- Nur pnpm, nie npm oder npx; Einmal-Tools mit `pnpm dlx`. pnpm-Workspace: Root (App), `docs`, `prototypes/*`; `e2e/` ist eine eigene Wurzel mit eigenem Lockfile.
- PHP 8.4, Laravel 13, MariaDB 11.4, Node 24, pnpm 12.
- Primärschlüssel ULID (`HasUlids`) in allen Tabellen; Items zusätzlich mit Key `IDENT-123`.
- Keine Fachlogik in Controllern, Inertia-Seiten, API-Endpunkten, MCP-Tools, Jobs oder Commands: nur in `app/Actions` (Abläufe, Validierung, Rechteprüfung, Transaktion) und `app/Domain` (reine Regeln ohne Laravel). Architekturtests sichern das ab, auch „kein schreibendes `DB::table` außerhalb von Actions“.
- Genau ein Zugriffs-Scope „sichtbare Projekte einer Person“ (`App\Access\Visibility`); Views, Suche, REST, MCP, Relationen, Anhänge, Benachrichtigungen und Live-Kanäle benutzen nur ihn.
- Rich Text wird als Tiptap-JSON gespeichert und nur serverseitig aus JSON gerendert; Nutzer-HTML wird nie ausgegeben.
- UI-Texte und Mails nur über Schlüssel in `lang/en.json` und `lang/de.json` (gleiche Schlüssel, jeder benutzte Schlüssel existiert; Test). URLs ohne Sprachpräfix. Code, Kommentare und Commit-Messages Englisch.
- Gestaltung nach `prototypes/clickdummy/DESIGN.md` (Werkbuch, „Arbeitsheft“). Tokens als CSS-Variablen hell/dunkel mit `@theme inline`, Tailwind-Palette entfernt, Schriften lokal (fontsource: Bricolage Grotesque, Figtree), Icons Lucide, Komponenten auf Base UI, kein shadcn, kein Radix.
- Tastatur zuerst: jede Aktion ohne Maus; ein Kürzel-Register (`resources/js/lib/shortcuts/registry.ts`) ist die einzige Quelle für Kürzel, Hilfe-Overlay und Doku.
- WCAG 2.2 AA; responsiv bis 390 px (lesen, kommentieren, Status und Assignee ändern).
- Abdeckung: 100 % Zeilen im PHP-Code (PCOV, `--min=100`) und 100 % Zeilen im Frontend (Vitest und Playwright zusammengeführt) ab Phase 1 und in jeder Phase; Ausnahmen nur mit Begründung im Kommentar. Dazu Larastan Level 8, Pint, `tsc`.
- CI-Pflicht-Job heißt `tests` (`.github/workflows/tests.yml`); der Name ändert sich nie.
- Demo- und Testdaten nur fiktiv (`@example.com`, Feldwerk, Studio Nordlicht und die übrigen Namen aus `prototypes/clickdummy/src/api/seed/`). Keine echten Kunden, Hosts, Firmen oder Personen.
- Doku: Jede Phase liefert ihre VitePress-Seiten in `docs/en/` **und** `docs/de/` (gleiche Dateinamen) im selben PR. Das Repo-README ist Englisch; Spec, Pläne, Rulings und Arbeitsnotizen sind Deutsch.
- `CLAUDE.md` des Repos wird in jeder Phase aktuell gehalten (Stand, Kommandos, Architektur, Fallstricke).
- Release (Tag `vX.Y.Z`) nur nach ausdrücklicher Freigabe durch Rafael.

## Review Focus

- **Outbox doppelt oder gar nicht:** Ein Event, das der Nachverteiler aufgreift, während sein erster Dispatch noch in der Queue liegt, darf keine zweite Benachrichtigung, Mail oder Webhook-Zustellung erzeugen; ein Absturz zwischen Commit und Dispatch darf nichts verlieren. → Phase 2: Konsumenten sind idempotent je `(event_id, consumer)`, Test mit doppeltem Dispatch und mit abgebrochenem Dispatch; Phase 8 und 11 prüfen es für Benachrichtigungen und Zustellungen erneut.
- **Gleichzeitig anlegen:** Zwei Items im selben Projekt zur selben Zeit (UI, Vorlagen-Job, MCP) bekommen nie dieselbe Nummer, eine fehlgeschlagene Anlage hinterlässt kein halbes Item. → Phase 4: `next_number` mit `lockForUpdate` in der Transaktion, Test mit zwei Verbindungen in der Suite `Integration`.
- **Zugriff verloren, während etwas unterwegs ist:** Wer zwischen Ereignis und Sammelmail, Live-Push, Suchtreffer oder Webhook den Zugriff auf das Projekt verliert (entfernt, Projekt privat, deaktiviert), bekommt nichts mehr davon zu sehen. → Phase 8 (Mail und Inbox prüfen das Leserecht beim Versand, Live-Kanal wird neu autorisiert), Phase 6 (Suche filtert zur Abfragezeit), Phase 11 (Webhook mit Bot-Filter).
- **Zeitzonen und Kalenderränder:** Zeitplan am 31. bzw. „letzter“ Tag, Sommerzeitwechsel in der Org-Zeitzone, Wechsel der Org-Zeitzone mit bereits berechnetem `next_run_at`, Erinnerung um 08:00 für Personen in verschiedenen Zeitzonen. → Phase 10 (Domain-Tests für Terminberechnung und Neuberechnung nach Zeitzonenwechsel), Phase 8 (Erinnerungen je Personen-Zeitzone).
- **Markdown von außen:** `@handle` in Code-Blöcken, Inline-Code oder Link-Texten erwähnt niemanden; ein unbekannter, deaktivierter oder projektfremder Handle bleibt Text; `WEB-123` eines unsichtbaren Items wird nicht zum Verweis; `attachment:<ulid>` eines fremden Projekts wird abgelehnt. → Phase 7 (Rundreise-Tests Markdown ↔ JSON mit genau diesen Fällen, über REST).

---

## Verträge zwischen den Phasen

Diese Namen und Formen gelten für alle Phasen. Ein Phasenplan darf sie erweitern, aber nicht umbenennen; braucht er eine Änderung, kommt sie als Ruling.

### Backend

- **Actor** (`App\Support\Actor`, final readonly): `public User $user`, `public string $via` (`ui`, `api`, `mcp`, `automation`, `template`, `system`), `public ?string $reason` (z. B. „Automatisierung: Auto-Archiv“, „aus Vorlage Monatsbericht“), `public ?PersonalAccessToken $token`. Fabriken: `Actor::fromRequest(Request $r): self`, `Actor::automation(string $reason): self` und `Actor::template(Template $t): self` (beide als Standard-Bot, `User::defaultBot()`), `Actor::system(User $u, string $reason): self`.
- **Actions** in `app/Actions/<Bereich>/<VerbNomen>.php` mit `use AsAction;` und `handle(Actor $actor, …)`. Sie prüfen das Recht selbst (`Gate::forUser($actor->user)->authorize(...)` gegen Policies in `app/Policies`), validieren selbst (`Validator::make(...)->validate()` oder eigene Regeln) und laufen schreibend in `DB::transaction`. Lesende Actions heißen `List…`, `Get…`, `Query…`.
- **Fehler** (`App\Exceptions\Problem extends RuntimeException`): `int $status`, `string $reason`, `?string $detail`, `array $errors = []`, `array $extensions = []`; Fabriken `Problem::forbidden()`, `Problem::notFound()`, `Problem::conflict(string $reason, array $extensions = [])`, `Problem::invalid(array $errors)`, `Problem::locked(string $reason)` (409). Unter `/api/*` als `application/problem+json` (RFC 9457) gerendert, `ValidationException` als 422 mit `reason: validation_failed` und `errors`; MCP macht daraus lesbaren Text. Die `reason`-Codes sind die Schlüssel von `REASON_TEXT` in `prototypes/clickdummy/src/api/client.ts` (u. a. `transition_not_allowed`, `not_closed`, `archived`, `project_archived`, `description_conflict`, `page_conflict`, `parent_not_epic`, `epic_has_no_parent`, `last_admin`, `in_use`); neue Codes ergänzen beide Seiten.
- **Events und Outbox:** Tabelle `events` (Spec 7.4: `type`, `actor_id`, `subject` morph, `project_id`, `changes` JSON `{feld: {old, new}}`, `meta` JSON mit `via` und `reason`, `occurred_at`, `dispatched_at`). Schreiben nur über `App\Events\EventRecorder::record(string $type, Actor $actor, Model $subject, ?Project $project, ?array $changes = null, array $meta = []): Event`. Die Typen stehen in `App\Events\EventType` (string-backed Enum) und tragen die Namen des Webhook-Katalogs aus Spec 6.3 (`work_item.created`, `work_item.state_changed`, `comment.created`, `page.moved`, `bot.assigned`, `template.run_failed`, …); Typen ohne Webhook (z. B. `workflow.updated`, `user.deactivated`) haben die Eigenschaft `webhook: false`. Nach dem Commit (`DB::afterCommit`) startet `DispatchEvent` je Event, das jeden Konsumenten aus `config('werkbuch.event_consumers')` als eigenen Job in dessen Queue stellt und dann `dispatched_at` setzt. Konsumenten implementieren `App\Events\EventConsumer { public function key(): string; public function queue(): string; public function consume(Event $event): void; }` und sind idempotent (Tabelle `event_consumptions` mit unique `(event_id, consumer)`). `app:redispatch-events` (jede Minute) verteilt Events mit `dispatched_at = null`, die älter als 2 Minuten sind.
- **History** wird nur aus `events` gelesen (`App\Actions\WorkItems\ListHistory`), nie aus einer eigenen Tabelle.
- **Sichtbarkeit:** `App\Access\Visibility::projectIds(User $user): Collection<string>` (gecacht je Request) und der Scope `Project::scopeVisibleTo(Builder $q, User $user)`; `WorkItem::scopeVisibleTo`, `Page::scopeVisibleTo` u. a. bauen nur darauf auf. Projektrollen: `App\Access\ProjectRole` (`admin`, `member`, `viewer`, `null`) aus `Visibility::roleIn(User $user, Project $p): ?ProjectRole` (Org-Admin → `admin`, Nicht-Mitglied in öffentlichem Projekt → `viewer`).
- **Rollen:** spatie/laravel-permission mit Teams; `team_id` ist ein ULID-String, Org-Rollen hängen am Team mit der ULID der Organisation, Projektrollen am Team mit der ULID des Projekts. Die Rechte sind eine feste Liste in `App\Access\Permission` (Enum); eine Migration und `app:sync-roles` synchronisieren die Rollen.
- **Resources:** genau eine Darstellung je Ressource in `app/Http/Resources/<Name>Resource.php`, die REST, MCP, Webhook-`data` und Live-Payloads gemeinsam nutzen. Feldnamen und Formen sind die Typen aus `prototypes/clickdummy/src/types.ts` (snake_case), inklusive `parent` (`id`, `key`, `title` oder `null`) am Work Item, `children_progress`, `blocked` und `blocking` am Item statt `getWorkItemMeta()` (README „Wo die echte API andockt“). Rich Text kommt in beiden Formen (`description` Markdown, `description_json` Tiptap-JSON).
- **Rich Text:** `App\RichText\Document` mit `static fromJson(array $json): self`, `static fromMarkdown(string $md, MarkdownContext $ctx): self`, `toJson(): array`, `toMarkdown(): string`, `toText(): string`, `toHtml(): string`, `mentionedUserIds(): list<string>`, `attachmentIds(): list<string>`, `itemRefs(): list<string>`, `pageRefs(): list<string>`. Eingaben über `App\RichText\RichTextInput::from(array $input, string $field, MarkdownContext $ctx): ?Document` (akzeptiert `<field>` als Markdown oder `<field>_json`, nicht beides). Phase 4 liefert die Standard-Knoten, Phase 7 die eigenen Knoten (Erwähnung, Verweis, Anhang) und HTML für Mails.
- **Uhr:** Code liest die Zeit nur über `now()`/`Carbon`; Tests setzen sie mit `Carbon::setTestNow()` bzw. `$this->travelTo()`. „Heute“ und Tagesgrenzen rechnet `App\Domain\Time\OrgCalendar` in der Zeitzone der Organisation (R10).
- **Routen:** REST unter `/api/v1/<ressource-im-plural-kebab>` (z. B. `work-items`, `relation-types`, `work-items/{idOrKey}/comments`); Work Items auch über den Key. MCP unter `/mcp`. Web-Routen spiegeln die Routen des Klickdummys 1:1 (README „Routen“, ohne `/_components`, das unter `/_components` nur in `local` bleibt).
- **Queues:** `default`, `notifications`, `webhooks`, `search`, `media`, `bulk`; ein Worker mit `--queue=default,notifications,webhooks,search,media,bulk`.
- **Konfiguration:** App-eigene Werte in `config/werkbuch.php` (`version`, `attachments_max_mb`, `notification_mail_delay`, `webhooks_allow_private`, `event_consumers`, Rate-Limits), gelesen aus den Env-Variablen der Spec 8.2.

### Frontend

- **Ordner:** Der Klickdummy wird nach `resources/js/` übertragen: `src/components/{ui,fields,items}` → `resources/js/components/…`, `src/features/*` → `resources/js/features/*`, `src/hooks` → `resources/js/hooks`, `src/lib` → `resources/js/lib`, `src/store` → `resources/js/store`, `src/domain` → `resources/js/domain`, `src/styles` → `resources/css`, `src/types.ts` → `resources/js/types.ts`, der Editor nach `resources/js/editor` (Spec 7.3). Nicht übernommen werden `src/api/db.ts`, `src/api/seed/`, `src/lib/clock.ts` (die Demo-Uhr) und die Werkzeuge, die es nur im Klickdummy gibt (README „Nur im Klickdummy“: „Als … ansehen“, simulierte Konflikte und Live-Ereignisse, „Demo zurücksetzen …“, `api:fail`).
- **API-Schicht:** `resources/js/api/<ressource>.ts` exportiert dieselben Funktionen mit denselben Signaturen und Typen wie `prototypes/clickdummy/src/api/<ressource>.ts`; die Körper rufen `resources/js/api/http.ts` (`get<T>(path, query?)`, `post<T>(path, body?)`, `patch<T>`, `put<T>`, `del<T>`, `upload<T>(path, FormData, onProgress)`), das Session-Cookie und CSRF mitschickt und Problem Details in dasselbe `ApiError` (`status`, `reason`, `errors`, `extensions`, `current`) und dieselbe `Page<T>`-Hülle übersetzt. Hooks (`resources/js/hooks/*`, Query-Keys in `keys.ts`) und Komponenten ändern sich beim Port nur, wo der Klickdummy die Fake-API umging.
- **Seiten:** Jede Route ist eine Inertia-Seite in `resources/js/pages/<Bereich>/<Name>.tsx`, die nur den Bildschirm aus `features/` rendert. Geteilte Props (`HandleInertiaRequests`): `auth.user`, `auth.permissions` (Org-Rechte), `organization` (Name, Zeitzone, Wochenbeginn, Logo), `locale`, `translations`, `features` (Mail konfiguriert, Live-Konfiguration). `lib/links.ts` liefert Pfade für Inertia-`<Link>`; React Router fällt weg.
- **i18n:** `resources/js/lib/i18n.ts` mit `t(key, params?)` und `tn(key, count, params?)`. Beim Port wird jeder deutsche Text des Klickdummys ein Schlüssel; `lang/de.json` übernimmt den Text wörtlich, `lang/en.json` bekommt die englische Fassung. Schlüssel sind Punktpfade nach Bereich (`items.board.move_rejected`).
- **Live:** `resources/js/api/live.ts` behält `subscribeLive`, `isLiveConnected`, `subscribeLiveStatus`; bis Phase 8 meldet es „verbunden“ und liefert keine Ereignisse.
- **Abdeckung:** `pnpm build:coverage` baut mit `vite-plugin-istanbul`; die Playwright-Fixture in `e2e/fixtures.ts` sammelt `window.__coverage__` nach jedem Test nach `coverage/e2e/`; `scripts/coverage-merge.mjs` führt sie mit `coverage/unit/coverage-final.json` (Vitest) zusammen und scheitert unter 100 % Zeilen.

---

## Phase 1: Fundament

**Branch:** `feat/phase-01-foundation` · **Phasenplan:** `docs/superpowers/plans/2026-10-30-phase-01-foundation.md`

**Liefert:**
- Laravel 13 im Root (per `ddev composer create-project` in einen temporären Ordner, dann ins Root), `composer.json` mit allen Paketen aus 7.1, die schon gebraucht werden; Prüfung, dass die übrigen Pakete Laravel 13 unterstützen (Ergebnis als Ruling).
- DDEV (`.ddev/config.yaml` nach openbill: Name `werkbuch`, PHP 8.4, MariaDB 11.4, Node 24, corepack; Datenbank `testing`; Meilisearch als Zusatzdienst; Mailpit; Queue-Worker, Scheduler und Reverb als Daemons im Web-Container; Vite mit HMR auf `https://werkbuch.ddev.site:5173`).
- Pest 5 mit Suiten Unit, Feature, Integration, PCOV, `--min=100`; Larastan Level 8; Pint; Architekturtests (Actions-Regel, Domain ohne `Illuminate`, kein schreibendes `DB::table` außerhalb von Actions).
- `Problem` und das Rendering als Problem Details, `config/werkbuch.php`, Trusted Proxies und Host-Prüfung wie openbill (`TRUSTED_PROXIES`, nur der Host aus `APP_URL`).
- Auth mit Fortify: Login, Logout, „Passwort vergessen“ per Mail, Login-Drosselung 5 Versuche je E-Mail und IP für 60 s, Throttle vor Auth; minimale `users`-Tabelle (Person) und `app:ensure-admin` (`ADMIN_EMAIL`, `ADMIN_PASSWORD`), `app:reset-password`. 2FA folgt in Phase 2.
- i18n: `lang/en.json`, `lang/de.json`, `SetLocale` (Profil, vor dem Login Cookie bzw. Standard), `t()`/`tn()`, Test auf gleiche und benutzte Schlüssel.
- pnpm-Workspace (Root, `docs`, `prototypes/*`); der Klickdummy zieht ins gemeinsame Lockfile.
- Frontend-Basis: Inertia v3 mit React 19, TanStack Query, Zustand; `resources/css` (Tokens aus `DESIGN.md`), Schriften; `components/ui` vollständig portiert (mit `ui.test.tsx`; FavoriteStar, FormDialog, CopyField und Sortable kommen hier in die gemeinsamen Komponenten, 13b); `api/http.ts`, `ApiError`, `Page`; Kürzel-Register und Hilfe-Overlay; Theme vor dem ersten Rendern; Shell mit Seitenleiste (Einträge ohne Daten bleiben leer bis zu ihrer Phase), Live-Banner-Platz; Bildschirme Login, Passwort vergessen, Passwort setzen.
- Abdeckungs-Pipeline (Istanbul-Build, Sammeln in Playwright, Zusammenführen, Grenze 100 %) und `e2e/` als eigenes pnpm-Projekt mit Login-Test nur per Tastatur, hell und dunkel, 1440 und 390 px.
- `DemoSeeder`-Gerüst (Organisation, Personen aus `src/api/seed/people.ts`); jede Phase ergänzt ihre Daten.
- VitePress-Gerüst in `docs/` nach openbill (Locales `/en/` und `/de/`, `srcExclude` für `history/**`, `superpowers/**`, `DOCS_BASE`, `llms.txt`), Seiten `index` und `development` in beiden Sprachen, Test auf gleiche Struktur.
- CI: `tests` prüft ab jetzt die App (Composer, Pint `--test`, Larastan, Pest mit Abdeckung gegen MariaDB-Service, `pnpm install --frozen-lockfile`, `tsc`, Vitest, Build); neuer Job `e2e` (Playwright gegen `php artisan serve` mit MariaDB-Service, zusammengeführte Abdeckung); neuer Job `docs` (VitePress-Build); die Prüfungen des Klickdummys wandern in den Job `clickdummy` (Unit, Build, Flows; kein Pflicht-Check). Dependabot für Actions, Composer und pnpm.
- `CLAUDE.md` neu geschnitten (Stand, Kommandos über DDEV, Architekturregeln, Verträge, Fallstricke), `.env.example`.

**Abnahme:** `ddev start && ddev composer install && ddev exec pnpm install && ddev artisan migrate` läuft; Login mit dem Konto aus `app:ensure-admin` klappt in beiden Sprachen; `ddev exec pnpm dev` liefert HMR; `ddev artisan test` mit 100 % grün; `pnpm --dir e2e test` grün mit 100 % Frontend-Abdeckung; CI `tests` und `e2e` grün; `pnpm --dir docs build` grün.

## Phase 2: Organisation, Konten, Rollen, Projekte

**Branch:** `feat/phase-02-accounts` · **Phasenplan:** `…phase-02-accounts.md`

**Liefert:**
- Outbox: `events`, `event_consumptions`, `EventRecorder`, `EventType`, `DispatchEvent`, `EventConsumer`, `app:redispatch-events` (Review Focus 1).
- `Actor`, `Visibility`, `ProjectRole`, `Permission`, spatie-Teams mit ULIDs, Policies, Rechte-Matrix-Test (jede Action × jede Rolle, wie `RightsMatrixTest` in openbill), der in jeder späteren Phase wächst.
- Organisation (eine Zeile, Name, Logo über medialibrary, Standardsprache, Zeitzone, Wochenbeginn); Standard-Bot „Automation“ (`automation`, Org-Admin, nicht lösch- oder deaktivierbar) per Migration.
- Konten: Personen (E-Mail, Sprache, Zeitzone, Avatar, Handle-Regeln), Bots (Beschreibung, verantwortliche Person), Einladungen (7 Tage, ersetzt die alte, kopierbarer Link ohne Mailserver, mit Projekten und Rollen), Deaktivieren und Reaktivieren (Tokens und Sitzungen widerrufen), letzter Admin, TOTP-2FA mit Recovery-Codes (Fortify), Sanctum-Tokens mit `read`, `write`, `mcp`, Ablauf, „zuletzt benutzt“, Warnung für Tokens des Standard-Bots.
- Projekte: Felder aus 4.4 außer Workflow und Typen (die folgen in Phase 3), Kennung mit Regeln und `project_identifiers` (alte Kennung bleibt reserviert und löst auf), öffentlich/privat, Beitreten mit einem Klick, Mitglieder und Rollen, Project Lead, Archivieren, Löschen per Job nach Eintippen der Kennung, Favoriten (Projekte; Views ab Phase 5).
- REST für alles davon (`organization`, `users`, `bots`, `invitations`, `tokens`, `projects`, `projects/{id}/members`, `favorites`).
- UI-Port: Einstellungen Organisation (Allgemein, Personen, Bots), Persönlich (Profil, Sicherheit, API und MCP ohne Snippet-Prüfung), Projekte-Übersicht, Projekteinstellungen (Allgemein, Mitglieder), Einladung annehmen; Seitenleiste mit Projekten und Favoriten. Gemeinsamer Einstellungsrahmen und Verlassen-Schutz einmal (R26, 13b).

**Tests:** Rechte-Matrix, letzter Admin (auch ohne Standard-Bot), Kennungswechsel mit Auflösung und Reservierung, Einladung abgelaufen bzw. ersetzt, Deaktivieren widerruft Token und Sitzung, Outbox doppelt und abgebrochen; e2e: Person einladen, Link kopieren, annehmen, Projekt anlegen, Mitglied hinzufügen, nur per Tastatur.

**Doku:** `concepts/permissions`, `concepts/projects`, `bots` (Grundlagen), en + de.

**Abnahme:** Admin lädt per UI und per REST ein, Projekt mit privaten und öffentlichen Rechten verhält sich wie die Tabellen in 4.3; Pest und e2e mit 100 %.

## Phase 3: Workflows, Typen, Properties, Kataloge

**Branch:** `feat/phase-03-catalog` · **Phasenplan:** `…phase-03-catalog.md`

**Liefert:**
- `app/Domain/Workflow/TransitionGraph` (Port von `src/domain/workflow.ts`: frei oder Matrix, Startstatus, mindestens ein Completed, Erreichbarkeit) mit portierten Tests.
- Workflows mit Status (Name, Icon-Form aus sieben, Kategorie, Reihenfolge) und Übergängen; Standard-Workflow aus der Spec per Migration; Löschen nur ungenutzt.
- Typen (Name, Lucide-Icon, einer von sechs Tönen, Beschreibung, Häkchen „Epic“, Properties mit Pflicht und Reihenfolge, Archiv statt Löschen); Task, Bug (mit „Aufwand (h)“, R6) und Epic per Migration.
- Properties (Schlüssel-Regeln, acht Feldtypen mit Einstellungen, Optionen mit Archiv, Wechsel Einfach → Mehrfach), Labels (ohne Standard-Markierung, R23), Relationstypen (drei eingebaute, „wird blockiert von“), Resolutions (vier eingebaute, Standard für Completed und Canceled).
- Projekt: Workflow wählen mit Status-Zuordnung (Job `RemapStates`, ohne Übergangsregeln, mit Actor in der History) und aktivierte Typen mit Standardtyp. Die Prüfungen gegen bestehende Items (Status mit Items löschen, Häkchen „Epic“ gegen Kinder) bekommen ihre Item-Seite in Phase 4.
- REST: `workflows` (mit `states`, `transitions`), `work-item-types`, `properties` (mit `options`), `labels`, `relation-types`, `resolutions`, `projects/{id}/workflow`, `projects/{id}/types`.
- UI-Port: Einstellungen Workflows (Editor mit Übergangsmatrix), Typen, Properties, Labels, Relationstypen, Resolutions; Projekteinstellungen Workflow und Typen. Status-Zuordnung und Entfernen-Helfer einmal (R26).

**Tests:** alle Fälle aus `src/domain/workflow.test.ts` und den Workflow-, Typ- und Property-Teilen von `src/api/resources.test.ts`, Schlüssel gleich einem Kernfeld, Feldtyp unveränderlich; e2e: Flow 7 des Klickdummys (Agentur-Freigabe, „Review ist vom Startstatus aus nicht erreichbar“).

**Doku:** `concepts/workflows`, `concepts/types-and-properties`, en + de.

**Abnahme:** Erfolgskriterium 2.1 und 2.2 (ohne Item) in UI und REST.

## Phase 4: Work Items, Relationen, History

**Branch:** `feat/phase-04-work-items` · **Phasenplan:** `…phase-04-work-items.md`

**Liefert:**
- `work_items`, `work_item_values` (typisiert, Spalte je Werttyp), `work_item_labels`, `work_item_relations`, `work_item_subscribers`; Key und Nummer (Review Focus 2), Rang (Port von `src/domain/rank.ts`), `parent` und `children_progress`, `blocked`, `blocking`.
- Actions: Anlegen (Startstatus oder Prüfung wie ein Übergang, Pflicht-Properties, zwei Ebenen nach `src/domain/hierarchy.ts`), Ändern (zuletzt gewinnt; Beschreibung mit `description_version` und 409 `description_conflict`), Übergang mit Resolution (Port von `src/domain/resolution.ts`, `started_at`, `closed_at`), Typwechsel (verlorene Werte in der History, fehlende Pflichtwerte → 422), Archivieren und Wiederherstellen, Löschen (Kinder werden zu Items ohne Eltern), Mehrfachbearbeitung je Item mit Liste der Ablehnungen, Relationen (keine mit sich selbst, kein Paar doppelt, „verborgenes Item“), Beobachten. Prüfungen aus Phase 3 gegen bestehende Items (Status löschen, Epic-Häkchen, Typwechsel).
- `App\RichText\Document` mit Standard-Knoten (JSON, Text, Markdown hin und zurück), `RichTextInput`.
- History aus `events` mit Zusammenfassen derselben Person in wenigen Minuten (Spec 13: der Plan legt 5 Minuten fest).
- Einfacher Listen-Endpunkt `GET /api/v1/work-items` mit Projekt-Kurzform, bis Phase 5 die Filter-Engine bringt; `GET/PATCH/DELETE /api/v1/work-items/{idOrKey}`, `POST …/transition`, `…/archive`, `…/restore`, `POST /api/v1/work-items/bulk`, `…/relations`, `…/subscribers`, `…/history`. Alte Kennungen leiten um (`OLD-12` → `NEW-12`, in UI per Redirect, in REST per 301 mit `Location`).
- UI-Port: Item-Seite und Vorschau (Kopf, Felder, Kinder, Relationen, Aktivität ohne Kommentare), Anlegen-Dialog mit „weitere anlegen“ und Fokus im Titel, alle Feld-Editoren aus `components/fields` mit den Item-Befehlen und Kürzeln; der Editor (`resources/js/editor`) für Beschreibungen mit den Stufen aus 4.16, noch ohne Erwähnungen, Verweise und Uploads. Große Dateien beim Port geteilt (Anlegen-Dialog, Aktivität, Item-Kopf, Item-Befehle; 13b).
- `DemoSeeder` mit allen Items, Relationen und Werten aus `src/api/seed/items.ts`.

**Tests:** Review Focus 2, Übergänge in jeder Schicht, Pflichtwerte beim Anlegen und Leeren, Eltern- und Typregeln, Beschreibungskonflikt, Mehrfachbearbeitung mit gemischten Ablehnungen, „verborgenes Item“ über Projektgrenzen; e2e: Flow 1 (Status setzen mit vorbelegter Resolution) und Flow 3 (Pflichtfeld im Anlegen-Dialog) über die Item-Seite.

**Doku:** `concepts/work-items` (Felder, Eltern und Kinder, Relationen, Archiv), en + de.

**Abnahme:** Erfolgskriterium 2.2 und 2.3 in UI und REST; History zeigt alle Feldänderungen mit Alt → Neu.

## Phase 5: Views, Filter-Engine, Listen-Layouts

**Branch:** `feat/phase-05-views` · **Phasenplan:** `…phase-05-views.md`

**Liefert:**
- `app/Domain/Filter` (Port von `src/domain/filter.ts`: Schema `version: 1`, Felder, Operatoren, dynamische Werte, Property-Bedingungen treffen Items ohne die Property nie, „blockiert andere“ eigenes Feld, Org-Zeitzone) und die Übersetzung in Eloquent-Queries (`App\Views\FilterQuery::apply(Builder $q, Filter $f, User $viewer): Builder`); Gruppierung (Port von `src/domain/grouping.ts`) mit Anzahl je Gruppe vom Server, Sortierung inklusive Properties, Cursor-Pagination.
- Views (Name, Icon, Filter, Darstellung, Ersteller-Rechte, „als neue View speichern“), eingebaute Listen „Meine Items“, „Von mir erstellt“, „Beobachtet“ und die Projekt-Liste als ungespeicherte View, Favoriten für Views.
- REST: `views`, `GET /api/v1/work-items?view=<id>`, `POST /api/v1/work-items/query` (Filter, Sortierung, Gruppierung, Cursor), Kurzform `filter[project]=…&filter[assignee]=me` in dieselbe Engine.
- Board-Regeln (Port von `src/domain/board.ts`: Ziehen ändert Status mit Prüfung, Priorität oder Assignee; Kategorie-Spalten behalten den eigenen Status, sonst erster erlaubter; Label-Boards nicht ziehbar), Timeline (Epics, Fortschritt, Daten ändern).
- UI-Port: Items-Bildschirm mit Filterleiste (ungespeichert, speichern, verwerfen, Zustand in der URL), Anzeigeoptionen, Liste, Board, Tabelle (Inline-Bearbeitung), Timeline, Mehrfachauswahl und -bearbeitung, Views-Übersicht, „Meine Items“, Seitenleiste mit Views. Board und Timeline werden virtualisiert (R34). Dateien geteilt (Items-Bildschirm, Board, Timeline; 13b). Aus 13c: Fokus beim Scrollen, Tab-Stopps der Gruppenschalter, Filterentwurf über das Operator-Menü, Skelett je Layout, Nachladefehler ersetzt keine volle Liste, gleiche Ränge über Projekte hinweg, Esc bricht Timeline-Ziehen ab, Auswahlfelder der Tabelle am Handy 44 px.

**Tests:** alle Fälle aus `filter.test.ts`, `grouping.test.ts`, `board.test.ts`; Gleichheit der Treffer zwischen Filter-Engine und REST `?view=` für jede Feldart; Datenleck: View über private Projekte; e2e: Flow 2 (Board-Zug abgelehnt mit Toast), Board und Timeline per Tastatur, Filter per `f`.

**Doku:** `concepts/views` (Filter-Syntax mit allen Feldern und Operatoren), en + de.

**Abnahme:** Erfolgskriterium 4 für UI und REST (MCP folgt in Phase 13); Filtern, Sortieren und Paginieren macht der Server.

## Phase 6: Suche und Befehlspalette

**Branch:** `feat/phase-06-search` · **Phasenplan:** `…phase-06-search.md`

**Liefert:**
- Scout mit Meilisearch für Items (Key, Titel, Klartext der Beschreibung; Kommentare ab Phase 7), Projekte, Personen und Bots; Wiki-Seiten folgen in Phase 9. Indexieren als Event-Konsument in der Queue `search`; `app:search-sync` für die Index-Einstellungen (Filterattribut `project_id`).
- `GET /api/v1/search?q=…&types=…`: läuft immer mit dem Filter aus `Visibility`, der Browser spricht nie mit Meilisearch; ein Key wie `WEB-123` (auch eine alte Kennung) liefert das Item direkt.
- UI-Port: Befehlspalette (⌘K, `/`): Suche nach Art gruppiert, Navigation, „Neues Item“, Befehle am ausgewählten Item, „Vorlage anwenden …“ (aktiv ab Phase 10), Theme; `?`-Hilfe vollständig.
- Tastatur-Doku: `scripts/shortcuts-doc.mjs` erzeugt `docs/{en,de}/keyboard.md` aus dem Register; ein Test prüft, dass die Seiten aktuell sind und kein Kürzel doppelt belegt ist (R38).

**Tests:** Suche über Projektgrenzen (privates Projekt, Nicht-Mitglied, deaktiviert), Index nach Änderung, Löschung und Archiv, Key-Sprung mit alter Kennung; Meilisearch in `Integration` echt, sonst Fake-Engine; e2e: Flow 1 komplett über ⌘K „kontakt“.

**Doku:** `keyboard` (erzeugt), `search`, en + de.

**Abnahme:** Erfolgskriterium 2.6 für UI und REST; Kürzel-Doku aus dem Register.

## Phase 7: Editor, Kommentare, Anhänge

**Branch:** `feat/phase-07-content` · **Phasenplan:** `…phase-07-content.md`

**Liefert:**
- Eigene Knoten in `Document` für Erwähnung (`@handle`), Verweis auf Item und Seite, Bild und Datei (`attachment:<ulid>`), HTML für Mails über tiptap-php; Rundreise-Tests Markdown ↔ JSON (Review Focus 5); nur neu Erwähnte werden gemeldet.
- Kommentare (bearbeiten mit „bearbeitet“ und alter Fassung in der History, löschen, Projekt-Admins löschen alle), Reaktionen (je Person einmal je Emoji), automatisches Beobachten beim Kommentieren und Erwähnen; Kommentare im Suchindex.
- Anhänge: `attachments` mit medialibrary, `inline` und `file`, Besitzer Item, Kommentar, Seite oder Vorlage, Verknüpfen beim Speichern (die hochladende Person wird geprüft, 13c), Auslieferung mit Leserecht, nur PNG, JPEG, GIF, WebP, AVIF inline, alles andere als Download mit `nosniff` und `CSP: sandbox`, `ATTACHMENTS_MAX_MB`, Vorschaubilder in der Queue `media`, Job für Uploads ohne Besitzer nach 24 Stunden, `app:prune-attachments --dry-run --min-age=`; der Löschjob für Projekte (Phase 2) und das Löschen von Items und Kommentaren entfernen ab jetzt auch die Dateien.
- REST: `work-items/{id}/comments`, `comments/{id}`, `comments/{id}/reactions`, `attachments` (Multipart), `attachments/{id}` (Datei); `GET /api/v1/mentions?project=…&q=…` und `GET /api/v1/references?project=…&q=…` für `@` und `#`.
- UI-Port: Editor komplett (`/`-Menü, Markdown-Kürzel, Code mit Hervorhebung, Bilder und Dateien per Einfügen und Ziehen mit Fortschritt, `@` und `#`), Kommentar-Composer, Aktivität mit Kommentaren und Filter, Dateiliste mit Rückgängig. Aus 13c: Uploads aus verworfenen Entwürfen, Entwurf nach fehlgeschlagenem Speichern, Tippen während des Speicherns.

**Tests:** Review Focus 5; Anhang eines fremden Projekts per ID, SVG nie inline, Größenlimit 413, Erwähnung eines Bots löst `bot.mentioned` aus (Event; Webhook in Phase 11); e2e: Flow 4 (`@ma` im Kommentar), Bild per Einfügen in Beschreibung und Kommentar.

**Doku:** `concepts/rich-text` (Markdown-Konventionen der Spec), en + de.

**Abnahme:** Erfolgskriterium 5 für Beschreibung und Kommentar (Wiki in Phase 9), Bild für Unbefugte 403/404.

## Phase 8: Benachrichtigungen, Mail, Live-Updates

**Branch:** `feat/phase-08-notifications` · **Phasenplan:** `…phase-08-notifications.md`

**Liefert:**
- Konsument `notifications`: wer benachrichtigt wird (Beobachter, Lead, nie der Auslöser, nie Bots, Deaktivierte oder Konten ohne Zugriff), Ereignisse aus 4.14, Einstellungen je Person, Ereignis und Kanal mit den Standards der Spec; Inbox-Aktionen (gelesen, ungelesen, alle, löschen, Filter).
- Mail: Sammeln je Person und Item `NOTIFICATION_MAIL_DELAY` (Standard 5 Minuten), Sprache der Person, Links, keine Anhänge; ohne Mailserver nur Inbox; Leserecht beim Versand erneut geprüft (Review Focus 3).
- Erinnerungen „fällig/überfällig“ stündlich für alle, bei denen es 08:00 ist; Aufräumen gelesener Benachrichtigungen nach 90 Tagen.
- Reverb mit Kanälen `project.{id}`, `user.{id}`, `work-item.{id}`, Autorisierung über dieselben Policies, Konsument `live`; `resources/js/api/live.ts` mit Echo, Aktualisieren des TanStack-Caches ohne doppelte eigene Änderungen, Live-Banner bei fehlender Verbindung.
- System-Seite für Admins (5.2): Version, Rückstand der Queue, fehlgeschlagene Jobs mit „erneut versuchen“, Status von Meilisearch, Testmail; REST `system`.
- REST: `notifications`, `notifications/read`, `notification-preferences`.
- UI-Port: Inbox (gruppiert, `e`, `u`, ⇧E, `#`, Öffnen markiert als gelesen), Badge live, persönliche Benachrichtigungseinstellungen, Einstellungen System. Aus 13c: Hinweistext bei gelesenen Einträgen, Zeilenaktionen per Tab, Ladefehler eines Items in der Inbox.

**Tests:** Empfängerregeln je Ereignis, Sammelmail über Mailpit (Integration), Zugriff verloren vor dem Versand, Kanal-Autorisierung für Nicht-Mitglieder; e2e mit zwei Browser-Kontexten: Erwähnung erscheint live in der Inbox der anderen Person.

**Doku:** `concepts/notifications`, en + de.

**Abnahme:** Erfolgskriterium 2.4 in UI und REST.

## Phase 9: Wiki

**Branch:** `feat/phase-09-wiki` · **Phasenplan:** `…phase-09-wiki.md`

**Liefert:**
- `pages`, `page_versions`; Baum mit Rang und Verschieben (auch „Verschieben nach …“), Löschen mit Teilbaum (Rückfrage, dann 5 Sekunden Rückgängig im Client), Autosave mit Versionsnummer und 409 `page_conflict` mit aktuellem Stand, „Meine Fassung übernehmen“ sichert die fremde Fassung als Version, Version nach 10 Minuten Pause, Versionsliste mit Wiederherstellen; Seiten im Suchindex, als `#`-Verweis und mit Bildern.
- REST: `projects/{id}/pages`, `pages/{id}` (mit `move`, `versions`, `versions/{id}/restore`).
- UI-Port: Wiki-Baum und Seite (Datei geteilt, 13b). Aus 13c: Schwelle beim Verschachteln, Zeitangabe „gespeichert“ für Screenreader, Ablege-Animation, „Meine Fassung übernehmen“ nach zurückgenommenem „Neu laden“, Bildansicht und Upload-Besitz.

**Tests:** Konflikt zweier Sitzungen, Versionen, Teilbaum-Löschung mit Anhängen, Viewer liest nur; e2e: Flow 5 mit zwei echten Sitzungen statt simuliertem Konflikt.

**Doku:** `concepts/wiki`, en + de.

**Abnahme:** Erfolgskriterium 5 für Wiki-Seiten; kein stiller Datenverlust bei gleichzeitigem Bearbeiten.

## Phase 10: Vorlagen, Zeitpläne, Automatisierungen

**Branch:** `feat/phase-10-templates` · **Phasenplan:** `…phase-10-templates.md`

**Liefert:**
- `app/Domain/Schedule` (Port von `src/domain/recurrence.ts`, `placeholders.ts`, `tz.ts`: Frequenzen, Wochentage 0 = Sonntag, Wochenintervalle ab Montag, „letzter“ und n-ter Wochentag, Ende nie/Datum/nach N Läufen, Nachholen nur des letzten Termins und höchstens bis N, Platzhalter zweistellig, `{month_name}` in der Sprache der Organisation) mit portierten Tests und Review Focus 4.
- Vorlagen (Payload aus 4.12, Anhänge beim Anwenden kopiert), Zeitplan mit Pause und nächsten 5 Terminen, Scheduler-Job jede Minute, `template_runs` unique `(template_id, scheduled_for)`, Anlage als Standard-Bot mit „aus Vorlage …“, Fehler protokolliert und an Lead und Ersteller gemeldet (`template.run_failed`), „jetzt ausführen“.
- Automatisierungen je Projekt (alle anfangs aus): Auto-Archiv und Auto-Close täglich um 03:00 Org-Zeit, Eltern schließen mit Schleifenbegrenzung, Assignee beim Start (nicht durch Bots); alle als Standard-Bot mit Grund in der History und mit Übergangsprüfung.
- REST: `projects/{id}/templates`, `templates/{id}` (`run`, `runs`, `preview`), `projects/{id}/automations`.
- UI-Port: Vorlagen-Bildschirm und Editor (geteilt, 13b; Wiederholschutz für ⌘⏎, 13c), Vorlage im Anlegen-Dialog und in der Palette, Projekteinstellungen Automatisierungen (kein doppeltes Speichern, 13c).

**Tests:** Erfolgskriterium 3 mit gestellter Uhr: pünktlich, nach Ausfall genau einmal nachgeholt, parallele Läufe ohne Duplikat; ungültige Vorlage zur Laufzeit; jede Automatisierung mit erlaubtem und verbotenem Übergang; e2e: Flow 6 (Vorschau „Monatsbericht“ mit den fünf Terminen bei gestellter Uhr 28.10.2026).

**Doku:** `concepts/templates`, `concepts/automations`, en + de.

**Abnahme:** Erfolgskriterium 3.

## Phase 11: Webhooks

**Branch:** `feat/phase-11-webhooks` · **Phasenplan:** `…phase-11-webhooks.md`

**Liefert:**
- `webhooks`, `webhook_deliveries`; Konfiguration aus 6.3 (Geheimnis verschlüsselt, einmal angezeigt, erneuerbar; Organisation oder Projekt; Ereignisse mit `gruppe.*`; optional ein Bot); Konsument `webhooks` mit Payload aus 6.3 und `data` aus den Resources.
- Zustellung über spatie/laravel-webhook-server: Header `X-Werkbuch-Event`, `X-Werkbuch-Delivery`, `X-Werkbuch-Timestamp`, `X-Werkbuch-Signature: sha256=<HMAC über "timestamp.body">`, 10 s Timeout, keine Weiterleitungen, 8 Versuche über etwa 24 Stunden, Protokoll mit Antwort gekürzt auf 2 KB und Löschen nach 30 Tagen, Abschalten nach 24 Stunden ohne Erfolg mit Benachrichtigung der Org-Admins, „erneut senden“, Test-Ping.
- SSRF: Prüfung bei jedem Versand nach der DNS-Auflösung, Anfrage an die geprüfte IP, gesperrt sind private, Loopback-, Link-local- und Metadata-Netze außer `WEBHOOKS_ALLOW_PRIVATE=true`.
- `bot.mentioned` und `bot.assigned`.
- REST: `webhooks`, `webhooks/{id}/deliveries`, `…/redeliver`, `…/ping`, `…/rotate-secret`.
- UI-Port: Einstellungen Webhooks mit Zustellungen.

**Tests:** Signatur gegen Beispielcode der Doku, SSRF mit DNS, das auf eine private Adresse zeigt, Abschalten nach 24 Stunden mit gestellter Uhr, Projekt-Webhook bekommt keine Ereignisse anderer Projekte, Idempotenz (Review Focus 1); e2e: Webhook an einen lokalen Empfänger in `e2e/`.

**Doku:** `webhooks` (Ereignisse, Payload, Signaturprüfung in Node, PHP und Python), en + de.

**Abnahme:** Erfolgskriterium 2.5.

## Phase 12: REST vollständig und OpenAPI

**Branch:** `feat/phase-12-api` · **Phasenplan:** `…phase-12-api.md`

**Liefert:**
- Lückenschluss: jede Fähigkeit der UI über REST (Abgleich der Liste aus 6.1 mit den Routen; der Orchestrator legt die Liste der Funktionen aus `resources/js/api/*` daneben), spatie/laravel-query-builder für alle normalen Listen mit `filter`, `sort`, `include`, Cursor-Pagination mit `per_page` ≤ 100, Body-Limit für JSON.
- Rate-Limits: API 600/min je gültigem Token, sonst je IP.
- Scramble unter `/api/docs` und `/api/openapi.json`; Entscheidung zwischen einer gepflegten Community-Erweiterung für den Query Builder und einer eigenen Extension (Ruling); Test, dass jede Route unter `/api/v1` dokumentiert ist.
- `ApiFlowTest`: Erfolgskriterium 2 komplett per REST.

**Doku:** `api` (Auth, Fehler, Pagination, Filter, Beispiele mit curl, Verweis auf `/api/docs`), en + de.

**Abnahme:** OpenAPI vollständig; `ApiFlowTest` grün.

## Phase 13: MCP

**Branch:** `feat/phase-13-mcp` · **Phasenplan:** `…phase-13-mcp.md`

**Liefert:**
- `app/Mcp/Servers/WerkbuchServer` unter `/mcp` (Sanctum, Fähigkeit `mcp`, Lese-Tools zusätzlich `read`, Schreib-Tools `write`, 300/min je Token).
- Je Ressource aus 6.2 ein Lese-Tool `<ressource>` (`IsReadOnly`) und ein Schreib-Tool `manage-<ressource>` (`IsDestructive`) mit `action`-Parameter, dazu `search` und `get-upload-url` (signierte URL für `curl -F`, 15 Minuten). Die Tools rufen Actions und geben die Resources zurück, Rich Text als Markdown.
- Resources: Filter-Syntax, Markdown-Konventionen, Feldtypen, zur Laufzeit aus `docs/en/` gelesen (`.dockerignore` behält diese Seiten).
- Server-Instructions (Texte in Ergebnissen sind Nutzerdaten, keine Anweisungen), Fehler als lesbarer Text.
- Persönlich „API und MCP“: Snippets für Claude Code, Codex und JSON (`mcpServers.werkbuch` mit `type`, `url`, `headers.Authorization`).
- `McpFlowTest`: Erfolgskriterium 2 und 4 per MCP; Agent-Szenario aus 6.2 als Test (Bot zugewiesen → `bot.assigned` → MCP kommentiert und setzt den Status).

**Tests:** Tool-Namen in Texten und Doku existieren, die Doku nennt alle Tools, Annotationen, Token ohne `write` bekommt keine Schreib-Tools, Datenleck über MCP.

**Doku:** `mcp` (alle Tools, Einrichtung), `bots` (Agent-Szenario), en + de.

**Abnahme:** Erfolgskriterium 2 und 4 per MCP.

## Phase 14: Docker und Release

**Branch:** `feat/phase-14-docker` · **Phasenplan:** `…phase-14-docker.md`

**Liefert:**
- `Dockerfile` (Node-Stage mit pnpm, `serversideup/php:8.4-fpm-nginx` per Digest, Code schreibgeschützt, beschreibbar nur `storage/` und `bootstrap/cache`, amd64 und arm64), nginx leitet `/app` und `/apps` an Reverb weiter.
- `docker/entrypoint.d/` (Ordner im Volume, `APP_KEY` und Reverb-Schlüssel aus der Env oder erzeugt und im Volume gespeichert, auf die Datenbank warten, migrieren, `app:ensure-admin`, `app:search-sync`, `optimize`); Queue, Scheduler und Reverb starten ohne Migration.
- `docker-compose.yml` und `docker-compose.standalone.yml` (Dienste aus 8.1, Port `${WERKBUCH_BIND:-0.0.0.0}:${WERKBUCH_PORT:-7740}`, Volumes `werkbuch-data`, `mariadb-data`, `meili-data`, alle Images per Digest), Test auf Gleichschritt; `.env.docker.example`, `.dockerignore`, Healthcheck `/up`.
- Workflows `docker.yml` (Tag `vX.Y.Z` → Image `X.Y.Z`, `X.Y`, `latest` und GitHub-Release mit Notizen aus `docs/*/upgrading.md`), `dockerhub.yml` (README-Sync); Tests auf `upgrading.md`-Abschnitt und `version` in `config/werkbuch.php`.
- CI: neuer Job `image` (Multi-Arch-Build ohne Push bei jedem PR); der Job `e2e` läuft ab jetzt gegen den Compose-Stack mit dem lokal gebauten Image.

**Doku:** `setup` (bindet die echte Compose-Datei ein), `reverse-proxy` (NPM mit „Websockets Support“, Traefik, Caddy), `upgrading`, `backup`, Mindestanforderungen (RAM für Meilisearch), en + de.

**Abnahme:** Erfolgskriterium 1: `docker compose up -d` startet alles auf Port 7740, Admin und Standard-Bot existieren, Live-Updates laufen über denselben Port.

## Phase 15: Feinschliff

**Branch:** `feat/phase-15-polish` · **Phasenplan:** `…phase-15-polish.md`

**Liefert:**
- Last-Seeder mit etwa 50.000 Items in 20 Projekten; Listen, Board, Suche und API ohne spürbare Wartezeit (Indizes, N+1, Virtualisierung).
- Restliche Punkte aus `2026-10-28-werkbuch-clickdummy-deferred.md`, die gegen den Code noch gelten (Einstellungen im Lese-Look statt ausgegraut, leere Zustände mit nächstem Schritt, Skelette nach etwa 300 ms, 422 auf ein nicht gezeigtes Feld, „Du liest nur mit.“ bei Org-Admins, Witwen in Seitentiteln, Galerie-Muster für Screenreader).
- Barrierefreiheit über alle Seiten (axe in Playwright), Erfolgskriterium 6: jeder Ablauf nur mit der Tastatur.
- Screenshots per Playwright aus Demo-Daten in beiden Sprachen (`docs/public/screenshots/{en,de}/`), Landingpage der Doku, README (Englisch) mit Screenshots, `docs.yml` für GitHub Pages unter `DOCS_BASE`, Doku-Durchsicht (Struktur, Links, Screenshots per Test).
- Checkliste für die manuellen Tests (Spec 11.5) in `docs/superpowers/plans/2026-10-30-werkbuch-manual-tests.md` aus den Erfolgskriterien und Kapitel 4; `docs/history/`-Eintrag; `CLAUDE.md` final.

**Abnahme:** alle Erfolgskriterien aus Spec 1 grün in CI; Doku baut in beiden Sprachen vollständig. Danach manuelle Tests durch Rafael; Release v0.1.0 erst nach seiner Freigabe.

---

## Entscheidungen dieses Plans (bitte prüfen)

- **REST wächst mit jeder Phase** statt in einer späten Phase 11 wie im Vorschlag der Spec, weil die UI ab dem ersten Bildschirm nur über `/api/v1` liest und schreibt (Spec 7.3). Phase 12 schließt nur Lücken, Query Builder, Rate-Limits und OpenAPI.
- **Reihenfolge:** Views vor Editor und Suche vor Editor, damit die Item-Listen früh stehen und `#`-Verweise auf eine fertige Suche treffen. Benachrichtigungen nach dem Editor, weil Erwähnungen und Kommentare ihre wichtigsten Auslöser sind.
- **Aufräumen 13b/13c im Port statt im Klickdummy:** Der Klickdummy bleibt eingefroren. Große Dateien werden beim Übertragen geteilt, Doppeltes zusammengeführt, und die offenen Punkte der Deferred-Liste sind den Phasen zugeteilt, deren Bildschirme sie betreffen. Doppelte Arbeit am Prototyp entfällt.
- **Routing über Inertia mit denselben Pfaden wie der Klickdummy;** React Router fällt weg.
- **Event-Typen tragen die Namen des Webhook-Katalogs**, damit History, Outbox und Webhooks dieselbe Liste haben.
- **CI ab Phase 1:** `tests` prüft die App; der Klickdummy wandert in den freiwilligen Job `clickdummy`.
- **Die History fasst Änderungen derselben Person innerhalb von 5 Minuten zusammen** (Spec 13 lässt den Wert offen).
- **Merge je Phase nach grüner CI durch den Orchestrator** mit `--admin` wie in openbill; Rafael kann jede Phase im PR anhalten.

## Fortschritt

- [ ] Phase 1: Fundament
- [ ] Phase 2: Organisation, Konten, Rollen, Projekte
- [ ] Phase 3: Workflows, Typen, Properties, Kataloge
- [ ] Phase 4: Work Items, Relationen, History
- [ ] Phase 5: Views, Filter-Engine, Listen-Layouts
- [ ] Phase 6: Suche und Befehlspalette
- [ ] Phase 7: Editor, Kommentare, Anhänge
- [ ] Phase 8: Benachrichtigungen, Mail, Live-Updates
- [ ] Phase 9: Wiki
- [ ] Phase 10: Vorlagen, Zeitpläne, Automatisierungen
- [ ] Phase 11: Webhooks
- [ ] Phase 12: REST vollständig und OpenAPI
- [ ] Phase 13: MCP
- [ ] Phase 14: Docker und Release
- [ ] Phase 15: Feinschliff
