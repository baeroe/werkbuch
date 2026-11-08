/*
 * The keyboard manifest (A442, K16): success criterion 6 says every flow works without a mouse and Playwright checks it.
 * This file names, for every id of the shortcut catalog (resources/js/lib/shortcuts/catalog.ts) and every key of a widget
 * (widgets.ts, as `<group>:<label>` with the last parts of their translation keys), the Playwright test that presses it
 * with the keyboard only. scripts/keyboard-flows.test.mjs keeps it complete and honest: it reads catalog and widgets as
 * text (this file imports nothing of the app), checks that the spec and the title exist, that the body of the test uses
 * no mouse (`.click(`, `.hover(`, `.dragTo(`, `.tap(`, `page.mouse`, also through a helper of the spec), and that a test
 * which skips a project proves nothing there.
 *
 * A new shortcut, widget key or flow needs its entry here in the same commit: a test, or for now a gap.
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
  // on the phone the test sets the assignee through the field editors (spec 5.1)
  'item.assignee': { file: 'items.spec.ts', test: 'changes assignee and priority with a and p', projects: DESKTOP },
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

  // the inbox
  'inbox.read': { file: 'inbox.spec.ts', test: 'works the inbox with the keyboard only' },
  'inbox.unread': { file: 'inbox.spec.ts', test: 'works the inbox with the keyboard only' },
  'inbox.read_all': { file: 'inbox.spec.ts', test: 'works the inbox with the keyboard only' },
  'inbox.delete': { file: 'inbox.spec.ts', test: 'works the inbox with the keyboard only' },

  // wiki, templates, preview
  'wiki.delete': { file: 'wiki.spec.ts', test: 'moves a page with Verschieben nach … and deletes a subtree with undo', projects: EVERYWHERE },
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

  // widgets: group headers (← on a row goes to its header, Enter folds and unfolds)
  'groups:collapse': { file: 'items-list.spec.ts', test: 'collapses a group from the keyboard' },
  'groups:toggle': { file: 'items-list.spec.ts', test: 'collapses a group from the keyboard' },

  // widgets: the page tree of the wiki (on the overview it shows on every width)
  'tree:move': { file: 'wiki.spec.ts', test: 'opens the wiki from the sidebar and walks the tree with the keyboard', projects: EVERYWHERE },
  'tree:expand': { file: 'wiki.spec.ts', test: 'opens the wiki from the sidebar and walks the tree with the keyboard', projects: EVERYWHERE },
  'tree:collapse': { file: 'wiki.spec.ts', test: 'opens the wiki from the sidebar and walks the tree with the keyboard', projects: EVERYWHERE },
  'tree:edge': { file: 'wiki.spec.ts', test: 'opens the wiki from the sidebar and walks the tree with the keyboard', projects: EVERYWHERE },
  'tree:open': { file: 'wiki.spec.ts', test: 'opens the wiki from the sidebar and walks the tree with the keyboard', projects: EVERYWHERE },
  // beside a page the tree shows from lg on; the test deletes from a row there only
  'tree:delete': { file: 'wiki.spec.ts', test: 'moves a page with Verschieben nach … and deletes a subtree with undo', projects: DESKTOP },

  // widgets: editors and fields
  'editor:submit': { file: 'comments.spec.ts', test: 'writes a comment with m and mod+enter' },
  // Escape in the title field of the item leaves it and takes the typed text back
  'editor:leave': { file: 'items.spec.ts', test: 'edits the title with e' },
  'editor:mention': { file: 'editor.spec.ts', test: 'mentions over @ and refers over #' },
  'editor:reference': { file: 'editor.spec.ts', test: 'mentions over @ and refers over #' },
  'editor:list_take': { file: 'editor.spec.ts', test: 'mentions over @ and refers over #' },
};

/**
 * A mouse call inside a test of the manifest that the test does not prove: `call` is the text of the call as it stands
 * in the test. Never for the key or flow the entry names.
 */
