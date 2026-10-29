/*
 * Views and favorites (spec 4.11). A view belongs to the whole team and spans projects; everybody may create one,
 * only the creator and org admins change or delete it. Favorites are per person: views and projects in the sidebar.
 */

import type { Favorite, View } from '@/types';
import { canSeeProject, isOrgAdmin } from './access';
import { clone, FieldErrors, forbidden, newId, notFound, paginate, read, write, type Page } from './client';

export type ViewInput = Omit<View, 'id' | 'created_by' | 'created_at'> & { id?: string };

const LAYOUTS = ['list', 'board', 'table', 'timeline'] as const;
const GROUPS = ['state', 'category', 'assignee', 'priority', 'type', 'label', 'project', 'parent', 'none'] as const;

export function listViews(): Promise<Page<View>> {
  return read(({ db }) => paginate(db.views));
}

/** Creates a view (no id) or changes one (the creator or an org admin). Answers the saved view. */
export function saveView(input: ViewInput): Promise<View> {
  return write(({ db, me, stamp }) => {
    const existing = input.id ? db.views.find((view) => view.id === input.id) : undefined;
    if (input.id && !existing) throw notFound('Die View');
    if (existing && existing.created_by !== me.id && !isOrgAdmin(me)) {
      throw forbidden('Nur der Ersteller oder Org-Admins dürfen diese View ändern.');
    }

    const errors = new FieldErrors();
    if (input.name.trim() === '') errors.add('name', 'Der Name darf nicht leer sein.');
    if (!LAYOUTS.includes(input.display.layout)) errors.add('display.layout', 'Dieses Layout gibt es nicht.');
    if (!GROUPS.includes(input.display.group_by)) errors.add('display.group_by', 'Diese Gruppierung gibt es nicht.');
    if (input.filter.version !== 1 || !Array.isArray(input.filter.conditions)) errors.add('filter', 'Der Filter hat ein unbekanntes Format.');
    errors.throwIfAny();

    const view: View = {
      id: existing?.id ?? newId('v'),
      name: input.name.trim(),
      icon: input.icon,
      filter: clone(input.filter),
      display: clone(input.display),
      created_by: existing?.created_by ?? me.id,
      created_at: existing?.created_at ?? stamp,
    };
    if (existing) db.views[db.views.indexOf(existing)] = view;
    else db.views.push(view);
    return view;
  });
}

export function deleteView(id: string): Promise<void> {
  return write(({ db, me }) => {
    const view = db.views.find((entry) => entry.id === id);
    if (!view) throw notFound('Die View');
    if (view.created_by !== me.id && !isOrgAdmin(me)) throw forbidden('Nur der Ersteller oder Org-Admins dürfen diese View löschen.');
    db.views = db.views.filter((entry) => entry.id !== id);
    db.favorites = db.favorites.filter((favorite) => !(favorite.kind === 'view' && favorite.id === id));
  });
}

/** Puts a view or project into the sidebar of the signed-in person, or takes it out. Answers the new state. */
export function toggleFavorite({ kind, id }: { kind: Favorite['kind']; id: string }): Promise<{ kind: Favorite['kind']; id: string; favorite: boolean }> {
  return write(({ db, me }) => {
    if (kind === 'view' && !db.views.some((view) => view.id === id)) throw notFound('Die View');
    if (kind === 'project') {
      const project = db.projects.find((entry) => entry.id === id);
      if (!project || !canSeeProject(db, me, project)) throw notFound('Das Projekt');
    }

    const mine = db.favorites.filter((favorite) => favorite.user_id === me.id);
    const existing = mine.find((favorite) => favorite.kind === kind && favorite.id === id);
    if (existing) {
      db.favorites = db.favorites.filter((favorite) => favorite !== existing);
      return { kind, id, favorite: false };
    }
    db.favorites.push({ user_id: me.id, kind, id, position: Math.max(-1, ...mine.map((favorite) => favorite.position)) + 1 });
    return { kind, id, favorite: true };
  });
}

/** The favorites of the signed-in person, in the order of the sidebar. */
export function listFavorites(): Promise<Page<Favorite>> {
  return read(({ db, me }) =>
    paginate(
      db.favorites
        .filter((favorite) => favorite.user_id === me.id)
        // a project the person can no longer see drops out of the sidebar
        .filter((favorite) => favorite.kind === 'view' || canSeeProject(db, me, db.projects.find((project) => project.id === favorite.id)!))
        .sort((a, b) => a.position - b.position),
    ),
  );
}
