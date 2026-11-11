/*
 * The keyboard manifest (A442, K16): success criterion 6 says every flow works without a mouse and Playwright checks it.
 * This file names, for every id of the shortcut catalog (resources/js/lib/shortcuts/catalog.ts) and every key of a widget
 * (widgets.ts, as `<group>:<label>` with the last parts of their translation keys), the Playwright test that presses it
 * with the keyboard only, and for every flow of the app (chapters 4 and 5.2 of the spec) the test that goes through it
 * with the keyboard only. scripts/keyboard-flows.test.mjs keeps it complete and honest: it reads catalog and widgets as
 * text (this file imports nothing of the app), checks that the spec and the title exist, that the body of the test uses
 * no mouse (`.click(`, `.hover(`, `.dragTo(`, `.tap(`, `page.mouse`, also through a helper of the spec), and that a test
 * which skips a project proves nothing there. A proof of a flow writes over the API only before its first key or in
 * `finally` (API_AFTER names the exceptions).
 *
 * A new shortcut, widget key or flow needs its entry here in the same commit, with its test (`GAPS` stays empty); a new
 * flow also comes into `FLOWS` of scripts/keyboard-flows.test.mjs.
 */

/** A Playwright test that presses a key with the keyboard only. Without `projects` it holds wherever the test runs. */
export interface Proof {
  file: string;
  test: string;
  projects?: string[];
}

/** The two desktop projects: tests whose keys run only from md on (a branch for the phone takes another way). */
const DESKTOP = ['desktop-light', 'desktop-dark'];
/** The two phone projects. */
const PHONE = ['phone-light', 'phone-dark'];
/** All four: for a test that branches on `isPhone()` but presses the key before or outside the branch. */
const EVERYWHERE = [...DESKTOP, ...PHONE];

