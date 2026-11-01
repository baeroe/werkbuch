/*
 * The item commands of the palette and their shortcuts (spec 5.3), shared by the item page and the preview (the
 * lists join with Phase 5). `useItemCommands` mounts them (contract in `useItemCommands.ts`), `context.ts` decides the
 * targets, `options.ts` builds the sub-lists, `actions.ts` changes, archives and deletes (also for the item page's
 * header), `register.ts` registers commands and shortcuts.
 */

export { archiveWithUndo, deleteWithUndo, useRemovalDeps, type RemovalDeps } from './actions';
export type { ItemCommandContext, ItemCommandScope, ItemCommandSource, ItemCommandsOptions } from './context';
export { datePresets } from './options';
export { PreviewItemCommands } from './PreviewItemCommands';
export { registerItemCommands } from './register';
export { useItemCommands } from './useItemCommands';
