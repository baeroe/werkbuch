# Workflows

Ein Workflow ist die Menge der Status, die ein Item durchläuft, samt den Regeln, wie es zwischen ihnen wechselt. Workflows gehören der Organisation: Org-Admins pflegen sie unter **Einstellungen → Workflows**, alle anderen können sie dort lesen. Jedes Projekt nutzt genau einen Workflow, und mehrere Projekte können sich einen teilen.

## Status

Ein Status hat einen Namen (bis 40 Zeichen), eine von sieben Icon-Formen und eine Kategorie. Die Reihenfolge der Status ist die, die du ihnen im Editor gibst; Boards und Listen zeigen sie so. Ein Workflow hat höchstens 30 Status.

Die Formen sind: gestrichelter Kreis, Kreis, halb gefüllt, dreiviertel gefüllt, Pause, Haken und Kreuz. Die Farbe des Icons folgt der Kategorie, so sieht ein Status immer nach dem aus, was er bedeutet.

### Kategorien

Die Kategorie sagt werkbuch, was ein Status bedeutet, egal wie er heißt. Offen oder geschlossen, Fortschritt, Resolutions und Filter richten sich nach der Kategorie, nicht nach dem Namen.

| Kategorie | Bedeutung |
|---|---|
| Backlog | Noch nicht eingeplant. Das Item ist offen. |
| Unstarted | Eingeplant, aber nicht begonnen. Offen. |
| Started | In Arbeit. Offen, zählt für den Fortschritt. |
| Completed | Erledigt. Schließt das Item, es bekommt eine Resolution. |
| Canceled | Abgebrochen. Schließt das Item, es bekommt eine Resolution. |

## Regeln beim Speichern

werkbuch prüft einen Workflow bei jedem Speichern und lehnt ihn ab, wenn er eine Regel bricht:

- Er hat genau einen **Startstatus**. Neue Items starten dort.
- Er hat **mindestens einen Status der Kategorie Completed**, damit sich Arbeit abschließen lässt.
- Jeder Status ist **vom Startstatus aus erreichbar**. Ein Status, zu dem niemand kommt, sammelt nichts.

Der Editor prüft dieselben Regeln schon während der Arbeit. Er listet jeden Befund mit einem Weg, ihn zu beheben, markiert die betroffenen Zeilen mit „Nicht erreichbar“ und schickt einen Workflow mit Befunden gar nicht erst ab.

Ein Beispiel aus den Demo-Daten: Der Workflow „Agentur-Freigabe“ führt von Backlog über Todo, In Progress, Review und Kundenfreigabe zu Done und aus den meisten Status nach Cancelled. Nimmst du den Übergang In Progress → Review aus der Matrix, ist Review vom Startstatus aus nicht mehr erreichbar, und damit auch Kundenfreigabe und Done nicht. werkbuch nennt alle drei und lässt den Workflow, wie er war.

## Frei oder Matrix

Ein Workflow ist entweder frei oder hat eine Übergangsmatrix.

- **Frei:** Jeder Status darf auf jeden anderen folgen. Der Standard-Workflow ist frei.
- **Matrix:** Nur die Paare, die du erlaubst (von → nach), sind möglich. Der Editor zeigt ein Raster mit einer Zeile je „von“-Status und einer Spalte je „nach“-Status; jede Zelle ist ein Übergang. Schaltest du **Freie Übergänge** aus, beginnt die Matrix mit allen Paaren erlaubt, und du nimmst nur weg, was du nicht willst.

Im selben Status bleiben ist immer erlaubt. Sobald es Work Items gibt, gilt die Regel überall gleich: in der Oberfläche, über REST-API und MCP, in Automatisierungen und Vorlagen.

## Der Standard-Workflow

Genau ein Workflow ist der Standard. Ein neues Projekt bekommt ihn, wenn du keinen anderen wählst. werkbuch liefert den Workflow „Standard“ als Standard mit: frei, mit Backlog (Backlog), Todo (Unstarted), In Progress und Pending (beide Started), Done (Completed) und Cancelled (Canceled), Start in Backlog.

Um einen anderen Workflow zum Standard zu machen, schaltest du in seinem Editor **Standard-Workflow** ein; der bisherige verliert die Marke. Einfach ausschalten geht nicht, denn ein Workflow ist immer der Standard.

## Benutzte Workflows ändern

Neue Status und neue Übergänge gelten sofort, in jedem Projekt, das den Workflow nutzt. **Duplizieren** beginnt einen neuen Workflow als Kopie eines bestehenden, mit neuen Status-IDs; die Kopie ist nie der Standard.

## Der Workflow eines Projekts

Projekt-Admins wechseln den Workflow ihres Projekts unter **Projekteinstellungen → Workflow**: neuen Workflow wählen, dann **Workflow wechseln …** und bestätigen.

Heute ist das eine einfache Bestätigung, weil es noch keine Work Items gibt. Sobald es welche gibt, ordnest du jedem Status, der Items hat, einen Status des neuen Workflows zu (ebenso, wenn du einen Status mit Items entfernst). werkbuch schreibt die Items dann im Hintergrund um, bewusst ohne Übergangsregeln, und die History nennt die Person, die es ausgelöst hat.

## Löschen