/** Per id of the catalog and per widget key (`<group>:<label>`), one test or several (e.g. one per width). */
export const SHORTCUT_TESTS: Record<string, Proof | Proof[]> = {
  // general and navigation
  'shell.help': { file: 'shell.spec.ts', test: 'starts with "Skip to content" and lists the shortcuts with ?' },
  'shell.palette': { file: 'palette.spec.ts', test: 'closes with Escape and mod+k, and gives the focus back' },
  'shell.search': { file: 'shell.spec.ts', test: 'opens the palette with / and from the search button, also on the phone', projects: EVERYWHERE },
  'shell.undo': { file: 'items.spec.ts', test: 'deletes an item with mod+backspace and undoes it with mod+z' },
  'shell.go.inbox': { file: 'shell.spec.ts', test: 'reaches the other main places with their g sequences' },
  'shell.go.my_items': { file: 'shell.spec.ts', test: 'reaches the other main places with their g sequences' },
  'shell.go.views': { file: 'shell.spec.ts', test: 'reaches the other main places with their g sequences' },
  'shell.go.projects': { file: 'shell.spec.ts', test: 'goes to projects with g p' },
  'dialog.submit': { file: 'create-item.spec.ts', test: 'creates an item of a type with a required property' },
  'settings.save': { file: 'settings-organization.spec.ts', test: 'changes the name of the organization with the keyboard' },

  // the item: c opens the dialog (a helper of the spec presses it), the field keys open the palette's sub-lists
  'item.create': { file: 'create-item.spec.ts', test: 'creates an item of a type with a required property' },
  'item.state': { file: 'items.spec.ts', test: 'sets a closing status with the resolution prefilled' },
  // on the phone the first test sets the assignee through the field editors (spec 5.1), the second presses a everywhere
  'item.assignee': [
    { file: 'items.spec.ts', test: 'changes assignee and priority with a and p', projects: DESKTOP },
    { file: 'items.spec.ts', test: 'assigns with i and a, sets a label with l and the dates with shift+d and d' },
  ],
  'item.assign_me': { file: 'items.spec.ts', test: 'assigns with i and a, sets a label with l and the dates with shift+d and d' },
  'item.labels': { file: 'items.spec.ts', test: 'assigns with i and a, sets a label with l and the dates with shift+d and d' },
  'item.start': { file: 'items.spec.ts', test: 'assigns with i and a, sets a label with l and the dates with shift+d and d' },
  'item.due': { file: 'items.spec.ts', test: 'assigns with i and a, sets a label with l and the dates with shift+d and d' },
  'item.type': { file: 'items.spec.ts', test: 'changes the type with t through the dialog and the parent with shift+p' },
  'item.parent': { file: 'items.spec.ts', test: 'changes the type with t through the dialog and the parent with shift+p' },
  'item.priority': [
    { file: 'bulk.spec.ts', test: 'selects three items with x and sets their priority with p' },
    { file: 'items.spec.ts', test: 'changes assignee and priority with a and p', projects: DESKTOP },
  ],
  'item.comment': { file: 'comments.spec.ts', test: 'writes a comment with m and mod+enter' },
  'item.relation': { file: 'item-sections.spec.ts', test: 'relates two items with r and removes the relation again' },
  'item.title': { file: 'items.spec.ts', test: 'edits the title with e' },
  'item.remove': { file: 'items.spec.ts', test: 'deletes an item with mod+backspace and undoes it with mod+z' },

  // the list: cursor, selection, preview, filter bar, layouts
  'list.next': { file: 'items-list.spec.ts', test: 'moves through the list with j and k, opens the preview with space and the page with Enter', projects: EVERYWHERE },
  'list.prev': { file: 'items-list.spec.ts', test: 'moves through the list with j and k, opens the preview with space and the page with Enter', projects: EVERYWHERE },
  'list.next_arrow': { file: 'items-list.spec.ts', test: 'moves with the arrows, extends the selection with shift, selects all with mod+a and clears it with Escape' },
  'list.prev_arrow': { file: 'items-list.spec.ts', test: 'moves with the arrows, extends the selection with shift, selects all with mod+a and clears it with Escape' },
  'list.extend_next': { file: 'items-list.spec.ts', test: 'moves with the arrows, extends the selection with shift, selects all with mod+a and clears it with Escape' },
  'list.extend_next_arrow': { file: 'items-list.spec.ts', test: 'moves with the arrows, extends the selection with shift, selects all with mod+a and clears it with Escape' },
  'list.extend_prev': { file: 'items-list.spec.ts', test: 'moves with the arrows, extends the selection with shift, selects all with mod+a and clears it with Escape' },
  'list.extend_prev_arrow': { file: 'items-list.spec.ts', test: 'moves with the arrows, extends the selection with shift, selects all with mod+a and clears it with Escape' },
  'list.select_all': { file: 'items-list.spec.ts', test: 'moves with the arrows, extends the selection with shift, selects all with mod+a and clears it with Escape' },
  'list.clear': { file: 'items-list.spec.ts', test: 'moves with the arrows, extends the selection with shift, selects all with mod+a and clears it with Escape' },
  'list.select': { file: 'bulk.spec.ts', test: 'selects three items with x and sets their priority with p' },
  'list.select_range': { file: 'bulk.spec.ts', test: 'selects a range with shift+x, archives with mod+backspace and undoes with mod+z' },
  'list.open': { file: 'items-list.spec.ts', test: 'moves through the list with j and k, opens the preview with space and the page with Enter', projects: EVERYWHERE },
  'list.peek': { file: 'items-list.spec.ts', test: 'moves through the list with j and k, opens the preview with space and the page with Enter', projects: EVERYWHERE },
  'list.filter': { file: 'filter.spec.ts', test: 'filters by priority with f' },
  'list.search': { file: 'filter.spec.ts', test: 'filters by title with /' },
  'list.layout.list': { file: 'items-list.spec.ts', test: 'switches to the board with 2 and back with 1, also in the address' },
  'list.layout.board': { file: 'items-list.spec.ts', test: 'switches to the board with 2 and back with 1, also in the address' },
  'list.layout.table': {
    file: 'views-acceptance.spec.ts',
    test: 'shows the items of a view on a property as list, board and table as REST does, and its epics with progress on the timeline',
  },
  'list.layout.timeline': { file: 'timeline.spec.ts', test: 'moves an epic by a week with shift+right at month zoom' },

  // moving the item under the cursor: the board and the timeline
  'list.move_left': { file: 'timeline.spec.ts', test: 'keeps the focus on an epic that moves past another of its project' },
  'list.move_right': { file: 'board.spec.ts', test: 'moves a card with shift+arrow to the next allowed column' },
  'list.move_up': { file: 'board.spec.ts', test: 'changes the place of a card in its column with alt+arrow and keeps the focus on it' },
  'list.move_down': { file: 'board.spec.ts', test: 'changes the place of a card in its column with alt+arrow and keeps the focus on it' },
  'board.column_prev': { file: 'board.spec.ts', test: 'moves the cursor to the column before and after with ← and →' },
  'board.column_next': { file: 'board.spec.ts', test: 'moves the cursor to the column before and after with ← and →' },
  'list.shorter': { file: 'timeline.spec.ts', test: 'moves the due date of an epic with alt+right and alt+left' },
  'list.longer': { file: 'timeline.spec.ts', test: 'moves the due date of an epic with alt+right and alt+left' },

  // the inbox
  'inbox.read': { file: 'inbox.spec.ts', test: 'works the inbox with the keyboard only' },
  'inbox.unread': { file: 'inbox.spec.ts', test: 'works the inbox with the keyboard only' },
  'inbox.read_all': { file: 'inbox.spec.ts', test: 'works the inbox with the keyboard only' },
  'inbox.delete': { file: 'inbox.spec.ts', test: 'works the inbox with the keyboard only' },

  // wiki, templates, preview
  'wiki.delete': { file: 'wiki.spec.ts', test: 'moves a page with Verschieben nach … and deletes a subtree with undo', projects: EVERYWHERE },
  'wiki.save': { file: 'wiki.spec.ts', test: 'saves a page at once with mod+enter and deletes a page from its row on the overview' },
  'template.save': { file: 'templates.spec.ts', test: 'creates a template with the keyboard and runs it now' },
  // the preview opened with space closes with Escape (on the phone the first Escape leaves the panel's focus)
  'peek.close': { file: 'items-list.spec.ts', test: 'moves through the list with j and k, opens the preview with space and the page with Enter', projects: EVERYWHERE },

  // widgets: the palette
  'palette:move': { file: 'search.spec.ts', test: 'finds a project and a view by name' },
  'palette:run': { file: 'palette.spec.ts', test: 'opens the palette with the keyboard and goes to the projects' },
  'palette:back': { file: 'palette.spec.ts', test: 'changes the theme from its list' },
  'palette:close': { file: 'palette.spec.ts', test: 'closes with Escape and mod+k, and gives the focus back' },

  // widgets: the grid of the table
  'table:column': { file: 'table.spec.ts', test: 'edits the priority of an item in the table with the keyboard' },
  'table:row': { file: 'table.spec.ts', test: 'edits the priority of an item in the table with the keyboard' },
  'table:edit': { file: 'table.spec.ts', test: 'edits the priority of an item in the table with the keyboard' },
  'table:stop': { file: 'table.spec.ts', test: 'edits the priority of an item in the table with the keyboard' },
  'table:extend': { file: 'table.spec.ts', test: 'jumps to the edges of the grid with Home, End and mod, and extends the selection with shift' },
  'table:edge_column': { file: 'table.spec.ts', test: 'jumps to the edges of the grid with Home, End and mod, and extends the selection with shift' },
  'table:edge_row': { file: 'table.spec.ts', test: 'jumps to the edges of the grid with Home, End and mod, and extends the selection with shift' },

  // widgets: group headers (← on a row goes to its header, ← on the header folds it, Enter folds and unfolds)
  'groups:collapse': [
    { file: 'items-list.spec.ts', test: 'collapses a group from the keyboard' },
    { file: 'items-list.spec.ts', test: 'unfolds a group with → and goes from header to header with ↑ and ↓' },
  ],
  'groups:toggle': { file: 'items-list.spec.ts', test: 'collapses a group from the keyboard' },
  'groups:expand': { file: 'items-list.spec.ts', test: 'unfolds a group with → and goes from header to header with ↑ and ↓' },
  'groups:header': { file: 'items-list.spec.ts', test: 'unfolds a group with → and goes from header to header with ↑ and ↓' },

  // widgets: the page tree of the wiki (on the overview it shows on every width)
  'tree:move': { file: 'wiki.spec.ts', test: 'opens the wiki from the sidebar and walks the tree with the keyboard', projects: EVERYWHERE },
  'tree:expand': { file: 'wiki.spec.ts', test: 'opens the wiki from the sidebar and walks the tree with the keyboard', projects: EVERYWHERE },
  'tree:collapse': { file: 'wiki.spec.ts', test: 'opens the wiki from the sidebar and walks the tree with the keyboard', projects: EVERYWHERE },
  'tree:edge': { file: 'wiki.spec.ts', test: 'opens the wiki from the sidebar and walks the tree with the keyboard', projects: EVERYWHERE },
  'tree:open': { file: 'wiki.spec.ts', test: 'opens the wiki from the sidebar and walks the tree with the keyboard', projects: EVERYWHERE },
  // beside a page the tree shows from lg on, the first test deletes from a row there; the second on the overview, on every width
  'tree:delete': [
    { file: 'wiki.spec.ts', test: 'moves a page with Verschieben nach … and deletes a subtree with undo', projects: DESKTOP },
    { file: 'wiki.spec.ts', test: 'saves a page at once with mod+enter and deletes a page from its row on the overview' },
  ],

  // widgets: editors and fields
  'editor:submit': { file: 'comments.spec.ts', test: 'writes a comment with m and mod+enter' },
  // Escape in the title field of the item leaves it and takes the typed text back
  'editor:leave': { file: 'items.spec.ts', test: 'edits the title with e' },
  'editor:mention': { file: 'editor.spec.ts', test: 'mentions over @ and refers over #' },
  'editor:reference': { file: 'editor.spec.ts', test: 'mentions over @ and refers over #' },
  'editor:list_take': { file: 'editor.spec.ts', test: 'mentions over @ and refers over #' },
  'editor:slash': { file: 'editor.spec.ts', test: 'inserts a table over /, moves and closes the list with the keyboard and edits the table from alt+F10' },
  'editor:list_move': { file: 'editor.spec.ts', test: 'inserts a table over /, moves and closes the list with the keyboard and edits the table from alt+F10' },
  'editor:list_close': { file: 'editor.spec.ts', test: 'inserts a table over /, moves and closes the list with the keyboard and edits the table from alt+F10' },
  'editor:table_menu': { file: 'editor.spec.ts', test: 'inserts a table over /, moves and closes the list with the keyboard and edits the table from alt+F10' },
  'editor:image_alt': { file: 'editor.spec.ts', test: 'edits the alternative text of a pasted image with Enter' },
};

