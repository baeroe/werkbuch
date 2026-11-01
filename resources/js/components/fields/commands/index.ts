/*
 * The item commands of the palette and their shortcuts (spec 5.3), shared by the item page, the preview and the
 * lists. `useItemCommands` mounts them (contract in `useItemCommands.ts`), `context.ts` decides the targets,
 * `options.ts` builds the sub-lists, `actions.ts` changes, archives and deletes (also for the item page's header and
 * the bulk bar), `register.ts` registers commands and shortcuts.
 */

export { archiveTargets, archiveWithUndo, deleteWithUndo, useRemovalDeps, type RemovalDeps } from './actions';
export { closedIn } from './context';
export type { ItemCommandContext, ItemCommandScope, ItemCommandSource, ItemCommandsOptions } from './context';
export { datePresets } from './options';
export { PreviewItemCommands } from './PreviewItemCommands';
export { registerItemCommands } from './register';
export { useItemCommands } from './useItemCommands';
