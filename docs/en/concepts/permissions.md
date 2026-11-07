# Roles and permissions

werkbuch has two kinds of roles. An **organization role** applies everywhere, a **project role** only in one project. The roles are fixed: there are no custom roles, and there is no guest role either. Someone from outside gets a normal account.

## Organization roles

| Right | Admin | Member |
|---|---|---|
| Manage the organization, people, bots and webhooks | ✓ | – |
| Manage workflows, types, properties, labels, relation types and resolutions | ✓ | – |
| See and manage all projects, private ones too | ✓ | – |
| See and join public projects | ✓ | ✓ |
| Create projects | ✓ | ✓ |
| Create views | ✓ | ✓ |
| Change and delete other people's views | ✓ | – |
| Own tokens | ✓ | ✓ |

## Project roles

| Right | Admin | Member | Viewer |
|---|---|---|---|
| Read items, wiki and templates | ✓ | ✓ | ✓ |
| Comment, react, watch | ✓ | ✓ | ✓ |
| Create, change and archive items | ✓ | ✓ | – |
| Edit the wiki, manage templates and schedules | ✓ | ✓ | – |
| Delete items | ✓ | – | – |
| Project settings, members, workflow, types, automations | ✓ | – | – |
| Archive and delete the project | ✓ | – | – |

[Webhooks](/en/webhooks) are read and managed by org admins only, their delivery log and the test ping included; a token of the default bot may do it too, since the default bot is an org admin. A member gets `403`, not `404`: the settings section exists for everyone.

In the [wiki](/en/concepts/wiki), viewers and people outside a public project read the pages and their versions; members and admins create, edit, move and delete pages and restore versions. In an archived project, the wiki is read-only for everyone.

[Templates](/en/concepts/templates) are read by everyone who sees the project, logs included; members and admins create, change, delete and run them. [Automations](/en/concepts/automations) are switched by admins of the project only; everyone else who sees the project reads them.

## Org admins are admins everywhere

An org admin has the rights of a project admin in every project, without being a member. That includes private projects, archived ones and projects nobody else has joined.

## Visibility

- A **public** project is visible to everyone in the organization.
- A **private** project is visible to its members and to org admins only.
- An org member who is not a member of a public project reads it with the rights of a viewer. One click on **Join** makes them a member of the project; they join as a member, never as an admin.

What someone may not see does not exist for them. The interface answers a project it hides with the page "not found", and the REST API answers `404`, never `403`. So a `404` can also mean "not visible to you". Only a project you can see but not change answers `403`.

## Project lead

Every project has a lead. The lead is an active person (not a bot) and a member of the project. The lead gets all notifications of the project and has **no additional rights**: the project role decides what the lead may do, and the role can be changed like any other. A lead cannot be removed from the project; name another lead first.

## The last admin

The last active org admin among the people cannot be demoted or deactivated. Without one nobody could manage the organization any more. The default bot does not count: it is an admin too, but nobody signs in as the bot. If you are locked out anyway, see [lost password](/en/development#lost-password) for the command line.

## The default bot

Every organization has one default bot, "Automation". Automations and template schedules act on its behalf. It is an org admin, it stays active and keeps the admin role (changing that is refused). You can rename it. See [bots](/en/bots).

## Tokens

A token acts with the rights of its account, never with more. It also carries abilities, which narrow it down further:

| Ability | What it allows |
|---|---|
| `read` | `GET` and `HEAD` requests and the reads that take their question in a body: see items, projects and everything else; over MCP the tools that read |
| `write` | all other requests: create, change, comment and delete; over MCP the tools `manage-…` and `get-upload-url` |
| `mcp` | use the [MCP server](/en/mcp) from an MCP client; without `read` or `write` it sees no tool, only the references. A session of the interface never reaches the MCP server |

A token without the ability a request needs gets `403`. Create one token per device or script and give it only what it needs.

## Only from the interface

Some actions are only possible with the session of the signed-in interface, not with a token, whatever its abilities:

- changing your own password and setting up or turning off the second factor (`/api/v1/me/…`),
- creating tokens (`POST /api/v1/tokens`).

A token that tries gets `403` with the reason `session_required`. A stolen token can neither take over the account nor create itself a longer-lived successor. Listing and revoking tokens works with a token.

The invitation link is a similar case: the response to `POST /api/v1/invitations` carries it for the interface and for tokens with `write`; for a read-only token it is `null`, because the link signs up a new account.