/**
 * The flows of chapters 4 and 5.2 of the spec (signing in to the system page), each done with the keyboard only by a
 * Playwright test: `flow` names it in words. A flow with several proofs (one per width) stands once per proof.
 */
export const FLOW_TESTS: ({ flow: string } & Proof)[] = [
  // signing in, the way back in, invitations
  { flow: 'sign in and out', file: 'login.spec.ts', test: 'signs in and out with the keyboard only, in English' },
  { flow: 'sign in with a second factor', file: 'two-factor.spec.ts', test: 'asks for the code after the password and signs in with it' },
  { flow: 'reset a forgotten password', file: 'password-reset.spec.ts', test: 'answers an unknown address like a known one, then sets a new password from the mail' },
  { flow: 'accept an invitation', file: 'invitation.spec.ts', test: 'accepts an invitation with the keyboard only' },

  // projects and catalogs
  { flow: 'create a project', file: 'projects.spec.ts', test: 'creates a project with the keyboard from the sidebar' },
  { flow: 'add a member', file: 'onboarding.spec.ts', test: 'invites a person who joins, gets a project and finds it' },
  { flow: 'create a workflow with a matrix', file: 'workflows.spec.ts', test: 'creates a workflow with a transition matrix' },
  { flow: 'create a type with a required property', file: 'types-properties.spec.ts', test: 'creates a dropdown property and a type that requires it' },

  // the item: create it, change its fields, its relations, texts and files
  { flow: 'create an item', file: 'create-item.spec.ts', test: 'creates an item of a type with a required property' },
  { flow: 'change the status', file: 'items.spec.ts', test: 'sets a closing status with the resolution prefilled' },
  // the palette with a on the desktop, the field editors on the phone (spec 5.1): both with the keyboard
  { flow: 'change the assignee', file: 'items.spec.ts', test: 'changes assignee and priority with a and p', projects: EVERYWHERE },
  { flow: 'change the priority', file: 'bulk.spec.ts', test: 'selects three items with x and sets their priority with p' },
  // in addition: one item from its page (on the phone the test returns after the assignee)
  { flow: 'change the priority', file: 'items.spec.ts', test: 'changes assignee and priority with a and p', projects: DESKTOP },
  { flow: 'change the labels', file: 'items.spec.ts', test: 'assigns with i and a, sets a label with l and the dates with shift+d and d' },
  { flow: 'change the dates', file: 'items.spec.ts', test: 'assigns with i and a, sets a label with l and the dates with shift+d and d' },
  { flow: 'change the type', file: 'items.spec.ts', test: 'changes the type with t through the dialog and the parent with shift+p' },
  { flow: 'change the parent', file: 'items.spec.ts', test: 'changes the type with t through the dialog and the parent with shift+p' },
  { flow: 'add a relation', file: 'item-sections.spec.ts', test: 'relates two items with r and removes the relation again' },
  { flow: 'remove a relation', file: 'item-sections.spec.ts', test: 'relates two items with r and removes the relation again' },
  { flow: 'edit the description', file: 'item-description.spec.ts', test: 'writes a heading and a checklist with Markdown shortcuts' },
  { flow: 'write a comment', file: 'comments.spec.ts', test: 'writes a comment with m and mod+enter' },
  { flow: 'edit a comment', file: 'comments.spec.ts', test: 'edits and deletes a comment with undo (mod+z)' },
  { flow: 'delete a comment', file: 'comments.spec.ts', test: 'edits and deletes a comment with undo (mod+z)' },
  { flow: 'react to a comment', file: 'comments.spec.ts', test: 'reacts with an emoji from the picker and takes it back' },
  { flow: 'paste an image into a comment', file: 'comments.spec.ts', test: 'pastes an image into a comment and sends it with mod+enter' },
  { flow: 'paste an image', file: 'editor.spec.ts', test: 'pastes an image into the description and shows it after a reload' },
  { flow: 'upload a file', file: 'attachments.spec.ts', test: 'uploads a file to the list and downloads it' },
  { flow: 'download a file', file: 'attachments.spec.ts', test: 'uploads a file to the list and downloads it' },
  { flow: 'edit a table in the editor', file: 'editor.spec.ts', test: 'inserts a table over /, moves and closes the list with the keyboard and edits the table from alt+F10' },
  { flow: 'edit several items at once', file: 'bulk.spec.ts', test: 'selects three items with x and sets their priority with p' },
  { flow: 'archive with undo', file: 'bulk.spec.ts', test: 'selects a range with shift+x, archives with mod+backspace and undoes with mod+z' },
  { flow: 'delete with undo', file: 'items.spec.ts', test: 'deletes an item with mod+backspace and undoes it with mod+z' },

  // lists and their layouts
  { flow: 'filter a list', file: 'filter.spec.ts', test: 'filters by priority with f' },
  { flow: 'save a list as a view', file: 'views-acceptance.spec.ts', test: 'filters with f, saves as a view, stars it and opens it from the sidebar' },
  { flow: 'move a card on the board', file: 'board.spec.ts', test: 'moves a card with shift+arrow to the next allowed column' },
  { flow: 'move a card where the ranks ran out', file: 'board.spec.ts', test: 'moves a card where the ranks ran out' },
  { flow: 'edit a cell of the table', file: 'table.spec.ts', test: 'edits the priority of an item in the table with the keyboard' },
  { flow: 'move an epic on the timeline', file: 'timeline.spec.ts', test: 'moves an epic by a week with shift+right at month zoom' },
  { flow: 'plan an epic on the timeline', file: 'timeline.spec.ts', test: 'plans an epic without dates from the side list' },

  // search, inbox, notifications
  { flow: 'search from the palette', file: 'search.spec.ts', test: 'Flow 1: finds the item over the palette and closes it with the resolution set' },
  { flow: 'jump to an item by its key', file: 'search.spec.ts', test: 'jumps to an item over its former key' },
  { flow: 'work the inbox', file: 'inbox.spec.ts', test: 'works the inbox with the keyboard only' },
  { flow: 'set the notifications', file: 'notification-settings.spec.ts', test: 'switches mail off for comments with the keyboard and keeps it after a reload' },

  // the wiki (the tests branch on isPhone for the tree beside a page only, the flow itself runs on every width)
  { flow: 'create a wiki page', file: 'wiki.spec.ts', test: 'creates a page with the keyboard: New page, then the title typed over', projects: EVERYWHERE },
  { flow: 'edit a wiki page', file: 'wiki.spec.ts', test: 'types into a page, saves by itself and keeps the text after reloading' },
  { flow: 'move a wiki page', file: 'wiki.spec.ts', test: 'moves a page with Verschieben nach … and deletes a subtree with undo', projects: EVERYWHERE },
  { flow: 'delete a wiki page', file: 'wiki.spec.ts', test: 'moves a page with Verschieben nach … and deletes a subtree with undo', projects: EVERYWHERE },
  { flow: 'open a wiki page of an item', file: 'item-sections.spec.ts', test: 'opens a wiki page that names the item from its section' },
  { flow: 'restore a page version', file: 'wiki.spec.ts', test: 'opens the versions with the keyboard and restores one' },

  // templates, automations, webhooks
  { flow: 'create a template', file: 'templates.spec.ts', test: 'creates a template with the keyboard and runs it now' },
  { flow: 'run a template', file: 'templates.spec.ts', test: 'creates a template with the keyboard and runs it now' },
  // changes a schedule that came over the API; the next test switches one on
  { flow: 'set a schedule', file: 'templates.spec.ts', test: 'shows the next five runs of a monthly schedule on the first Monday' },
  { flow: 'switch a schedule on', file: 'templates.spec.ts', test: 'switches a schedule on in the editor and saves it' },
  { flow: 'link a referenced item', file: 'automations.spec.ts', test: 'relates an item it references, keyboard only' },
  { flow: 'switch an automation', file: 'automations.spec.ts', test: 'switches Assignee beim Start on with the keyboard; a person who starts an item becomes its assignee' },
  { flow: 'create a webhook', file: 'webhooks.spec.ts', test: 'creates a webhook with the keyboard, copies its secret once and pings the receiver' },
  { flow: 'redeliver a webhook delivery', file: 'webhooks.spec.ts', test: 'sends a delivery of the log again with the keyboard' },
  { flow: 'ping a webhook', file: 'webhooks.spec.ts', test: 'creates a webhook with the keyboard, copies its secret once and pings the receiver' },

  // settings
  { flow: 'create a token', file: 'settings-personal.spec.ts', test: 'creates a token, copies it and revokes it' },
  { flow: 'set up a second factor', file: 'settings-personal.spec.ts', test: 'sets up two-factor sign-in with a real code and turns it off again' },
  { flow: 'change the organization', file: 'settings-organization.spec.ts', test: 'changes the name of the organization with the keyboard' },
  { flow: 'open the system page', file: 'system.spec.ts', test: 'opens the system page with the keyboard and sends a test mail that arrives in Mailpit' },
  { flow: 'retry failed jobs', file: 'system.spec.ts', test: 'retries the failed jobs with the keyboard' },

  // the shell: from md on the sidebar folds to the rail, below md it is the drawer
  { flow: 'change the theme', file: 'shell.spec.ts', test: 'switches the theme from the profile menu and keeps it after reload' },
  { flow: 'open and close the sidebar', file: 'shell.spec.ts', test: 'collapses the sidebar to the rail and back' },
  { flow: 'open and close the sidebar', file: 'shell.spec.ts', test: 'opens the navigation drawer on the phone' },

  // beyond the list of Task 17b: more of chapters 4 and 5.2 that a keyboard-only test already goes through
  { flow: 'invite a person', file: 'settings-organization.spec.ts', test: 'invites a person, copies the link and shows it in the list' },
  { flow: 'create a bot with a token', file: 'settings-organization.spec.ts', test: 'creates a bot, a token for it, and revokes it' },
  { flow: 'change the profile', file: 'settings-personal.spec.ts', test: 'changes name and handle in the profile' },
  { flow: 'create a label', file: 'catalogs.spec.ts', test: 'creates, renames and deletes a label with undo' },
  { flow: 'create a relation type', file: 'catalogs.spec.ts', test: 'creates a symmetric relation type and cannot delete a built-in one' },
  { flow: 'create a resolution', file: 'catalogs.spec.ts', test: 'creates a resolution and archives it' },
  { flow: 'switch the workflow of a project', file: 'state-mapping.spec.ts', test: 'switches the workflow of a project and maps its states' },
  { flow: 'apply a template in the dialog', file: 'create-item.spec.ts', test: 'applies a template in the dialog and creates the item with a copy of its image' },
  { flow: 'create several items in a row', file: 'create-item.spec.ts', test: 'creates several items in a row with another one' },
  { flow: 'change the display of a list', file: 'views-save.spec.ts', test: 'changes the grouping of a view, sees it as unsaved and discards it' },
  { flow: 'change the password', file: 'settings-personal.spec.ts', test: 'changes the password and signs in with the new one' },
  { flow: 'change the role of a person', file: 'settings-organization.spec.ts', test: 'changes the role of a person and back' },
  { flow: 'duplicate a workflow', file: 'workflows.spec.ts', test: 'duplicates a workflow and deletes the copy with undo' },
  { flow: 'switch on a type for a project', file: 'project-catalog.spec.ts', test: 'switches a type on and makes it the default' },
  { flow: 'archive and restore a project', file: 'projects.spec.ts', test: 'archives and restores a project' },
  { flow: 'delete a project', file: 'projects.spec.ts', test: 'deletes a project after typing its identifier' },
  { flow: 'create a child item', file: 'create-item.spec.ts', test: 'creates a child item of an epic from its children section' },
  { flow: 'restore an archived item', file: 'items.spec.ts', test: 'archives a done item and restores it' },
  { flow: 'create an item on the board', file: 'board.spec.ts', test: 'creates an item with the quick add of a column' },
  { flow: 'star a view', file: 'views.spec.ts', test: 'stars a view and opens it from the sidebar' },
  { flow: 'paste an image into a wiki page', file: 'wiki.spec.ts', test: 'pastes an image into a page' },
];

