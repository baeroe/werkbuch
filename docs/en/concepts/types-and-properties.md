# Types and properties

Types, properties, labels, relation types and resolutions are the catalogs of the organization. Org admins manage them under **Settings**, in the group **Catalogs**; everyone else can read them there, and projects pick from them. Names are unique within each catalog, regardless of upper and lower case and of accents ("Über" and "uber" are the same name). The labels of properties are not names: two properties may share one, their keys are unique.

## Types

Every work item has a type, such as Task or Bug. werkbuch ships three: **Task**, **Bug** (with the optional property "Effort (h)") and **Epic**. You can add more under **Settings → Types**.

A type has:

- a **name** (up to 60 characters) and a **description**,
- an **icon** from a fixed list of 20 (`square-check`, `bug`, `zap`, `layers`, `file-text`, `rocket` and others),
- a **colour**, one of six tones: Sky, Ochre, Moss, Plum, Sand and Slate,
- the checkbox **Epic**: items of an epic type appear on the timeline and can have child items,
- its **properties**, each one required or not, in the order you give them.

### Archive instead of delete

An archived type takes no new items. Projects that have it switched on keep it, but no project can switch it on anew, and it cannot become a default type. **Restore** brings it back.

A type that is the default type of a project can be neither archived nor deleted; choose another default type in those projects first. This includes archived projects and a project being deleted until it is gone for good. The interface and the API (`409`, `reason: default_type`, the identifiers in `projects`) name them. Deleting a type removes it from every project that had it switched on. Once work items exist, a type that items still carry is archived instead of deleted.

### The types of a project

Each project switches on the types it uses and picks one of them as its **default type** for new items. Project admins do that under **Project settings → Types**. At least one active type stays switched on, and the default type is switched on and active.

A new project gets every active type, with the first one as the default, unless you choose otherwise in the dialog; there the topmost ticked type becomes the default.

## Properties

A property is a field that types add to their items, beyond the core fields every item has. Properties belong to the organization and are assigned to types under **Settings → Types**. A property has a label (up to 60 characters), a help text (up to 500), a key, a field type and an optional default value.

### Keys

The key names the property in the API and, later, in MCP and filters. It is `snake_case`: lowercase letters, digits and `_`, starting with a letter, at most 40 characters. It is unique and **cannot be changed** once the property is saved. It must not be the name of a core field: `id`, `key`, `project`, `type`, `title`, `description`, `state`, `state_category`, `resolution`, `assignee`, `priority`, `label`, `labels`, `start_date`, `due_date`, `parent`, `created_by`, `created_at`, `updated_at`, `started_at`, `closed_at`, `archived`, `archived_at` and `rank` are taken.

### Field types

The field type is fixed as well. The only change allowed is from single to multiple choice (for dropdowns and the people picker), never back, because items would lose all their values but one.

| Field type | Value | Settings | Default value |
|---|---|---|---|
| Text (`text`) | One line, up to 255 characters. | – | A text; blank means none. |
| Number (`number`) | A decimal number. | 0 to 4 decimal places. | A number, rounded to the decimal places. |
| Dropdown (`dropdown`) | One or more options from a list. | Multiple choice; the options. | One option that is not archived, or several with multiple choice. |
| Yes or no (`boolean`) | A switch. | – | Yes or no; no reads the same as an empty yes-or-no field. |
| Date (`date`) | A date without a time. | – | A date (`2026-10-31`). |
| People picker (`member`) | People or bots with access to the project. | Multiple choice. | None. |
| Rich text (`rich_text`) | Formatted text in the same editor as the description. | – | None. |
| URL (`url`) | An address with http or https. | – | An address with http or https. |

### Options

A dropdown has at least one active option. An option has a label (up to 60 characters), a tone (the field `color` in the API) and a place in the order; a dropdown has at most 100. An option you no longer want to offer can be **archived**: it is not offered for new values any more, and you can restore it. In the interface a saved option can only be archived; over the API, an option left out of a `PUT` is deleted.

## Labels

Labels mark items across all projects, such as "UX" or "Forms". A label has a name (up to 60 characters) and a tone (the field `color` in the API). There is no default label.

## Relation types

