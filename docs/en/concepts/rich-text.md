# Rich text

Descriptions, rich text properties, comments and wiki pages are rich text: formatted text with mentions, references to items and pages, images and files. werkbuch stores it as JSON in the form of the editor (Tiptap) and reads and writes it as Markdown too, so the API and agents work with plain text. HTML that someone pastes or sends is never shown as it is; werkbuch only renders the nodes it knows.

## Levels of the editor

There is one editor in three levels. Each level shows what fits its place:

| Level | Where | Blocks |
|---|---|---|
| Comment | Comments | Text, lists, quotes, code, links, mentions, references, images and files |
| Description | Descriptions of items, rich text properties | Also headings (three levels), checklists and tables |
| Page | [Wiki pages](/en/concepts/wiki) | Also horizontal rules; tables in the `/` menu |

A text that holds blocks its level does not know (a table pasted into a comment) shows their text as paragraphs. `mod+enter` saves or sends; the description, rich text properties and wiki pages also save on their own after a short pause and when you leave the field.

## Blocks and shortcuts

Type `/` at the start of a line or after a space to open the block menu (right after bold text, a mention or a file it stays a slash). Typing narrows the list (also by words like "todo" for a checklist), the arrow keys choose, `enter` or `tab` turns the line into the block, `esc` closes the menu. Each entry names its Markdown shortcut, which works while typing as well:

| Block | Shortcut while typing |
|---|---|
| Heading 1 to 3 | `# `, `## `, `### ` |
| List | `- ` |
| Numbered list | `1. ` |
| Checklist | `[ ] ` |
| Code | ```` ``` ```` (with a language: ```` ```php ````) |
| Quote | `> ` |
| Horizontal rule (pages only) | `---` |

