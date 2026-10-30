# Phase 2: Organisation, Konten, Rollen, Projekte – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auf dem Fundament von Phase 1 die Organisation, Personen und Bots, Einladungen, Rollen mit spatie-Teams, Tokens, TOTP-2FA und Projekte mit Mitgliedern und Favoriten bauen: als Actions mit Events in der Outbox, als REST unter `/api/v1` und als portierte Bildschirme des Klickdummys (Einstellungen Organisation, Persönlich, Projekt; Projekte-Übersicht; Einladung annehmen; Seitenleiste mit Favoriten).

**Architecture:** Jeder Anwendungsfall ist eine Action in `app/Actions/<Bereich>/` mit `handle(Actor $actor, …)`; sie prüft das Recht über Policies (`App\Access\Authorize`), validiert, schreibt in `DB::transaction` und legt dort über `EventRecorder` Events an. Nach dem Commit verteilt `DispatchEvent` jedes Event an die Konsumenten aus `config('werkbuch.event_consumers')` (in dieser Phase keine echten, nur Test-Konsumenten); `event_consumptions` macht jeden Konsumenten idempotent, `app:redispatch-events` holt Liegengebliebenes nach. Rollen liegen in spatie/laravel-permission v8 mit Teams (Team = ULID der Organisation bzw. des Projekts); welche Rolle welches Recht hat, steht fest in `App\Access\Grants`, die Datenbank spiegelt es (`app:sync-roles`). `App\Access\Visibility` ist der einzige Zugriffs-Scope. Controller unter `app/Http/Controllers/Api/` sind dünn, `app/Http/Resources/*Resource.php` haben die Formen aus `prototypes/clickdummy/src/types.ts`. Das Frontend ersetzt die Fake-API durch `resources/js/api/<ressource>.ts` mit denselben Funktionsnamen und Signaturen und portiert die Bildschirme mit `t()`.

**Tech Stack:** wie Phase 1, neu: laravel/sanctum 4.3, spatie/laravel-permission 8.3 (Teams), spatie/laravel-medialibrary 11.23; 2FA über Fortify (pragmarx/google2fa und bacon/bacon-qr-code kommen mit Fortify). Keine neuen npm-Pakete.

**Spec:** `docs/superpowers/specs/2026-10-28-werkbuch-design.md` (4.1–4.4, 5.2, 6.1, 7.2, 7.4, 7.5, „Änderungen vom …“), Master-Plan `…/plans/2026-10-30-werkbuch-app.md` (Global Constraints, Review Focus, Verträge, Phase 2; die Verträge bleiben unverändert, Erweiterungen stehen in P5, P12, P13, P14), Rulings `…/plans/2026-10-30-werkbuch-app-rulings.md`, Klickdummy `prototypes/clickdummy/{README.md,DESIGN.md,src/}`. Vorbild: openbill (`tests/Feature/Api/RightsMatrixTest.php`, `app/Actions/{InviteUser,AcceptInvitation}.php`, `app/Support/InvitationLinks.php`).

---

## Global Constraints

Es gelten alle Global Constraints des Master-Plans und alle Regeln aus `CLAUDE.md`. Für Phase 2 entscheidend:

- Branch `feat/phase-02-accounts`. Vor dem ersten Commit `git config user.email` → muss `rafael@hauss.dev` sein, sonst stoppen und nachfragen; nie `user.email`/`user.name` setzen, nie `rafael@lulububu.de`. Commits englisch, Conventional Commits, letzte Zeile `Co-Authored-By: <tatsächliches Modell> <noreply@anthropic.com>` (die Commit-Schritte nennen nur den Betreff, der Trailer gehört immer dazu).
- PHP, Composer, Artisan und pnpm der App nur in DDEV (`ddev composer …`, `ddev artisan …`, `ddev exec pnpm …`); `e2e/` auf dem Mac. Nur pnpm, nie npm oder npx. Pakete einmal installieren (Task 1), nicht in späteren Tasks erneut `require`n.
- Primärschlüssel ULID in allen eigenen Tabellen; Paket-Tabellen siehe P3.
- Fachlogik nur in `app/Actions` und `app/Domain`. Controller, Middleware, Commands, Jobs und `app/Auth/` rechnen nicht und schreiben weder Modelle noch per `DB::table`. **Jede schreibende Action legt in ihrer Transaktion mindestens ein Event an; jede Action steht in der Rechte-Matrix** (Ausnahmen in der Matrix nur `App\Actions\Auth`, `App\Actions\Setup` und der Lese-Helfer `App\Actions\Accounts\NextHandle`, mit Grund in der Matrix-Datei; einzige schreibende Action ohne eigenes Event ist `PurgeProject`, das nach dem `project.deleted` aus `DeleteProject` nur aufräumt — die Matrix-Zeile sagt es, P26).
- Die UI liest und schreibt nur über `/api/v1` (Session mit CSRF, Sanctum stateful). Ausnahmen wie in Phase 1: Anmeldung, 2FA-Abfrage beim Login und Einladung annehmen laufen als Web-Formulare (vor der Anmeldung gibt es keine API-Sitzung).
- `resources/js/api/<ressource>.ts` exportiert dieselben Namen und Signaturen wie `prototypes/clickdummy/src/api/<ressource>.ts`; Abweichungen nur wie in P13 festgelegt.
- Texte: jeder deutsche Text des Klickdummys wird ein Schlüssel in `lang/de.json` (wörtlich) und `lang/en.json` (englische Fassung); Schlüssel ohne Ziffern, alphabetisch, gleiche Platzhalter. Neue `reason`-Codes in `Problem::REASONS` und `lang/*.json` (`problem.reason.<code>`, das Frontend liest sie über `reasonText()`) zugleich. Dynamisch gebaute Schlüssel (`roles.org.<rolle>`, `roles.project.<rolle>`, `problem.reason.<code>`) findet der Scan nicht: sie stehen vollständig in beiden Dateien.
- Abdeckung 100 % Zeilen PHP und Frontend (Vitest + Playwright zusammengeführt) **am Ende jeder Task**; keine Datei unter einer Vitest-Schwelle ohne eigenen Test; keine unerreichbaren Zweige (lieber Code weglassen als `@codeCoverageIgnore`).
- Demo- und Testdaten nur fiktiv (Feldwerk, die Personen aus `prototypes/clickdummy/src/api/seed/people.ts`, `@example.com`).
- `CLAUDE.md` wird im selben Commit angepasst wie die Änderung, die eine Angabe dort ändert (Kommandos, Architektur, Fallstricke).
- Der Klickdummy bleibt unverändert.

## Review Focus

- **Outbox doppelt oder gar nicht** (Master Review Focus 1): Zwei `DispatchEvent` für dasselbe Event (Nachverteiler, während der erste Dispatch noch in der Queue liegt) lassen jeden Konsumenten genau einmal laufen; ein Event, dessen Dispatch nach dem Commit nie lief, verteilt `app:redispatch-events` nach mehr als 2 Minuten genau einmal; eine zurückgerollte Transaktion hinterlässt weder Event noch Dispatch; ein Konsument, der wirft, wird beim nächsten Versuch erneut ausgeführt. → Task 3, `OutboxTest`.
- **Datenleck über private Projekte:** Wer ein privates Projekt nicht sieht, bekommt auf jedem Weg 404 ohne `detail` (Detail, Mitglieder, Beitreten, Favorit, Bild, Einstellungsseite), nie 403, und keine Liste nennt es; nach dem Entfernen aus einem privaten Projekt verschwindet es sofort aus Liste und Favoriten. → Task 4 `VisibilityTest`, Task 11/12 `ProjectRightsTableTest`, Rechte-Matrix (Spalte `outsider_private`).
- **Letzter Admin:** Der letzte aktive Org-Admin unter den Personen lässt sich weder herabstufen noch deaktivieren, auch wenn der Standard-Bot Admin ist oder fehlt; die Prüfung sperrt die Admin-Zeilen (`lockForUpdate`), damit sich zwei Admins nicht gleichzeitig gegenseitig herabstufen. → Task 8, `LastAdminTest`.
- **Einladungslinks:** Ein Link gilt 7 Tage, nur mit gültiger Signatur, nur einmal; eine neue Einladung an dieselbe Adresse macht den alten Link ungültig; ein Link eines inzwischen herabgestuften oder deaktivierten Admins ist geschlossen; der Link beginnt immer mit `APP_URL`. → Task 9, `InvitationTest`.
- **Deaktivieren und Passwortwechsel beenden alles:** Nach dem Deaktivieren scheitern die Tokens (401) und die nächste Anfrage jeder Sitzung (Web: zur Anmeldung, API: 401), unabhängig vom Session-Treiber; nach einem Passwortwechsel bleibt nur die Sitzung gültig, die ihn gemacht hat. → Task 5 `SessionEndTest`, Task 8 `DeactivateUserTest`, Task 10 `ChangePasswordTest`.
- **Kennungswechsel:** Eine alte Kennung löst weiter auf (REST und Einstellungsseite leiten auf die neue), ist für andere Projekte reserviert und wird beim Zurückbenennen wieder frei; beim Löschen werden alle Kennungen frei. → Task 11 `ProjectIdentifierTest`, Task 17 `ProjectPagesTest`.

## Gates

Am Ende jeder Task laufen die Gates, die die Task nennt; alle Ergebnisse grün.

- **G1 (PHP):** `ddev artisan test --coverage --min=100` → `Total: 100.0 %`; `ddev exec vendor/bin/phpstan analyse --memory-limit=1G` → `[OK] No errors`; `ddev exec vendor/bin/pint --test` → `PASS`.
- **G2 (Frontend):** `ddev exec pnpm typecheck && ddev exec pnpm test:coverage` → keine Typfehler, alle Vitest-Schwellen erfüllt.
- **G3 (e2e, zusammengeführt):** `ddev exec pnpm build:coverage && pnpm --dir e2e test && ddev exec pnpm build` → alle Playwright-Projekte grün, der Global-Teardown (`coverage:merge`) meldet 100 % Zeilen über `resources/js/**`. Vorher `ddev exec pnpm dev` beenden.

Jede Task, die Dateien unter `resources/js/pages/`, `resources/js/features/` oder `resources/js/shell/` anlegt oder ändert, nennt G3 und bringt die Playwright-Specs und Vitest-Tests mit, die ihre neuen Zeilen decken: Abläufe per Playwright (nur Tastatur, wie Phase 1), Fehler- und Ladezustände per `page.route(…, (r) => r.fulfill({ status: 503 }))` oder per Vitest der Feature-Datei mit gemocktem `fetch` (Helfer `resources/js/test/api.ts`, Task 13).

---

## Dateistruktur nach Phase 2

| Ort | Inhalt |
|---|---|
| `app/Access/` | `Permission`, `OrgRole`, `ProjectRole` (Enums), `Grants`, `RoleIndex`, `RoleAssignments`, `Visibility`, `Authorize` |
| `app/Actions/{Organization,Users,Invitations,Tokens,Account,Projects,Favorites,Media}/` | die Anwendungsfälle dieser Phase |
| `app/Actions/Auth/` | Anmelde-Actions (Phase 1) plus `EndSessions`, `CheckInvitation`, `AcceptInvitation` |
| `app/Actions/Setup/` | `SyncRoles`, `EnsureDefaultBot` (Migrationen und Kommandos, ohne Actor) |
| `app/Domain/Projects/` | `Identifier` |
| `app/Events/` | `EventType`, `EventRecorder`, `EventConsumer`, `Outbox` |
| `app/Http/Controllers/Api/`, `app/Http/Resources/` | REST-Controller und die Resources (eine je Ressource) |
| `app/Jobs/` | `DispatchEvent`, `ConsumeEvent`, `PurgeProject` |
| `app/Policies/` | `OrganizationPolicy`, `UserPolicy`, `ProjectPolicy` |
| `app/Support/` | `Actor`, `ListResult`, `PageArgs`, `ImageInput`, `InvitationLinks` |
| `resources/js/api/`, `resources/js/hooks/` | `organization`, `users`, `tokens`, `projects`, `views` (nur Favoriten), `security`; `keys.ts`, `mutation.ts` |
| `resources/js/domain/` | `tz.ts`, `people.ts` (Port mit Tests) |
| `resources/js/features/settings/frame/` | gemeinsamer Einstellungsrahmen und Verlassen-Schutz (R26, 13b) |
| `resources/js/features/settings/{org,personal,project,tokens}/`, `resources/js/features/projects/`, `resources/js/features/favorites/` | die portierten Bildschirme |

## Paketversionen

Composer (Packagist am 2026-10-30, illuminate-Constraint der neuesten stabilen Version):

| Paket | Constraint | neueste | Laravel 13 | Hinweis |
|---|---|---|---|---|
| `laravel/sanctum` | `^4.3` | 4.3.3 (2026-06-23) | ja (`^11\|^12\|^13`) | Migration nur veröffentlicht, nicht automatisch geladen: eigene ULID-Migration |
| `spatie/laravel-permission` | `^8.3` | 8.3.2 (2026-10-19) | ja (`^12\|^13`) | Teams-API v8 im Quellcode 8.3.2 geprüft, siehe P2 |
| `spatie/laravel-medialibrary` | `^11.23` | 11.23.11 (2026-10-26) | ja (`^12\|^13`) | eigene Migration mit `ulidMorphs('model')` |

**spatie/laravel-permission 8.3.2, geprüft im Quellcode (Tag `8.3.2`):** `config/permission.php` hat `teams` (Standard `false`), `team_resolver` (`DefaultTeamResolver`, speichert `int|string|null`), `column_names.team_foreign_key` (`team_id`), `column_names.model_morph_key` (`model_id`), `register_permission_check_method` (Standard `true`: ein `Gate::before`, das jede Fähigkeit mit gleichem Namen über `checkPermissionTo` beantwortet). Die Migrations-Vorlage legt `team_id` und `model_id` als `unsignedBigInteger` an. `setPermissionsTeamId(int|string|Model|null)` und `getPermissionsTeamId()` sind Helfer und Methoden des `PermissionRegistrar`. `HasRoles::roles()` filtert den Pivot mit `wherePivot('team_id', getPermissionsTeamId())` und Rollen mit `roles.team_id IS NULL OR = Team`; `assignRole` lädt `roles` neu und hängt mit dem aktuellen Team an, `syncRoles` löst nur die Rollen des aktuellen Teams. Daraus folgt P2.

Keine neuen npm-Pakete; TOTP in `e2e/` mit `node:crypto` (RFC 6238, Helfer in `e2e/helpers.ts`).

## Port-Umfang aus `prototypes/clickdummy/src/`

| Portiert in Phase 2 | Ziel | Task |
|---|---|---|
| `api/{organization,users,tokens,projects}.ts`, aus `api/views.ts` nur `listFavorites`, `toggleFavorite`; `settings/personal/securityApi.ts` als `api/security.ts` | `resources/js/api/` | 13 |
| `hooks/{keys,organization,users,tokens,projects}.ts`, aus `hooks/views.ts` nur `useFavorites`, `useToggleFavorite`; aus `hooks/mutation.ts` nur `useApiMutation`, `useSettle` | `resources/js/hooks/` | 13 |
| `lib/permissions.ts`, `domain/{people,tz}.ts` (mit Tests), `settings/personal/zones.ts` + `settings/org/catalog.ts` (`COMMON_ZONES`) als ein `lib/zones.ts` | `resources/js/lib/`, `resources/js/domain/` | 13 |
| `settings/project/{SettingsParts,form}.ts(x)`, `settings/org/{parts,errors,format,LeaveGuard,useDialogRound,useRemoval,access}.ts(x)` zusammengeführt (13b) | `resources/js/features/settings/frame/` | 14 |
| `settings/org/{OrgSettings,sections,General,People,Bots}.tsx` | `resources/js/features/settings/org/` | 15 |
| `settings/personal/{TokenDialog,SetupSnippets,CopyButton,snippets}.ts(x)` und der `TokenDialog` aus `settings/org/Bots.tsx` zusammengeführt (13b) | `resources/js/features/settings/tokens/` | 15 |
| `settings/personal/{PersonalSettings,Profile,Security,TwoFactor,ApiAndMcp,QrPlaceholder→QrCode,twoFactorCodes}.ts(x)` | `resources/js/features/settings/personal/` | 16 |
| `features/projects/*`, `settings/project/{ProjectSettings,General,Members,DangerZone,ImageField}.tsx`, Projekte-Teil von `app/Sidebar.tsx`, `features/views-overview/FavoriteStar.tsx` (als `features/favorites/FavoriteToggle.tsx`) | `resources/js/features/…`, `resources/js/shell/Sidebar.tsx` | 17 |
| `features/auth/Invitation.tsx` | `resources/js/features/auth/Invitation.tsx` | 9 |

Nicht in Phase 2: `Notifications.tsx` (Phase 8), Org-Abschnitte Workflows bis System (3, 8, 11), Projekt-Abschnitte Workflow, Typen (3), Automatisierungen (10), Workflow und Typen im Dialog „Neues Projekt“ (3), offene Items auf Projektkarten (4), `useCommand`/`registerCommand` (Palette, 6), `twoFactorStore.ts`, `useProjectItems.ts`.

## Abdeckung über die Tasks

- **PHP:** G1 am Ende jeder Task. Jede Task bringt Tests für ihren PHP-Code; die Rechte-Matrix (`tests/Feature/Access/RightsMatrixTest.php`, Zeilen in `tests/Feature/Access/matrix.php`) und die Routen-Matrix (`tests/Feature/Api/RouteMatrixTest.php`, Zeilen in `tests/Feature/Api/routes.php`) entstehen in Task 7 mit Wächtertests; ab dann fügt jede Task, die eine Action oder eine Route anlegt, ihre Zeilen im selben Commit hinzu, sonst ist der Wächter rot.
- **Frontend, Vitest:** G2 ab Task 7. Neue Schwellen (100 % Zeilen) in `vitest.config.ts`: `resources/js/domain/**` (Task 13), `resources/js/features/settings/frame/**` (Task 15, sobald die Bildschirme den Rahmen benutzen; Task 14 bringt trotzdem Tests je Datei, P30). `api/`, `hooks/`, `lib/` haben ihre Schwellen aus Phase 1.
- **Frontend, zusammengeführt:** G3 in den Tasks 7, 9, 10, 15, 16, 17 (sie ändern `pages/`, `features/` oder `shell/`), dazu in 1, 5, 6 und 13 (Middleware, e2e-Helfer, `app.tsx`). G1 läuft in jeder Task, die `lang/*.json` ändert (`TranslationKeysTest`). Neue Specs in `e2e/tests/`: `invitation.spec.ts` (9), `two-factor.spec.ts` (10), `settings-organization.spec.ts` (15), `settings-personal.spec.ts` (16), `projects.spec.ts` und `onboarding.spec.ts` (17). Jede läuft in allen vier Playwright-Projekten; Daten, die eine Spec anlegt, tragen eine Lauf-Kennung (`runId()` aus `e2e/helpers.ts`), Konten, die eine Spec verändert, gibt es je Projekt (`E2eSeeder`).

### Task 1: Pakete, Paket-Tabellen mit ULID, Morph-Map, Exception-Rendering unter `app/`

**Files:**
- Create: `config/sanctum.php`, `config/permission.php`, `config/media-library.php`, `database/migrations/2026_10_31_000100_create_personal_access_tokens_table.php`, `…_000110_create_permission_tables.php`, `…_000120_create_media_table.php`, `app/Models/PersonalAccessToken.php`, `app/Exceptions/Rendering.php`, `tests/Feature/PackageTablesTest.php`, `tests/Feature/MorphMapTest.php`, `tests/Feature/SanctumTest.php`
- Modify: `composer.json`, `composer.lock`, `bootstrap/app.php`, `app/Models/User.php` (`use HasApiTokens`), `app/Providers/AppServiceProvider.php`, `tests/Feature/InertiaTest.php`, `CLAUDE.md` (Tech Stack, Architektur „Problem“: Rendering-Klasse)

**Interfaces:**
- Consumes: `ProblemResponse`, `HandleInertiaRequests`, `SetLocale` (Phase 1)
- Produces:
  - `config/sanctum.php`: `stateful` wie veröffentlicht (enthält den Host aus `APP_URL`), `guard => ['web']`, `expiration => null`, `token_prefix => 'wb_'`.
  - `config/permission.php`: `teams => true`, `register_permission_check_method => false` (P2), `column_names.model_morph_key => 'model_id'`, `column_names.team_foreign_key => 'team_id'`, `events_enabled => false`, Rest wie veröffentlicht.
  - `config/media-library.php`: `disk_name => env('FILESYSTEM_DISK', 'local')` (privat, `storage/app/private`), `max_file_size => 2 * 1024 * 1024`, `queue_conversions_by_default => false`.
  - Migrationen: `personal_access_tokens` mit `ulid('id')->primary()`, `ulidMorphs('tokenable')`, `name`, `token(64) unique`, `abilities text null`, `last_used_at`, `expires_at index`, Zeitstempel. Permission-Tabellen wie die v8-Vorlage, aber `roles.team_id` und `model_has_*.team_id` als `ulid` (in `roles` nullable), `model_has_*.model_id` als `ulid`; `roles.id`/`permissions.id` bleiben `bigIncrements` (P3). `media` wie die Vorlage von medialibrary 11, aber `ulidMorphs('model')`; `id` bleibt `bigIncrements`, `uuid` unique.
  - `User` bekommt `Laravel\Sanctum\HasApiTokens` (für `createToken()` im `SanctumTest` und in Task 10).
  - `final class App\Models\PersonalAccessToken extends Laravel\Sanctum\PersonalAccessToken` mit `HasUlids`; in `AppServiceProvider::boot()`: `Sanctum::usePersonalAccessTokenModel(PersonalAccessToken::class)`.
  - `AppServiceProvider::boot()`: `Relation::enforceMorphMap(['user' => User::class, 'token' => PersonalAccessToken::class])`; spätere Tasks ergänzen ihre Modelle in derselben Liste.
  - `final class App\Exceptions\Rendering { public static function register(Exceptions $exceptions): void }` — enthält wörtlich die bisherigen Callbacks aus `bootstrap/app.php` (`dontReportWhen`, Problem Details unter `/api`, Drossel am E-Mail-Feld, 419 mit Meldung, Inertia-Fehlerseiten, `shouldRenderJsonWhen`); `bootstrap/app.php` ruft nur noch `Rendering::register($exceptions)` (vorgemerkt: PCOV misst nur `app/`).
  - `bootstrap/app.php`: `$middleware->statefulApi()`; in der Prioritätsliste steht `HandleInertiaRequests::class` direkt nach `PreventRequestForgery::class` (vorgemerkt).

