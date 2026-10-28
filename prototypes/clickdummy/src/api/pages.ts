/*
 * The wiki of a project (spec 4.15): a tree of pages, saved with the version they are based on, no live editing.
 * A save on top of an outdated version is refused with 409 `page_conflict` and the stored page. Versions are kept
 * after a pause of ten minutes and before a foreign version is overwritten.
 */

import { rankBetween } from '@/domain/rank';
import { requireRole, requireWritable } from './access';
import { clone, conflict, FieldErrors, invalid, newId, notFound, paginate, read, write, type Ctx, type Page } from './client';
import { saveDb, type Db } from './db';
import { recordEvent } from './events';
import { findProject, userName } from './lookup';
import { textDoc } from '@/lib/richtext';
import type { Page as WikiPage, PageNode, PageVersion, RichText } from '@/types';

/** Ten minutes without an edit and the state is kept as a version (spec 4.15). */
const PAUSE_MS = 10 * 60_000;
const MAX_TITLE = 200;

function requirePage(db: Db, me: Ctx['me'], id: string): { page: WikiPage; projectId: string } {
  const page = db.pages.find((entry) => entry.id === id);
  const project = page && db.projects.find((entry) => entry.id === page.project_id);
  if (!page || !project) throw notFound('Die Seite');
  requireRole(db, me, project, 'viewer');
  return { page, projectId: project.id };
}

function bySibling(a: WikiPage, b: WikiPage): number {
  return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
}

/** The tree of a project: top-level pages with their children, by rank, without content. */
export function listPages(project_id: string): Promise<Page<PageNode>> {
  return read(({ db, me }) => {
    const project = findProject(db, project_id);
    if (!project) throw notFound('Das Projekt');
    requireRole(db, me, project, 'viewer');

    const pages = db.pages.filter((page) => page.project_id === project.id);
    const build = (parentId: string | null): PageNode[] =>
      pages
        .filter((page) => page.parent_id === parentId)
        .sort(bySibling)
        .map(({ content: _content, simulate_conflict_once: _simulate, ...rest }) => ({ ...rest, children: build(rest.id) }));
    return { items: build(null), next_cursor: null, total: pages.length };
  });
}

export function getPage(id: string): Promise<WikiPage> {
  return read(({ db, me }) => requirePage(db, me, id).page);
}

export interface CreatePageInput {
  project_id: string;
  parent_id?: string | null;
  title: string;
  emoji?: string | null;
  content?: RichText | null;
}

/** A new page at the end of its siblings. */
export function createPage(input: CreatePageInput): Promise<WikiPage> {
  return write((ctx) => {
    const { db, me, stamp } = ctx;
    const project = findProject(db, input.project_id);
    if (!project) throw notFound('Das Projekt');
    requireWritable(db, me, project, 'member', 'Das Wiki bearbeiten nur Member und Admins des Projekts.');

    const errors = new FieldErrors();
    const title = input.title.trim();
    if (title === '') errors.add('title', 'Der Titel darf nicht leer sein.');
    else if (title.length > MAX_TITLE) errors.add('title', `Der Titel darf höchstens ${MAX_TITLE} Zeichen haben.`);
    if (input.parent_id && !db.pages.some((page) => page.id === input.parent_id && page.project_id === project.id)) {
      errors.add('parent_id', 'Die übergeordnete Seite gibt es nicht.');
    }
    errors.throwIfAny();

    const siblings = db.pages.filter((page) => page.project_id === project.id && page.parent_id === (input.parent_id ?? null)).sort(bySibling);
    const page: WikiPage = {
      id: newId('pg'),
      project_id: project.id,
      parent_id: input.parent_id ?? null,
      rank: rankBetween(siblings.at(-1)?.rank ?? null, null),
      title,
      emoji: input.emoji ?? null,
      content: input.content ? clone(input.content) : null,
      version: 1,
      created_by: me.id,
      created_at: stamp,
      updated_by: me.id,
      updated_at: stamp,
    };
    db.pages.push(page);
    recordEvent(ctx, { type: 'page.created', actor_id: me.id, subject: { type: 'page', id: page.id }, project_id: project.id });
    return page;
  });
}