**Image or file** in the menu opens the file choice of the browser. Code is highlighted for Bash, CSS, Diff, JavaScript, JSON, Markdown, PHP, Python, Shell, SQL, TypeScript, XML and YAML; without a language werkbuch guesses one for the display, the text stays as you typed it. Bold, italic, strike-through, inline code and links work with the usual Markdown marks (`**`, `*`, `~~`, `` ` ``) and keys. Links keep only `http`, `https` and `mailto`.

## Editing tables

While the cursor is in a table, the **Table** button sits on its top edge at the right; `alt+F10` opens its menu straight from the text. There you insert rows above or below and columns to the left or right, delete the row or column of the cursor or the whole table, and turn the **Header row** and the **Header column** on and off. The last row and the last column stay; delete the table instead. After every command and on `esc` the focus goes back to the same place in the text. The same commands are in the `/` menu while the cursor is in a table (group "Table"). The editor offers neither merged cells nor single header cells: Markdown carries neither (see [Tables](#tables) under Markdown).

## Mentions

`@` opens a list of the people and bots that can be mentioned in the project: its active members, and people who are org admins. A bot only when it is a member of the project, the default bot as well. Typing narrows the list by name or handle. A mention shows the current handle of the account, even after it was renamed; a deactivated account is marked as such.

Mentioning a person in an item or a comment makes them watch the item, even if they had stopped watching it, and they get a [notification](/en/concepts/notifications). A mentioned bot gets the event `bot.mentioned`. Only people mentioned anew count: editing a text that keeps a mention does not mention anyone again, and mentioning yourself does not count. A mention in a wiki page stays a mention but notifies nobody.

A mention of someone who cannot be mentioned in the project, for example after they left it, stays as text `@handle` when you save. A mention that the text already had stays a mention.

## References

`#` searches the items and wiki pages you see with the same [search](/en/search) as the command palette: items by key (also a former one), title and text, pages below them by title and text. A reference to an item shows its type and current key, the title for screen readers, and leads to the item when you read the text; a reference to a page shows its emoji and current title and leads to the page.

werkbuch stores only the ULID of the item or page, never a key or title. Whoever reads the text sees the reference as they may: an item or page they cannot see shows as **hidden**, without key or title, in the interface, in the API and in mails. When you save, you can only refer to items and pages you see; a reference that the text already had stays, even to one you do not see.

## Images and files

Paste a screenshot or an image copied in the browser, drag files into the editor, or choose them with **Image or file** in the `/` menu. Each file shows its progress while it uploads, and you can keep typing. Images are shown in the text; a selected image takes its alternative text with `enter` or a double click. Every other file is a chip with its name and size, and clicking it downloads the file.

- **Formats:** werkbuch tells the type of a file from its content, never from its name or what the browser says. Only PNG, JPEG, GIF, WebP and AVIF are shown inline; everything else, SVG and PDF included, comes as a download (`Content-Security-Policy: sandbox`, `nosniff`). HTML or Markdown with the address of an image (`<img src>`, `![](https://…)`) never becomes an image; its alternative text stays as text.
- **Size:** at most `ATTACHMENTS_MAX_MB` per file, 25 MB by default. The browser refuses a larger file before it uploads it; over the API it is a `413`. While an upload runs, leaving the page asks first; closing the text stops the upload and says so.
- **Previews:** for PNG, JPEG and WebP werkbuch computes a preview of at most 1600 × 1600 pixels in the background (queue `media`); until it is there, the original is shown. GIF keeps its animation, AVIF is shown without a preview.
- **Who:** anyone who may comment may put images and files into a text, viewers included. The file list of an item takes the right to change the item (see [work items](/en/concepts/work-items#files)).
- **Who sees them:** a file is delivered only to someone who sees the item (or the item of the comment) it belongs to, or the project of its wiki page; to everyone else it is a `404`, as if it did not exist.

An upload belongs to nobody until the text that names it is saved; then it belongs to that text. A text may also show an image of another text of the same project (copied from one description into another); that image stays with its first text. It can never name an image of another project, or an upload of someone else that no text owns yet.

Images and files removed from a text stay, so that the history and undo keep working. [Cleaning up](#clean-up) removes them later.

<!-- reference:start -->
## Markdown

Over the API every rich text comes in two forms: Markdown (`description`, `body`, `content`, `values_markdown`) and Tiptap JSON (`description_json`, `body_json`, `content_json`, `values`). You write one of the two, never both. Markdown is read as GitHub-flavoured Markdown; HTML in it stays text. werkbuch writes each node in exactly one form, so a text you read and send back unchanged stays the same.

| What | Markdown |
|---|---|
| Mention | `@mara` |
| Reference to an item | `WEB-123` |
| Reference to an item the reader does not see | `[hidden](item:<ulid>)` |
| Reference to a page | `[Title](page:<ulid>)`, with the current title |
| Reference to a page the reader does not see | `[hidden](page:<ulid>)` |
| Image | `![alt text](attachment:<ulid>)` |
| File | `[offer.pdf](attachment:<ulid>)` |

### Writing over REST

The same rules apply to Markdown and JSON, checked for the account that writes:

| You write | Result |
|---|---|
| `@handle` of an account that can be mentioned in the project | A mention. |
| `@handle` without access to the project, unknown or deactivated | Stays text. |
| `WEB-123` of an item you see (also with a former key) | A reference with the current key. |
| `WEB-123` of an item you do not see, or that does not exist | Stays text; nobody learns whether it exists. |
| `[hidden](item:<ulid>)` that the text already had | Stays a reference. |
| `[x](item:<ulid>)` of an item you do not see, new in the text | Stays text: `x`. |
| `[Title](page:<ulid>)` of a page you see | A reference; werkbuch keeps only the ULID and writes the current title when it reads. |
| `[Title](page:<ulid>)` of a page you do not see, new in the text | Stays text: `Title`. |
| `attachment:<ulid>` of the project that a text owns, or your own upload | An image or a file. |
| `attachment:<ulid>` of another project, or of someone else's upload no text owns | `422` at the field that sent the text, nothing is saved. |

Nothing inside code blocks, inline code, link texts or alternative texts is read as a mention or reference: `` `@mara` `` and `[WEB-123](https://example.com)` stay as they are. A backslash keeps text from becoming one: `\@mara`, `WEB\-123`. When werkbuch writes Markdown, it puts that backslash in front of text that would otherwise turn into a mention or reference on the way back.

### Tables

Markdown knows one kind of table: the first row is the header row, and no column is a header column. werkbuch writes every table that way. When you send Markdown back, each table keeps the header row and the header column the text had before. With as many tables as the stored text, the first table of your Markdown takes them from the first stored table, the second from the second, and so on, as long as both have as many columns. If you add or remove a table, werkbuch pairs tables only from the start and from the end of the text, and only while a table has as many columns and the same text in its first row as the stored one; it stops at the first table that differs, and the tables in between read as Markdown writes them. So a layout never moves to another table, but a table you add between others, or whose first row you change in the same request, comes back with a header row and without a header column. Adding or removing rows keeps the layout; with another number of columns, or in a new text, the table reads as Markdown writes it. This also means a table without a header row never gets one through Markdown: to switch the header row or the header column, use the editor or send JSON. Markdown carries no single header cells and no cells that span several rows or columns; they are lost when Markdown comes back. JSON (`*_json`) keeps all of it.

<!-- reference:end -->

## REST

Reading needs a token with `read`, writing one with `write`. A comment or attachment of an item you do not see is a `404`.

| Request | Answer |
|---|---|
| `GET /api/v1/work-items/{item}/comments` | The comments of the item, oldest first, with `cursor` and `per_page`. |
| `POST /api/v1/work-items/{item}/comments` | `201` with the comment; `body` (Markdown) or `body_json`. |
| `GET`, `PATCH`, `DELETE /api/v1/comments/{id}` | The comment; change your own; delete your own (project admins and org admins delete any, `204`). |
| `PUT`, `DELETE /api/v1/comments/{id}/reactions` | Add or take back your reaction, `{"emoji": "👍"}` (for `DELETE` in the body or as `?emoji=`); both can be repeated and answer with the comment. |
| `POST /api/v1/attachments` | Upload (multipart): `project_id`, `kind` (`inline` for texts, `file` for the file list with `work_item_id`), `file`. `201`. |
| `GET`, `DELETE /api/v1/attachments/{id}` | The data of an attachment; delete it (`204`). |
| `GET /attachments/{id}` | The file itself; `?download=1` always as a download, `/attachments/{id}/preview` the preview. |
| `GET /api/v1/mentions?project=WEB&q=ma` | Who can be mentioned in the project, best matches first. |
| `GET /api/v1/references?items=<ulid>,<ulid>&pages=<ulid>` | The items and pages behind references (100 at most together), only those you see, without telling which are missing. |
| `GET /api/v1/work-items/{item}?include=attachments` | Embeds the file list of the item. |

The file route also takes a bearer token with `read`, so scripts can download files. Uploads are limited to 60 per minute and account.

### Write a comment

```bash
curl -X POST https://werkbuch.example.com/api/v1/work-items/WEB-47/comments \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"body": "Fixed on staging, @mara can you check? Same cause as WEB-42.\n\n- form sends once\n- mail arrives once"}'
```

The answer (`201`):

```json
{
  "data": {
    "id": "01m6b3h0xq7tn2c5d8e9f4g6hj",
    "work_item_id": "01m6akyecnp503vn6jmb8sp249",
    "author_id": "01m6akx65qgwfz2m2tz3bpt7st",
    "body": "Fixed on staging, @mara can you check? Same cause as WEB-42.\n\n- form sends once\n- mail arrives once",
    "body_json": { "type": "doc", "content": ["…"] },
    "created_at": "2026-11-03T09:12:44.318204Z",
    "edited_at": null,
    "reactions": []
  }
}
```

In `body_json`, `@mara` is a node `{"type": "mention", "attrs": {"id": "<ulid>", "label": "mara", "mentionSuggestionChar": "@"}}` and `WEB-42` a node `{"type": "reference", "attrs": {"id": "<ulid>", "kind": "item", "label": null, "mentionSuggestionChar": "#"}}`. A change (`PATCH` with `body` or `body_json`) marks the comment as edited; the history keeps the earlier version until the comment is deleted. A comment that is empty after the rules is a `422` at `body`.

### Upload a file

Upload the image first, then name it in the text:

```bash
curl -X POST https://werkbuch.example.com/api/v1/attachments \
  -H "Authorization: Bearer <token>" \
  -F project_id=WEB \
  -F kind=inline \
  -F file=@screenshot.png
```

```json
{
  "data": {
    "id": "01m6b3k2r5s8t1v4w7x0y3z6ab",
    "project_id": "01m6akx72yptw2aw6n30m5fg0a",
    "owner": null,
    "kind": "inline",
    "filename": "screenshot.png",
    "mime": "image/png",
    "size": 48213,
    "inline": true,
    "url": "/attachments/01m6b3k2r5s8t1v4w7x0y3z6ab",
    "preview_url": null,
    "uploaded_by": "01m6akx65qgwfz2m2tz3bpt7st",
    "created_at": "2026-11-03T09:14:02.000000Z"
  }
}
```

```bash
curl -X PATCH https://werkbuch.example.com/api/v1/work-items/WEB-47 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"description": "The second send is visible here:\n\n![Network tab](attachment:01m6b3k2r5s8t1v4w7x0y3z6ab)"}'
```

From then on the image belongs to the description of WEB-47 (`owner` `{"type": "work_item", …}`). For the file list of an item, send `kind=file` and `work_item_id=WEB-47`: the file belongs to the item right away, and its history names it.

### Errors

A file over the limit, also when PHP has dropped it before werkbuch sees it:

```json
{
  "type": "urn:werkbuch:problem:payload_too_large",
  "title": "Payload too large",
  "status": 413,
  "detail": "Uploads can be at most 25 MB.",
  "reason": "payload_too_large"
}
```

A text that names an image of another project, or an upload of someone else:

```json
{
  "type": "urn:werkbuch:problem:validation_failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "The input is not valid.",
  "reason": "validation_failed",
  "errors": { "description": ["The text names an image or file it may not use: upload it again in this project."] }
}
```

Deleting an image or file that belongs to a text is a `409` with `reason: attachment_inline`: it goes with its text. Only files of the file list are deleted one by one, and only by someone who may change the item; a file of the list that a text of the project names leaves the list but stays as a file of that text. A text that still names an image or file that is gone meanwhile can be saved: the dead image or file leaves it. Comments and reactions on an archived item, or in an archived project, are refused with `409` (`archived`, `project_archived`).

## Clean up

Two things keep uploads from piling up:

- **Uploads that no text took** (a picture pasted into a comment that was never sent): a job of the scheduler removes them every hour once they are older than 24 hours. The browser never deletes uploads itself, because a text may already have been saved with them.
- **Images and files that no text names any more:** `php artisan app:prune-attachments --dry-run --min-age=30` lists the images and files that no current text of their project names (descriptions, rich text values, comments, wiki pages and their versions) and that are older than the minimum age in days; without `--dry-run` it removes them. An image that only a version of a wiki page shows stays, because versions can be restored; images that only an older version in the history of an item shows go, so pick the minimum age with that in mind. Files of the file list are never pruned.

Deleting an item removes its files and those of its comments, deleting a comment its files, deleting a wiki page those of its subtree, deleting a project all of them; an image that another text of the project still shows stays and then belongs to that text. Files are removed only after the change is saved: if it fails, nothing is lost. More under [development](/en/development#maintenance-commands).
