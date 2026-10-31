# Projects

A project is where a team works on items. Every project has its own members, and, as work items arrive in later phases, its own items, wiki and settings.

## Fields

| Field | Notes |
|---|---|
| Name | Required. |
| Description | Plain text, up to 2000 characters. |
| Image | Optional. Without one the project gets a color with its initials. |
| Lead | An active person who is a member of the project. By default the person who creates it. |
| Identifier | See below. |
| Visibility | Public or private. |
| Workflow | The default workflow, unless you choose another one. See below. |
| Types | The item types the project uses, one of them the default type. See below. |

## Identifier

The identifier is 2 to 10 capital letters or digits and starts with a letter, for example `WEB`. It is unique across the organization and becomes the prefix of the keys of items (`WEB-12`).

You can change it. Old identifiers keep working: `OLD-12` redirects to `NEW-12`, and links, bookmarks and API calls with the old identifier still find the project. An old identifier stays reserved for that project; nobody else can take it. Changing back to an earlier identifier of the same project is allowed.

## Workflow and types

Every project uses one [workflow](/en/concepts/workflows) of the organization, and switches on the [types](/en/concepts/types-and-properties) its items may have, one of them as the default type for new items. When you create a project, the dialog suggests the default workflow and every active type, with the topmost ticked type as the default.

Project admins change both in the project settings, under **Workflow** and **Types**. Switching the workflow is a step of its own: over the API it is `PUT /api/v1/projects/{project}/workflow`, not a field of the project. The types change with the other fields of the project (`enabled_type_ids`, `default_type_id`).

## Public and private

A public project is visible to everyone in the organization, a private one only to its members and to org admins. Who sees what, and what each role may do, is described under [roles and permissions](/en/concepts/permissions). The visibility can be changed at any time in the project settings.

## Members and roles

A member has one of three roles: admin, member or viewer. Project admins add people and bots, change roles and remove members in the project settings. Org admins can do that in every project.

- Anyone who sees a public project can join it with one click and becomes a member.
- Whoever creates a project becomes its admin.
- The lead stays a member. You can change the lead's role, but you cannot remove the lead: name another lead first.
- Bots can be members like people. The default bot only when you add it explicitly.

## Archive

A project admin can archive a project. It becomes read-only and disappears from the sidebar and from views. Nothing is lost: **Show archived** on the projects page lists archived projects, and a project admin can restore the project in its settings. The interface waits five seconds first, and **Undo** takes the archiving back.

## Delete

Only a project admin can delete a project, and has to type the identifier to confirm. The project disappears for everyone right away. The rest, with everything that belongs to it, is removed in the background by a job, so deleting a large project does not block the page. The interface waits five seconds before it deletes, and **Undo** stops it. After that, deleting cannot be undone.

## Favorites

The star next to a project puts it in the sidebar. Favorites are personal. If someone loses access to a private project, it leaves their sidebar at once, and it comes back when they get access again.
