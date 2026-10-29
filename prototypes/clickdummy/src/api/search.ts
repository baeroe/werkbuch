/*
 * Search and the command palette's data (spec 4.17): items, wiki pages, projects, people and views, always limited to
 * the projects the signed-in account sees. A key like `WEB-47` finds its item at once. Every word of the query must
 * occur somewhere in the text; matches in the title and at its start rank first.
 */

import { parseKey } from '@/domain/keys';
import { plainText } from '@/lib/richtext';
import type { Project, SearchResults, User, View, WorkItem } from '@/types';
import { visibleProjects } from './access';
import { read } from './client';
import type { Db } from './db';
import { findItem, itemResource } from './lookup';

const LIMIT = 20;

/**
 * How well the text matches: null when a word is missing, 0 (best) when one of the `starts` begins with the first
 * word (the title, the key), otherwise 1.
 */
function score(text: string, terms: string[], starts: string[] = [text]): number | null {
  if (!terms.every((term) => text.toLowerCase().includes(term))) return null;
  return starts.some((start) => start.toLowerCase().startsWith(terms[0])) ? 0 : 1;
}

function rank<T>(entries: { entry: T; rank: number; order: number }[]): T[] {
  return entries
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, LIMIT)
    .map(({ entry }) => entry);
}

function searchItems(db: Db, scope: Set<string>, terms: string[], query: string): WorkItem[] {
  const commentText = new Map<string, string>();
  for (const comment of db.comments) {
    commentText.set(comment.work_item_id, `${commentText.get(comment.work_item_id) ?? ''} ${plainText(comment.body)}`);
  }
  const projectOrder = new Map(db.projects.map((project, index) => [project.id, index]));

  const exact = parseKey(query) ? findItem(db, query) : undefined;
  const found = db.items.flatMap((item) => {
    if (!scope.has(item.project_id) || item.archived_at !== null) return [];
    const inTitle = score(`${item.key} ${item.title}`, terms, [item.title, item.key]);
    const inBody = score(`${plainText(item.description)} ${commentText.get(item.id) ?? ''}`, terms);
    const own = item.id === exact?.id ? -1 : inTitle === null ? (inBody === null ? null : 2) : inTitle;
    // matches in the title beat matches in the text; newer items of a project first
    return own === null ? [] : [{ entry: item, rank: own, order: (projectOrder.get(item.project_id) ?? 0) * 100_000 - item.number }];
  });
  return rank(found).map((item) => itemResource(db, item));
}

export function search(q: string): Promise<SearchResults> {
  return read(({ db, me }) => {
    const query = q.trim();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return { items: [], pages: [], projects: [], people: [], views: [] };

    const projects = visibleProjects(db, me);
    const scope = new Set(projects.map((project) => project.id));
    const projectOrder = new Map(db.projects.map((project, index) => [project.id, index]));

    const pages = rank(
      db.pages.flatMap((page) => {
        if (!scope.has(page.project_id)) return [];
        const inTitle = score(page.title, terms);
        const inBody = score(plainText(page.content), terms);
        const own = inTitle ?? (inBody === null ? null : 2);
        return own === null ? [] : [{ entry: page, rank: own, order: (projectOrder.get(page.project_id) ?? 0) * 1000 + page.title.length }];
      }),
    );
    const matchingProjects: Project[] = rank(
      projects.flatMap((project) => {
        const own = score(`${project.identifier} ${project.name} ${project.description}`, terms);
        return own === null ? [] : [{ entry: project, rank: own, order: projectOrder.get(project.id) ?? 0 }];
      }),
    );
    const people: User[] = rank(
      db.users.flatMap((user, index) => {
        if (user.disabled_at !== null) return [];
        const own = score(`${user.name} ${user.handle}`, terms);
        return own === null ? [] : [{ entry: user, rank: own, order: index }];
      }),
    );
    const views: View[] = rank(
      db.views.flatMap((view, index) => {
        const own = score(view.name, terms);
        return own === null ? [] : [{ entry: view, rank: own, order: index }];
      }),
    );
    return { items: searchItems(db, scope, terms, query), pages, projects: matchingProjects, people, views } satisfies SearchResults;
  });
}
