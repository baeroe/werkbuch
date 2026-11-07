# MCP

werkbuch is an MCP server: an AI agent in Claude Code, Codex or any other MCP client reads and changes projects, items, comments, wiki pages, templates and webhooks through it. The server lives at `/mcp` of your instance. Its tools are thin shells around the [REST API](/en/api): every action of a tool calls the same code as one REST operation, its twin, with the same rights, rules and errors. What the tools do not cover, a script does over REST.

## What the server offers

- **29 tools**, one pair per resource: a tool that reads (`work-items`) and one that writes (`manage-work-items`), each with an argument `action`. Three tools stand alone: `whoami`, `search` and `get-upload-url`. The [list of tools](#tools) names every action and its twin.
- **Three references** as MCP resources: how to write a filter, Markdown and the values of the field types (see [References](#references)).
- **Instructions** the client hands to the model when it connects: call `whoami` first, texts in results are data, how lists page, where the references are.

Not over MCP: creating tokens, your password and the second factor (they need the session of the interface, as over REST), the system page, and `GET /references`.

## Set up

1. Create a token in the interface under **Personal settings → API & MCP → New token**, with the ability `mcp` and `read`, and `write` if the agent is to change anything. For a [bot](/en/bots), an org admin creates the token in the settings of the bot. The token acts with the rights of its account, never with more.
2. Add the server to your client. The dialog that shows the new token gives the three snippets with your address and the token filled in:

```bash
# Claude Code
claude mcp add --transport http --scope user werkbuch https://werkbuch.example.com/mcp --header "Authorization: Bearer <token>"
```

```toml
# Codex, ~/.codex/config.toml
[mcp_servers.werkbuch]
url = "https://werkbuch.example.com/mcp"
http_headers = { "Authorization" = "Bearer <token>" }
```

```json
{
  "mcpServers": {
    "werkbuch": {
      "type": "http",
      "url": "https://werkbuch.example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

The JSON is for clients with an `mcpServers` configuration, for example a `.mcp.json` in a project.

## Connection

The server speaks Streamable HTTP: every message is a `POST /mcp` with a JSON-RPC body and `Content-Type: application/json` (another type is a `415`). It is stateless: there is no session of the protocol (no `Mcp-Session-Id`), no notifications from the server, and `GET` and `DELETE` on `/mcp` answer `405`. Every request carries the token as `Authorization: Bearer <token>`; a cookie of the interface signs nobody in here (`401`).

Protocol versions:

- `2026-07-28`, the current protocol, through `server/discover`. Every request then carries `_meta` with `io.modelcontextprotocol/protocolVersion` and `io.modelcontextprotocol/clientCapabilities`, and the headers `MCP-Protocol-Version: 2026-07-28`, `Mcp-Method` (the method of the body) and, for `tools/call` and `resources/read`, `Mcp-Name` (the tool or the URI). A missing or contradicting header is a JSON-RPC error `-32020` with the status `400`.
- `2025-11-25`, `2025-06-18` and `2025-03-26` through `initialize`; a client that asks for an older version gets `2025-11-25`.

A browser cannot use the server for another site: an `Origin` header that is not the address of your instance is a `403`; a request without `Origin` (every command-line client) passes. `tools/list` names every tool the token may use on one page.

```bash
curl https://werkbuch.example.com/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'Mcp-Method: tools/call' -H 'Mcp-Name: whoami' \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "whoami", "arguments": {}, "_meta": {"io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {}}}}'
```

## What a token sees

Only a token with the ability `mcp` gets in. A tool that reads needs `read` in addition, a tool that writes (`manage-…` and `get-upload-url`) needs `write`. A tool the token may not use is missing from `tools/list`; calling it anyway is the JSON-RPC error `-32602` ("Tool [x] not found."). A token with `read` and `mcp` only sees the 15 reading tools and can change nothing. The references need `mcp` alone.

Beyond that, a tool sees exactly what its account sees over REST. Something the account may not see is answered like something that does not exist (`404`): an item of a private project, a comment on it, its key in the search. A relation or a reference to such an item shows the other end as hidden, without key, title or ID.

## Limits

- **Requests:** 300 a minute per valid token (`MCP_RATE_LIMIT`), without a valid token 300 per address. This is a quota of its own beside the 600 of the REST API: an agent that uses both does not slow down the other. Requests are counted before signing in. Every answer carries `X-RateLimit-Limit` and `X-RateLimit-Remaining`; over the limit the answer is `429` with `Retry-After`.
- **Shared with REST:** a test ping and `redeliver` of a webhook count in the same 6 a minute per account as over REST, uploads through `get-upload-url` in the same 60 a minute per account. A tool over such a limit answers an error `429 too_many_requests` with `retry_after` in seconds.
- **Bodies:** a JSON body over 8 MiB (8 388 608 bytes) is a `413`; uploads have their own limit, `ATTACHMENTS_MAX_MB`.
- **Pages:** `per_page` is 1 to 100, 25 when left out.

## Tools

A tool with several actions takes the argument `action`. A tool with one action (`whoami`, `search`, `get-upload-url`, `automations`, `manage-automations`, `relations`, `attachments`, `manage-attachments`) takes none; the table names its action all the same (`call` for the first three). The guide writes an action as `tool:action`, for example `work-items:get`. **Required** names the arguments an action needs besides `action`; **REST twin** is the operation below `/api/v1` the action mirrors, with its parameters, body and answer in the reference at `/api/docs`.

<!-- tools:start -->

### `whoami`

The account of the token: person or bot, language, time zone, role in the organization and the rights of that role. Call it first. (Needs `read`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `call` | The account of the token. | – | `GET /me` |

### `search`

Searches items, wiki pages, projects, people and views at once, like the command palette. Every word has to hit, a key (`WEB-47`) puts its item first. `type_id`, `state_category`, `assignee_id` (`none` alone: items without an assignee) and `label_id` narrow the items. Hits are lean. (Needs `read`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `call` | Searches. | `q` | `GET /search` |

### `get-upload-url`

An address to upload a file to, see [Upload a file](#upload-a-file). (Needs `write`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `call` | An upload address. | `input` | – |

### `organization`

The organization and its catalogs: workflows, work item types, properties, labels, relation types and resolutions. Every account reads them. (Needs `read`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `get` | The organization. | – | `GET /organization` |
| `state-usage` | The items per state of a project or of a workflow, archived ones included (`project` or `workflow`). | – | `GET /state-usage` |
| `list-workflows` | The workflows. | – | `GET /workflows` |
| `get-workflow` | One workflow. | `id` | `GET /workflows/{workflow}` |
| `list-types` | The work item types. | – | `GET /work-item-types` |
| `get-type` | One work item type. | `id` | `GET /work-item-types/{workItemType}` |
| `list-properties` | The properties. | – | `GET /properties` |
| `get-property` | One property. | `id` | `GET /properties/{property}` |
| `list-labels` | The labels. | – | `GET /labels` |
| `get-label` | One label. | `id` | `GET /labels/{label}` |
| `list-relation-types` | The relation types. | – | `GET /relation-types` |
| `get-relation-type` | One relation type. | `id` | `GET /relation-types/{relationType}` |
| `list-resolutions` | The resolutions. | – | `GET /resolutions` |
| `get-resolution` | One resolution. | `id` | `GET /resolutions/{resolution}` |

### `manage-organization`

Changes the organization and its catalogs; org admins only. `update-…` replaces the entry as a whole, like `PUT`. (Needs `write`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `update` | Changes the organization; only the keys named change. | `input` | `PATCH /organization` |
| `create-workflow` | Creates a workflow. | `input` | `POST /workflows` |
| `update-workflow` | Replaces a workflow. | `id`, `input` | `PUT /workflows/{workflow}` |
| `delete-workflow` | Deletes a workflow. | `id` | `DELETE /workflows/{workflow}` |
| `create-type` | Creates a work item type. | `input` | `POST /work-item-types` |
| `update-type` | Replaces a work item type. | `id`, `input` | `PUT /work-item-types/{workItemType}` |
| `delete-type` | Deletes a work item type (archives it while items carry it). | `id` | `DELETE /work-item-types/{workItemType}` |
| `create-property` | Creates a property. | `input` | `POST /properties` |
| `update-property` | Replaces a property. | `id`, `input` | `PUT /properties/{property}` |
| `delete-property` | Deletes a property with its values. | `id` | `DELETE /properties/{property}` |
| `create-label` | Creates a label. | `input` | `POST /labels` |
| `update-label` | Replaces a label. | `id`, `input` | `PUT /labels/{label}` |
| `delete-label` | Deletes a label. | `id` | `DELETE /labels/{label}` |
| `create-relation-type` | Creates a relation type. | `input` | `POST /relation-types` |
| `update-relation-type` | Replaces a relation type. | `id`, `input` | `PUT /relation-types/{relationType}` |
| `delete-relation-type` | Deletes a relation type with its relations. | `id` | `DELETE /relation-types/{relationType}` |
| `create-resolution` | Creates a resolution. | `input` | `POST /resolutions` |
| `update-resolution` | Replaces a resolution. | `id`, `input` | `PUT /resolutions/{resolution}` |
| `delete-resolution` | Deletes a resolution (archives it while items carry it). | `id` | `DELETE /resolutions/{resolution}` |

### `people`

Accounts: people and bots, open invitations, API tokens (your own; org admins also those of bots) and who can be mentioned in a project. (Needs `read`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `list-users` | The accounts, people before bots (`filter.type` takes `person` and `bot`). | – | `GET /users` |
| `get-user` | One account. | `id` | `GET /users/{user}` |
| `list-bots` | The bots. | – | `GET /bots` |
| `list-invitations` | The open invitations. | – | `GET /invitations` |
| `list-tokens` | The API tokens of the own account, or of the account in `filter.user_id`. | – | `GET /tokens` |
| `mentionable` | Who can be mentioned in a project. | `project` | `GET /mentions` |

### `manage-people`

Changes accounts; most actions are for org admins. A new e-mail address of a person only comes from the interface (`403 session_required`), and tokens are only created there. (Needs `write`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `update-user` | Changes a profile; only the keys named change. | `id`, `input` | `PATCH /users/{user}` |
| `set-role` | Sets the role in the organization (`org_role`). | `id`, `input` | `PUT /users/{user}/role` |
| `deactivate` | Deactivates an account; its tokens and sessions end. | `id` | `POST /users/{user}/deactivate` |
| `reactivate` | Reactivates an account; tokens do not come back. | `id` | `POST /users/{user}/reactivate` |
| `create-bot` | Creates a bot. | `input` | `POST /bots` |
| `invite` | Invites an address; answers `{link, invitation}`. | `input` | `POST /invitations` |
| `revoke-token` | Revokes an API token. | `id` | `DELETE /tokens/{token}` |

### `projects`

The projects the account sees, one project, its members and your favorites. (Needs `read`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `list` | The projects of the account (`filter.member` only the ones it is a member of; `include` `members`). | – | `GET /projects` |
| `get` | One project. | `project` | `GET /projects/{project}` |
| `members` | The members of a project, people and bots with their role. | `project` | `GET /projects/{project}/members` |
| `favorites` | The own favorites, projects and views in one order. | – | `GET /favorites` |

### `manage-projects`

Projects, their members and your favorites. The admins of a project change it. (Needs `write`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `create` | Creates a project; the account becomes its admin. | `input` | `POST /projects` |
| `update` | Changes a project; only the keys named change. | `project`, `input` | `PATCH /projects/{project}` |
| `archive` | Archives a project; its items are read-only. | `project` | `POST /projects/{project}/archive` |
| `restore` | Restores an archived project. | `project` | `POST /projects/{project}/restore` |
| `delete` | Deletes a project at once for everybody; its data goes in the background. | `project` | `DELETE /projects/{project}` |
| `set-workflow` | Switches the workflow; every state in use needs a state in `mapping`, else 422 with `states`. | `project`, `input` | `PUT /projects/{project}/workflow` |
| `join` | Joins a project as a member. | `project` | `POST /projects/{project}/join` |
| `add-member` | Adds an account with a role. | `project`, `input` | `POST /projects/{project}/members` |
| `update-member` | Changes the role of a member. | `project`, `user`, `input` | `PATCH /projects/{project}/members/{user}` |
| `remove-member` | Removes a member; the lead stays. | `project`, `user` | `DELETE /projects/{project}/members/{user}` |
| `toggle-favorite` | Puts a project or view into the own favorites or takes it out; answers `{kind, id, favorite}`. | `input` | `POST /favorites/toggle` |

### `automations`

The four automations of a project with their settings. (Needs `read`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `list` | The automations of a project. | `project` | `GET /projects/{project}/automations` |

### `manage-automations`

Switches an automation of a project and sets its settings; the admins of the project. (Needs `write`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `update` | Switches an automation on or off and sets its settings. | `project`, `key`, `input` | `PUT /projects/{project}/automations/{key}` |

### `work-items`

Lists by a view and the short form of `filter`, queries by a body, groups and counts, one item with what it embeds, its history and its watchers. (Needs `read`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `list` | A page of items (lean unless `lean` is 0). | – | `GET /work-items` |
| `query` | A page of items by a filter in `input`. | – | `POST /work-items/query` |
| `groups` | The groups of a query and their numbers. | `input` | `POST /work-items/groups` |
| `counts` | The number of items of each named filter. | `input` | `POST /work-items/counts` |
| `get` | One item; `include` embeds more. | `item` | `GET /work-items/{item}` |
| `history` | The history of an item, oldest first. | `item` | `GET /work-items/{item}/history` |
| `subscribers` | Who watches an item. | `item` | `GET /work-items/{item}/subscribers` |

### `manage-work-items`

Creates and changes items. A description sent with `base_description_version` is refused with `409 description_conflict` when someone changed it since. (Needs `write`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `create` | Creates an item. | `input` | `POST /work-items` |
| `update` | Changes the keys of `input`. | `item`, `input` | `PATCH /work-items/{item}` |
| `transition` | Moves an item to another state. | `item`, `input` | `POST /work-items/{item}/transition` |
| `change-type` | Gives an item another type. | `item`, `input` | `PUT /work-items/{item}/type` |
| `archive` | Archives a closed item. | `item` | `POST /work-items/{item}/archive` |
| `restore` | Restores an archived item. | `item` | `POST /work-items/{item}/restore` |
| `delete` | Deletes an item for good. | `item` | `DELETE /work-items/{item}` |
| `bulk-update` | One patch for many items. | `input` | `POST /work-items/bulk` |
| `subscribe` | Watches an item. | `item` | `PUT /work-items/{item}/subscription` |
| `unsubscribe` | Stops watching an item. | `item` | `DELETE /work-items/{item}/subscription` |

### `relations`

The relations of an item. An end in a project the account does not see is `hidden`, without key, title or ID. (Needs `read`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `list` | The relations of an item. | `item` | `GET /work-items/{item}/relations` |

### `manage-relations`

Relates items and removes relations. (Needs `write`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `add` | Relates an item (`item`, the source) to `input.target_id` (ULID or key). | `item`, `input` | `POST /work-items/{item}/relations` |
| `remove` | Removes a relation, from either end the account may change. | `relation` | `DELETE /relations/{relation}` |

### `comments`

The comments of an item, oldest first, with their reactions. (Needs `read`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `list` | A page of the comments of an item. | `item` | `GET /work-items/{item}/comments` |
| `get` | One comment. | `comment` | `GET /comments/{comment}` |

### `manage-comments`

Writes comments. Only the author edits a comment; the author or a project admin deletes it. (Needs `write`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `add` | Comments on an item. | `item`, `input` | `POST /work-items/{item}/comments` |
| `edit` | Replaces the text of the own comment. | `comment`, `input` | `PATCH /comments/{comment}` |
| `delete` | Deletes a comment (its author or a project admin). | `comment` | `DELETE /comments/{comment}` |
| `react` | Adds the own reaction. | `comment`, `input` | `PUT /comments/{comment}/reactions` |
| `unreact` | Takes the own reaction back. | `comment`, `input` | `DELETE /comments/{comment}/reactions` |

### `attachments`

The data of a picture or file. The file itself comes from `url` with the same bearer token (`?download=1` to download it). (Needs `read`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `get` | The data of an attachment. | `attachment` | `GET /attachments/{attachment}` |

### `manage-attachments`

Deletes a file of the file list of an item, or an own upload no text names yet. A picture or file inside a text goes with the text (`409 attachment_inline`). (Needs `write`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `delete` | Deletes an attachment. | `attachment` | `DELETE /attachments/{attachment}` |

### `pages`

The wiki of a project: the tree, a page with its text, the versions of a page. (Needs `read`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `tree` | The whole tree of a project, without text. | `project` | `GET /projects/{project}/pages` |
| `get` | One page with its text. | `page` | `GET /pages/{page}` |
| `versions` | The kept versions of a page, newest first, without text. | `page` | `GET /pages/{page}/versions` |
| `version` | One version of a page with its text. | `page`, `page_version` | `GET /pages/{page}/versions/{pageVersion}` |

### `manage-pages`

Writes wiki pages, with the protection against conflicts of the REST API (`base_version`, `keep_current`). (Needs `write`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `create` | A new page at the end of its siblings. | `project`, `input` | `POST /projects/{project}/pages` |
| `update` | Saves the keys sent. | `page`, `input` | `PATCH /pages/{page}` |
| `move` | Moves a page with its subtree. | `page`, `input` | `POST /pages/{page}/move` |
| `delete` | Deletes a page with its subtree; answers `{deleted}`. | `page` | `DELETE /pages/{page}` |
| `restore-version` | Makes a kept version the current page. | `page`, `page_version` | `POST /pages/{page}/versions/{pageVersion}/restore` |

### `templates`

Templates of items: the list, one template, its runs, the draft of an item made from it and the next terms of a schedule. (Needs `read`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `list` | A page of the templates of every project the account sees. | – | `GET /templates` |
| `get` | One template. | `template` | `GET /templates/{template}` |
| `runs` | The runs of a template, newest first. | `template` | `GET /templates/{template}/runs` |
| `draft` | The fields of a new item from a template, placeholders filled. | `template` | `GET /templates/{template}/draft` |
| `preview` | The next terms of a schedule and a title with its placeholders filled; saves nothing. | `input` | `POST /templates/preview` |

### `manage-templates`

Writes templates and runs them now. A failed run answers with its sentence, not an error. (Needs `write`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `create` | A new template in a project. | `project`, `input` | `POST /projects/{project}/templates` |
| `update` | Replaces a template as a whole. | `template`, `input` | `PUT /templates/{template}` |
| `delete` | Deletes a template; items made from it stay. | `template` | `DELETE /templates/{template}` |
| `run` | Runs a template now; answers the run and its item (none when the run failed). | `template` | `POST /templates/{template}/run` |

### `views`

The views of the team and a page of the items of a view. (Needs `read`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `list` | The views, by name. | – | `GET /views` |
| `get` | One view with its filter and display. | `view` | `GET /views/{view}` |
| `items` | A page of the items of a view (lean unless `lean` is false). | `view` | `POST /work-items/query` |

### `manage-views`

Creates, replaces and deletes views; the author of a view or an org admin. (Needs `write`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `create` | Creates a view. | `input` | `POST /views` |
| `update` | Replaces a view (all four keys). | `view`, `input` | `PUT /views/{view}` |
| `delete` | Deletes a view and the stars of everyone on it. | `view` | `DELETE /views/{view}` |

### `notifications`

Your own inbox and your notification settings. A bot has an empty inbox. (Needs `read`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `list` | A page of the own inbox, newest first. | – | `GET /notifications` |
| `preferences` | The whole matrix of kinds and channels with the value that counts. | – | `GET /notification-preferences` |

### `manage-notifications`

Marks your notifications read or unread, deletes them and changes your settings. (Needs `write`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `read` | Marks notifications read: by ids, or all unread ones. | `input` | `POST /notifications/read` |
| `unread` | Marks read notifications unread again. | `input` | `POST /notifications/unread` |
| `delete` | Deletes a notification of the own inbox. | `notification` | `DELETE /notifications/{notification}` |
| `save-preferences` | Changes the named cells of the settings; answers the whole matrix. | `input` | `PUT /notification-preferences` |

### `webhooks`

Webhooks and their delivery log; org admins only. The secret is never shown. (Needs `read`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `list` | A page of the webhooks. | – | `GET /webhooks` |
| `get` | One webhook. | `webhook` | `GET /webhooks/{webhook}` |
| `deliveries` | The attempts of a webhook, newest first. | `webhook` | `GET /webhooks/{webhook}/deliveries` |

### `manage-webhooks`

Writes webhooks; org admins only. `create` and `rotate-secret` answer the secret once. `ping` and `redeliver` call the receiver, 6 a minute per account together with the REST API. (Needs `write`.)

| Action | Purpose | Required | REST twin |
|---|---|---|---|
| `create` | Creates a webhook; answers {data, secret}. | `input` | `POST /webhooks` |
| `update` | Replaces a webhook as a whole; no secret in the answer. | `webhook`, `input` | `PUT /webhooks/{webhook}` |
| `delete` | Deletes a webhook with its attempts. | `webhook` | `DELETE /webhooks/{webhook}` |
| `rotate-secret` | A new secret; the old one stops working. Answers {data, secret}. | `webhook` | `POST /webhooks/{webhook}/rotate-secret` |
| `ping` | Sends a test ping now and answers its attempt. | `webhook` | `POST /webhooks/{webhook}/ping` |
| `redeliver` | Sends a delivery again and answers the new attempt. | `webhook`, `delivery` | `POST /webhooks/{webhook}/deliveries/{delivery}/redeliver` |

<!-- tools:end -->

## Arguments

- **References** in the path of the twin are arguments in `snake_case`: `item` (ULID or key, also a former key: the item is read with its current key, there is no redirect), `project` (ULID, identifier or a former identifier), `page`, `page_version`, `comment`, `template`, `view`, `webhook` and so on (ULIDs in any case), `id` for an entry of a catalog, an account or a token, except where the route names the account as `{user}` next to a project: `manage-projects` takes the member as `user` in `update-member` and `remove-member`.
- **`input`** is the body of the REST twin, with the same keys and the same schema as in `/api/docs`. Rich text goes in as Markdown (`description`, `body`, `content`), or as Tiptap JSON under the `_json` key, as over REST.
- **Queries** of a `GET` twin are arguments of their own: `filter` is an object (`{"assignee": ["me"]}`), lists are JSON lists (`["person", "bot"]`), flags `true` and `false` or `1` and `0`. Strings are trimmed like over REST, with Unicode whitespace.
- **Pages:** `cursor` is the `meta.next_cursor` of the page before, `per_page` 25 when left out (REST: 100). Lists of items are lean when `lean` is left out (`work-items:list`, `work-items:query`, `views:items`, `templates:list`): no description and no Markdown of rich-text values; pass `lean: false` for them, or read the item with `work-items:get`. Set both and a tool answers like REST.

## Results

The result of a tool is the body of the REST answer, as `structuredContent` and mirrored as JSON text in `content`, with three differences:

- **Rich text only as Markdown:** `description`, `body`, `content` and the rich-text values in `values` are Markdown for the account (current handles, keys of items it sees, `[hidden](item:…)` for the rest); the `_json` forms are left out.
- **No `links`:** a list has `data` and `meta`; `meta.path` is the address of the REST twin, `meta.next_cursor` leads to the next page.
- **Answers without a body** (`204`, `202`) are `{"done": true}`.

A tool that writes answers what REST answers: the item after the change, `{updated, rejected}` of `manage-work-items:bulk-update`, `{deleted}` of `manage-pages:delete`, the run of `manage-templates:run`, also when the run failed (with its sentence in `error`).

## Errors

A refusal is a result with `isError: true`. Its text is one line `<status> <reason>: <detail>`, followed by a line `<field>: <sentence>` per field error; `structuredContent` is the [problem](/en/api#errors) REST would answer, with the same `reason` and in the language of the account. A `429` adds `retry_after` in seconds.

```text
422 validation_failed: The input is not valid.
values.customer: "Customer" is required.
```

Some errors come before a tool runs and are answered as HTTP: `401` without a valid token or for a deactivated account (with `WWW-Authenticate`), `403` for a token without `mcp` or a foreign `Origin`, `413`, `415`, `429`, each with a problem document. A tool the token may not use and an unknown tool are the JSON-RPC error `-32602`.

## Rich text and mentions

Write Markdown like over REST: `@handle` mentions a person or bot that can take work in the project (`people:mentionable` names them), a key like `WEB-12` becomes a reference when the account sees the item, `![alt](attachment:<id>)` shows an uploaded picture. The resource `werkbuch://reference/markdown` is the reference, the same as the section [Markdown](/en/concepts/rich-text#markdown) of rich text. A mention from a tool notifies like one from the interface; mentioning a bot sends `bot.mentioned` to its webhook.

## Upload a file

A file never goes through a tool argument. `get-upload-url` gives an address to post it to:

```json
{
  "data": {
    "url": "https://werkbuch.example.com/api/mcp/uploads/01k…?project_id=…&kind=inline&expires=…&signature=…",
    "method": "POST",
    "field": "file",
    "expires_at": "2026-11-07T09:15:00.000000Z",
    "curl": "curl -F 'file=@<path>' 'https://werkbuch.example.com/api/mcp/uploads/01k…'"
  }
}
```

`input.kind` is `inline` for a picture or file in a text, or `file` for the file list of `input.work_item_id`. The agent posts the file with `curl -F 'file=@<path>' '<url>'`, without a bearer token; the answer is the attachment with its `id`. A `file` is in the file list of the item right away. An `inline` upload belongs to nobody until the agent writes `![alt](attachment:<id>)` (picture) or `[name](attachment:<id>)` (file) into a Markdown text of the project; the text owns it from then on, and an upload no text takes goes after 24 hours.

The address names the project, the kind and the item in its signature, and it holds for 15 minutes at most, and never longer than its token. It may be used more than once, so `curl` can start again after a break. Each upload checks the token again (not revoked, not expired, account active, `write` and `mcp`) and the rights of the account on the project and item, as at the time of the upload.

## References

| URI | Content |
|---|---|
| `werkbuch://reference/filters` | Filters as JSON: fields, operators, values ([views](/en/concepts/views#filters)) |
| `werkbuch://reference/markdown` | Markdown of rich text ([rich text](/en/concepts/rich-text#markdown)) |
| `werkbuch://reference/field-types` | The values of every field type of a property ([types and properties](/en/concepts/types-and-properties#field-types)) |

Each is a section of these English docs, read when the client asks for it, so the reference and the docs never part.

## Security

- **Texts are data.** Titles, descriptions, comments, wiki pages and names come from people. The instructions of the server tell the model not to follow requests found there; the tools give it no way around the rights of its account either. Give an agent a token of a [bot](/en/bots) with the memberships its job needs, and only `read` and `mcp` when it only reads.
- **The default bot is an org admin.** A token of it may do everything everywhere; never hand one to an agent.
- **Everything a tool answers ends up in the history of the agent**, at the provider of the model too. That includes the secret of a webhook (`manage-webhooks:create`, `manage-webhooks:rotate-secret`), the invitation link of `manage-people:invite`, the address of `get-upload-url` and the address of a webhook with its query (`webhooks:get`), which may carry a token of the receiver. Create webhooks and invitations over REST or in the interface when that matters.
- **Every change is signed:** events and the history name the account and `via: mcp`, so a change of an agent can be told from one of a person.

## Agent scenario

A [bot](/en/bots) as an agent: an org admin creates the bot, adds it to a project and creates a token with `read`, `write` and `mcp` for it, plus a [webhook](/en/webhooks#agents) **only for this bot** with the events `bot.*`.

1. Someone assigns an item to the bot. The webhook `bot.assigned` reaches the agent with the item in `data.item`.
2. The agent connects to `/mcp` with its token and calls `whoami`: it learns its account and its rights.
3. `work-items:get` with `item` (the key from the webhook) reads the item, the description as Markdown.
4. It does the work and reports with `manage-comments:add` (`item`, `input.body` in Markdown).
5. `manage-work-items:transition` (`item`, `input.to_state_id`) moves the item on; the history shows the bot with `via: mcp`.

`bot.mentioned` wakes the agent the same way when someone writes `@handle` of the bot. Over REST the same steps are `GET /me`, `GET /work-items/{item}`, `POST /work-items/{item}/comments` and `POST /work-items/{item}/transition`.
