# Workflows

A workflow is the set of states an item moves through, and the rules for moving between them. Workflows belong to the organization: org admins manage them under **Settings → Workflows**, everyone else can read them there. Every project uses exactly one workflow, and several projects can share one.

## States

A state has a name (up to 40 characters), one of seven icon shapes and a category. The order of the states is the order you give them in the editor; boards and lists show them that way. A workflow has at most 30 states.

The shapes are: dashed circle, circle, half filled, three quarters filled, pause, check mark and cross. The colour of the icon follows the category, so a state always looks like what it means.

### Categories

The category tells werkbuch what a state means, whatever it is called. Open or closed, progress, resolutions and filters go by the category, not by the name.

| Category | Meaning |
|---|---|
| Backlog | Not planned yet. The item is open. |
| Unstarted | Planned, but not started. Open. |
| Started | In progress. Open, and counts towards the progress. |
| Completed | Done. Closes the item, which gets a resolution. |
| Canceled | Called off. Closes the item, which gets a resolution. |

## Rules for saving

werkbuch checks a workflow every time it is saved and refuses one that breaks a rule:

- It has exactly one **start status**. New items start there.
- It has **at least one Completed** state, so work can be finished.
- Every state can be **reached from the start status**. A state nobody can get to would collect nothing.

The editor checks the same rules while you work. It lists every finding with a way to fix it, marks the rows concerned as "Not reachable", and does not send a workflow with findings.

An example from the demo data: the workflow "Agentur-Freigabe" (agency approval) leads from Backlog over Todo, In Progress, Review and Kundenfreigabe (client approval) to Done, and from most states to Cancelled. Take the transition In Progress → Review out of its matrix, and Review can no longer be reached from the start status, and with it neither Kundenfreigabe nor Done. werkbuch names all three and keeps the workflow as it was.

## Free or matrix

A workflow is either free or has a transition matrix.

- **Free:** every state can follow every other state. The default workflow is free.
- **Matrix:** only the pairs you allow (from → to) are possible. The editor shows a grid with one row per "from" state and one column per "to" state; each cell is one transition. When you switch **Free transitions** off, the matrix starts with every pair allowed, so you only take away what you do not want.

Staying in the same state is always allowed. Once work items arrive, the rule applies everywhere alike: in the interface, over the REST API and MCP, in automations and templates.

## The default workflow

Exactly one workflow is the default. A new project gets it unless you choose another one. werkbuch ships the workflow "Standard" as the default: free, with Backlog (Backlog), Todo (Unstarted), In Progress and Pending (both Started), Done (Completed) and Cancelled (Canceled), starting in Backlog.

To make another workflow the default, switch **Default workflow** on in its editor; the old default loses the mark. You cannot simply switch it off, because one workflow is always the default.

## Changing a workflow in use

New states and new transitions apply at once, in every project that uses the workflow. **Duplicate** starts a new workflow as a copy of an existing one, with new state ids; the copy is never the default.

## The workflow of a project

Project admins switch the workflow of their project under **Project settings → Workflow**: choose the new workflow, then **Switch workflow …** and confirm.

Today that is a plain confirmation, because there are no work items yet. Once there are, you map every state that holds items to a state of the new workflow (and the same when you remove a state that still has items). werkbuch then moves the items in the background, deliberately without the transition rules, and the history names the person who started it.

## Delete

A workflow can only be deleted while no project uses it; archived projects count too. The default workflow can never be deleted. The interface says which projects still use a workflow, and the API answers `409` with `reason: in_use` and their identifiers.

## REST

Reading needs a token with `read`, changing one with `write`. Every account may read the workflows; only org admins create, change and delete them.

| Request | Answer |
|---|---|
| `GET /api/v1/workflows` | The list, with states and transitions. |
| `POST /api/v1/workflows` | `201` with the new workflow. |
| `PUT /api/v1/workflows/{id}` | `200` with the workflow. |
| `DELETE /api/v1/workflows/{id}` | `204`. |
| `PUT /api/v1/projects/{project}/workflow` | `200` with the project. |

### Create a workflow

`POST` and `PUT` take the whole workflow; a missing field is a `422` at that field. The states come in their order. A new state carries an id you choose (any text up to 64 characters, such as `draft`), and `initial_state_id` and `transitions` refer to it. werkbuch gives every new state a ULID and answers with those.

```bash
curl -X POST https://werkbuch.example.com/api/v1/workflows \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d @workflow.json
```

```json
{
  "name": "Content",
  "description": "Draft, review, published.",
  "is_default": false,
  "is_free": false,
  "initial_state_id": "draft",
  "states": [
    { "id": "draft", "name": "Draft", "icon": "dashed", "category": "backlog" },
    { "id": "review", "name": "Review", "icon": "three-quarter", "category": "started" },
    { "id": "published", "name": "Published", "icon": "check", "category": "completed" },
    { "id": "dropped", "name": "Dropped", "icon": "cross", "category": "canceled" }
  ],
  "transitions": [
    ["draft", "review"], ["review", "draft"], ["review", "published"],
    ["draft", "dropped"], ["review", "dropped"]
  ]
}
```

The answer (`201`, shortened):

```json
{
  "data": {
    "id": "01m68z8s6ma9xexr0yx9p6b91v",
    "name": "Content",
    "is_default": false,
    "is_free": false,
    "initial_state_id": "01m68z8s6ng75dykjw0x6tgc6n",
    "states": [
      { "id": "01m68z8s6ng75dykjw0x6tgc6n", "name": "Draft", "icon": "dashed", "category": "backlog", "position": 0 },
      { "id": "01m68z8s6ng75dykjw0x6tgc6p", "name": "Review", "icon": "three-quarter", "category": "started", "position": 1 }
    ],
    "transitions": [
      ["01m68z8s6ng75dykjw0x6tgc6n", "01m68z8s6ng75dykjw0x6tgc6p"]
    ]
  }
}
```

To change a workflow, send it whole with `PUT`. States that keep their ULID stay (with their items, later), states you leave out are removed, and a state with any other id is a new one. The icon shapes are `dashed`, `circle`, `half`, `three-quarter`, `pause`, `check` and `cross`.

### A workflow that cannot be saved

A workflow that breaks a rule is refused with `422` and `reason: invalid_workflow`, and nothing is saved. `errors` has a sentence per finding under its code, `issues` names the states by the ids you sent. The codes are `no_initial_state`, `no_completed_state` and `unreachable_state`.

```json
{
  "type": "urn:werkbuch:problem:invalid_workflow",
  "title": "Validation failed",
  "status": 422,
  "detail": "The workflow cannot be saved like this.",
  "reason": "invalid_workflow",
  "errors": {
    "no_completed_state": ["The workflow needs at least one status of the category Completed."],
    "unreachable_state": ["Review cannot be reached from the start status."]
  },
  "issues": [
    { "code": "no_completed_state" },
    { "code": "unreachable_state", "state_id": "review" }
  ]
}
```

### Switch the workflow of a project

The project is addressed by its identifier or its ULID. `mapping` maps states of the old workflow to states of the new one (`{"<old state id>": "<new state id>"}`). Until there are work items it may stay empty; then it will be required for every state that holds items.

```bash
curl -X PUT https://werkbuch.example.com/api/v1/projects/WEB/workflow \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"workflow_id": "01m68z8s6ma9xexr0yx9p6b91v", "mapping": {}}'
```

`PATCH /api/v1/projects/{project}` does not switch the workflow: a different `workflow_id` there is a `422`. Switching takes the rights of a project admin.