A relation type names the link between two items. It has a name and a label for each direction, such as "blocks" and "is blocked by", or it is **symmetric** and reads the same both ways, such as "relates to".

Over the API, a symmetric relation type has `inward_label: null`; an empty text is refused.

werkbuch ships three: **blocks** ("is blocked by" the other way round), **Duplicate** and **related** (symmetric). They can be renamed but not deleted. Only "blocks" will trigger anything once work items arrive: as long as the blocker is open, the blocked item shows a hint. Your own relation types are labels only.

## Resolutions

A resolution says how a closed item ended. An item that moves to a Completed or Canceled state gets one: the one you choose, or else the default of the category. werkbuch ships **Done** (default for Completed), **Won't do** (default for Canceled), **Duplicate** and **Cannot reproduce**, in that order.

Each of the two categories always has exactly one default. Making a resolution the default of a category takes the mark from the old one; to change the default, make another resolution the default. A default can be neither archived nor deleted. An archived resolution cannot be chosen any more.

## REST

Every account may read the catalogs; only org admins create, change and delete entries. Lists come in pages of up to 100 (`per_page`, `cursor`), like every list of the API.

| Catalog | List and create | Change and delete |
|---|---|---|
| Types | `/api/v1/work-item-types` | `/api/v1/work-item-types/{id}` |
| Properties | `/api/v1/properties` | `/api/v1/properties/{id}` |
| Labels | `/api/v1/labels` | `/api/v1/labels/{id}` |
| Relation types | `/api/v1/relation-types` | `/api/v1/relation-types/{id}` |
| Resolutions | `/api/v1/resolutions` | `/api/v1/resolutions/{id}` |

`POST` creates (`201`), `PUT` replaces the whole entry: every field is required except the ones that may be empty (descriptions, help texts, the default value, `inward_label`, `default_for`, `archived_at`), and a missing one is a `422` at that field. To archive, send any text in `archived_at` (werkbuch sets the time itself); `null` restores. A field that names an entry by its id (`property_id`, `enabled_type_ids`, `default_type_id`) takes its ULID exactly as werkbuch gives it, in any case; anything else is a `422` at that field. The types of a project change with `PATCH /api/v1/projects/{project}` and the fields `enabled_type_ids` and `default_type_id`.

A dropdown property with two options, the first one as default. As with the states of a workflow, new options carry ids you choose (not starting with `new:`), and werkbuch answers with ULIDs:

```bash
curl -X POST https://werkbuch.example.com/api/v1/properties \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "Channel",
    "key": "channel",
    "field_type": "dropdown",
    "help": "Where the piece is published.",
    "settings": { "multiple": false },
    "options": [
      { "id": "web", "label": "Website", "color": "sky" },
      { "id": "news", "label": "Newsletter", "color": "moss" }
    ],
    "default_value": "web"
  }'
```

```json
{
  "data": {
    "id": "01m68z9k8p6q45xg9r0vx5mc93",
    "key": "channel",
    "label": "Channel",
    "field_type": "dropdown",
    "help": "Where the piece is published.",
    "default_value": "01m68z9k8p6q45xg9r0vx5mc94",
    "settings": { "multiple": false },
    "options": [
      { "id": "01m68z9k8p6q45xg9r0vx5mc94", "label": "Website", "color": "sky", "position": 0, "archived_at": null },
      { "id": "01m68z9k8qhx241w3mz1fagh3q", "label": "Newsletter", "color": "moss", "position": 1, "archived_at": null }
    ]
  }
}
```

A type that requires it:

```bash
curl -X POST https://werkbuch.example.com/api/v1/work-item-types \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Article",
    "icon": "file-text",
    "tone": "plum",
    "description": "A piece for the website or the newsletter.",
    "is_epic": false,
    "properties": [{ "property_id": "01m68z9k8p6q45xg9r0vx5mc93", "required": true }]
  }'
```

`settings` is `{"decimals": 0…4}` for a number, `{"multiple": true|false}` for a dropdown or a people picker, and empty otherwise. Deleting answers `200` with `{"outcome": "deleted"}` for types and resolutions, `{"affected_items": 0}` for properties and labels and `{"affected_relations": 0}` for relation types; the counts will name the items and relations that lost the value once there are work items.