/** Keeps the current state of a page as a version, unless that state is kept already. */
function snapshot(db: Db, page: WikiPage): void {
  if (db.page_versions.some((version) => version.page_id === page.id && version.version === page.version)) return;
  db.page_versions.push({
    id: newId('pv'),
    page_id: page.id,
    version: page.version,
    title: page.title,
    content: clone(page.content),
    author_id: page.updated_by,
    created_at: page.updated_at,
  });
}

export interface SavePageInput {
  title: string;
  emoji: string | null;
  content: RichText | null;
  /** The version the client edited. */
  base_version: number;
}

/**
 * Saves a page. When somebody else saved in the meantime (`base_version` is not the stored version) the answer is
 * 409 `page_conflict` with `{ current }`; the client may then reload or save again on top of `current.version` to
 * take its own text, which keeps the foreign version first. "Seitenstruktur" of the demo reports a conflict once on
 * the first save, as if a colleague had saved just before.
 */
export function savePage(id: string, input: SavePageInput): Promise<WikiPage> {
  return write((ctx) => {
    const { db, me, stamp, now } = ctx;
    const { page, projectId } = requirePage(db, me, id);
    const project = db.projects.find((entry) => entry.id === projectId)!;
    requireWritable(db, me, project, 'member', 'Das Wiki bearbeiten nur Member und Admins des Projekts.');

    const title = input.title.trim();
    if (title === '') throw invalid({ title: ['Der Titel darf nicht leer sein.'] });
    if (title.length > MAX_TITLE) throw invalid({ title: [`Der Titel darf höchstens ${MAX_TITLE} Zeichen haben.`] });

    if (page.simulate_conflict_once && input.base_version === page.version) {
      // a colleague "saved just before": the stored page moves on and this save is refused once
      delete page.simulate_conflict_once;
      const colleague = ['u_jonas', 'u_lene', 'u_ida'].find((candidate) => candidate !== me.id)!;
      page.content = {
        type: 'doc',
        content: [...(page.content?.content ?? []), ...(textDoc('Nachtrag: Die Referenzen kommen erst in Phase 2.').content ?? [])],
      };
      page.version += 1;
      page.updated_by = colleague;
      page.updated_at = stamp;
      saveDb(); // this change stays although the call fails
      throw conflict('page_conflict', `${userName(db, colleague)} hat die Seite inzwischen geändert.`, { current: page });
    }
    if (input.base_version !== page.version) {
      throw conflict('page_conflict', `${userName(db, page.updated_by)} hat die Seite inzwischen geändert.`, { current: page });
    }

    // a foreign version is kept before it is overwritten, and so is a state after a pause
    if (page.updated_by !== me.id || now.getTime() - Date.parse(page.updated_at) >= PAUSE_MS) snapshot(db, page);
    page.title = title;
    page.emoji = input.emoji;
    page.content = input.content ? clone(input.content) : null;
    page.version += 1;
    page.updated_by = me.id;
    page.updated_at = stamp;
    recordEvent(ctx, { type: 'page.updated', actor_id: me.id, subject: { type: 'page', id: page.id }, project_id: page.project_id });
    return page;
  });
}