- [ ] **Step 1: Pakete installieren (einmal für die ganze Phase)**

```bash
ddev composer require laravel/sanctum:^4.3 spatie/laravel-permission:^8.3 spatie/laravel-medialibrary:^11.23
ddev artisan vendor:publish --tag=sanctum-config
ddev artisan vendor:publish --provider="Spatie\Permission\PermissionServiceProvider" --tag=permission-config
ddev artisan vendor:publish --provider="Spatie\MediaLibrary\MediaLibraryServiceProvider" --tag=medialibrary-config
```

Nicht `install:api` (legt eine Migration mit `morphs` und eine `routes/api.php` an) und keine Migrations-Vorlagen veröffentlichen; die drei Migrationen werden von Hand mit ULID geschrieben.

- [ ] **Step 2: Failing Tests schreiben**

`PackageTablesTest.php`:

```php
it('keys the package tables to ULID models', function (string $table, string $column) {
    expect(Schema::getColumnType($table, $column))->toBe('char')
        ->and(collect(Schema::getColumns($table))->firstWhere('name', $column)['type'])->toContain('26');
})->with([
    ['personal_access_tokens', 'id'], ['personal_access_tokens', 'tokenable_id'],
    ['model_has_roles', 'model_id'], ['model_has_roles', 'team_id'], ['model_has_permissions', 'model_id'],
    ['roles', 'team_id'], ['media', 'model_id'],
]);

it('issues a Sanctum token whose id is a ULID and that finds its account', function () {
    $user = User::factory()->create();
    $plain = $user->createToken('t', ['read'])->plainTextToken;
    [$id, $secret] = explode('|', $plain, 2);
    expect(Str::isUlid($id))->toBeTrue()->and($secret)->toStartWith('wb_')
        ->and(PersonalAccessToken::findToken($plain)?->tokenable->is($user))->toBeTrue();
});
```

`MorphMapTest.php`: `Relation::getMorphedModel('user')` ist `User::class`; `(new User)->getMorphClass()` ist `'user'`; ein Modell ohne Eintrag wirft `ClassMorphViolationException` (anonyme Model-Klasse, `getMorphClass()`).

`SanctumTest.php`: `GET /sanctum/csrf-cookie` → 204 mit Cookie `XSRF-TOKEN`; `config('permission.register_permission_check_method')` ist `false` und `Gate::forUser($user)->allows('org.manage')` ohne Policy ist `false` (kein spatie-Hook).

`InertiaTest.php` ergänzen („shares the props on a 404 from a route binding“): Testroute `Route::middleware(['web', 'auth'])->get('_t/bound/{user}', fn (User $user) => 'x')`, angemeldet mit unbekannter ULID → 404, Komponente `Errors/NotFound`, Prop `locale` gesetzt.

- [ ] **Step 3: Rot, implementieren, grün**

```bash
ddev artisan test --filter='PackageTablesTest|MorphMapTest|SanctumTest|InertiaTest'
```

Expected: erst FAIL (Tabellen fehlen), nach den Migrationen, der Morph-Map, `Rendering` und `statefulApi()` PASS; die Tests aus Phase 1 (`ProblemTest`, `ErrorPagesTest`, `CsrfExpiryTest`, `LoginThrottleTest`) bleiben unverändert grün, jetzt mit den Zeilen von `Rendering` in der Abdeckung.

- [ ] **Step 4: Gates G1, G2, G3** (G3, weil die Middleware-Reihenfolge jede Seite betrifft; keine Frontend-Datei ändert sich)

- [ ] **Step 5: Commit**

Betreff: `feat: add Sanctum, permission and media library with ULID keys, enforce the morph map, move exception rendering into app/`.

---

### Task 2: Datenmodell für Organisation, Konten und Projekte

**Files:**
- Create: `database/migrations/2026_10_31_000200_create_organization_table.php`, `…_000210_extend_users_table.php`, `…_000220_create_projects_tables.php`, `…_000230_create_favorites_table.php`, `app/Models/{Organization,Project,ProjectIdentifier,ProjectMember,Favorite}.php`, `app/Enums/ProjectVisibility.php`, `database/factories/{ProjectFactory,FavoriteFactory}.php`, `tests/Feature/Models/{OrganizationTest,ProjectModelTest,UserModelTest}.php`
- Modify: `app/Models/User.php`, `database/factories/UserFactory.php`, `app/Enums/Locale.php`, `app/Http/Middleware/SetLocale.php` (Kommentar), `app/Providers/AppServiceProvider.php` (Morph-Map, `scoped`), `tests/Feature/LocaleTest.php`, `tests/Feature/UserTest.php`

**Interfaces:**
- Consumes: Task 1
- Produces:
  - `organization`: `ulid id`, `name(120)`, `locale(2)`, `timezone(64)`, `week_start` (tinyint, 0 oder 1), Zeitstempel. Die Migration legt genau eine Zeile an: `name = config('app.name')`, `locale = Locale::tryFrom(config('app.locale')) ?? en`, `timezone = 'UTC'`, `week_start = 1`.
  - `users` ergänzt (A6): `is_default_bot` bool default false (index), `owner_id` ulid nullable FK `users` nullOnDelete, `description` string(500) nullable, `two_factor_secret` text nullable, `two_factor_recovery_codes` text nullable, `two_factor_confirmed_at` timestamp nullable.
  - `projects`: `ulid id`, `identifier(10)` unique, `name(120)`, `description` text (≤ 2000, leer erlaubt), `lead_id` ulid FK `users`, `visibility(16)`, `workflow_id` ulid nullable (ohne FK bis Phase 3), `default_type_id` ulid nullable (ohne FK bis Phase 3), `next_number` unsigned int default 0, `archived_at`, `deleting_at` (P10), Zeitstempel. `project_identifiers`: `ulid id`, `identifier(10)` unique, `project_id` FK cascade, Zeitstempel. `project_members`: `ulid id`, `project_id` FK cascade, `user_id` FK cascade, Zeitstempel, unique `(project_id, user_id)` (die Rolle steht bei spatie, P2).
  - `favorites`: `ulid id`, `user_id` FK cascade, `ulidMorphs('favoritable')`, `position` unsigned int, Zeitstempel, unique `(user_id, favoritable_type, favoritable_id)`.
  - `final class Organization` (`HasUlids`): `public static function current(): self` → `app(self::class)`; `AppServiceProvider::register()`: `$this->app->scoped(Organization::class, fn () => Organization::query()->sole())`. Casts `locale` → `Locale`, `week_start` → `int`.
  - `final class Project` (`HasUlids`, `HasFactory`): Casts `visibility` → `ProjectVisibility` (`Public = 'public'`, `Private = 'private'`), `archived_at`, `deleting_at` → `datetime`; Relationen `lead()`, `identifiers()`, `memberships()`; `public static function findByReference(string $ref): ?self` (ULID, Kennung oder frühere Kennung, Groß/klein egal, ohne Sichtbarkeitsprüfung).
  - `ProjectIdentifier`, `ProjectMember`, `Favorite` (`HasUlids`, Relationen).
  - `User`: Fillable/Casts für die neuen Spalten (`is_default_bot` bool, `two_factor_confirmed_at` datetime), `#[Hidden]` ergänzt um `two_factor_secret`, `two_factor_recovery_codes`; `owner()`; `public static function defaultBot(): self` (`where('is_default_bot', true)->sole()`); `public function isBot(): bool`; `locale` und `timezone` bleiben nullable, `effectiveLocale(): Locale` und `effectiveTimezone(): string` fallen auf die Organisation zurück; `preferredLocale()` nutzt `effectiveLocale()`.
  - `Locale::default()` → `Organization::current()->locale` (vor dem Login gilt laut Spec 7.3 der Standard der Organisation).
  - Morph-Map ergänzt: `organization`, `project`.
  - `UserFactory`: Zustände `bot(?User $owner = null)`, `defaultBot()`, `disabled()` (bestehend), `locale()`; `ProjectFactory`: `public()`, `private()`, `archived()`, `identifier(string)`, Standard-Lead ist eine neue Person.

- [ ] **Step 1: Failing Tests schreiben**

`OrganizationTest.php`: „has exactly one organization after the migrations“ (`Organization::count() === 1`, `current()` liefert sie, `locale` ist `Locale`, `week_start` 1, `timezone` `UTC`); „answers the same instance within a request“ (`current() === current()`).

`ProjectModelTest.php`:

```php
it('finds a project by id, identifier and former identifier in any case', function () {
    $project = Project::factory()->identifier('WEB')->create();
    $project->identifiers()->create(['identifier' => 'SITE']);
    expect(Project::findByReference($project->id)?->is($project))->toBeTrue()
        ->and(Project::findByReference('web')?->is($project))->toBeTrue()
        ->and(Project::findByReference('SITE')?->is($project))->toBeTrue()
        ->and(Project::findByReference('NOPE'))->toBeNull();
});
```

Dazu: Mitgliedschaft doppelt → `UniqueConstraintViolationException`; Kennung in `project_identifiers` doppelt → ebenso; Löschen des Projekts entfernt Kennungen und Mitgliedschaften (FK cascade).

`UserModelTest.php`: `defaultBot()` wirft ohne Standard-Bot `ModelNotFoundException`; `effectiveLocale()`/`effectiveTimezone()` nehmen die eigenen Werte, sonst die der Organisation; die 2FA-Spalten stehen nicht in `toArray()`.

