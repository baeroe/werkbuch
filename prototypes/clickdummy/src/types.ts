/*
 * Shared domain types. Task 1 starts the file with the base types the component set needs;
 * Task 2 adds the rest (organisation, projects, workflows, work items, views, templates …).
 */

/** Status category: decides the colour of a status (DESIGN.md: colour = category, shape = status). */
export type StateCategory = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

/** Shape of a status icon, from a fixed set. */
export type StateIcon = 'dashed' | 'circle' | 'half' | 'three-quarter' | 'pause' | 'check' | 'cross';

export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

/** Muted tones for type tabs, labels and dropdown options (light and dark variants in tokens.css). */
export type TypeTone = 'sky' | 'ochre' | 'moss' | 'plum' | 'sand' | 'slate';