/** Moves a page under `parent_id` (null: top level), in front of the sibling `before_id` (null: at the end). */
export function movePage(id: string, parent_id: string | null, before_id: string | null): Promise<WikiPage> {
  return write((ctx) => {
    const { db, me } = ctx;
    const { page, projectId } = requirePage(db, me, id);
    const project = db.projects.find((entry) => entry.id === projectId)!;
    requireWritable(db, me, project, 'member', 'Das Wiki bearbeiten nur Member und Admins des Projekts.');

    const errors = new FieldErrors();
    if (parent_id !== null) {
      const parent = db.pages.find((entry) => entry.id === parent_id);
      if (!parent || parent.project_id !== page.project_id) errors.add('parent_id', 'Die übergeordnete Seite gibt es nicht.');
      else {
        for (let cursor: WikiPage | undefined = parent; cursor; cursor = cursor.parent_id ? db.pages.find((entry) => entry.id === cursor?.parent_id) : undefined) {
          if (cursor.id === page.id) {
            errors.add('parent_id', 'Eine Seite lässt sich nicht in sich selbst oder ihren Unterbaum verschieben.');
            break;
          }
        }
      }
    }
    const siblings = db.pages
      .filter((entry) => entry.project_id === page.project_id && entry.parent_id === parent_id && entry.id !== page.id)
      .sort(bySibling);
    const beforeIndex = before_id === null ? siblings.length : siblings.findIndex((entry) => entry.id === before_id);
    if (beforeIndex < 0) errors.add('before_id', 'Diese Seite liegt nicht unter dem neuen Ziel.');
    errors.throwIfAny();

    page.parent_id = parent_id;
    page.rank = rankBetween(siblings[beforeIndex - 1]?.rank ?? null, siblings[beforeIndex]?.rank ?? null);
    recordEvent(ctx, { type: 'page.moved', actor_id: me.id, subject: { type: 'page', id: page.id }, project_id: page.project_id });
    return page;
  });
}

/** Deletes a page with all pages below it. Answers how many pages are gone. */
export function deletePage(id: string): Promise<{ deleted: number }> {
  return write((ctx) => {
    const { db, me } = ctx;
    const { page, projectId } = requirePage(db, me, id);
    const project = db.projects.find((entry) => entry.id === projectId)!;
    requireWritable(db, me, project, 'member', 'Das Wiki bearbeiten nur Member und Admins des Projekts.');

    const doomed = new Set<string>([page.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const entry of db.pages) {
        if (entry.parent_id !== null && doomed.has(entry.parent_id) && !doomed.has(entry.id)) {
          doomed.add(entry.id);
          grew = true;
        }
      }
    }
    db.pages = db.pages.filter((entry) => !doomed.has(entry.id));
    db.page_versions = db.page_versions.filter((version) => !doomed.has(version.page_id));
    db.attachments = db.attachments.filter((attachment) => !(attachment.owner?.type === 'page' && doomed.has(attachment.owner.id)));
    recordEvent(ctx, { type: 'page.deleted', actor_id: me.id, subject: { type: 'page', id: page.id }, project_id: projectId, changes: { pages: { old: doomed.size, new: 0 } } });
    return { deleted: doomed.size };
  });
}

/** The kept versions of a page, newest first. */
export function listPageVersions(page_id: string): Promise<Page<PageVersion>> {
  return read(({ db, me }) => {
    requirePage(db, me, page_id);
    return paginate(db.page_versions.filter((version) => version.page_id === page_id).sort((a, b) => b.version - a.version));
  });
}

/** Makes an earlier version the current text. This is a new version; the state it replaces is kept first. */
export function restorePageVersion(page_id: string, version_id: string): Promise<WikiPage> {
  return write((ctx) => {
    const { db, me, stamp } = ctx;
    const { page, projectId } = requirePage(db, me, page_id);
    const project = db.projects.find((entry) => entry.id === projectId)!;
    requireWritable(db, me, project, 'member', 'Das Wiki bearbeiten nur Member und Admins des Projekts.');
    const version = db.page_versions.find((entry) => entry.id === version_id && entry.page_id === page.id);
    if (!version) throw notFound('Die Version');

    snapshot(db, page);
    page.title = version.title;
    page.content = clone(version.content);
    page.version += 1;
    page.updated_by = me.id;
    page.updated_at = stamp;
    recordEvent(ctx, { type: 'page.updated', actor_id: me.id, subject: { type: 'page', id: page.id }, project_id: page.project_id, reason: `Version ${version.version} wiederhergestellt` });
    return page;
  });
}