`LocaleTest.php` ergänzen: Organisation auf `de` → ein Gast ohne Cookie bekommt `<html lang="de">`; Cookie `en` schlägt die Organisation.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='OrganizationTest|ProjectModelTest|UserModelTest|LocaleTest|UserTest'`; Expected: erst FAIL, dann PASS.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit**

Betreff: `feat: add the organization record, project tables, favorites and the account columns for bots and two-factor sign-in`.

---

### Task 3: Actor und Outbox

**Files:**
- Create: `database/migrations/2026_10_31_000300_create_events_tables.php`, `app/Models/{Event,EventConsumption}.php`, `app/Support/Actor.php`, `app/Events/{EventType,EventRecorder,EventConsumer,Outbox}.php`, `app/Jobs/{DispatchEvent,ConsumeEvent}.php`, `app/Console/Commands/RedispatchEventsCommand.php`, `tests/Support/RecordingConsumer.php`, `tests/Feature/Events/{OutboxTest,EventRecorderTest}.php`, `tests/Integration/EventRecorderTransactionTest.php`, `tests/Feature/ActorTest.php`, `tests/Unit/EventTypeTest.php`
- Modify: `routes/console.php`, `config/werkbuch.php` (Kommentar `event_consumers`), `tests/Unit/ArchTest.php`, `tests/Pest.php`, `app/Providers/AppServiceProvider.php` (Morph-Map `event`), `CLAUDE.md` (Architektur: Actor, Outbox; Kommandos: `app:redispatch-events`)

**Interfaces:**
- Consumes: `User`, `Project`, `PersonalAccessToken` (Tasks 1–2)
- Produces:
  - `events`: `ulid id`, `type(64)` index, `actor_id` ulid FK `users`, `ulidMorphs('subject')` (für `token` eine ULID dank Task 1), `project_id` ulid nullable index **ohne FK** (P10), `changes` json nullable, `meta` json, `occurred_at` `timestamp(6)` index, `dispatched_at` timestamp nullable index, Zeitstempel. `event_consumptions`: `ulid id`, `event_id` FK cascade, `consumer(120)`, `consumed_at`, Zeitstempel, unique `(event_id, consumer)`.
  - `final readonly class App\Support\Actor`: `public function __construct(public User $user, public string $via, public ?string $reason = null, public ?PersonalAccessToken $token = null)`; Konstanten `VIA_UI = 'ui'`, `VIA_API = 'api'`, `VIA_MCP = 'mcp'`, `VIA_AUTOMATION = 'automation'`, `VIA_TEMPLATE = 'template'`, `VIA_SYSTEM = 'system'`; `static fromRequest(Request $r): self` (Konto aus `$r->user()`, `via` `api` mit Token, wenn `currentAccessToken()` ein `PersonalAccessToken` ist, sonst `ui`; ohne Konto `AuthenticationException`); `static automation(string $reason): self` (`User::defaultBot()`, `automation`); `static system(User $u, string $reason): self`; `public function meta(): array` → `['via' => …, 'reason' => …]` plus `token_id`, wenn ein Token handelt.
  - `enum App\Events\EventType: string` mit dem ganzen Katalog aus Spec 6.3 (`project.created|updated|archived|deleted|member_added|member_removed`, `work_item.*` (9), `comment.*` (3), `page.*` (4), `bot.mentioned|assigned`, `template.run_failed`) und den Typen dieser Phase ohne Webhook: `project.restored` (Webhook ja, P11), `project.member_role_changed`, `organization.updated`, `user.created`, `user.updated`, `user.role_changed`, `user.deactivated`, `user.reactivated`, `user.invited`, `user.password_changed`, `user.two_factor_setup_started`, `user.two_factor_enabled`, `user.two_factor_disabled`, `user.recovery_codes_regenerated`, `bot.created`, `token.created`, `token.revoked`, `favorite.added`, `favorite.removed`. Methoden `webhook(): bool` (true genau für den Katalog aus 6.3 plus `project.restored`), `group(): string` (Teil vor dem Punkt).
  - `final class App\Events\EventRecorder`: `public static function record(EventType|string $type, Actor $actor, Model $subject, ?Project $project, ?array $changes = null, array $meta = []): Event` — wirft `LogicException('Events are recorded inside the transaction of an action.')` bei `DB::transactionLevel() === 0`; `meta` = `$actor->meta() + $meta`; `occurred_at = now()`; danach `DispatchEvent::dispatch($event->id)->afterCommit()`.
  - `interface App\Events\EventConsumer { public function key(): string; public function queue(): string; public function consume(Event $event): void; }`
  - `final class App\Events\Outbox`: `dispatch(string $eventId): void` (je Klasse aus `config('werkbuch.event_consumers')` ein `ConsumeEvent` in `queue()` des Konsumenten, danach `dispatched_at = now()` nur, wo es noch `null` ist); `consume(string $eventId, string $consumerClass): bool` (in `DB::transaction`: `EventConsumption::query()->insertOrIgnore(['event_id' => …, 'consumer' => $consumer->key(), 'consumed_at' => now(), …])`; 0 Zeilen → `false`, sonst `consume()` und `true`; wirft der Konsument, rollt die Zeile mit zurück); `redispatchStale(): int` (Events mit `dispatched_at = null` und `occurred_at < now()->subMinutes(2)`, je ein `DispatchEvent`, Anzahl zurück).
  - `DispatchEvent` (Queue `default`, `$tries = 5`, `$backoff = [10, 60, 300]`): `__construct(public string $eventId)`, `handle(Outbox $outbox)` → `$outbox->dispatch($this->eventId)`. `ConsumeEvent` (Queue des Konsumenten, gleiche Wiederholung): `__construct(public string $eventId, public string $consumer)`, `handle(Outbox $outbox)`.
  - `app:redispatch-events` (`RedispatchEventsCommand`) gibt „Redispatched <n> events.“ aus; `routes/console.php`: `Schedule::command('app:redispatch-events')->everyMinute()->withoutOverlapping()`.
  - `tests/Pest.php`: `function actor(User $user, string $via = Actor::VIA_UI): Actor`, `function consumers(string ...$classes): void` (setzt `werkbuch.event_consumers`).
  - `ArchTest.php`: rawWrites-Regex geschärft (vorgemerkt): erfasst auch `DB::connection(...)->table(...)->update(`, Ketten über Zeilenumbrüche und Closures (`DB::table('x')->where(fn ($q) => …)->delete()`); neue Regel `arch('only actions record events')->expect(EventRecorder::class)->toOnlyBeUsedIn(['App\Actions', 'Tests'])` (Jobs und Commands bleiben unter der bestehenden Regel ohne `DB` und ohne Modell-Schreibzugriffe; sie rufen nur `Outbox` bzw. Actions); Test „gives every action an Actor first“ (Reflection über `appFiles('app/Actions')` ohne `Auth/`, `Setup/` und `Accounts/NextHandle.php`: erster Parameter von `handle` hat den Typ `App\Support\Actor`).

- [ ] **Step 1: Failing Tests schreiben**

`tests/Support/RecordingConsumer.php`: `final class RecordingConsumer implements EventConsumer` mit statischem Zähler `public static array $seen = []` (Event-IDs), `key()` → `'recording'`, `queue()` → `'default'`, `consume()` hängt die ID an; Variante `FailingOnceConsumer` (wirft beim ersten Aufruf).

`OutboxTest.php` (Review Focus 1; `beforeEach`: `consumers(RecordingConsumer::class)`, `RecordingConsumer::$seen = []`):

```php
it('runs each consumer once when the event is dispatched twice', function () {
    $event = recordedEvent();                       // helper: DB::transaction(fn () => EventRecorder::record(...))
    DispatchEvent::dispatchSync($event->id);
    DispatchEvent::dispatchSync($event->id);        // the redispatcher picked it up while the first was queued

    expect(RecordingConsumer::$seen)->toBe([$event->id])
        ->and(EventConsumption::query()->where('event_id', $event->id)->count())->toBe(1)
        ->and($event->fresh()->dispatched_at)->not->toBeNull();
});

it('redispatches an event whose dispatch never ran, after two minutes and only once', function () {
    Queue::fake();                                   // nothing runs: the process died between commit and dispatch
    $event = recordedEvent();

    $this->travel(119)->seconds();
    $this->artisan('app:redispatch-events')->expectsOutput('Redispatched 0 events.');
    $this->travel(2)->seconds();
    $this->artisan('app:redispatch-events')->expectsOutput('Redispatched 1 events.');
    Queue::assertPushed(DispatchEvent::class, 2);

    // the lost original turns up late, next to the redispatch: both run, the consumer runs once
    $outbox = app(Outbox::class);
    Queue::pushed(DispatchEvent::class)->each(fn (DispatchEvent $job) => $job->handle($outbox));
    Queue::pushed(ConsumeEvent::class)->each(fn (ConsumeEvent $job) => $job->handle($outbox));
    $this->artisan('app:redispatch-events')->expectsOutput('Redispatched 0 events.');

    expect(RecordingConsumer::$seen)->toBe([$event->id]);
});
```

Dazu: „leaves neither event nor dispatch when the transaction rolls back“ (`Queue::fake()`, Transaktion wirft nach `record` → `Event::count() === 0`, `Queue::assertNothingPushed()`); „runs a consumer again after it failed“ (`FailingOnceConsumer`: erster `ConsumeEvent` wirft, keine Zeile in `event_consumptions`; zweiter Lauf zählt einmal); „puts each consumer in its own queue“ (`Queue::fake()`, Konsument mit `queue()` `search` → `ConsumeEvent` auf `search`); „schedules the redispatcher every minute“ (`Schedule`-Event mit `app:redispatch-events` und Ausdruck `* * * * *`).

`EventRecorderTest.php`: Felder (`type`, `actor_id`, `subject_type` `project`, `project_id`, `changes`, `meta` mit `via` und `reason`, `occurred_at` = gestellte Uhr); `token_id` in `meta`, wenn das Actor-Token gesetzt ist; ein unbekannter String-Typ wirft `ValueError`. Die `LogicException` außerhalb einer Transaktion prüft `tests/Integration/EventRecorderTransactionTest.php` (Suite `Integration` mit `DatabaseMigrations`, ohne die Test-Transaktion von `RefreshDatabase`, in der der Zweig nie erreichbar wäre).

`ArchTest.php` ergänzen: „runs every action that records events in a transaction“ — jede Datei unter `app/Actions`, die `EventRecorder` nennt, enthält `DB::transaction(` (Textscan über `appFiles('app/Actions')`).

`ActorTest.php`: `fromRequest` mit Session → `ui`, ohne Token; mit Bearer-Token → `api` und das Token; ohne Konto → `AuthenticationException`; `automation('Automatisierung: Auto-Archiv')` handelt als Standard-Bot (Factory `defaultBot()`); `system()`.

`EventTypeTest.php` (Unit): die Webhook-Typen sind genau der Katalog aus Spec 6.3 plus `project.restored` (Liste im Test ausgeschrieben); jeder Wert hat die Form `[a-z_]+\.[a-z_]+`; `group()` von `work_item.state_changed` ist `work_item`.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='OutboxTest|EventRecorderTest|EventRecorderTransactionTest|ActorTest|EventTypeTest|ArchTest'`; Expected: erst FAIL, dann PASS.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit**

Betreff: `feat: add the actor, the event log as outbox with idempotent consumers and app:redispatch-events`.

---

### Task 4: Rollen, Rechte und Sichtbarkeit

**Files:**
- Create: `app/Access/{Permission,OrgRole,ProjectRole,Grants,RoleIndex,RoleAssignments,Visibility,Authorize}.php`, `app/Actions/Setup/SyncRoles.php`, `app/Console/Commands/SyncRolesCommand.php`, `database/migrations/2026_10_31_000400_sync_roles.php`, `tests/Unit/Access/GrantsTest.php`, `tests/Feature/Access/{SyncRolesTest,RoleAssignmentsTest,VisibilityTest,AuthorizeTest}.php`
- Modify: `app/Models/User.php` (`HasRoles`), `app/Models/Project.php` (`scopeVisibleTo`), `app/Providers/AppServiceProvider.php` (`scoped(RoleIndex::class)`), `database/factories/{UserFactory,ProjectFactory}.php` (`admin()`, `member(User, ProjectRole)`), `tests/Pest.php`, `tests/Unit/ArchTest.php`, `CLAUDE.md` (Architektur: Rollen, Sichtbarkeit; Kommandos: `app:sync-roles`)

**Interfaces:**
- Consumes: Tasks 1–3
- Produces:
  - `enum App\Access\Permission: string` (feste Liste, Spec 4.3; Werte wie `src/lib/permissions.ts`, P4): Org: `OrgManage = 'org.manage'`, `OrgManageCatalog = 'org.manage_catalog'`, `ProjectSeeAll = 'project.see_all'`, `ProjectJoin = 'project.join'`, `ProjectCreate = 'project.create'`, `ViewCreate = 'view.create'`, `ViewManageAny = 'view.manage_any'`, `TokenOwn = 'token.own'`; Projekt: `ProjectRead = 'project.read'`, `ItemComment = 'item.comment'`, `ItemCreate = 'item.create'`, `ItemEdit = 'item.edit'`, `WikiEdit = 'wiki.edit'`, `TemplateManage = 'template.manage'`, `ItemDelete = 'item.delete'`, `ProjectManage = 'project.manage'`, `ProjectArchive = 'project.archive'`. Methode `scope(): string` (`org`/`project`).
  - `enum App\Access\OrgRole: string { Admin = 'admin'; Member = 'member'; }` und `enum App\Access\ProjectRole: string { Admin = 'admin'; Member = 'member'; Viewer = 'viewer'; }` (der Vertrag nennt `null` für „sieht es nicht“: das ist `?ProjectRole`), je `roleName(): string` (`org-admin`, `org-member`, `project-admin`, `project-member`, `project-viewer`) und `static fromRoleName(string): ?self`; `ProjectRole::rank(): int` (viewer 0, member 1, admin 2).
  - `final class App\Access\Grants`: `public const ORG` und `public const PROJECT` (Rolle → Liste der Rechte, genau die Tabellen aus 4.3: Org-Admin alle Org-Rechte; Org-Member `project.join`, `project.create`, `view.create`, `token.own`; Projekt-Admin alle Projektrechte; Member `project.read`, `item.comment`, `item.create`, `item.edit`, `wiki.edit`, `template.manage`; Viewer `project.read`, `item.comment`); `static allows(OrgRole|ProjectRole $role, Permission $p): bool`; `static of(OrgRole|ProjectRole $role): list<Permission>`.
  - `final class App\Actions\Setup\SyncRoles` (`AsAction`, ohne Actor): `handle(): void` — legt die Rechte und die fünf Rollen (Guard `web`, `team_id = null`, also global) an, gleicht `role_has_permissions` mit `Grants` ab, entfernt Rechte und Rollen, die nicht mehr in `Grants` stehen, und leert den Cache des Registrars. Migration `…_000400_sync_roles.php` ruft `SyncRoles::run()`; `app:sync-roles` ebenso („Roles and permissions are in sync.“).
  - `final class App\Access\RoleIndex` (scoped): `orgRoles(): array<string, OrgRole>` (alle Org-Zuordnungen in einer Abfrage, `team_id` = Organisation); `projectRoles(User $user): array<string, ProjectRole>` (Projekt-ID → Rolle, eine Abfrage je Konto); `members(Project $p): array<string, ProjectRole>`; `forget(): void`. Liest `model_has_roles` ⋈ `roles` (lesend, kein Schreibzugriff).
  - `final class App\Access\RoleAssignments` (nur aus `App\Actions`, Seedern und Factories benutzt, Arch-Regel): `setOrgRole(User $u, OrgRole $r): void`, `setProjectRole(User $u, Project $p, ProjectRole $r): void` (legt `project_members` an, falls nötig), `removeFromProject(User $u, Project $p): void` (Mitgliedschaft und Rolle). Intern: Team-ID setzen, `unsetRelation('roles')`, `syncRoles([...])` bzw. `removeRole`, vorherige Team-ID wiederherstellen (auch im `finally`), danach `RoleIndex::forget()`.
  - `final class App\Access\Visibility` (statisch, rechnet über `RoleIndex`, der auch das Ergebnis von `projectIds` je Konto und Request hält): `projectIds(User $user): Collection<int, string>` (deaktiviert → leer; Org-Admin → alle Projekte ohne `deleting_at`; sonst Mitgliedschaften ∪ öffentliche, ohne `deleting_at`; archivierte gehören dazu), `roleIn(User $user, Project $p): ?ProjectRole` (deaktiviert oder `deleting_at` → `null`; Org-Admin → `Admin`; Mitglied → seine Rolle; öffentlich → `Viewer`; sonst `null`), `orgRole(User $user): OrgRole` (ohne Zuordnung `Member`), `isMember(User $user, Project $p): bool`, `can(User $user, Permission $p, ?Project $project = null): bool` (Org-Recht über `orgRole`, Projektrecht über `roleIn`), `forget(): void`.
  - `Project::scopeVisibleTo(Builder $q, User $user): void` → `whereIn('id', Visibility::projectIds($user))`.
  - `final class App\Access\Authorize`: `static check(Actor $actor, string $ability, mixed ...$arguments): void` — `Gate::forUser($actor->user)->inspect(...)`; erlaubt → zurück; Status 404 (`Response::denyAsNotFound()`) → `Problem::notFound()`; sonst `Problem::forbidden($response->message())` (P5).
  - `UserFactory::admin()` (nach dem Anlegen `setOrgRole(Admin)`), Standard: `setOrgRole(Member)` für Personen und Bots; `ProjectFactory::member(User $u, ProjectRole $r)`.
  - `tests/Pest.php`: `function memberOf(Project $p, ProjectRole $r, array $attributes = []): User`.

- [ ] **Step 1: Failing Tests schreiben**

`GrantsTest.php` (Unit): die Tabellen aus 4.3 Zeile für Zeile als Datensatz `[Rolle, Recht, erwartet]` (z. B. `[ProjectRole::Member, Permission::ItemDelete, false]`, `[ProjectRole::Viewer, Permission::ItemComment, true]`, `[OrgRole::Member, Permission::OrgManage, false]`); jedes Recht hat genau einen Scope; jede Rolle nur Rechte ihres Scopes.

`SyncRolesTest.php`: nach den Migrationen entsprechen `Role::with('permissions')` genau `Grants` (Namen sortiert verglichen); ein zusätzliches Recht `stale.right` und eine Rolle `ghost` in der DB verschwinden nach `SyncRoles::run()`; zweimal laufen ändert nichts; `artisan('app:sync-roles')` gibt den Satz aus.

`RoleAssignmentsTest.php`:

```php
it('keeps the role of an account per team', function () {
    $user = User::factory()->create();
    [$web, $ops] = Project::factory()->count(2)->create();
    app(RoleAssignments::class)->setProjectRole($user, $web, ProjectRole::Admin);
    app(RoleAssignments::class)->setProjectRole($user, $ops, ProjectRole::Viewer);
    app(RoleAssignments::class)->setProjectRole($user, $web, ProjectRole::Member);

    expect(Visibility::roleIn($user, $web))->toBe(ProjectRole::Member)
        ->and(Visibility::roleIn($user, $ops))->toBe(ProjectRole::Viewer)
        ->and(Visibility::orgRole($user))->toBe(OrgRole::Member)
        ->and(getPermissionsTeamId())->toBeNull()
        ->and(ProjectMember::query()->where('user_id', $user->id)->count())->toBe(2);
});
```

Dazu: `removeFromProject` entfernt Mitgliedschaft und Rolle, andere Teams bleiben; `setOrgRole` überschreibt die Org-Rolle; nach einer Ausnahme mitten in der Zuordnung ist die Team-ID wieder die alte.

`VisibilityTest.php` (Spec 4.3, Tabelle „Sichtbarkeit“; Datensatz mit Org-Admin, Mitglied, Nicht-Mitglied, Deaktiviertem gegen ein öffentliches, ein privates, ein archiviertes und ein Projekt mit `deleting_at`): erwartete `roleIn` und `projectIds`, z. B. Nicht-Mitglied × privat → `null` und nicht in `projectIds`; Nicht-Mitglied × öffentlich → `Viewer`; Org-Admin × privat ohne Mitgliedschaft → `Admin`; Deaktivierter Org-Admin → `null`, `projectIds` leer; `deleting_at` → für alle `null`. Dazu `Project::visibleTo()` liefert genau `projectIds`, und `projectRoles` braucht für ein Konto genau eine Abfrage (`DB::enableQueryLog()`, zweiter Aufruf 0 Abfragen).

`AuthorizeTest.php`: Testpolicy über `Gate::define`: erlaubt → nichts; `Response::deny('Nur Admins.')` → `Problem` 403 mit `detail` `Nur Admins.`; `Response::denyAsNotFound()` → `Problem` 404 ohne `detail`.

`ArchTest.php`: `arch('role assignments only in actions')->expect(RoleAssignments::class)->toOnlyBeUsedIn(['App\Actions', 'Database\Seeders', 'Database\Factories', 'Tests'])`.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='GrantsTest|SyncRolesTest|RoleAssignmentsTest|VisibilityTest|AuthorizeTest|ArchTest'`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit**

Betreff: `feat: add fixed permissions, roles per team with ULIDs and the one visibility scope`.

---

### Task 5: Anmeldung nacharbeiten, Standard-Bot, Sitzungen beenden

**Files:**
- Create: `app/Actions/Setup/EnsureDefaultBot.php`, `app/Actions/Accounts/NextHandle.php`, `database/migrations/2026_10_31_000500_create_default_bot.php`, `app/Actions/Auth/EndSessions.php`, `app/Http/Middleware/EnsureAccountIsActive.php`, `tests/Feature/{DefaultBotTest,SessionEndTest}.php`
- Modify: `app/Actions/Auth/{Authenticate,SetPassword,EnsureAdmin}.php`, `bootstrap/app.php` (Web-Gruppe: `AuthenticateSession`, `EnsureAccountIsActive`), `tests/Feature/{EnsureAdminTest,SetPasswordTest,ActorTest,DemoSeederTest}.php`, `tests/Feature/Models/UserModelTest.php`, `database/factories/UserFactory.php` (Zustand `defaultBot()` entfällt), `tests/Unit/ArchTest.php` (Ausnahme `NextHandle`) — ab der Migration gibt es immer einen Standard-Bot: ActorTest nimmt ihn statt eines per Factory angelegten, `UserModelTest` löscht ihn vor „`defaultBot()` wirft ohne Standard-Bot“, `EnsureAdminTest` und `DemoSeederTest` zählen Konten mit `where('is_default_bot', false)` bzw. ersetzen `User::sole()` durch `User::query()->where('is_default_bot', false)->sole()`, `tests/Feature/Auth/LoginTest.php`, `lang/en.json`, `lang/de.json`, `CLAUDE.md` (Fallstricke: Sitzungen, Rehash; A4-Hinweis bei den Regeln)

**Interfaces:**
- Consumes: Tasks 2–4
- Produces:
  - `final class App\Actions\Accounts\NextHandle` (`AsAction`, lesend, ohne Actor; P24): `handle(string $seed): string` → `Handle::suggest($seed, fn (string $h): bool => User::query()->where('handle', $h)->exists())`; die einzige Stelle für „Handle vergeben“, `EnsureAdmin`, `EnsureDefaultBot` und `AcceptInvitation` rufen sie (`EnsureAdmin` verliert seine eigene Closure).
  - `final class App\Actions\Setup\EnsureDefaultBot` (`AsAction`): `handle(): User` — gibt es keinen Bot mit `is_default_bot`, legt es ihn an: `type` bot, Name „Automation“, Handle `NextHandle::run('automation')`, `description` = `__('bots.default.description', [], Organization::current()->locale->value)`, Org-Rolle Admin; idempotent. Die Migration ruft es nach `sync_roles`.
  - `EnsureAdmin` (A4, vorgemerkt): E-Mail mit `Str::lower(trim())`; prüft das Passwort mit `PasswordRules` und legt die Person mit Passwort direkt an (ohne `SetPassword`, also ohne `user.password_changed`); Org-Rolle Admin; genau ein Event `user.created` mit `Actor::system($user, 'ensure_admin')`. Signatur bleibt `handle(?string $email, ?string $password)`.
  - `SetPassword` (vorgemerkt, P25): `handle(User $user, string $password, ?Actor $actor = null, bool $keepSession = false, string $reason = 'password_reset'): void` — einzige Stelle, die ein Passwort setzt (Regeln aus `PasswordRules`, Hash, `remember_token`); `$keepSession` behält die Sitzung der laufenden Anfrage (`session()->getId()`), sonst enden alle; Event `user.password_changed` mit `$actor ?? Actor::system($user, $reason)` und `meta.reason` (ohne Passwort in `changes`); alle Datenbank-Sitzungen über `EndSessions::run($user)` statt `DB::table('sessions')`.
  - `final class App\Actions\Auth\EndSessions` (`AsAction`): `handle(User $user, ?string $except = null): void` — nur bei `config('session.driver') === 'database'`: löscht Zeilen in `config('session.table')` des Kontos außer `$except`; für alle anderen Treiber greift `AuthenticateSession` (P8).
  - `Authenticate` (vorgemerkt): nach erfolgreicher Prüfung `Hash::needsRehash()` → Passwort neu setzen (`forceFill(['password' => $password])->save()`); kein Event (technisch).
  - `final class App\Http\Middleware\EnsureAccountIsActive`: angemeldet und `isDisabled()` → `Auth::guard('web')->logout()`, Sitzung ungültig; unter `/api/*` `AuthenticationException` (401 Problem Details), sonst Redirect `login` mit `error` = `__('errors.account_disabled')`. In der Web-Gruppe nach `HandleInertiaRequests`; die API-Gruppe bekommt sie in Task 7.
  - Web-Gruppe: `Illuminate\Session\Middleware\AuthenticateSession` (für Sanctum-Anfragen aus der UI gilt `sanctum.middleware.authenticate_session`).
  - Schlüssel: `bots.default.description` („Der Standard-Bot: Automatisierungen und Zeitpläne von Vorlagen handeln in seinem Namen.“ / „The default bot: automations and template schedules act on its behalf.“), `errors.account_disabled`.

- [ ] **Step 1: Failing Tests schreiben**

`DefaultBotTest.php`: nach den Migrationen gibt es genau einen Standard-Bot `automation`, Org-Rolle Admin (`Visibility::orgRole`), ohne E-Mail und Passwort; `EnsureDefaultBot::run()` ein zweites Mal legt keinen an; ist `automation` von einer Person belegt (Bot vorher gelöscht), heißt der neue `automation-2`; der Standard-Bot kann sich nicht anmelden: er hat weder E-Mail noch Passwort, und `Authenticate::run('', '')` sowie `Authenticate::run('automation', '')` liefern `null`. `NextHandleTest` (in `DefaultBotTest.php`): `NextHandle::run('Mara Lindqvist')` → `mara-lindqvist`, belegt → `mara-lindqvist-2`.

`SessionEndTest.php` (Review Focus „Deaktivieren und Passwortwechsel“):

```php
it('signs out every other session after a password change, whatever the session driver', function () {
    User::factory()->create(['email' => 'lene@example.com', 'password' => 'old-password']);
    $this->post('/login', ['email' => 'lene@example.com', 'password' => 'old-password']);   // a real session, not actingAs
    $this->get('/my-items')->assertOk();                            // AuthenticateSession keeps the hash in the session

    SetPassword::run(User::query()->where('email', 'lene@example.com')->sole(), 'new-password');
    Auth::forgetGuards();                                           // the next request loads the account afresh, as a new request would

    $this->get('/my-items')->assertRedirect('/login');
});

it('ends the database sessions of the account except the one it keeps', function () {
    config(['session.driver' => 'database', 'session.table' => 'sessions']);
    $user = User::factory()->create();
    foreach (['keep', 'other'] as $id) {
        DB::table('sessions')->insert(['id' => $id, 'user_id' => $user->id, 'payload' => '', 'last_activity' => time()]);
    }
    EndSessions::run($user, 'keep');
    expect(DB::table('sessions')->pluck('id')->all())->toBe(['keep']);
});
```

Dazu: anderer Treiber (`array`) → `EndSessions` fasst die Tabelle nicht an; ein deaktiviertes Konto mit laufender Sitzung landet beim nächsten Seitenaufruf auf `/login` mit `session('error')` = `errors.account_disabled` und ist abgemeldet.

`EnsureAdminTest.php` ergänzen: `' Owner@Example.com '` → gespeichert `owner@example.com`; Org-Rolle Admin; genau ein Event `user.created`, `meta.via` `system`.

`SetPasswordTest.php` anpassen: Sitzungen über `config('session.table')` (Test mit Treiber `database`); Event `user.password_changed` ohne Passwort im JSON.

`LoginTest.php` ergänzen (vorgemerkt): „rehashes an outdated password on sign-in“ (`config(['hashing.bcrypt.rounds' => 5]); Hash::forgetDrivers();` Person mit Hash von Runde 4 → nach Anmeldung `Hash::needsRehash($user->fresh()->password)` `false` und Hash geändert); der bestehende Test „makes a new dummy hash when the hasher changes“ ruft nach der Config-Änderung `Hash::forgetDrivers()` (sonst rechnet der alte Treiber weiter).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='DefaultBotTest|SessionEndTest|EnsureAdminTest|SetPasswordTest|LoginTest|ActorTest|UserModelTest|DemoSeederTest|ArchTest'`.

- [ ] **Step 3: Gates G1, G3** (Web-Middleware ändert sich; Login-, Reset- und Shell-Specs müssen grün bleiben)

- [ ] **Step 4: Commit**

Betreff: `feat: create the default bot, give the first admin the admin role, end sessions on password change and deactivation`.

---

### Task 6: Demo- und e2e-Daten

**Files:**
- Create: `database/seeders/Demo/{OrganizationSeeder,BotsSeeder,ProjectsSeeder,FavoritesSeeder,TokensSeeder}.php`, `tests/Feature/E2eSeederTest.php`
- Modify: `database/seeders/DemoSeeder.php`, `database/seeders/Demo/PeopleSeeder.php`, `database/seeders/E2eSeeder.php`, `tests/Feature/DemoSeederTest.php`, `e2e/helpers.ts` (Konten, `runId()`), `CLAUDE.md` (Seeder)

**Interfaces:**
- Consumes: Tasks 2–5
- Produces:
  - Alle Seeder `use WithoutModelEvents` (vorgemerkt); Reihenfolge in `DemoSeeder::run()`: Organization, People, Bots, Projects, Favorites, Tokens. Rollen nur über `RoleAssignments`.
  - `OrganizationSeeder`: Feldwerk, `de`, `Europe/Berlin`, `week_start` 1 (aus `src/api/seed/people.ts`).
  - `PeopleSeeder`: wie Phase 1, dazu Org-Rolle (Mara Admin, alle anderen Member).
  - `BotsSeeder`: Standard-Bot mit der deutschen Beschreibung aus `people.ts`; Kira (`kira`, Beschreibung aus `people.ts`, `owner_id` Mara, Member).
  - `ProjectsSeeder`: WEB, APP, OPS mit Name, Beschreibung, Lead, Sichtbarkeit aus `people.ts` und den Mitgliedschaften aus `projectMembers` (= Tabelle „Demo-Rollen“ des Klickdummy-README).
  - `FavoritesSeeder`: nur die Projekt-Favoriten aus `src/api/seed/workspace.ts` mit ihren Positionen (Views ab Phase 5).
  - `TokensSeeder`: Maras „Claude Code“ (`read`, `write`, `mcp`) und „CI-Skript“ (`read`, abgelaufen 30.09.2026), Kiras „MCP“, mit `created_at`, `last_used_at`, `expires_at` aus `people.ts` (Europe/Berlin nach UTC), Geheimnis zufällig (niemand kennt den Klartext).
  - `E2eSeeder`: setzt nach dem `DemoSeeder` die Sprache der Organisation auf `en` (die Specs aus Phase 1 prüfen `tr('en', …)`; der `DemoSeeder` bleibt bei `de`, P31); Erik Ende wird Org-Admin; je Playwright-Projekt (`desktop-light`, `desktop-dark`, `phone-light`, `phone-dark`) zusätzlich `security-<variant>@example.com` (Passwortwechsel und 2FA-Einrichtung; jeder Lauf setzt Passwort `E2eSeeder::PASSWORD` und leere 2FA-Spalten) und `twofactor-<variant>@example.com` mit bestätigter 2FA: Geheimnis `E2eSeeder::TOTP_SECRET` (Base32, `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`), Recovery-Codes `E2eSeeder::recoveryCodes($variant)` (8 Codes der Form `xxxxxxxxxx-xxxxxxxxxx`, aus der Variante abgeleitet), jeweils mit `updateOrCreate`, also nach jedem Lauf zurückgesetzt.
  - `e2e/helpers.ts`: `PEOPLE.security[variant]`, `PEOPLE.twoFactor[variant]` (mit `secret`, `recoveryCodes`), `export function runId(): string` (5 Zeichen `[A-Z0-9]` aus `Date.now()`, einmal je Lauf), `export function variant(): string` (`test.info().project.name`).

- [ ] **Step 1: Failing Tests schreiben**

`DemoSeederTest.php` (Abgleich mit dem Klickdummy, vorgemerkt): liest `prototypes/clickdummy/src/api/seed/people.ts` per Regex (`person('u_…', 'Name', 'handle'(, 'admin')?…)`, die `projects`-Einträge und `projectMembers`) und erwartet nach `db:seed --class=DemoSeeder` genau diese Namen, Handles, Org-Rollen, Projekte (Kennung, Lead, Sichtbarkeit) und Projektrollen (über `Visibility::roleIn`); Kira gehört Mara; Sven ist deaktiviert; zweimal seeden ändert nichts (Anzahl Konten, Mitgliedschaften, Favoriten, Tokens gleich); Maras Favoriten sind WEB, APP, OPS in dieser Reihenfolge.

`E2eSeederTest.php`: die Organisation spricht nach dem `E2eSeeder` `en`, nach dem `DemoSeeder` `de`; Erik ist Org-Admin; je Variante existieren die beiden Konten; `twofactor-desktop-light` hat `two_factor_confirmed_at` und `Google2FA::verifyKey(TOTP_SECRET, <Code jetzt>)` gilt; ein zweiter Lauf setzt verbrauchte Recovery-Codes zurück; in `production` wirft der Seeder.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='DemoSeederTest|E2eSeederTest'`; `ddev artisan db:seed --class=DemoSeeder` → ohne Fehler.

- [ ] **Step 3: Gates G1, G3** (e2e-Helfer ändern sich; die Specs aus Phase 1 bleiben grün)

- [ ] **Step 4: Commit**

Betreff: `feat: seed Feldwerk with roles, bots, projects, memberships, favorites and tokens; add the e2e accounts`.

---
### Task 7: REST-Grundlage, Organisation, Bilder, Shared Props und die beiden Matrizen

**Files:**
- Create: `app/Http/Middleware/EnsureTokenAbility.php`, `app/Support/{ListResult,PageArgs,ImageInput}.php`, `app/Rules/ImageDataUrl.php`, `app/Http/Api/ApiList.php`, `app/Http/Resources/{OrganizationResource,UserResource}.php`, `app/Actions/Organization/{GetOrganization,UpdateOrganization}.php`, `app/Actions/Media/ShowMedia.php`, `app/Policies/OrganizationPolicy.php`, `app/Http/Controllers/Api/OrganizationController.php`, `app/Http/Controllers/MediaController.php`, `tests/Feature/Api/{OrganizationApiTest,ApiListTest,TokenAbilityTest}.php`, `tests/Feature/MediaTest.php`, `tests/Feature/Access/{RightsMatrixTest.php,matrix.php,MatrixWorld.php}`, `tests/Feature/Api/{RouteMatrixTest.php,routes.php}`
- Modify: `routes/api.php`, `routes/web.php` (Medien-Route), `app/Models/Organization.php` (`HasMedia`, Sammlung `logo`), `app/Http/Middleware/HandleInertiaRequests.php`, `app/Exceptions/Problem.php` (Reasons, Fabriken), `tests/Feature/ProblemTest.php`, `resources/js/lib/page.ts`, `resources/js/lib/page.test.ts`, `resources/js/shell/ProfileMenu.tsx` (Typ), `tests/Feature/InertiaTest.php`, `tests/Pest.php`, `lang/en.json`, `lang/de.json`, `CLAUDE.md` (Architektur: REST, Shared Props, Matrizen)

**Interfaces:**
- Consumes: Tasks 1–6
- Produces:
  - `routes/api.php`: eine Gruppe `Route::middleware(['auth:sanctum', EnsureAccountIsActive::class, EnsureTokenAbility::class])`; in `bootstrap/app.php` stehen `EnsureSession` (Task 10) und `EnsureTokenAbility` in der Prioritätsliste nach `AuthenticatesRequests`, `EnsureSession` zuerst (P28), damit ein Token auf `/me/*` immer `session_required` bekommt und nie den Fähigkeitstext; Controller in `App\Http\Controllers\Api` (je Ressource ein Controller, Methoden `index`, `show`, `store`, `update`, `destroy` plus benannte Aktionen); jede Methode: Eingabe aus dem Request holen, `Actor::fromRequest($request)`, Action `::run(...)`, Resource zurück. Route-Parameter `{user}` und `{token}` per Model-Binding (ULID).
  - `final class EnsureTokenAbility`: handelt ein `PersonalAccessToken` (nicht die Session), brauchen `GET`/`HEAD` die Fähigkeit `read`, alle anderen Methoden `write`; sonst `Problem::forbidden(__('problem.detail.token_ability', ['ability' => …]))`.
  - `final readonly class PageArgs { public function __construct(public ?string $cursor, public int $perPage) {} public static function from(array $input): self }` (`per_page` 1–100, Standard 100; sonst `ValidationException` an `per_page`); `final readonly class ListResult { public function __construct(public CursorPaginator $page, public int $total) {} public static function of(Builder $query, PageArgs $args): self }` (zählt und blättert per `cursorPaginate`, P12).
  - `final class App\Http\Api\ApiList { public static function respond(ListResult $result, string $resource): JsonResponse }` → `{data, links, meta: {path, per_page, next_cursor, prev_cursor, total}}` (Laravel-Format plus `total`).
  - `final class ImageInput`: `static rules(): array` (`nullable`, `string`, `ImageDataUrl`); `static apply(HasMedia $model, string $collection, ?string $value, ?string $current): ?array` — `null` löscht, ein `data:image/(png|jpeg|webp|gif);base64,…` ersetzt (singleFile), derselbe Wert wie `$current` ändert nichts; liefert `['old' => …, 'new' => …]` für `changes` oder `null` ohne Änderung. `ImageDataUrl` prüft MIME aus dem Kopf und mit `getimagesizefromstring`, höchstens 2 MB nach dem Dekodieren; SVG nie.
  - Bild-URL: `route('media.show', $media->uuid)`; `GET /media/{media:uuid}` (Middleware `auth:sanctum`, `EnsureAccountIsActive`, `EnsureTokenAbility`) → `MediaController@show` → `ShowMedia::run($actor, $media)` → `response()->file($path, ['Content-Type' => mime, 'X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'private, max-age=86400'])`. `ShowMedia::handle(Actor $actor, Media $media): Media` — Logo und Avatare sieht jedes angemeldete Konto, ein Projektbild nur, wer das Projekt sieht (sonst 404).
  - `OrganizationResource`: `id`, `name`, `locale`, `timezone`, `week_start`, `logo_url` (Typ `Organization`). `UserResource`: Typ `User` aus `types.ts` (`id`, `type`, `name`, `handle`, `email`, `org_role`, `is_default_bot`, `owner_id`, `description` nur bei Bots, `disabled_at`, `avatar_url`, `locale` und `timezone` als wirksame Werte); `org_role` aus `RoleIndex::orgRoles()` (eine Abfrage je Request).
  - `GetOrganization::handle(Actor $actor): Organization` (jedes Konto); `UpdateOrganization::handle(Actor $actor, array $input): Organization` — Recht `update` der `OrganizationPolicy` (`org.manage`, sonst `Response::deny(__('problem.detail.organization_admins_only'))`); Regeln: `name` required string max 120 (getrimmt), `locale` in `en,de`, `timezone` `timezone:all`, `week_start` in `0,1`, `logo_url` per `ImageInput`; Event `organization.updated` mit `changes` je geändertem Feld; nichts geändert → kein Event, keine Schreibzugriffe. Danach `app()->instance(Organization::class, $fresh)`.
  - REST: `GET /api/v1/organization`, `PATCH /api/v1/organization`.
  - Shared Props: `organization` = `OrganizationResource`, `auth.user` = `UserResource` des eigenen Kontos, `auth.permissions` = Werte von `Grants::of(Visibility::orgRole($user))`. `resources/js/lib/page.ts`: `auth: { user: User | null; permissions: string[] }`, `organization: Organization` (Typen aus `@/types`).
  - `Problem` (P23, Vertragserweiterung): `conflict(string $reason, array $extensions = [], ?string $detail = null)` und `forbidden(?string $detail = null, string $reason = 'forbidden')` — bisherige Aufrufe bleiben gültig; `tests/Feature/ProblemTest.php` prüft `detail` beim Konflikt und einen eigenen Reason beim 403 (Problem Details mit `reason` `session_required`).
  - `Problem::REASONS` ergänzt um `default_bot`, `already_member`, `lead_cannot_leave`, `session_required`, `two_factor_enabled`, `two_factor_not_pending`, `two_factor_disabled`; je `problem.reason.<code>` in beiden Sprachen (deutsch aus `REASON_TEXT`, wo vorhanden, sonst aus den Meldungen des Klickdummys).
  - **Rechte-Matrix** `tests/Feature/Access/RightsMatrixTest.php`: `MatrixWorld::build()` legt an: Organisation, Projekte `WEB` (öffentlich) und `OPS` (privat), Konten je Spalte — `org_admin` (Person, Org-Admin, in keinem Projekt), `project_admin` (Member, Admin in WEB und OPS), `project_member` (Member in WEB und OPS), `project_viewer` (Viewer in WEB und OPS), `outsider_public` (Member ohne Mitgliedschaft; Ziel ist WEB), `outsider_private` (Member ohne Mitgliedschaft; Ziel ist OPS), `default_bot`; alle Personen mit dem Passwort `MatrixWorld::PASSWORD`. `$w->project(string $column): Project` ist OPS für `outsider_private`, sonst WEB; `$w->target` ist eine weitere Person (Member in WEB, nicht Lead), `$w->bot` ein Bot. `matrix.php` gibt Zeilen zurück: `'UpdateOrganization' => ['action' => UpdateOrganization::class, 'run' => fn (Actor $a, MatrixWorld $w, string $column) => UpdateOrganization::run($a, ['name' => 'Neu']), 'allowed' => ['org_admin', 'default_bot'], 'event' => EventType::OrganizationUpdated]`; Projektzeilen tragen `'hidden' => ['outsider_private']`. Test 1 (`->with(rows)->with(columns)`): erlaubt → der Aufruf wirft weder `Problem` 403/404 noch eine andere Ausnahme außer `ValidationException`, und bei `event` gelingt er und es gibt danach ein neues Event dieses Typs mit `actor_id` des Kontos (die Zeilen geben dafür gültige Eingaben); nicht erlaubt → `Problem` 403; in `hidden` → `Problem` 404. Zeilen mit `'system' => true` (Arbeit von Jobs, ohne REST) laufen einmal mit `Actor::system(User::defaultBot(), 'matrix')` statt je Spalte und dürfen nicht scheitern. Test 2 (Wächter): jede Klasse unter `app/Actions` außer `Auth/`, `Setup/` und `Accounts\NextHandle` ist genau einmal `action` einer Zeile; `matrix.php` nennt die Ausnahmen mit Grund in einem Kommentar.
  - **Routen-Matrix** `tests/Feature/Api/RouteMatrixTest.php`: Spalten `none` (kein Token), `read`, `write`, `read+write` (Tokens eines Org-Admins); `routes.php` listet `'show organization' => ['GET', '/api/v1/organization']`; erwartet: `none` → 401 Problem Details; `GET` mit `read`/`read+write` → weder 401 noch 403 noch ≥ 500, mit `write` → 403; schreibend mit `write`/`read+write` → weder 401 noch 403 noch ≥ 500, mit `read` → 403. Zeilen mit `'session' => true` (Task 10) erwarten für jedes Token 403 `session_required`. Wächter: die Zeilen decken genau alle Routen unter `api/v1` (Methode und URI mit Platzhaltern) ab.
  - `tests/Pest.php`: `function apiToken(User $user, array $abilities): string`, `function forgetApiAuth(): void` (wie openbill).
  - Schlüssel `problem.detail.organization_admins_only` („Die Organisation ändern nur Org-Admins.“), `problem.detail.token_ability`, `field.name.required`, `field.name.max`, `field.locale.unknown` („Diese Sprache gibt es nicht.“), `field.timezone.unknown` („Diese Zeitzone gibt es nicht.“), `field.week_start.invalid` („Die Woche beginnt am Montag oder Sonntag.“), `field.image.invalid`, `field.image.too_large`; Feldmeldungen übergeben die Actions als `$messages` an `Validator::make` (P9).

- [ ] **Step 1: Failing Tests schreiben**

`OrganizationApiTest.php`:

```php
it('lets an org admin change the organization and records what changed', function () {
    $admin = User::factory()->admin()->create();
    $this->actingAs($admin)->patchJson('/api/v1/organization', ['name' => ' Feldwerk ', 'timezone' => 'Europe/Berlin', 'week_start' => 0])
        ->assertOk()->assertJsonPath('data.name', 'Feldwerk')->assertJsonPath('data.week_start', 0);
    $event = Event::sole();
    expect($event->type)->toBe(EventType::OrganizationUpdated)
        ->and($event->changes)->toMatchArray(['name' => ['old' => config('app.name'), 'new' => 'Feldwerk'], 'timezone' => ['old' => 'UTC', 'new' => 'Europe/Berlin']]);
});

it('names the field of every invalid value', function (array $input, string $field) {
    $this->actingAs(User::factory()->admin()->create())->patchJson('/api/v1/organization', $input)
        ->assertUnprocessable()->assertJsonPath('reason', 'validation_failed')->assertJsonValidationErrors([$field]);
})->with([[['name' => ' '], 'name'], [['locale' => 'fr'], 'locale'], [['timezone' => 'Mars/Olympus'], 'timezone'], [['week_start' => 3], 'week_start'], [['logo_url' => 'data:image/svg+xml;base64,PHN2Zy8+'], 'logo_url']]);
```

Dazu: Member → 403 mit `detail` `problem.detail.organization_admins_only`; jedes Konto liest `GET`; ohne Änderung kein Event; Logo als PNG-Data-URL → `logo_url` zeigt auf `/media/<uuid>`, `null` entfernt es.

`MediaTest.php`: das Logo liefert `GET /media/<uuid>` angemeldet mit `nosniff` und dem MIME des Bilds; Gast → Redirect `/login`; unbekannte UUID → 404; per Bearer-Token mit `read` → 200. (Projektbilder kommen mit Task 11.)

`ApiListTest.php`: `ListResult::of()` über 3 Konten mit `per_page` 2 → `meta.total` 3, `meta.next_cursor` gesetzt, zweite Seite mit dem Cursor bringt das dritte; `per_page` 0 und 101 → 422 an `per_page`.

`TokenAbilityTest.php`: Testrouten unter `api/v1/_t` (GET und POST): Token `read` darf GET, nicht POST (403, `detail` nennt `write`); `write` umgekehrt; Session darf beides.

`InertiaTest.php` anpassen: `auth.user.org_role`, `auth.permissions` enthält für Admins `org.manage`, für Member nicht; `organization.name` kommt aus der Tabelle.

`page.test.ts` an die neuen Typen anpassen.

Matrix-Zeilen `GetOrganization` (alle Spalten), `UpdateOrganization` (`org_admin`, `default_bot`, Event), `ShowMedia` (Logo, das `MatrixWorld` anlegt; alle Spalten); Routen-Zeilen `show organization`, `change organization`.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='OrganizationApiTest|MediaTest|ApiListTest|TokenAbilityTest|InertiaTest|RightsMatrixTest|RouteMatrixTest'`.

- [ ] **Step 3: Gates G1, G2, G3** (Shared Props und `ProfileMenu`-Typ ändern sich)

- [ ] **Step 4: Commit**

Betreff: `feat: add the REST base with token abilities, the organization endpoints, images through the media library and the rights matrices`.

---

### Task 8: Personen und Bots

**Files:**
- Create: `app/Actions/Users/{ListUsers,UpdateUser,UpdateUserRole,DeactivateUser,ReactivateUser,CreateBot}.php`, `app/Policies/UserPolicy.php`, `app/Http/Controllers/Api/{UsersController,BotsController}.php`, `tests/Feature/Api/{UsersApiTest,BotsApiTest,DeactivateUserTest}.php`, `tests/Feature/LastAdminTest.php`, `tests/Integration/LastAdminRaceTest.php`
- Modify: `routes/api.php`, `app/Models/User.php` (`HasMedia`, Sammlung `avatar`), `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `lang/en.json`, `lang/de.json`

**Interfaces:**
- Consumes: Task 7
- Produces:
  - `ListUsers::handle(Actor $actor, array $input): ListResult` — jedes Konto; `type` optional `person`/`bot`; Personen zuerst (`orderByDesc('type')`, weil `person` > `bot`), dann `orderBy('id')` als eindeutiger Schlüssel für `cursorPaginate` (P12; die Bildschirme sortieren selbst nach Namen); Deaktivierte inklusive. `UsersApiTest` blättert mit `per_page` 2 über mehr als eine Seite und erhält jede Person genau einmal, Personen vor Bots.
  - `UpdateUser::handle(Actor $actor, User $user, array $input): User` — Policy `update`: sich selbst oder Org-Admin (sonst `problem.detail.foreign_profile`). Felder: `name` (max 120), `handle` (`Handle::PATTERN`, unique; Meldungen `field.handle.format`, `field.handle.taken`), `email` (nur Org-Admins, nur Personen, `Str::lower`, unique; Bots → `field.email.bots`), `locale`, `timezone`, `avatar_url` (`ImageInput`), `description` (max 500) und `owner_id` (aktive Person) nur bei Bots und nur durch Org-Admins. Event `user.updated` mit `changes`.
  - `UpdateUserRole::handle(Actor $actor, User $user, OrgRole|string $role): User` — Org-Admin; Standard-Bot → `Problem::conflict('default_bot')` mit `detail`; letzter Admin → `Problem::conflict('last_admin')`; Event `user.role_changed`.
  - `DeactivateUser::handle(Actor $actor, User $user): User` — Org-Admin; Standard-Bot → 409 `default_bot`; letzter Admin → 409 `last_admin`; setzt `disabled_at` (bleibt, wenn schon gesetzt), löscht alle Tokens des Kontos, `EndSessions::run($user)`; Event `user.deactivated`. `ReactivateUser::handle(Actor $actor, User $user): User` — `disabled_at = null`, Event `user.reactivated`.
  - Letzter Admin (Review Focus, P29): in der Transaktion zuerst `RoleIndex::forget()`, dann eine frische Abfrage der Org-Admin-Zuordnungen (`model_has_roles` ⋈ `users`, aktive Personen) mit `lockForUpdate()` auf den `users`-Zeilen; gezählt werden sie ohne das Ziel; der Standard-Bot zählt nicht. Keine Leseabfrage auf Rollen vor dem Lock innerhalb der Transaktion.
  - `CreateBot::handle(Actor $actor, array $input): User` — Org-Admin; `name`, `handle`, `description` optional, `owner_id` optional (Standard: der Actor; muss eine aktive Person sein); Org-Rolle Member; Event `bot.created`.
  - REST: `GET /api/v1/users` (`?type=`), `PATCH /api/v1/users/{user}`, `PUT /api/v1/users/{user}/role` (`{org_role}`), `POST /api/v1/users/{user}/deactivate`, `POST /api/v1/users/{user}/reactivate`, `GET /api/v1/bots` (= `ListUsers` mit `type` bot), `POST /api/v1/bots`.
  - Schlüssel `problem.detail.*` für jede Ablehnung mit den Sätzen aus `src/api/users.ts` („Das ist der letzte aktive Admin. Mache zuerst jemand anderen zum Admin.“, „Der Standard-Bot hat immer die Rolle Admin.“, „Der Standard-Bot lässt sich nicht deaktivieren.“, „Fremde Profile ändern nur Org-Admins.“, „Rollen ändern nur Org-Admins.“, …), `field.*` für die Feldmeldungen.

- [ ] **Step 1: Failing Tests schreiben**

`LastAdminTest.php`:

```php
it('refuses to demote or deactivate the last active admin among the people', function (string $call) {
    $mara = User::factory()->admin()->create();                 // the default bot is an admin as well
    User::factory()->admin()->disabled()->create();             // a deactivated admin does not count
    $response = $call === 'demote'
        ? $this->actingAs($mara)->putJson("/api/v1/users/{$mara->id}/role", ['org_role' => 'member'])
        : $this->actingAs($mara)->postJson("/api/v1/users/{$mara->id}/deactivate");
    $response->assertConflict()->assertJsonPath('reason', 'last_admin');
    expect(Visibility::orgRole($mara->fresh()))->toBe(OrgRole::Admin)->and($mara->fresh()->disabled_at)->toBeNull();
})->with(['demote', 'deactivate']);
```

Dazu: „also without the default bot“ (Standard-Bot vorher gelöscht → gleiche Antwort); mit einem zweiten aktiven Admin gelingt beides; „counts under a lock“ (Query-Log enthält `for update` auf `users`). Dazu `tests/Integration/LastAdminRaceTest.php` (zwei Verbindungen: `mariadb` und `mariadb_second`, die der Test per `config()` als Kopie von `mariadb` anlegt; die zweite mit `SET innodb_lock_wait_timeout = 1`): zwei aktive Admins A und B; Verbindung 1 stuft B herab und hält die Transaktion offen; Verbindung 2 (per `DB::setDefaultConnection`) will A herabstufen und scheitert mit Lock-Timeout statt mit veralteter Zählung; nach dem Commit von 1 scheitert der zweite Versuch auf 2 mit `last_admin`; am Ende ist genau ein Admin übrig.

`DeactivateUserTest.php` (Review Focus): Token des Kontos (Person und Bot) → vorher 200, danach 401; Datenbank-Sitzung gelöscht (Treiber `database`); laufende Session-Anfrage danach → 401 unter `/api/v1`; Reaktivieren hebt `disabled_at` auf, die alten Tokens bleiben weg; Standard-Bot → 409 `default_bot`.

`UsersApiTest.php`: Liste mit `type=bot`, Formen wie `User` aus `types.ts` (`assertJsonStructure`), `description` nur bei Bots; eigenes Profil ändern (Name, Handle, Sprache, Zeitzone, Avatar); Handle-Regeln (Datensatz `ab`, `Mara`, `mara_l`, vergeben) → 422 an `handle`; E-Mail ändert nur ein Org-Admin (Person selbst → 403), Großbuchstaben werden klein gespeichert; fremdes Profil als Member → 403 `problem.detail.foreign_profile`; Event `user.updated` mit `changes.handle`.

`BotsApiTest.php`: Bot anlegen (Owner Standard = Actor), Owner muss aktive Person sein (Bot als Owner → 422 `owner_id`), Member → 403, Standard-Bot umbenennen und Avatar setzen klappt, seine Rolle ändern → 409.

Matrix-Zeilen: `ListUsers` (alle Spalten), `UpdateUser` (Ziel `$w->target`; erlaubt `org_admin`, `default_bot`), `UpdateUserRole`, `DeactivateUser`, `ReactivateUser`, `CreateBot` (je `org_admin`, `default_bot`), jeweils mit Event. Routen-Zeilen für alle sieben Routen.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='LastAdminTest|LastAdminRaceTest|DeactivateUserTest|UsersApiTest|BotsApiTest|RightsMatrixTest|RouteMatrixTest'`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit**

Betreff: `feat: manage people and bots over REST with the last-admin rule, deactivation and avatars`.

---

### Task 9: Einladungen und „Einladung annehmen“

**Files:**
- Create: `database/migrations/2026_10_31_000600_create_invitations_table.php`, `app/Models/Invitation.php`, `database/factories/InvitationFactory.php`, `app/Enums/InvitationState.php`, `app/Support/InvitationLinks.php`, `app/Actions/Invitations/{InviteUser,ListInvitations}.php`, `app/Actions/Auth/{CheckInvitation,AcceptInvitation}.php`, `app/Notifications/InvitationNotification.php`, `app/Http/Resources/InvitationResource.php`, `app/Http/Controllers/Api/InvitationsController.php`, `app/Http/Controllers/Auth/InvitationController.php`, `resources/js/features/auth/Invitation.tsx`, `resources/js/pages/Auth/Invitation.tsx`, `tests/Feature/InvitationTest.php`, `tests/Feature/Api/InvitationsApiTest.php`, `e2e/tests/invitation.spec.ts`
- Modify: `routes/api.php`, `routes/auth.php`, `app/Providers/{AppServiceProvider,FortifyServiceProvider}.php` (Morph-Map `invitation`, Limiter `invitation`), `app/Policies/UserPolicy.php` (`invite`, `viewInvitations`), `config/werkbuch.php` (`rate_limits.invitation_accept_per_ip` = 10), `resources/js/shell/Shell.tsx` (`flash.status` als Erfolgs-Toast), `resources/js/shell/Shell.test.tsx`, `e2e/helpers.ts` (`api()`), `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `tests/Feature/ConfigTest.php`, `lang/en.json`, `lang/de.json`, `CLAUDE.md` (Architektur: Einladungen)

**Interfaces:**
- Consumes: Tasks 7–8
- Produces:
  - `invitations`: `ulid id`, `email` index, `org_role(16)`, `projects` json (`[{project_id, role}]`), `invited_by` ulid FK `users` nullOnDelete, `expires_at`, `accepted_at` nullable, Zeitstempel.
  - `final class InvitationLinks { public static function for(Invitation $i): string }` → `rtrim(config('app.url'), '/').URL::signedRoute('invitations.show', ['invitation' => $i->id], absolute: false)`; Routen mit `signed:relative`.
  - `InviteUser::handle(Actor $actor, array $input): Invitation` — Policy `invite` (Org-Admin); `email` (getrimmt, klein, gültig, kein Konto mit der Adresse → `field.email.account_exists` „Zu dieser Adresse gibt es schon ein Konto.“), `org_role`, `projects.*.project_id` (existiert, sichtbar für den Actor), `projects.*.role`; löscht offene Einladungen an dieselbe Adresse (P7), legt die neue mit `expires_at = now()->addDays(7)` an; Event `user.invited` (Subjekt Einladung, `changes.email`); ist Mail konfiguriert (`MailSetup::configured()`), geht `InvitationNotification` (Queue `notifications`, Sprache der Organisation, Link aus `InvitationLinks`) nach dem Commit raus.
  - `ListInvitations::handle(Actor $actor, array $input): ListResult` — Org-Admin; offen = nicht angenommen und nicht abgelaufen.
  - `InvitationResource`: Typ `Invitation` aus `types.ts` (`id`, `email`, `org_role`, `projects`, `link`, `created_by`, `created_at`, `expires_at`). REST: `GET /api/v1/invitations`, `POST /api/v1/invitations` → `{ link, invitation }` (201).
  - `enum InvitationState: string { Open = 'open'; Expired = 'expired'; Closed = 'closed'; }`; `CheckInvitation::handle(?Invitation $i): InvitationState` — `null`, angenommen, Einlader kein aktiver Org-Admin mehr oder Konto zur Adresse vorhanden → `Closed`; abgelaufen → `Expired`; sonst `Open`.
  - `AcceptInvitation::handle(Invitation $i, array $input): User` (Auth-Namespace, ohne Actor, A4) — sperrt die Einladung (`lockForUpdate`), nicht `Open` → `ValidationException` an `invitation` (`invitation.closed` bzw. `invitation.expired`); `name` required max 120, `password` nach `PasswordRules`; legt die Person an (E-Mail der Einladung, Handle aus `NextHandle::run($name)`, Sprache = Sprache der Anfrage), setzt die Org-Rolle, tritt den Projekten bei, die noch existieren und nicht gelöscht werden, setzt `accepted_at`; Events `user.created` und je Projekt `project.member_added`, alle mit `Actor::system($user, 'invitation')`.
  - Web: `GET /invitations/{invitation}` (`invitations.show`, `guest`, `signed:relative`) → Inertia `Auth/Invitation` mit `state`, `email`; unbekannte ID → `state` `closed`. `POST /invitations/{invitation}` (`invitations.accept`, `guest`, `signed:relative`, `throttle:invitation`) → `AcceptInvitation`, `Auth::login`, `session()->regenerate()`, Redirect `/my-items` mit `status` = `__('invitation.welcome', ['name' => …, 'organization' => …])`.
  - `features/auth/Invitation.tsx`: Port des Klickdummys mit `useForm` von Inertia (Felder `name`, `password`), Texte unter `invitation.*` (de wörtlich, ohne „Im Klickdummy gilt jedes Passwort.“; stattdessen `invitation.password_hint` „Mindestens 8 Zeichen.“), Organisation aus den Shared Props (nie über die API, vorgemerkt: kein 401-Kreislauf auf Gast-Seiten); `state` `expired`/`closed` zeigt statt des Formulars einen Banner (`invitation.expired`, `invitation.closed`) und den Link zur Anmeldung.
  - `Shell.tsx`: `flash.status` erscheint einmal je Besuch als Toast `tone: 'success'`.
  - `e2e/helpers.ts`: `export async function api(page: Page, method: string, path: string, body?: unknown): Promise<APIResponse>` (schickt `X-XSRF-TOKEN` aus dem Cookie der Seite mit). `invitation.spec.ts` leert in `beforeAll` den Cache (Drossel `invitation` je IP).

- [ ] **Step 1: Failing Tests schreiben**

`InvitationTest.php` (Review Focus „Einladungslinks“):

```php
it('replaces the open invitation to an address, so the old link closes', function () {
    $admin = User::factory()->admin()->create();
    $first = InviteUser::run(actor($admin), ['email' => 'neu@example.com', 'org_role' => 'member']);
    $second = InviteUser::run(actor($admin), ['email' => 'NEU@example.com ', 'org_role' => 'admin']);

    $this->get(InvitationLinks::for($first))->assertInertia(fn (Assert $p) => $p->component('Auth/Invitation')->where('state', 'closed'));
    $this->get(InvitationLinks::for($second))->assertInertia(fn (Assert $p) => $p->where('state', 'open')->where('email', 'neu@example.com'));
});

it('accepts once, signs the person in and joins the invited projects', function () {
    $admin = User::factory()->admin()->create();
    $web = Project::factory()->identifier('WEB')->create();
    $invitation = InviteUser::run(actor($admin), ['email' => 'lea@example.com', 'org_role' => 'member', 'projects' => [['project_id' => $web->id, 'role' => 'viewer']]]);

    $this->post(InvitationLinks::for($invitation), ['name' => 'Lea Sommer', 'password' => 'secret-pass'])->assertRedirect('/my-items');
    $lea = User::query()->where('email', 'lea@example.com')->sole();
    $this->assertAuthenticatedAs($lea);
    expect(Visibility::roleIn($lea, $web))->toBe(ProjectRole::Viewer)->and($lea->handle)->toBe('lea-sommer');

    auth()->logout();
    $this->post(InvitationLinks::for($invitation), ['name' => 'Again', 'password' => 'secret-pass'])->assertSessionHasErrors('invitation');
});
```

Dazu: „expires after seven days“ (`travel(7)->days()->addSecond()` → `state` `expired`, POST → Fehler `invitation`); „closes when the inviter is no longer an active admin“; „refuses a link with a broken signature“ (403-Seite); „builds the link from APP_URL“ (Host-Header fremd); „mails the link when mail is configured, and only then“ (`Notification::fake()`, beide Fälle); „skips projects deleted in between“ (`deleting_at`); „refuses a short password and an empty name at the fields“; Events `user.created` und `project.member_added` mit `meta.reason` `invitation`; Drossel nach 10 Versuchen je IP.

`InvitationsApiTest.php`: Member → 403; Adresse eines bestehenden Kontos → 422 `email`; Projekt in Löschung (`deleting_at`, für niemanden sichtbar) → 422 `projects.0.project_id`; Antwort `{link, invitation}`, `link` beginnt mit `APP_URL`; Liste ohne angenommene und abgelaufene.

Matrix-Zeilen `InviteUser`, `ListInvitations` (`org_admin`, `default_bot`; Event bei `InviteUser`), Ausnahmen `CheckInvitation`, `AcceptInvitation` (Auth, vor der Anmeldung) im Kommentar; Routen-Zeilen.

`Shell.test.tsx`: `flash.status` erscheint als Erfolgs-Toast, derselbe `flash`-Gegenstand nur einmal.

`e2e/tests/invitation.spec.ts` (als Erik per `api()` einladen, Lauf-Kennung in der Adresse `invite-<variant>-<runId>@example.com`; dann in einem neuen Kontext ohne Sitzung): „accepts an invitation with the keyboard only“ (Link öffnen, Tab in „Name“, tippen, Tab, Passwort, Enter → `/my-items`, Toast `invitation.welcome`); „shows a closed link“ (zweite Einladung an dieselbe Adresse, alter Link → Banner `invitation.closed`, Tab zum Link `invitation.to_login`, Enter → `/login`); „names the empty fields“ (Enter ohne Eingaben → Fehler an `name`, Fokus dort).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='InvitationTest|InvitationsApiTest|RightsMatrixTest|RouteMatrixTest'`.

- [ ] **Step 3: Gates G1, G2, G3**

- [ ] **Step 4: Commit**

Betreff: `feat: invite people with a signed link valid for seven days, by mail when configured, and accept the invitation`.

---

### Task 10: Tokens, Passwort und Zwei-Faktor-Anmeldung

**Files:**
- Create: `app/Actions/Tokens/{ListTokens,CreateToken,RevokeToken}.php`, `app/Actions/Account/{ChangePassword,GetTwoFactor,EnableTwoFactor,ConfirmTwoFactor,DisableTwoFactor,RegenerateRecoveryCodes}.php`, `app/Http/Resources/TokenResource.php`, `app/Http/Middleware/EnsureSession.php`, `app/Http/Controllers/Api/{TokensController,PasswordController,TwoFactorController}.php`, `resources/js/features/auth/TwoFactorChallenge.tsx`, `resources/js/pages/Auth/TwoFactorChallenge.tsx`, `tests/Feature/Api/{TokensApiTest,ChangePasswordTest,TwoFactorApiTest}.php`, `tests/Feature/Auth/TwoFactorLoginTest.php`, `e2e/tests/two-factor.spec.ts`
- Modify: `config/fortify.php` (Feature `twoFactorAuthentication(['confirm' => true, 'confirmPassword' => false])`, Limiter `two-factor`), `app/Providers/FortifyServiceProvider.php` (Pipeline, View, Limiter), `routes/auth.php`, `routes/api.php`, `app/Models/User.php` (`TwoFactorAuthenticatable`), `app/Policies/UserPolicy.php` (`manageTokens`), `tests/Feature/Auth/LoginThrottleTest.php` (Pipeline), `e2e/helpers.ts` (`totp()`), `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `lang/en.json`, `lang/de.json`, `CLAUDE.md` (Fallstricke: Pipeline mit 2FA, `session_required`)

**Interfaces:**
- Consumes: Tasks 7–9
- Produces:
  - Policy `UserPolicy::manageTokens(User $actor, User $owner)`: das eigene Konto oder, für Org-Admins, ein Bot (Spec 4.2); sonst `problem.detail.tokens_own_or_bots`.
  - `ListTokens::handle(Actor $actor, User $owner, array $input): ListResult`; `CreateToken::handle(Actor $actor, User $owner, array $input): NewAccessToken` — `name` required max 120, `abilities` nicht leer, Teilmenge von `read`, `write`, `mcp` (doppelte entfernt, Reihenfolge `read`, `write`, `mcp`), `expires_at` optional, in der Zukunft; deaktiviertes Konto → `Problem::forbidden(__('problem.detail.token_disabled_owner'))`; Event `token.created` (Subjekt Token). `RevokeToken::handle(Actor $actor, PersonalAccessToken $token): void` — löscht, Event `token.revoked`.
  - `TokenResource`: Typ `Token` (`id`, `user_id`, `name`, `abilities`, `expires_at`, `last_used_at`, `created_at`). REST: `GET /api/v1/tokens?user_id=` (ohne `user_id` das eigene Konto), `POST /api/v1/tokens` (`{user_id, name, abilities, expires_at}`) → 201 `{ token, plain_text }`, `DELETE /api/v1/tokens/{token}` → 204.
  - `final class EnsureSession`: handelt ein `PersonalAccessToken` → `Problem::forbidden(__('problem.reason.session_required'), 'session_required')` (P6); gilt für `/api/v1/me/*` und läuft vor `EnsureTokenAbility` (Prioritätsliste, P28).
  - `ChangePassword::handle(Actor $actor, array $input): void` — nur Personen; prüft `current_password` (`field.current_password.wrong`) und `confirmed`, dann `SetPassword::run($actor->user, $input['password'], $actor, keepSession: true, reason: 'password_change')` (Regeln, Hash, `remember_token`, Sitzungen und Event `user.password_changed` nur dort, P25). Die aktuelle Sitzung bleibt gültig, weil `AuthenticateSession` am Ende derselben Anfrage den neuen Hash speichert.
  - 2FA (nur Personen, sonst 403): `GetTwoFactor::handle(Actor $actor): array` → `{enabled: bool, confirmed_at: ?string, recovery_codes_left: int}`; `EnableTwoFactor::handle(Actor $actor): array` — bestätigt → 409 `two_factor_enabled`; sonst Fortifys `EnableTwoFactorAuthentication` mit `force: true` (eine angefangene Einrichtung beginnt neu) → `{secret, otpauth_url, qr_svg}` (`qr_svg` als `data:image/svg+xml;base64,…` aus `twoFactorQrCodeSvg()`), Event `user.two_factor_setup_started` ohne Webhook und ohne Geheimnis (P26); `ConfirmTwoFactor::handle(Actor $actor, string $code): array` — ohne angefangene Einrichtung 409 `two_factor_not_pending`; falscher Code → 422 an `code` (`field.code.wrong` „Der Code stimmt nicht. Nimm den aktuellen aus der App.“); sonst Fortifys `ConfirmTwoFactorAuthentication` → `{recovery_codes: list<string>}`, Event `user.two_factor_enabled`; `DisableTwoFactor::handle(Actor $actor): void` (aus → nichts, kein Event), Event `user.two_factor_disabled`; `RegenerateRecoveryCodes::handle(Actor $actor): array` — aus → 409 `two_factor_disabled`; Event `user.recovery_codes_regenerated`.
  - REST (alle mit `EnsureSession`): `PUT /api/v1/me/password`, `GET /api/v1/me/two-factor`, `POST /api/v1/me/two-factor`, `POST /api/v1/me/two-factor/confirm` (`throttle:6,1`), `DELETE /api/v1/me/two-factor`, `POST /api/v1/me/two-factor/recovery-codes`.
  - Fortify (vorgemerkt): Pipeline `[EnsureLoginIsNotThrottled, CanonicalizeUsername, RedirectIfTwoFactorAuthenticatable, AttemptToAuthenticate, PrepareAuthenticatedSession]`; `Fortify::twoFactorChallengeView(fn () => Inertia::render('Auth/TwoFactorChallenge'))`; Routen `GET /two-factor-challenge` (`two-factor.login`, `guest`) und `POST /two-factor-challenge` (`two-factor.login.store`, `guest`, `throttle:two-factor`) mit Fortifys `TwoFactorAuthenticatedSessionController`; `RateLimiter::for('two-factor', fn (Request $r) => Limit::perMinute(5)->by((string) $r->session()->get('login.id')))`.
  - `features/auth/TwoFactorChallenge.tsx` (neu, im Stil von `Login`, Rahmen `AuthLayout`, Reiter „Anmelden“): Feld `code` (`inputMode="numeric"`, `autoComplete="one-time-code"`), Umschalter „Recovery-Code verwenden“ auf Feld `recovery_code`, Fehler am Feld, Fokus beim Wechsel; Texte unter `two_factor_challenge.*` (de selbst formuliert im Ton des Klickdummys, en übersetzt).
  - `e2e/helpers.ts`: `export function totp(secret: string, at = Date.now()): string` (RFC 6238, SHA-1, 30 s, 6 Stellen, `node:crypto`); `export async function signedInContext(browser: Browser, person: { email: string; password: string }): Promise<BrowserContext>` — öffnet den Kontext mit `test.info().project.use` (`baseURL`, `ignoreHTTPSErrors`, Viewport, `locale`, `timezoneId`, `colorScheme`) plus Zwischenablage-Rechten, führt vor der ersten Anmeldung eines Kontos `artisan('cache:clear')` aus (Login-Drossel je IP, wie A16), meldet per Tastatur an und hält den Zustand je Konto und Lauf unter `e2e/.auth/<email>.json`, damit spätere Specs dasselbe Konto ohne neue Anmeldung nutzen. `two-factor.spec.ts` leert den Cache in `beforeAll` (jeder Test meldet sich selbst an).

- [ ] **Step 1: Failing Tests schreiben**

`TwoFactorApiTest.php`:

```php
it('sets up two-factor sign-in in two steps and hands out the recovery codes once', function () {
    $lene = User::factory()->create();
    $this->actingAs($lene);
    $setup = $this->postJson('/api/v1/me/two-factor')->assertOk()->json();
    expect($setup['qr_svg'])->toStartWith('data:image/svg+xml;base64,')->and($setup['otpauth_url'])->toContain('otpauth://totp/');

    $this->postJson('/api/v1/me/two-factor/confirm', ['code' => '000000'])->assertUnprocessable()->assertJsonValidationErrors(['code']);
    $code = app(Google2FA::class)->getCurrentOtp($setup['secret']);
    $codes = $this->postJson('/api/v1/me/two-factor/confirm', ['code' => $code])->assertOk()->json('recovery_codes');

    expect($codes)->toHaveCount(8)
        ->and($this->getJson('/api/v1/me/two-factor')->json())->toMatchArray(['enabled' => true, 'recovery_codes_left' => 8])
        ->and(Event::query()->where('type', 'user.two_factor_enabled')->count())->toBe(1);
});
```

Dazu: zweites `POST` bei bestätigter 2FA → 409 `two_factor_enabled`; `confirm` ohne Einrichtung → 409 `two_factor_not_pending`; `DELETE` schaltet aus; Recovery-Codes neu → 8 neue, alte gelten nicht mehr; Bot (per Token) und jedes Token → 403 `session_required`; `secret` und Codes stehen in keinem Event.

`TwoFactorLoginTest.php`: Person mit bestätigter 2FA → `POST /login` leitet auf `/two-factor-challenge`, noch nicht angemeldet; richtiger TOTP-Code → `/my-items`; Recovery-Code → angemeldet und Code verbraucht (danach `recovery_codes_left` 7); falscher Code → Fehler `code`; sechster Versuch in einer Minute gedrosselt; `GET /two-factor-challenge` ohne angefangene Anmeldung → `/login`; Person ohne 2FA meldet sich weiter direkt an; `LoginThrottleTest` hält die neue Pipeline fest.

`ChangePasswordTest.php`: falsches aktuelles → 422 `current_password`; neues zu kurz bzw. ungleich → 422 `password`; Erfolg (Sitzung per echtem `POST /login`, dann `putJson('/api/v1/me/password')`, dann `Auth::forgetGuards()`): neues Passwort gilt, andere Datenbank-Sitzungen weg, die eigene bleibt (`getJson('/api/v1/organization')` danach 200); eine zweite Sitzung mit dem alten Hash (`flushSession()`, `withSession(['login_web_…' => $id, 'password_hash_web' => <alter Hash>])`, `Auth::forgetGuards()`) landet auf `/login` — ohne den Wechsel bliebe sie angemeldet; Event ohne Passwort.

`TokensApiTest.php`: Klartext genau einmal (`plain_text` beginnt nach `|` mit `wb_`, `GET` zeigt ihn nie); Token mit `read` liest, `write` schreibt (über die Middleware aus Task 7); abgelaufenes Token → 401; `last_used_at` nach Benutzung gesetzt; Person verwaltet nur eigene (fremde Person → 403), Org-Admin die Tokens von Bots und des Standard-Bots, nicht die anderer Personen; deaktiviertes Konto → 403; Widerrufen → 204, danach 401 (`forgetApiAuth()`).

Matrix-Zeilen: `ListTokens`, `CreateToken`, `RevokeToken` (Ziel: ein Bot der `MatrixWorld`; erlaubt `org_admin`, `default_bot`), `ChangePassword` (mit `MatrixWorld::PASSWORD`), `GetTwoFactor`, `EnableTwoFactor`, `ConfirmTwoFactor` (die Zeile richtet vorher ein und tippt `Google2FA::getCurrentOtp`), `DisableTwoFactor`, `RegenerateRecoveryCodes` (die Zeile schaltet vorher ein) — jeweils am eigenen Konto: erlaubt allen Personen-Spalten, `default_bot` → 403; Events auch bei `EnableTwoFactor` (`user.two_factor_setup_started`); Routen-Zeilen mit `session => true` für `/me/*`.

`e2e/tests/two-factor.spec.ts` (eigener Kontext ohne die geteilte Sitzung, Konto `PEOPLE.twoFactor[variant()]`): „asks for the code after the password and signs in with it“ (Tastatur: E-Mail, Passwort, Enter → Challenge, `totp(secret)` tippen, Enter → `/my-items`); „signs in with a recovery code“ (Umschalter per Tab und Leertaste, Code aus `recoveryCodes[0]`); „names a wrong code at the field“.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='TokensApiTest|ChangePasswordTest|TwoFactorApiTest|TwoFactorLoginTest|LoginThrottleTest|RightsMatrixTest|RouteMatrixTest'`.

- [ ] **Step 3: Gates G1, G2, G3**

- [ ] **Step 4: Commit**

Betreff: `feat: add API tokens with read, write and mcp, password change and TOTP sign-in with recovery codes`.

---

### Task 11: Projekte

**Files:**
- Create: `app/Domain/Projects/Identifier.php`, `app/Actions/Projects/{ListProjects,GetProject,CreateProject,UpdateProject,ArchiveProject,DeleteProject,PurgeProject}.php`, `app/Jobs/PurgeProject.php`, `app/Policies/ProjectPolicy.php`, `app/Http/Resources/ProjectResource.php`, `app/Http/Controllers/Api/ProjectsController.php`, `tests/Unit/Domain/IdentifierTest.php`, `tests/Feature/Api/{ProjectsApiTest,ProjectIdentifierTest,DeleteProjectTest}.php`
- Modify: `routes/api.php` (`Route::bind('project', …)`), `app/Models/Project.php` (`HasMedia`, Sammlung `image`), `app/Actions/Media/ShowMedia.php` (Projektbild), `tests/Feature/MediaTest.php`, `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `lang/en.json`, `lang/de.json`

**Interfaces:**
- Consumes: Tasks 4, 7
- Produces:
  - `final class App\Domain\Projects\Identifier`: `PATTERN = '/^[A-Z][A-Z0-9]{1,9}$/'`, `static normalize(string $raw): string` (trim, upper), `static isValid(string $identifier): bool`.
  - `ProjectPolicy` (alle Methoden: unsichtbar → `Response::denyAsNotFound()`): `viewAny` (jeder), `view` (`roleIn !== null`), `create` (`project.create`), `update` (`project.manage`, `problem.detail.project_settings_admins`), `archive` und `delete` (`project.archive`, `problem.detail.project_archive_admins` bzw. `problem.detail.project_delete_admins`), `join`, `viewMembers`, `manageMembers` (Task 12).
  - `ListProjects::handle(Actor $actor, array $input): ListResult` — `Project::visibleTo()`, ohne archivierte außer `include_archived` (bool), nach Name.
  - `GetProject::handle(Actor $actor, Project|string $project): Project` — ein String geht durch `findByReference` (unbekannt → 404), dann Policy `view` (404 für Unsichtbares und Unbekanntes gleich); REST übergibt das gebundene Modell, die Einstellungsseite (Task 17) die Kennung aus der URL. Kam der String als frühere Kennung, setzt die Action das nicht gespeicherte Attribut `resolved_by_former_identifier = true` (sonst `false`; nicht in der Resource) — die Entscheidung „ist das eine alte Kennung“ fällt hier, nicht im Controller (P32).
  - `CreateProject::handle(Actor $actor, array $input): Project` — Regeln aus `src/api/projects.ts`: `name` 1–120, `description` ≤ 2000 (getrimmt), `identifier` (normalisiert, `Identifier::isValid`, frei in `projects` und `project_identifiers`; `field.identifier.format` „Die Kennung hat 2 bis 10 Großbuchstaben oder Ziffern und beginnt mit einem Buchstaben.“, `field.identifier.taken` „Diese Kennung ist schon vergeben.“), `visibility` (Standard `public`), `lead_id` (Standard der Actor; aktive Person, `field.lead.invalid` „Diese Person kann nicht Lead sein.“), `image_url` (`ImageInput`); `workflow_id`, `enabled_type_ids`, `default_type_id` werden in Phase 2 nicht angenommen (Phase 3). Der Actor wird Projekt-Admin, ein anderer Lead Member; Event `project.created` (`changes.identifier`).
  - `UpdateProject::handle(Actor $actor, Project $project, array $input): Project` — Policy `update`; `name`, `description`, `image_url`, `visibility`, `lead_id` (muss Mitglied und aktive Person sein: `field.lead.not_member` „Die Lead-Person muss Mitglied des Projekts sein.“), `identifier` (Kennungswechsel: alte Kennung kommt nach `project_identifiers`, eine eigene frühere Kennung als neue entfernt diesen Eintrag, fremde frühere sind vergeben); Event `project.updated` mit `changes` nur bei Änderungen. Ein archiviertes Projekt bleibt für Admins änderbar (wie `src/lib/permissions.ts`).
  - `ArchiveProject::handle(Actor $actor, Project $project, bool $archived = true): Project` — Policy `archive`; Event `project.archived` bzw. `project.restored` (P11) nur bei Änderung.
  - Sichtbarkeits-Cache (P33): `CreateProject`, `UpdateProject` (bei `visibility` oder Lead-Mitgliedschaft), `ArchiveProject` und `DeleteProject` rufen nach dem Schreiben `Visibility::forget()` (der `RoleIndex` lebt je Request, im Test über mehrere Aufrufe). `ProjectsApiTest` „sees a change of visibility in the next call“: in einem Test erst `GET /api/v1/projects/OPS` als Nicht-Mitglied (404), dann als Admin `PATCH visibility=public`, dann wieder als Nicht-Mitglied → 200; ebenso `DELETE` → danach 404 im selben Test.
  - `DeleteProject::handle(Actor $actor, Project $project): void` — Policy `delete`; setzt `deleting_at` (ab sofort für alle unsichtbar), Event `project.deleted` mit `meta` `{identifier, name}`, stellt nach dem Commit `App\Jobs\PurgeProject` (Queue `bulk`) mit Projekt- und Actor-ID ein. `App\Actions\Projects\PurgeProject::handle(Actor $actor, Project $project): void` — entfernt Rollen (Team = Projekt), Favoriten, Mitgliedschaften, Kennungen, Bild und das Projekt; die Events des Projekts bleiben (P10); spätere Phasen hängen ihre Daten an (Items, Seiten, Anhänge). Der Job ruft nur die Action.
  - `ProjectResource`: Typ `Project` aus `types.ts` plus `my_role` (P13); bis Phase 3 `workflow_id: null`, `enabled_type_ids: []`, `default_type_id: null`.
  - REST: `GET /api/v1/projects` (`?include_archived=1`, `cursor`, `per_page`), `POST /api/v1/projects`, `GET /api/v1/projects/{project}`, `PATCH /api/v1/projects/{project}`, `POST /api/v1/projects/{project}/archive`, `POST /api/v1/projects/{project}/restore`, `DELETE /api/v1/projects/{project}` → 202. `{project}` bindet `Route::bind('project', fn (string $ref) => Project::findByReference($ref) ?? throw Problem::notFound())`; die Sichtbarkeit prüft die Action.

- [ ] **Step 1: Failing Tests schreiben**

`IdentifierTest.php` (Unit): gültig `WEB`, `A1`, `OPS2026`; ungültig `W`, `1AB`, `WEB-1`, `ABCDEFGHIJK`; `normalize(' web ')` → `WEB`.

`ProjectIdentifierTest.php` (Review Focus „Kennungswechsel“):

```php
it('keeps the old identifier resolving and reserved after a rename', function () {
    $admin = User::factory()->admin()->create();
    $web = CreateProject::run(actor($admin), ['name' => 'Website', 'identifier' => 'WEB']);
    UpdateProject::run(actor($admin), $web, ['identifier' => 'site']);

    $this->actingAs($admin)->getJson('/api/v1/projects/WEB')->assertOk()->assertJsonPath('data.identifier', 'SITE');
    $this->postJson('/api/v1/projects', ['name' => 'Andere', 'identifier' => 'WEB'])
        ->assertUnprocessable()->assertJsonPath('errors.identifier.0', __('field.identifier.taken'));

    UpdateProject::run(actor($admin), $web->fresh(), ['identifier' => 'WEB']);
    expect(ProjectIdentifier::query()->pluck('identifier')->all())->toBe(['SITE']);
});
```

Dazu: nach dem Löschen und Purge sind alle Kennungen frei; ein Projekt ohne Recht sieht die Kennung eines privaten Projekts nur als „vergeben“ (422, keine weiteren Angaben).

`ProjectsApiTest.php`: Anlegen als Member (wird Admin, Lead ist er selbst, Event `project.created`); anderer Lead wird Member; Lead deaktiviert oder Bot → 422 `lead_id`; Feldregeln (Datensatz Name leer, 121 Zeichen, Beschreibung 2001, Kennung ungültig); Liste ohne archivierte und mit `include_archived=1`; `my_role` je Spalte (Org-Admin `admin`, Viewer `viewer`, öffentlich ohne Mitgliedschaft `viewer`); privates Projekt für Nicht-Mitglieder: `GET` 404 ohne `detail`, fehlt in der Liste; Member ändert Einstellungen → 403 mit `detail`; Lead auf Nicht-Mitglied → 422; Archivieren und Wiederherstellen (Events `project.archived`, `project.restored`); Projektbild per Data-URL, `GET /media/<uuid>` für Unsichtbare 404.

`DeleteProjectTest.php`: `DELETE` → 202, sofort 404 für alle (auch Org-Admins), `PurgeProject` ist auf `bulk` eingestellt (`Queue::fake()`); nach dem Job (`Queue::fake([])`, sync) fehlen Projekt, Mitgliedschaften, Rollen (`model_has_roles` mit `team_id`), Favoriten, Kennungen; das Event `project.deleted` bleibt mit `meta.identifier`; Member → 403.

Matrix-Zeilen: `ListProjects` (alle), `GetProject` (alle außer `outsider_private` → 404), `CreateProject` (alle Spalten, jede Rolle hat `project.create`), `UpdateProject`, `ArchiveProject`, `DeleteProject` (erlaubt `org_admin`, `project_admin`, `default_bot`; Projekt über `$w->project($column)`, `hidden` `outsider_private`), `PurgeProject` (nur als System: Zeile mit `'system' => true`, ruft mit dem Standard-Bot, erwartet keinen Fehler und **kein** Event — die benannte Ausnahme der Global Constraints, P26); Routen-Zeilen.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='IdentifierTest|ProjectIdentifierTest|ProjectsApiTest|DeleteProjectTest|MediaTest|RightsMatrixTest|RouteMatrixTest'`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit**

Betreff: `feat: add projects over REST with identifiers that keep resolving, archive and deletion by job`.

---

### Task 12: Mitglieder, Beitreten, Favoriten

**Files:**
- Create: `app/Actions/Projects/{ListMembers,JoinProject,AddMember,UpdateMemberRole,RemoveMember}.php`, `app/Actions/Favorites/{ListFavorites,ToggleFavorite}.php`, `app/Http/Resources/{ProjectMemberResource,FavoriteResource}.php`, `app/Http/Controllers/Api/{MembersController,FavoritesController}.php`, `tests/Feature/Api/{MembersApiTest,FavoritesApiTest,ProjectRightsTableTest}.php`
- Modify: `routes/api.php`, `app/Policies/ProjectPolicy.php`, `tests/Feature/Access/matrix.php`, `tests/Feature/Api/routes.php`, `lang/en.json`, `lang/de.json`

**Interfaces:**
- Consumes: Task 11
- Produces:
  - `ListMembers::handle(Actor $actor, Project $project, array $input): ListResult` — Policy `viewMembers` (wer das Projekt sieht).
  - `JoinProject::handle(Actor $actor, Project $project): ProjectMember` — schon Mitglied → `Problem::conflict('already_member')` mit `detail`; öffentlich oder Org-Admin, sonst 404; Rolle Member; Event `project.member_added`.
  - `AddMember::handle(Actor $actor, Project $project, array $input): ProjectMember` — Policy `manageMembers` (`project.manage`, `problem.detail.members_admins_only` „Mitglieder verwalten nur Admins des Projekts.“); `user_id` aktives Konto (Person oder Bot, auch der Standard-Bot), noch kein Mitglied (`field.user.already_member`, `field.user.inactive`); `role` aus `ProjectRole`; Event `project.member_added` (`changes.member`).
  - `UpdateMemberRole::handle(Actor $actor, Project $project, User $user, string $role): ProjectMember` — kein Mitglied → 404; Event `project.member_role_changed`.
  - `RemoveMember::handle(Actor $actor, Project $project, User $user): void` — Lead → `Problem::conflict('lead_cannot_leave')`; Event `project.member_removed`.
  - `JoinProject`, `AddMember`, `UpdateMemberRole`, `RemoveMember` rufen nach dem Schreiben `Visibility::forget()` (über `RoleAssignments` ohnehin; die Actions verlassen sich nicht darauf). `MembersApiTest` „loses the project in the next call after removal“: im selben Test erst `GET /api/v1/projects/OPS` als Mitglied 200, Entfernen durch den Admin, dann derselbe Aufruf 404.
  - `ListFavorites::handle(Actor $actor): ListResult` — eigene Favoriten nach `position`, nur Projekte, die das Konto noch sieht (Review Focus: Entfernte verlieren den Favoriten sofort); `ToggleFavorite::handle(Actor $actor, array $input): array` — `kind` nur `project` (`view` mit Phase 5, bis dahin 422 `kind`), Projekt sichtbar (sonst 404), legt an (Position = max + 1) oder entfernt; Antwort `{kind, id, favorite}`; Event `favorite.added` bzw. `favorite.removed` (Subjekt das Projekt, `project_id` `null`: persönlich, keine Projektaktivität).
  - `ProjectMemberResource` (aus `ProjectMember`, Rolle über `RoleIndex::members()`): `project_id`, `user_id`, `role`. `FavoriteResource`: `user_id`, `kind`, `id`, `position`.
  - REST: `POST /api/v1/projects/{project}/join` → 201, `GET|POST /api/v1/projects/{project}/members`, `PATCH|DELETE /api/v1/projects/{project}/members/{user}`, `GET /api/v1/favorites`, `POST /api/v1/favorites/toggle`.

- [ ] **Step 1: Failing Tests schreiben**

`ProjectRightsTableTest.php` (Abnahme „verhält sich wie die Tabellen in 4.3“, über REST): Datensatz `[Rolle, öffentlich/privat, Aufruf, erwarteter Status]` für Org-Admin ohne Mitgliedschaft, Admin, Member, Viewer, Nicht-Mitglied gegen WEB (öffentlich) und OPS (privat) mit `GET project`, `GET members`, `PATCH project`, `POST members`, `POST join`, `POST archive`, `DELETE`. Beispiele: Nicht-Mitglied × OPS × jeder Aufruf → 404; Nicht-Mitglied × WEB × `GET` → 200, `PATCH` → 403, `join` → 201; Viewer × WEB × `PATCH` → 403; Org-Admin × OPS × `PATCH` → 200.

`MembersApiTest.php`: Hinzufügen, Rolle ändern, Entfernen mit Events; doppelt → 422 `user_id`; deaktiviertes Konto → 422; unbekannte Rolle → 422 `role`; Lead entfernen → 409 `lead_cannot_leave`; nach dem Entfernen aus OPS: `GET /api/v1/projects/OPS` → 404, fehlt in `GET /api/v1/projects` und `GET /api/v1/favorites`; Standard-Bot als ausdrückliches Mitglied; Beitreten öffentlich → Member, zweimal → 409 `already_member`, privat → 404, privat als Org-Admin → 201.

`FavoritesApiTest.php`: an, aus, Positionen fortlaufend; `kind` `view` → 422; unsichtbares Projekt → 404; nur die eigenen.

Matrix-Zeilen für die sieben Actions (Projekt über `$w->project($column)`, `hidden` `outsider_private`) mit Events: `JoinProject` entfernt vorher die eigene Mitgliedschaft des Kontos in WEB (dann treten alle sichtbaren Spalten bei), `AddMember` fügt eine neue Person hinzu, `UpdateMemberRole` und `RemoveMember` zielen auf `$w->target`, `ListFavorites` (alle Spalten), `ToggleFavorite` (alle sichtbaren); Routen-Zeilen.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter='ProjectRightsTableTest|MembersApiTest|FavoritesApiTest|RightsMatrixTest|RouteMatrixTest'`.

- [ ] **Step 3: Gates G1**

- [ ] **Step 4: Commit**

Betreff: `feat: manage project members, join public projects and keep favorite projects`.

---
### Task 13: Frontend-Datenschicht

**Files:**
- Create: `resources/js/api/{organization,users,tokens,projects,views,security}.ts` mit je `*.test.ts`, `resources/js/hooks/{keys,mutation,organization,users,tokens,projects,views,security}.ts`, `resources/js/hooks/data.test.tsx`, `resources/js/lib/{permissions,zones}.ts` mit Tests, `resources/js/domain/{tz,people}.ts` mit Tests (Port von `src/domain/{tz,people}.test.ts`), `resources/js/test/api.ts`
- Modify: `resources/js/api/http.ts`, `resources/js/api/http.test.ts`, `resources/js/app.tsx`, `resources/js/hooks/queryClient.test.ts`, `resources/js/types.ts`, `vitest.config.ts` (Schwelle `resources/js/domain/**`), `lang/en.json`, `lang/de.json`, `CLAUDE.md` (Architektur: Frontend-Datenschicht, `getPage`, `setSignedIn`)

**Interfaces:**
- Consumes: REST aus Tasks 7–12
- Produces:
  - Einzelressourcen bleiben in `{data}` gehüllt (Laravel-Standard wie die Listen, P27); `http.ts` exportiert `export async function one<T>(call: Promise<{ data: T }>): Promise<T>` und jede API-Funktion mit Einzelantwort entpackt genau dort (`return one(get<{ data: Project }>(…))`); Antworten ohne Hülle (`{link, invitation}`, `{token, plain_text}`, `{kind, id, favorite}`, 2FA, 204) gehen unverändert durch. `http.test.ts`: „unwraps data of a single resource“.
  - `http.ts` (vorgemerkt): `export function getPage<T>(path: string, query?: Query, options?: RequestOptions): Promise<Page<T>>` (übersetzt `{data, meta: {next_cursor, total}}` in `{items, next_cursor, total}`); eine 2xx-Antwort, deren Text kein JSON ist, wird `ApiError({ status, reason: 'http_error' })`; `export function setSignedIn(signedIn: boolean): void` — ein 401 lädt die Seite nur neu, wenn jemand angemeldet war (sonst nur `ApiError`, kein Kreislauf auf Gast-Seiten).
  - `app.tsx`: `setSignedIn(props.auth.user !== null)` beim ersten Rendern und bei jedem `navigate`; der Kommentar zu HMR-Imports entfällt (vorgemerkt).
  - `resetForUser` (vorgemerkt) bleibt bei `queryClient.clear()`: Anmelden, Abmelden und Einladung annehmen wechseln immer über eine Seite ohne Shell, es bleibt kein Beobachter mit altem Konto stehen; `queryClient.test.ts` hält das fest.
  - API-Funktionen mit denselben Namen und Signaturen wie im Klickdummy (`src/api/*`): `getOrganization()`, `updateOrganization(patch)`; `listUsers(args)`, `inviteUser(input)`, `listInvitations()`, `updateUserRole(user_id, org_role)`, `deactivateUser(user_id)`, `reactivateUser(user_id)`, `createBot(input)`, `updateUser(user_id, patch)`; `listTokens(user_id)`, `createToken(input)`, `revokeToken(id)`; `listProjects(args)`, `getProject(identifier)`, `createProject(input)`, `updateProject(id, patch)`, `archiveProject(id, archived = true)` (`archive` bzw. `restore`), `deleteProject(id)`, `listMembers(project)` (P13: Projekt Pflicht), `joinProject(id)`, `addMember(project_id, user_id, role)`, `updateMemberRole(project_id, user_id, role)`, `removeMember(project_id, user_id)`; `listFavorites()`, `toggleFavorite({ kind, id })`. Die Typen der Eingaben (`InviteUserInput`, `CreateBotInput`, `UpdateUserPatch`, `CreateTokenInput`, `CreateProjectInput` ohne `workflow_id`/`enabled_type_ids`/`default_type_id`, `UpdateProjectPatch`, `ListProjectsArgs`, `ListUsersArgs`, `UpdateOrganizationPatch`) wie dort. Neu `api/security.ts` (aus `securityApi.ts`): `changePassword(input: { current_password: string; password: string; password_confirmation: string })`, `getTwoFactor(): Promise<TwoFactorStatus>`, `enableTwoFactor(): Promise<TwoFactorSetup>`, `confirmTwoFactor(code: string): Promise<{ recovery_codes: string[] }>`, `disableTwoFactor()`, `regenerateRecoveryCodes()`.
  - `types.ts`: `Project.my_role: ProjectRole`; `Project.workflow_id` und `default_type_id` `string | null` bis Phase 3 (Kommentar); neu `TwoFactorStatus { enabled: boolean; confirmed_at: string | null; recovery_codes_left: number }`, `TwoFactorSetup { secret: string; otpauth_url: string; qr_svg: string }`.
  - Hooks wie `src/hooks/*` (Namen, Query-Keys aus dem portierten `keys.ts`, Invalidierungen wie dort); `useCurrentUser(): User | undefined` liest `auth.user` aus den Shared Props (der Klickdummy las die Sitzung aus Zustand); `useOrganization()` startet mit den Shared Props als `initialData`; `useUpdateOrganization` und `useUpdateUser` (eigenes Konto) rufen nach dem Erfolg `router.reload()`, damit Shared Props und Sprache stimmen; neu `useTwoFactor()`, `useChangePassword()`, `useEnableTwoFactor()`, `useConfirmTwoFactor()`, `useDisableTwoFactor()`, `useRegenerateRecoveryCodes()`; aus `mutation.ts` nur `useApiMutation`, `useSettle` (`useItemMutation` kommt mit Phase 4).
  - `lib/permissions.ts`: `Permission`-Typ wie im Klickdummy, `deniedReason(data, permission, projectRef?)` mit `PermissionData { user: User; projects: Project[] }` (Rolle aus `project.my_role` statt aus `listMembers()`, P13), Gründe als Schlüssel `permissions.reason.*` (de wörtlich aus `src/lib/permissions.ts`), `usePermissions()` aus `useCurrentUser()` und `useProjects({ include_archived: true })`.
  - `lib/zones.ts` (13b: eine Liste statt zwei): `COMMON_ZONES`, `zoneOptions(current: string, fallback: string): ZoneOption[]` (Port von `settings/personal/zones.ts` samt Test); `domain/tz.ts`, `domain/people.ts` unverändert portiert.
  - `test/api.ts`: `mockApi(routes: Record<string, (body: unknown, url: URL) => { status?: number; body?: unknown }>): { calls: { method: string; url: string; body: unknown }[]; restore(): void }` — stellt `fetch` für Tests von API-Funktionen und Bildschirmen.

- [ ] **Step 1: Failing Tests schreiben**

Je API-Datei ein Test, der für **jede** Funktion Methode, Pfad, Query und Body prüft und die Antwort übersetzt (Schwelle `api/**`), z. B. `projects.test.ts`:

```ts
it('lists projects as a page and archives through archive or restore', async () => {
  const api = mockApi({
    'GET /api/v1/projects': () => ({ body: { data: [web], links: {}, meta: { next_cursor: null, total: 1 } } }),
    'POST /api/v1/projects/p1/restore': () => ({ body: { data: { ...web, archived_at: null } } }),
  });
  expect(await listProjects({ include_archived: true })).toEqual({ items: [web], next_cursor: null, total: 1 });
  expect(api.calls[0]!.url).toBe('/api/v1/projects?include_archived=1');
  await archiveProject('p1', false);
  expect(api.calls[1]!.method).toBe('POST');
});
```

`http.test.ts` ergänzen: „turns a 2xx answer that is no JSON into an http_error“; „does not reload on a 401 while nobody is signed in“ (`setSignedIn(false)` → kein `reload`, `ApiError` 401) und „reloads on a 401 of a signed-in page“; `getPage` mit fehlendem `meta.total` → `total` = Länge von `data`.

`data.test.tsx` (Schwelle `hooks/**`: jeder Hook mindestens einmal, Queries mit Daten, Mutationen mit ihrer Invalidierung): `useCurrentUser` liest die Shared Props (Inertia-`usePage` gemockt); `useUpdateUser` für das eigene Konto ruft `router.reload`, für ein fremdes nicht; `useCreateToken` hält die Antwort nicht im Cache (`gcTime` 0); `useApiMutation` bleibt `isPending`, bis die Invalidierung durch ist (Port aus `src/hooks/hooks.test.tsx`).

`permissions.test.ts`: Port der Fälle aus dem Klickdummy (Org-Admin überall Admin, Viewer liest nur, archiviert schreibgeschützt außer `project.manage`, ohne Projekt „irgendwo erlaubt“), umgestellt auf `my_role`; `usePermissions().loading` bis die Projekte da sind.

`tz.test.ts`, `people.test.ts`, `zones.test.ts`: Port der Klickdummy-Tests.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/api resources/js/hooks resources/js/lib resources/js/domain`.

- [ ] **Step 3: Gates G1, G2, G3** (G1 wegen `lang/*.json` und `TranslationKeysTest`; G3, weil `app.tsx` sich ändert)

- [ ] **Step 4: Commit**

Betreff: `feat: port the API layer, hooks, permissions and time zone helpers of accounts and projects to the REST API`.

---

### Task 14: Gemeinsamer Einstellungsrahmen und Verlassen-Schutz

**Files:**
- Create: `resources/js/features/settings/frame/{SettingsFrame,parts,LeaveGuard,access}.tsx`, `resources/js/features/settings/frame/{form,format,useDialogRound,useRemoval}.ts`, `resources/js/features/settings/frame/{frame.test.tsx,form.test.ts,format.test.ts,LeaveGuard.test.tsx}`
- Modify: `resources/js/lib/shortcuts/catalog.ts` (`settings.save`), `resources/js/lib/shortcuts/catalog.test.ts`, `lang/en.json`, `lang/de.json`

**Interfaces:**
- Consumes: Task 13
- Produces (13b, R26: ein Rahmen für Organisation, Persönlich und Projekt):
  - `SettingsFrame.tsx`: `SettingsFrame({ title, lead, nav, children })`, `SectionNav({ label, items, current, hrefFor })` mit Inertia-`<Link>` (unter `lg` eine Zeile Links, ab `lg` die Liste links, wie `OrgSettings.tsx`), `interface SectionItem { slug: string; label: string; icon?: LucideIcon; group?: string }`.
  - `parts.tsx` (aus `org/parts.tsx` und `project/SettingsParts.tsx` zusammengeführt): `SettingsCard`, `Panel`, `Rows`, `Row`, `RuledList`, `RuledRow`, `Badge`, `FieldGroup`, `Measure`, `FormActions` („Keine Änderungen zu speichern.“ bei leerem Speichern, wie der Klickdummy), `SettingsSkeleton`, `RowsSkeleton`, `FormSkeleton`, `Loaded`, `SettingsError`, `ReadOnlyBanner`, `SectionHeader`, `readOnlyField`. `TonePicker`/`ToneMenu` bleiben bis Phase 3 draußen.
  - `LeaveGuard.tsx`: `LeaveGuard({ dirty, what, bypass })` — solange `dirty`: `router.on('before', …)` hält Inertia-Besuche an (außer Neuladen ohne URL-Wechsel und `bypass.current`), fragt „Änderungen verwerfen?“ (`AlertDialog`), „Verwerfen“ setzt den Besuch fort (`router.visit(url, { method, data, preserveState … })`), dazu `beforeunload`. Ersetzt `UnsavedGuard` und den Org-`LeaveGuard` des Klickdummys.
  - `form.ts`: `fieldErrors`, `fieldMessage`, `unplacedMessages`, `noticeOf`, `hasReason`, `errorText`, `focusFirstInvalid`, `focusNeighbour` (auch auf der letzten Zeile: nimmt die vorige, 13c-Befund aus Task 12 des Klickdummys), `useDraft`, `useFieldErrors`, `useSaveShortcut(form, active)` (Katalog-ID `settings.save`, `mod+enter`, Scope `detail`).
  - `format.ts`: `useOrgZone()`, `formatDate(iso, zone)`, `formatDateTime(iso, zone)`, `relativeTime(iso)`, alle mit `Intl` in `intlLocale()` aus `lib/i18n` statt fest `de-DE`; „jetzt“ ist `Date.now()`.
  - `access.tsx`: `useOrgRight(permission)`, `NotForMembers`, `ReadOnlyNotice` (Port; wartet auf `usePermissions().loading`).
  - Schlüssel unter `settings.frame.*`, `settings.access.*`; Kürzel `settings.save` (Label `shortcuts.settings.save`, Gruppe `shortcuts.group.settings`).

- [ ] **Step 1: Failing Tests schreiben**

`LeaveGuard.test.tsx` (Inertia-`router` gemockt): ohne Änderungen kein Halt; mit Änderungen hält `before` an und öffnet den Dialog; „Verwerfen“ besucht die Ziel-URL ohne erneuten Halt; „Weiter bearbeiten“ bleibt; `bypass.current = true` lässt durch; `beforeunload` setzt `returnValue` nur mit Änderungen.

`frame.test.tsx`: `SectionNav` markiert den aktuellen Abschnitt (`aria-current="page"`) und nutzt `hrefFor`; `FormActions` meldet „Keine Änderungen zu speichern.“ ohne Änderungen; `Loaded` zeigt Skelett, Fehler mit „Erneut versuchen“ und Inhalt; `ReadOnlyBanner` und `NotForMembers` mit Grund.

`form.test.ts`: `fieldErrors` nur für 422; `noticeOf` sammelt Meldungen ohne Platz; `useDraft` setzt zurück, wenn die Quelle sich ändert; `useSaveShortcut` reicht nur mit `active` ab; `focusNeighbour` auf der letzten Zeile fokussiert die vorige.

`format.test.ts`: Datum in `en` und `de`, in `Europe/Berlin` und `UTC` (Tageswechsel um Mitternacht UTC), `relativeTime` mit gestellter Uhr (`vi.setSystemTime`).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/settings/frame`.

- [ ] **Step 3: Gates G1, G2** (G1 wegen `lang/*.json`; die Schwelle für `frame/**` kommt erst mit Task 15, P30 — die Tests oben decken trotzdem jede Datei: `frame.test.tsx` rendert `SettingsFrame`, `SectionNav`, `SettingsCard`, `Panel`, `Rows`/`Row`, `RuledList`/`RuledRow`, `Badge`, `FieldGroup`, `Measure`, `SectionHeader`, alle Skelette, `Loaded`, `SettingsError`, `ReadOnlyBanner`, `NotForMembers`, `ReadOnlyNotice` und `useOrgRight` (laden, Fehler, bereit); `form.test.ts` jede Funktion inklusive `unplacedMessages`, `hasReason`, `focusFirstInvalid`, `useFieldErrors`; `useDialogRound` und `useRemoval` bekommen eigene Fälle in `frame.test.tsx`)

- [ ] **Step 4: Commit**

Betreff: `feat: add one settings frame with section navigation, form helpers and an Inertia leave guard`.

---

### Task 15: Einstellungen der Organisation (Allgemein, Personen, Bots)

**Files:**
- Create: `resources/js/pages/Settings/Organization.tsx`, `resources/js/features/settings/org/{OrgSettings,General,People,Bots}.tsx`, `resources/js/features/settings/org/sections.ts`, `resources/js/features/settings/org/org.test.tsx`, `resources/js/features/settings/frame/{ImageField.tsx,ImageField.test.tsx}`, `resources/js/features/settings/tokens/{TokenDialog,SetupSnippets,CopyButton,AdminWarning}.tsx`, `resources/js/features/settings/tokens/snippets.ts` mit Test, `tests/Feature/SettingsPagesTest.php`, `e2e/tests/settings-organization.spec.ts`
- Modify: `routes/web.php`, `vitest.config.ts` (Schwelle `resources/js/features/settings/frame/**` = 100 % Zeilen, P30), `lang/en.json`, `lang/de.json`, `e2e/fixtures.ts` (Zwischenablage-Rechte)

**Interfaces:**
- Consumes: Tasks 13–14
- Produces:
  - Route `GET /settings/{section?}` (`auth`) → Inertia `Settings/Organization` mit `section` (Standard `general`); die Seite rendert nur `<OrgSettings section={section} />` mit `shellLayout`.
  - `sections.ts`: in Phase 2 nur `general`, `people`, `bots` (Gruppe „Organisation“); die übrigen Abschnitte kommen mit ihren Phasen; unbekannter Abschnitt zeigt „Diesen Bereich gibt es nicht“ mit der Liste (wie der Klickdummy).
  - `frame/ImageField.tsx` (P15): Port von `settings/project/ImageField.tsx` samt `readSquareImage` (Mitte des Bilds als 128-px-PNG-Data-URL, die der Server prüft und in medialibrary ablegt); Test `frame/ImageField.test.tsx` (Schwelle des Rahmens: Nicht-Bild abgelehnt, unlesbares Bild abgelehnt, Entfernen, Vorschau).
  - `General.tsx`: Port; Logo über `frame/ImageField` als Data-URL in `updateOrganization`, Zeitzonen aus `lib/zones.ts`, Speichern mit `useSaveShortcut`, Members lesen mit `ReadOnlyNotice`.
  - `People.tsx`: Port (Einladen-Dialog mit Projekten und Rollen, Link kopieren, offene Einladungen mit „Link anzeigen“, Rollenwechsel, Deaktivieren und Aktivieren, Hinweis bei `last_admin`, Rückfrage bei eigenem Konto); statt „Der Klickdummy meldet dich jetzt als … an“ lädt die Seite nach dem eigenen Deaktivieren neu (der Server meldet ab).
  - `Bots.tsx`: Port (Karten, Anlegen und Bearbeiten, Deaktivieren, Tokens je Bot, Warnung beim Standard-Bot); `handleFrom(name)` bleibt im Modul.
  - `features/settings/tokens/` (13b: ein Dialog für Bots und Persönlich): `TokenDialog({ owner, onClose })` auf Basis von `settings/personal/TokenDialog.tsx` (Ablaufdatum als `Input type="date"` bis Ende des Tages in der Zeitzone des Eigentümers über `domain/tz`; `confirmClose` nach dem Anlegen), zeigt bei `owner.is_default_bot` `AdminWarning`; `SetupSnippets({ token })` und `snippets.ts` (Port, ohne Snippet-Prüfung gegen einen MCP-Server, Master-Plan), `CopyButton`.
  - Texte unter `settings.org.*`, `settings.people.*`, `settings.bots.*`, `settings.tokens.*`, `roles.org.*`, `roles.project.*`; Schlüssel, auf die sich die Spec verlässt: `settings.people.invite`, `settings.people.invite_dialog.email`, `settings.people.invite_dialog.submit`, `settings.people.copy_link`, `settings.bots.create`, `settings.tokens.create`, `settings.tokens.copy`, `settings.tokens.copied_confirm` („Ich habe den Token kopiert“).

- [ ] **Step 1: Failing Tests schreiben**

`SettingsPagesTest.php`: `/settings` und `/settings/people` rendern `Settings/Organization` mit `section` `general` bzw. `people`; Gäste → `/login`.

`org.test.tsx` (Vitest mit `mockApi`, für Zweige, die Playwright nicht sinnvoll erreicht): Ladefehler jeder Sektion mit „Erneut versuchen“; 422 auf ein nicht gezeigtes Feld erscheint als Hinweis (`noticeOf`); `last_admin` bleibt als Banner stehen, bis es geschlossen wird; Standard-Bot ohne Deaktivieren-Knopf; abgelaufener Token mit „abgelaufen“.

`e2e/tests/settings-organization.spec.ts` (als Erik, Org-Admin; Lauf-Kennung in allen neuen Namen): „changes the name of the organization with the keyboard“ (Tab ins Feld, tippen, ⌘⏎, Toast, Reload zeigt den Namen; danach zurück auf „Feldwerk“); „invites a person, copies the link and shows it in the list“ (Dialog per Tastatur, Projekt WEB mit Rolle Viewer, `navigator.clipboard.readText()` = angezeigter Link); „changes the role of a person and back“ (Lene per Menü zu Admin, Toast, zurück zu Member; der `last_admin`-Banner ist in `org.test.tsx` gedeckt, weil Erik und Mara beide Admins sind); „creates a bot, a token for it, and revokes it“ (Klartext einmal, Knopf `tr(locale, 'settings.tokens.copied_confirm')`, Widerrufen mit Rückgängig-Toast); „warns at the tokens of the default bot“; „shows members the read-only general section and no people“ (`signedInContext` als Lene, Member: `ReadOnlyNotice`, „Nur für Admins“ unter Personen); „leaves an edited form only after the question“ (Name ändern, `g p`, Dialog, „Weiter bearbeiten“, dann „Verwerfen“); Fehlerzustand per `page.route('**/api/v1/users*', 503)` → „Erneut versuchen“.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter=SettingsPagesTest`; `ddev exec pnpm test -- resources/js/features/settings`; `pnpm --dir e2e test -- settings-organization` (nach `build:coverage`).

- [ ] **Step 3: Gates G1, G2, G3**

- [ ] **Step 4: Commit**

Betreff: `feat: port the organization settings for general, people and bots with one token dialog`.

---

### Task 16: Persönliche Einstellungen (Profil, Sicherheit, API und MCP)

**Files:**
- Create: `resources/js/pages/Settings/Personal.tsx`, `resources/js/features/settings/personal/{PersonalSettings,Profile,Security,TwoFactor,ApiAndMcp,QrCode}.tsx`, `resources/js/features/settings/personal/personal.test.tsx`, `e2e/tests/settings-personal.spec.ts`
- Modify: `routes/web.php`, `tests/Feature/SettingsPagesTest.php`, `lang/en.json`, `lang/de.json`

**Interfaces:**
- Consumes: Tasks 13–15
- Produces:
  - Route `GET /me/{section?}` (`auth`) → `Settings/Personal` mit `section` (Standard `profile`); Abschnitte `profile`, `security`, `api` (Benachrichtigungen mit Phase 8).
  - `Profile.tsx`: Port (Name, Handle, Avatar, Sprache, Zeitzone; E-Mail schreibgeschützt); Sprachwechsel lädt die Seite in der neuen Sprache (`router.reload()` aus Task 13).
  - `Security.tsx`: Passwortkarte gegen `changePassword` (Felder `current_password`, `password`, `password_confirmation`; Feldfehler vom Server am Feld).
  - `TwoFactor.tsx`: Port der Abläufe (Einrichten → QR und Schlüssel → Code → Recovery-Codes einmal, Verlassen erst nach „Codes sind gesichert“ über `LeaveGuard`; Ausschalten und neue Codes mit Rückfrage), Daten vom Server (`useTwoFactor`, `useEnableTwoFactor`, …); `QrCode.tsx` zeigt `qr_svg` als `<img alt=…>` (ersetzt `QrPlaceholder`), der Schlüssel in Vierergruppen; Anzahl der Codes aus der Antwort (Fortify: 8).
  - `ApiAndMcp.tsx`: Port mit `TokenDialog` aus Task 15 (`owner` = eigenes Konto) und `SetupSnippets`.
  - Der Avatar nutzt `frame/ImageField` aus Task 15.
  - Texte unter `settings.personal.*`, `settings.security.*`, `settings.two_factor.*`, `settings.api.*`.

- [ ] **Step 1: Failing Tests schreiben**

`SettingsPagesTest.php` ergänzen: `/me`, `/me/security` → `Settings/Personal` mit `section`.

`personal.test.tsx` (Vitest, `mockApi`): falscher Code → Fehler am Feld, Fokus bleibt; Ladefehler des 2FA-Status; Recovery-Codes kopieren; abgebrochene Einrichtung beginnt beim nächsten Mal neu.

`e2e/tests/settings-personal.spec.ts` (eigener Kontext über `signedInContext(browser, PEOPLE.security[variant()])`; die Spec richtet 2FA an diesem Konto ein, `twofactor-*` bleibt für Task 10 unverändert): „changes name and handle in the profile“; „switches the language to English and back“ (`<html lang>` wechselt); „sets up two-factor sign-in with a real code and turns it off again“ (Schlüssel aus der Seite lesen, `totp()` tippen, Codes bestätigen, Ausschalten); „creates a token, copies it and revokes it“; „asks before leaving an unsaved profile“; zuletzt „changes the password and signs in with the new one“ (die Spec läuft `serial`, weil die neue Anmeldung den gespeicherten Zustand von `signedInContext` ersetzt). Der E2eSeeder setzt das Sicherheitskonto jeden Lauf zurück (Task 6).

- [ ] **Step 2: Rot, implementieren, grün** — `ddev exec pnpm test -- resources/js/features/settings/personal`; `pnpm --dir e2e test -- settings-personal`.

- [ ] **Step 3: Gates G1, G2, G3**

- [ ] **Step 4: Commit**

Betreff: `feat: port the personal settings with profile, password, real two-factor setup and tokens`.

---

### Task 17: Projekte-Übersicht, Projekteinstellungen, Seitenleiste und der Hauptablauf

**Files:**
- Create: `resources/js/pages/Projects/{Index,Settings}.tsx`, `resources/js/features/projects/{ProjectsScreen,CreateProjectDialog,identifier}.ts(x)`, `resources/js/features/projects/{identifier.test.ts,projects.test.tsx}`, `resources/js/features/settings/project/{ProjectSettings,General,Members,DangerZone}.tsx`, `resources/js/features/favorites/FavoriteToggle.tsx`, `app/Http/Controllers/ProjectSettingsPageController.php`, `tests/Feature/ProjectPagesTest.php`, `e2e/tests/{projects,onboarding}.spec.ts`
- Modify: `routes/web.php`, `resources/js/shell/{Sidebar,ProfileMenu}.tsx`, `resources/js/shell/Shell.test.tsx`, `resources/js/components/ui/FavoriteStar.tsx` (`disabled`), `resources/js/components/ui/FavoriteStar.test.tsx`, `e2e/tests/shell.spec.ts` (`/projects` ist keine 404 mehr), `lang/en.json`, `lang/de.json`

**Interfaces:**
- Consumes: Tasks 11–16
- Produces:
  - Route `GET /projects` (`auth`) → `Projects/Index` (Prop `create` aus `?create=1`, die Seite öffnet den Dialog einmal und nimmt den Parameter aus der Adresse); `GET /projects/{identifier}/settings/{section?}` (`auth`) → `ProjectSettingsPageController`: `GetProject::run(Actor::fromRequest($r), $identifier)`; ist `resolved_by_former_identifier` gesetzt, Redirect 301 auf dieselbe Seite mit `$project->identifier` (der Controller liest nur das Flag, P32; Review Focus); unsichtbar → 404-Seite; sonst Inertia `Projects/Settings` mit `identifier`, `section` (Standard `general`). `/projects/{identifier}` selbst kommt mit Phase 5 (bis dahin 404, wie P13 aus Phase 1).
  - `ProjectsScreen.tsx`: Port (Karten mit Bild oder Initialen, Lead, Sichtbarkeit, Rolle aus `my_role`, „Beitreten“, Archivierte zeigen, Stern) ohne Zähler offener Items (Phase 4); „Du liest nur mit.“ nur für Nicht-Mitglieder, die nicht Org-Admin sind (13c-Befund aus Task 9 des Klickdummys).
  - `CreateProjectDialog.tsx`: Port ohne Workflow und Typen (Phase 3); `suggestIdentifier` aus `identifier.ts` (Port samt Test); Feldfehler vom Server am Feld, Fokus auf das erste; doppeltes ⌘⏎ legt nur einmal an.
  - Projekteinstellungen: `ProjectSettings` mit den Abschnitten `general`, `members` (Workflow, Typen, Automatisierungen mit ihren Phasen) im Rahmen aus Task 14; `General` (Name, Kennung mit Hinweis auf alte Keys, Beschreibung, Bild über `frame/ImageField`, Lead aus den Mitgliedern, Sichtbarkeit) und `DangerZone` (Archivieren/Wiederherstellen, Löschen nach Eintippen der Kennung, danach Redirect `/projects` mit Toast); `Members` (Hinzufügen mit Personen- und Bot-Auswahl, Rolle ändern, Entfernen mit Rückgängig, Lead nicht entfernbar). Wer nicht verwaltet, liest (`ReadOnlyBanner`).
  - `FavoriteToggle({ kind, id, name })` (Port von `views-overview/FavoriteStar.tsx`): `FavoriteStar` aus `components/ui` mit neuem Prop `disabled`, gesetzt, bis die Favoriten geladen sind (vorgemerkt).
  - `Sidebar.tsx`: Abschnitt „Projekte“ mit den Favoriten-Projekten (Port aus `src/app/Sidebar.tsx`: Lade- und Fehlerzustand, leer-Text, Link „Projekt anlegen“ auf `/projects?create=1` mit Grund aus `usePermissions`), Archivierte fehlen; „Views“ bleibt bis Phase 5 beim leeren Text.
  - `ProfileMenu.tsx` (vorgemerkt): `onHttpException` zeigt „Abmelden nicht möglich“ mit dem HTTP-Status (`errors.http_status`), `onNetworkError` mit `errors.no_answer`.
  - Texte unter `projects.*`, `projects.create.*`, `settings.project.*`, `shell.nav.*` (neu: `create_project`).

- [ ] **Step 1: Failing Tests schreiben**

`ProjectPagesTest.php`: `/projects` → `Projects/Index`; `/projects/WEB/settings` → `Projects/Settings` mit `section` `general`; nach dem Umbenennen von WEB in SITE leitet `/projects/WEB/settings/members` mit 301 auf `/projects/SITE/settings/members`; privates Projekt für Nicht-Mitglieder → 404 (Inertia `Errors/NotFound`); unbekannt → 404.

`identifier.test.ts`: Port der Klickdummy-Tests. `projects.test.tsx` (Vitest, `mockApi`): Ladefehler der Übersicht, leere Zustände (keine Projekte, alle archiviert), Beitreten scheitert mit Toast, 422 auf `identifier` im Dialog, Löschen mit falscher Kennung bleibt gesperrt. `FavoriteStar.test.tsx`: `disabled` sperrt den Knopf. `Shell.test.tsx`: Abmelden mit HTTP-Fehler bzw. ohne Antwort zeigt verschiedene Beschreibungen.

`e2e/tests/projects.spec.ts` (als Erik): „creates a project with the keyboard from the sidebar“ (`Projekt anlegen`, Name `E2E <variant> <runId>`, Kennung aus dem Vorschlag, ⌘⏎, Toast, Karte da); „stars a project into the sidebar and out again“; „renames the identifier and follows the old address“ (alte Settings-URL leitet um); „archives and restores a project“; „deletes a project after typing its identifier“; „joins a public project with one click“ (Erik legt ein öffentliches Lauf-Projekt an; Lene in `signedInContext` sieht es mit „Beitreten“, Tab und Enter → Rolle „Member“); „hides a private project from a non-member“ (Ida in `signedInContext` öffnet `/projects/OPS/settings` → 404-Seite, OPS fehlt in der Übersicht); Fehlerzustand der Seitenleiste per `page.route('**/api/v1/favorites', 503)`.

`e2e/tests/onboarding.spec.ts` (Master-Plan, nur Tastatur): Erik lädt `onboard-<variant>-<runId>@example.com` unter Personen ein, kopiert den Link; neuer Kontext nimmt an (Name, Passwort, Enter → `/my-items`); Erik legt ein Projekt an, öffnet dessen Einstellungen → Mitglieder, fügt die neue Person als Member hinzu; die neue Person sieht das Projekt in `/projects` mit Rolle „Member“.

`shell.spec.ts`: `g p` führt jetzt auf die Projekte-Übersicht (Überschrift `projects.title`), der 404-Fall nimmt `/views`.

- [ ] **Step 2: Rot, implementieren, grün** — `ddev artisan test --filter=ProjectPagesTest`; `ddev exec pnpm test -- resources/js/features/projects resources/js/components/ui/FavoriteStar resources/js/shell`; `pnpm --dir e2e test -- projects onboarding shell`.

- [ ] **Step 3: Gates G1, G2, G3**

- [ ] **Step 4: Commit**

Betreff: `feat: port the projects overview, project settings with members, favorites in the sidebar and the onboarding flow`.

---

### Task 18: Doku, `CLAUDE.md`, Rulings und Spec

**Files:**
- Create: `docs/en/{concepts/permissions,concepts/projects,bots}.md`, `docs/de/{concepts/permissions,concepts/projects,bots}.md`
- Modify: `docs/.vitepress/config.ts` (Seiten und Titel), `tests/Unit/DocsTest.php` (Unterordner `concepts/`), `docs/en/development.md`, `docs/de/development.md`, `CLAUDE.md`, `README.md` (Status), `docs/superpowers/plans/2026-10-30-werkbuch-app-rulings.md`, `docs/superpowers/specs/2026-10-28-werkbuch-design.md` („Änderungen vom 2026-10-31“)

**Interfaces:**
- Consumes: alles Vorige
- Produces:
  - `concepts/permissions`: die beiden Tabellen aus 4.3, Org-Admins überall Admin, Sichtbarkeit, Beitreten, Project Lead, letzter Admin, Standard-Bot, Token-Fähigkeiten `read`/`write`/`mcp`, `session_required`; dazu der Satz, dass ein 404 auch „nicht sichtbar“ heißt. `concepts/projects`: Felder, Kennung und alte Keys, öffentlich/privat, Mitglieder und Rollen, Archivieren, Löschen per Job, Favoriten. `bots` (Grundlagen): Bot anlegen, verantwortliche Person, Tokens durch Admins, Standard-Bot mit Admin-Rechten und Warnung (Agent-Szenario folgt in Phase 13). Beide Sprachen mit gleichen Dateinamen und Überschriften.
  - `DocsTest`: zählt Seiten rekursiv (`docs/en/**/*.md`), Sidebar-Einträge mit Pfad (`'concepts/permissions'`).
  - `development.md` (vorgemerkt): der Kommentar „Vitest, 100 % line coverage“ wird „Vitest mit Schwellen je Ordner; 100 % Zeilen erst zusammen mit Playwright“; neue Kommandos `app:sync-roles`, `app:redispatch-events`.
  - `CLAUDE.md`: „Stand“ (Phase 2 umgesetzt), Kommandos (`app:sync-roles`, `app:redispatch-events`), Architektur (Actor, Outbox, Rollen und Sichtbarkeit, REST-Grundlage mit `ListResult`/`ApiList`, Matrizen und ihre Wächter, Bilder als Data-URL in medialibrary, Einladungen, 2FA-Pipeline, Frontend `getPage`/`setSignedIn`, Einstellungsrahmen), Fallstricke (spatie-Teams: Rollen nur über `RoleAssignments`, nie `assignRole` direkt; `register_permission_check_method` bleibt aus; `Visibility::forget()` nach Rollenwechsel in derselben Anfrage; Events nur in Transaktionen; e2e-Daten mit Lauf-Kennung, Aufräumen mit `ddev artisan migrate:fresh --seed --seeder=DemoSeeder`; Zwischenablage in Playwright braucht Rechte). Die Schritte vorher haben ihre Teile schon eingetragen; hier nur ordnen und prüfen.
  - Rulings `A21` ff. (Entscheidungen mit Wirkung über Phase 2 hinaus, je mit Grund und „Falls falsch“): P2, P3, P4, P5, P6, P10, P11, P12, P13, P14, P23, P24, P25, P27, P28, P33 dieses Plans; der Abschnitt „Für spätere Phasen vorgemerkt“ verliert die erledigten Phase-2-Punkte.
  - Spec „Änderungen vom 2026-10-31 (Phase 2)“ mit den fachlichen Präzisierungen zur Bestätigung: E-Mail-Adressen ändern nur Org-Admins (P16); `/api/v1/me/*` nur aus der Sitzung (P6); Projekt-Lead ist eine aktive Person (P17); Einladungen schließen, wenn der Einladende kein aktiver Admin mehr ist (P7); `project.restored` als eigenes Webhook-Ereignis (P11); 8 Recovery-Codes (Fortify).

- [ ] **Step 1: Seiten und Tests** — `ddev artisan test --filter=DocsTest` (erst rot mit den neuen Seiten ohne Sidebar, dann grün); `ddev exec pnpm --dir docs build` → ohne tote Links.

- [ ] **Step 2: Abnahme der Phase**

```bash
ddev artisan migrate:fresh --seed --seeder=DemoSeeder
ddev artisan test --coverage --min=100
ddev exec vendor/bin/phpstan analyse --memory-limit=1G && ddev exec vendor/bin/pint --test
ddev exec pnpm typecheck && ddev exec pnpm test:coverage
ddev exec pnpm build:coverage && pnpm --dir e2e test && ddev exec pnpm build
ddev exec pnpm --dir docs build
```

Expected: alles grün, PHP `Total: 100.0 %`, Frontend zusammengeführt 100 %. Von Hand (Master-Abnahme): Mara lädt per UI ein und per `curl -H "Authorization: Bearer <Token>" -X POST https://werkbuch.ddev.site/api/v1/invitations -d '{"email":"neu@example.com","org_role":"member"}'`; Ida sieht OPS nicht (UI 404, REST 404), Theo liest WEB nur, Lene tritt einem öffentlichen Projekt mit einem Klick bei.

- [ ] **Step 3: Commit**

Betreff: `docs: add permissions, projects and bots pages, update CLAUDE.md, the rulings and the spec for phase 2`.

---
## Entscheidungen dieses Phasenplans

- **P1 Seiten entstehen im Task ihrer Route** (Einladung annehmen: Task 9, 2FA-Abfrage: Task 10) samt Port, Texten und Spec. Grund: `ensure_pages_exist`, und jede Task endet mit 100 % zusammengeführter Abdeckung. Falls falsch: Seite und Route-Tests in einen UI-Task.
- **P2 spatie-Teams: fünf globale Rollen (`team_id = null`), Zuordnungen je Team (Organisation bzw. Projekt), `register_permission_check_method = false`, Zuordnen nur über `RoleAssignments`, Lesen über `RoleIndex`, die Rechte je Rolle stehen in `Grants`, die Datenbank spiegelt sie (`SyncRoles`).** Grund: v8 filtert `roles()` nach der aktuellen Team-ID (Wechsel zwischen Teams sind fehleranfällig), der Gate-Hook von spatie würde Policies mit gleichnamigen Fähigkeiten umgehen, und Policies sollen ohne Team-Kontext prüfen; „Rechte fest im Code, Rollen per Migration“ (Spec 4.3) bleibt wörtlich. Falls falsch (eigene Rollen später): `Grants::allows` liest `role_has_permissions` über den Cache des Registrars statt der Konstanten.
- **P3 Paket-Tabellen: `roles`, `permissions` und `media` behalten ihre `bigIncrements`-Schlüssel; alle Verweise auf eigene Modelle (`model_id`, `team_id`, `tokenable_id`, `media.model_id`) und `personal_access_tokens.id` sind ULIDs.** Grund: wie A1 (Pakete lesen und schreiben ihre Tabellen selbst), Sanctum findet Tokens über `<id>|<geheim>` auch mit ULID, und `events.subject` kann so auf Tokens zeigen. Falls falsch: eigene Modelle mit `HasUlids` für Rolle, Recht und Media.
- **P4 Die Werte von `App\Access\Permission` sind die Namen aus `src/lib/permissions.ts`** (`org.manage`, `item.edit`, …), ergänzt um `project.read`, `project.join`, `project.see_all`, `project.archive`, `token.own`. Grund: dieselben Namen in UI, Shared Props und Server. Falls falsch: Umbenennen in Enum, `lib/permissions.ts` und `SyncRoles` (eine Migration).
- **P5 Actions prüfen Rechte über `App\Access\Authorize::check()` (Gate `inspect`) statt `authorize()`:** 404 aus `denyAsNotFound()` wird `Problem::notFound()` ohne `detail`, jede andere Ablehnung `Problem::forbidden()` mit dem Satz der Policy. Grund: A10 erlaubt eigenen `detail` nur bei `Problem`, die Sätze des Klickdummys („Mitglieder verwalten nur Admins des Projekts.“) sollen ankommen. Falls falsch: `authorize()` und der Standardtext `problem.reason.forbidden`.
- **P6 `/api/v1/me/*` (Passwort, 2FA) nur aus der Sitzung; ein Token bekommt 403 `session_required`.** Grund: Ein gestohlenes Token soll weder das Passwort ändern noch den zweiten Faktor ein- oder ausschalten. Falls falsch: `EnsureSession` aus der Gruppe nehmen, die Matrix-Zeilen umstellen.
- **P7 Einladungslinks wie openbill: relativ signierte URL mit der ULID der Einladung, vorn `APP_URL`;** eine neue Einladung löscht die offene an dieselbe Adresse, ein Link schließt, wenn der Einladende kein aktiver Org-Admin mehr ist oder es ein Konto mit der Adresse gibt; kein Widerrufen-Endpunkt (der Klickdummy hat keinen). Grund: Der Link lässt sich jederzeit wieder anzeigen („Link anzeigen“), ohne einen Klartext-Token zu speichern. Falls falsch: zufälliger Token mit Hash und Anzeige nur beim Anlegen; `RevokeInvitation` nachrüsten.
- **P8 Sitzungen enden über drei Wege:** `AuthenticateSession` (Passwortwechsel, jeder Session-Treiber), `EndSessions` (Zeilen der Tabelle `config('session.table')` beim Treiber `database`) und `EnsureAccountIsActive` (deaktivierte Konten, jeder Treiber, Web und API). Grund: vorgemerkt „andere Session-Treiber bedenken“. Falls falsch: nur `database` unterstützen und es dokumentieren.
- **P9 Feldmeldungen eigener Regeln als JSON-Schlüssel (`field.<feld>.<fall>`), die die Actions als `$messages` übergeben; allgemeine Regeln bleiben in `lang/<sprache>/validation.php`.** Grund: Die Sätze des Klickdummys kommen wörtlich an, ohne die Framework-Gruppen umzubauen. Falls falsch: alles in `validation.php` unter `custom`.
- **P10 Löschen eines Projekts: `deleting_at` macht es sofort unsichtbar, `PurgeProject` (Queue `bulk`) räumt auf; Events bleiben, `events.project_id` hat keinen Fremdschlüssel.** Grund: Spec 4.4 „läuft als Job“, und spätere Konsumenten (Webhooks) brauchen `project.deleted`, auch wenn das Projekt schon weg ist. Falls falsch: Events mit dem Projekt löschen (FK cascade), `project.deleted` als einziges behalten.
- **P11 Feinschnitt des Ereigniskatalogs (Spec 6.3 lässt ihn dem Plan):** `project.restored` ist ein eigenes Webhook-Ereignis; `project.member_role_changed`, `organization.updated`, `user.*`, `bot.created`, `token.*`, `favorite.*` sind Events ohne Webhook. Grund: „archiviert“ für ein Wiederherstellen wäre für Empfänger irreführend; jede schreibende Action hat ein Event. Falls falsch: `project.restored` auf `webhook: false` und `project.archived` mit `changes.archived_at`.
- **P12 Listen antworten im Laravel-Format mit `meta.total`** (`ListResult` zählt einmal je Anfrage), `getPage()` macht daraus `Page<T>` (`items`, `next_cursor`, `total`). Grund: Der Klickdummy und seine Bildschirme nutzen `total`; Cursor-Pagination hat sonst keine Gesamtzahl. Falls falsch (Last in Phase 15): `total` nur auf Anfrage (`?with_total=1`).
- **P13 `Project.my_role` statt `listMembers()` über alle Projekte; `listMembers(project)` verlangt das Projekt.** Grund: README „Wo die echte API andockt“ (6.1 kennt keine projektübergreifende Liste); Rechte brauchen nur die eigene Rolle. Die übrigen Aufrufer ohne Projekt (Board, Mehrfachbearbeitung, Item-Befehle) entscheiden Phase 4 und 5. Falls falsch: `GET /api/v1/project-members` und der optionale Parameter zurück.
- **P14 `Actor::template(Template $t)` kommt mit dem Modell `Template` in Phase 10.** Grund: Larastan kennt die Klasse vorher nicht. Falls falsch: ein Platzhalter-Interface jetzt.
- **P15 Bilder (Logo, Avatar, Projektbild) als Data-URL im JSON-Patch (`logo_url`, `avatar_url`, `image_url`), auf der privaten Disk in medialibrary, ausgeliefert über `GET /media/{uuid}` mit `auth:sanctum` und Sichtbarkeit; `ImageField` und `readSquareImage` liegen im Einstellungsrahmen.** Grund: dieselben Signaturen wie der Klickdummy (`updateUser(user_id, { avatar_url })`), kein zweiter Aufruf, kein Symlink für `storage/public`, und ein Projektbild verrät kein privates Projekt. Falls falsch: Multipart-Endpunkte (`POST …/avatar`) und die API-Funktion lädt vorher hoch.
- **P16 Die E-Mail-Adresse ändern nur Org-Admins** (bei Personen; Bots haben keine). Grund: Sie ist der Login; der Klickdummy zeigt sie im Profil schreibgeschützt. Fachlich, darum auch als „Änderungen vom …“ in der Spec. Falls falsch: Selbständerung mit Bestätigungsmail.
- **P17 Project Lead ist eine aktive Person und Mitglied.** Grund: Der Lead bekommt alle Benachrichtigungen (4.3), Bots bekommen keine (4.2). Fachlich, in die Spec. Falls falsch: Bots als Lead zulassen.
- **P18 Die Anmelde-Actions behalten ihre Signaturen (A4); die schreibenden (`EnsureAdmin`, `SetPassword`, `AcceptInvitation`) legen ihre Events mit `Actor::system($person, <Grund>)` an.** Die Actor-Regel und die Rechte-Matrix nehmen `App\Actions\Auth` und `App\Actions\Setup` aus. Grund: Vor der Anmeldung gibt es niemanden, der handelt; das betroffene Konto ist der ehrlichste Actor. Falls falsch: ein eigenes System-Konto als Actor.
- **P19 2FA einrichten, ausschalten und neue Codes ohne erneute Passwortabfrage** (wie der Klickdummy), dafür nur aus der Sitzung (P6) und die Bestätigung gedrosselt. Grund: Der Klickdummy ist eingefroren und hat keinen solchen Schritt. Falls falsch: Passwort-Dialog vor „Ausschalten“ und „Neue Codes“, `ConfirmablePasswordController` von Fortify.
- **P20 e2e: neue Daten mit Lauf-Kennung, veränderte Konten je Playwright-Projekt (vom `E2eSeeder` je Lauf zurückgesetzt), 2FA mit festem Geheimnis und `node:crypto`.** Grund: eine Datenbank für alle Projekte und Läufe (DDEV), keine neuen Pakete. Falls falsch: `migrate:fresh` im Global-Setup (nur CI).
- **P21 Ein `TokenDialog` für Bots und Persönlich (13b), Ablaufdatum als Datumsfeld statt `DatePopover`.** Grund: Der Klickdummy hat zwei Dialoge, und `DatePopover` gehört zu den Feld-Editoren aus Phase 4. Falls falsch: `DatePopover` in Phase 4 nachziehen.
- **P22 Zeitzonen: die kuratierte Liste einmal in `lib/zones.ts`, der Server nimmt jede IANA-Zone.** Grund: 13b; alle Zonen bräuchten eine virtualisierte Combobox. Falls falsch: Phase 15.
- **P23 `Problem`-Fabriken erweitert (Preflight 9):** `conflict(string $reason, array $extensions = [], ?string $detail = null)`, `forbidden(?string $detail = null, string $reason = 'forbidden')`; bestehende Aufrufe bleiben gültig, `ProblemTest` deckt beides. Grund: Ablehnungen mit eigenem Satz (`last_admin`, `default_bot`) und eigenem Reason (`session_required`). Falls falsch: eigene Fabriken je Reason. Ruling in Task 18.
- **P24 Eine Stelle für „Handle vergeben“ (Preflight 10):** `App\Actions\Accounts\NextHandle::run(string $seed): string` (lesend, ohne Actor, in Actor-Regel und Matrix ausgenommen); `EnsureAdmin`, `EnsureDefaultBot`, `AcceptInvitation` rufen sie. Grund: die Datenbank-Closure für `Handle::suggest` stand sonst dreimal da. Falls falsch: `User::handleTaken()` als statische Methode.
- **P25 `SetPassword` ist die einzige Stelle, die ein Passwort setzt (Preflight 11):** `handle(User, string, ?Actor = null, bool $keepSession = false, string $reason = 'password_reset')`; `ChangePassword` prüft nur das aktuelle Passwort und `confirmed` und delegiert; `EnsureAdmin` legt die Person mit geprüftem Passwort direkt an und schreibt nur `user.created`. Grund: Regeln, Hash, Sitzungen und Event an einem Ort. Falls falsch: `ChangePassword` mit eigener Logik und doppeltem Test.
- **P26 Events ohne Lücke (Preflight 12):** `EnableTwoFactor` schreibt `user.two_factor_setup_started` (ohne Webhook, ohne Geheimnis); `PurgeProject` ist die einzige benannte Ausnahme (es räumt nach `project.deleted` auf), in Global Constraints und Matrix-Zeile vermerkt. Falls falsch: `project.purged` als eigenes Event.
- **P27 Einzelressourcen bleiben in `{data}` (Preflight 14):** wie die Listen; `one<T>()` in `http.ts` entpackt an einer Stelle. Grund: Laravel-Standard, eine Form für REST-Nutzer. Falls falsch: `JsonResource::withoutWrapping()` und `one()` entfällt.
- **P28 `EnsureSession` vor `EnsureTokenAbility` (Preflight 7):** beide in der Middleware-Prioritätsliste; ein Token auf `/me/*` bekommt immer 403 `session_required`. Falls falsch: `/me/*` in eine eigene Gruppe ohne `EnsureTokenAbility`.
- **P29 Letzter Admin zählt im Lock frisch (Preflight 6):** `RoleIndex::forget()`, dann Abfrage unter `lockForUpdate`; `LastAdminRaceTest` mit zwei Verbindungen. Grund: der per Request gecachte `RoleIndex` sah sonst den Stand vor dem Lock. Falls falsch: Org-Rolle als Spalte an `users` mit Zeilensperre.
- **P30 Vitest-Schwelle für `features/settings/frame/**` erst in Task 15 (Preflight 8):** Task 14 bringt trotzdem Tests je Datei. Grund: In Task 14 nutzt noch kein Bildschirm den Rahmen; die Schwelle soll die Bildschirm-Tasks halten, nicht Task 14 an Teilen blockieren, die erst mit den Bildschirmen ihre Form finden. Falls falsch: Schwelle schon in Task 14.
- **P31 Die e2e-Organisation spricht Englisch (Preflight 3):** Der `E2eSeeder` setzt `locale` `en` nach dem `OrganizationSeeder`; der `DemoSeeder` bleibt `de`. Grund: die Specs aus Phase 1 prüfen `tr('en', …)` für Gäste und Konten ohne Sprache. Falls falsch: Erik und alle e2e-Konten mit `locale` `en`.
- **P32 `GetProject` meldet die frühere Kennung (Preflight 19):** transientes Attribut `resolved_by_former_identifier`; der Seiten-Controller liest nur das Flag und leitet um. Grund: Controller rechnen nicht. Falls falsch: eine eigene Action `ResolveProjectPath`.
- **P33 Schreibende Projekt- und Mitglieder-Actions rufen `Visibility::forget()` (Preflight 13):** auch wo `RoleAssignments` es schon tut; Tests mit zwei Aufrufen im selben Test. Grund: der Cache lebt je Request und im Test über mehrere Aufrufe. Falls falsch: `RoleIndex` ohne Cache (eine Abfrage mehr je Prüfung).