/**
 * A mouse call inside a test of the manifest that the test does not prove: `call` is the text of the call as it stands
 * in the test. Never for the key or flow the entry names.
 */
export const MOUSE_ALLOWED: { file: string; test: string; call: string; reason: string }[] = [];

/**
 * A write over the API (`createItem`, `api(page, 'POST', …)`, `artisan`, …) inside a proof of a flow after its first key,
 * outside `finally`: `call` is the text as it stands in the test. Never the flow itself done over the API.
 */
export const API_AFTER: { file: string; test: string; call: string; reason: string }[] = [
  // the flow is the switch; the item and its move show what the switched automation does
  {
    file: 'automations.spec.ts',
    test: 'switches Assignee beim Start on with the keyboard; a person who starts an item becomes its assignee',
    call: "createItem(page, { project_id: project.id, title: 'E2E Startseite bauen' })",
    reason: 'the item the switched automation acts on, after the switch (the flow)',
  },
  {
    file: 'automations.spec.ts',
    test: 'switches Assignee beim Start on with the keyboard; a person who starts an item becomes its assignee',
    call: "move(page, item.id, 'In Progress')",
    reason: 'starts the item over the API to show that the switched automation assigns it',
  },
];

/** Projects where nothing proves a key, with the reason (a phone has no such widget, …). */
export const PROJECT_GAPS: { key: string; projects: string[]; reason: string }[] = [];

/**
 * Keys and flows without a keyboard-only test: `test` says what the missing test would do. A name with a space is a flow
 * of `FLOW_TESTS`, one without a key of the catalog or the widgets. Task 18 closed every gap; keyboard-flows.test.mjs
 * keeps it empty ("has no gaps"): a new key or flow comes with its test.
 */
export const GAPS: Record<string, { file: 'TODO'; test: string }> = {};