export const MOUSE_ALLOWED: { file: string; test: string; call: string; reason: string }[] = [];

/** Projects where nothing proves a key, with the reason (a phone has no such widget, …). */
export const PROJECT_GAPS: { key: string; projects: string[]; reason: string }[] = [
  {
    key: 'item.assignee',
    projects: PHONE,
    reason: 'the phone branch of the test assigns through the field editors (spec 5.1); a keyboard test of a on the phone is open for Task 18',
  },
  {
    key: 'tree:delete',
    projects: PHONE,
    reason: 'below lg the tree shows on the overview only, the test presses mod+backspace on a row beside a page; open for Task 18',
  },
];

/** Keys without a keyboard-only test yet: `test` says what the missing test does. Task 18 closes them. */
export const GAPS: Record<string, { file: 'TODO'; test: string }> = {
  'item.assign_me': { file: 'TODO', test: 'i assigns the item of the page (or the cursor) to oneself' },
  'item.labels': { file: 'TODO', test: 'l opens the labels of the item in the palette and sets one' },
  'item.type': { file: 'TODO', test: 't changes the type of an item, with the dialog for lost values' },
  'item.due': { file: 'TODO', test: 'd sets the due date from the palette' },
  'item.start': { file: 'TODO', test: 'shift+d sets the start date from the palette' },
  'item.parent': { file: 'TODO', test: 'shift+p sets the parent epic from the palette' },
  'list.next_arrow': { file: 'TODO', test: '↓ moves the cursor of a list' },
  'list.prev_arrow': { file: 'TODO', test: '↑ moves the cursor of a list' },
  'list.extend_next': { file: 'TODO', test: 'shift+j extends the selection of a list' },
  'list.extend_next_arrow': { file: 'TODO', test: 'shift+↓ extends the selection of a list' },
  'list.extend_prev': { file: 'TODO', test: 'shift+k extends the selection of a list' },
  'list.extend_prev_arrow': { file: 'TODO', test: 'shift+↑ extends the selection of a list' },
  'list.select_all': { file: 'TODO', test: 'mod+a selects every item of a list, also on pages not loaded yet' },
  'list.clear': { file: 'TODO', test: 'Escape clears the selection of a list and the bulk bar goes' },
  'board.column_prev': { file: 'TODO', test: '← moves the cursor of the board to the column before' },
  'board.column_next': { file: 'TODO', test: '→ moves the cursor of the board to the next column' },
  'list.shorter': { file: 'TODO', test: 'alt+← moves the due date of an epic on the timeline one unit earlier' },
  'list.longer': { file: 'TODO', test: 'alt+→ moves the due date of an epic on the timeline one unit later' },
  'wiki.save': { file: 'TODO', test: 'mod+enter saves a wiki page at once' },
  'table:extend': { file: 'TODO', test: 'shift+↑/↓ in the grid of the table extends the selection' },
  'table:edge_column': { file: 'TODO', test: 'Home/End in the grid go to the first and last column' },
  'table:edge_row': { file: 'TODO', test: 'mod+Home/End in the grid go to the first and last row' },
  'groups:expand': { file: 'TODO', test: '→ on a group header unfolds it, a second → goes to its first row' },
  'groups:header': { file: 'TODO', test: '↑/↓ on a group header go to the previous and next header' },
  'editor:slash': { file: 'TODO', test: '/ in an editor opens the block menu and inserts a block with the keyboard' },
  'editor:list_move': { file: 'TODO', test: '↑/↓ choose an entry of the @, # or / list' },
  'editor:list_close': { file: 'TODO', test: 'Escape closes the @, # or / list and keeps the text' },
  'editor:image_alt': { file: 'TODO', test: 'Enter on a selected image edits its alternative text' },
  // the test of Task 21s ('edits a table with the keyboard only', editor.spec.ts) waits for Rafael's OK (Task 17b)
  'editor:table_menu': { file: 'TODO', test: 'alt+F10 opens the menu of the table and adds a row with the keyboard' },
};