Ein Workflow lässt sich nur löschen, solange kein Projekt ihn nutzt; archivierte Projekte zählen mit. Der Standard-Workflow lässt sich nie löschen. Die Oberfläche sagt, welche Projekte einen Workflow noch nutzen, und die API antwortet `409` mit `reason: in_use` und ihren Kennungen.

## REST

Lesen braucht ein Token mit `read`, Ändern eines mit `write`. Lesen darf jedes Konto; anlegen, ändern und löschen nur Org-Admins.

| Anfrage | Antwort |
|---|---|
| `GET /api/v1/workflows` | Die Liste, mit Status und Übergängen. |
| `POST /api/v1/workflows` | `201` mit dem neuen Workflow. |
| `PUT /api/v1/workflows/{id}` | `200` mit dem Workflow. |
| `DELETE /api/v1/workflows/{id}` | `204`. |
| `PUT /api/v1/projects/{project}/workflow` | `200` mit dem Projekt. |

### Workflow anlegen

`POST` und `PUT` nehmen den ganzen Workflow; ein fehlendes Feld ist ein `422` an diesem Feld. Die Status kommen in ihrer Reihenfolge. Ein neuer Status trägt eine ID, die du wählst (beliebiger Text bis 64 Zeichen, etwa `draft`), und `initial_state_id` und `transitions` verweisen auf sie. werkbuch gibt jedem neuen Status eine ULID und antwortet mit diesen.

```bash
curl -X POST https://werkbuch.example.com/api/v1/workflows \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d @workflow.json
```

```json
{
  "name": "Content",
  "description": "Entwurf, Prüfung, veröffentlicht.",
  "is_default": false,
  "is_free": false,
  "initial_state_id": "draft",
  "states": [
    { "id": "draft", "name": "Entwurf", "icon": "dashed", "category": "backlog" },
    { "id": "review", "name": "Prüfung", "icon": "three-quarter", "category": "started" },
    { "id": "published", "name": "Veröffentlicht", "icon": "check", "category": "completed" },
    { "id": "dropped", "name": "Verworfen", "icon": "cross", "category": "canceled" }
  ],
  "transitions": [
    ["draft", "review"], ["review", "draft"], ["review", "published"],
    ["draft", "dropped"], ["review", "dropped"]
  ]
}
```

Die Antwort (`201`, gekürzt):

```json
{
  "data": {
    "id": "01m68z8s6ma9xexr0yx9p6b91v",
    "name": "Content",
    "is_default": false,
    "is_free": false,
    "initial_state_id": "01m68z8s6ng75dykjw0x6tgc6n",
    "states": [
      { "id": "01m68z8s6ng75dykjw0x6tgc6n", "name": "Entwurf", "icon": "dashed", "category": "backlog", "position": 0 },
      { "id": "01m68z8s6ng75dykjw0x6tgc6p", "name": "Prüfung", "icon": "three-quarter", "category": "started", "position": 1 }
    ],
    "transitions": [
      ["01m68z8s6ng75dykjw0x6tgc6n", "01m68z8s6ng75dykjw0x6tgc6p"]
    ]
  }
}
```

Zum Ändern schickst du den Workflow ganz per `PUT`. Status, die ihre ULID behalten, bleiben (später mit ihren Items), weggelassene werden entfernt, und ein Status mit einer anderen ID ist ein neuer. Die Icon-Formen heißen `dashed`, `circle`, `half`, `three-quarter`, `pause`, `check` und `cross`.

### Ein Workflow, der sich nicht speichern lässt

Ein Workflow, der eine Regel bricht, wird mit `422` und `reason: invalid_workflow` abgelehnt, und nichts wird gespeichert. `errors` hat je Befund einen Satz unter seinem Code, `issues` nennt die Status mit den IDs, die du geschickt hast. Die Codes sind `no_initial_state`, `no_completed_state` und `unreachable_state`.

```json
{
  "type": "urn:werkbuch:problem:invalid_workflow",
  "title": "Validierung fehlgeschlagen",
  "status": 422,
  "detail": "Der Workflow lässt sich so nicht speichern.",
  "reason": "invalid_workflow",
  "errors": {
    "no_completed_state": ["Der Workflow braucht mindestens einen Status der Kategorie Completed."],
    "unreachable_state": ["Prüfung ist vom Startstatus aus nicht erreichbar."]
  },
  "issues": [
    { "code": "no_completed_state" },
    { "code": "unreachable_state", "state_id": "review" }
  ]
}
```

### Workflow eines Projekts wechseln

Das Projekt sprichst du über seine Kennung oder seine ULID an. `mapping` ordnet Status des alten Workflows Status des neuen zu (`{"<alte Status-ID>": "<neue Status-ID>"}`). Solange es keine Work Items gibt, darf es leer bleiben; danach ist es für jeden Status mit Items Pflicht.

```bash
curl -X PUT https://werkbuch.example.com/api/v1/projects/WEB/workflow \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"workflow_id": "01m68z8s6ma9xexr0yx9p6b91v", "mapping": {}}'
```

`PATCH /api/v1/projects/{project}` wechselt den Workflow nicht: Ein anderes `workflow_id` ist dort ein `422`. Zum Wechseln braucht es die Rechte eines Projekt-Admins.
