/*
 * The catalogs of the organisation: labels, relation types and resolutions (spec 4.7, 4.9). Only org admins change
 * them.
 */

import type { Label, RelationType, Resolution } from '@/types';
import type { Page, PageArgs } from './client';
import { del, getPage, saveOne } from './http';

type SaveInput<T extends { id: string }> = Omit<T, 'id'> & { id?: string };

/** The id names the resource and stays out of the body. */
function save<T extends { id: string }>(path: string, { id, ...body }: SaveInput<T>): Promise<T> {
  return saveOne<T>(path, id, body);
}

/* ----------------------------------------------------------------------- labels */

export function listLabels(args: PageArgs = {}): Promise<Page<Label>> {
  return getPage<Label>('/labels', { ...args });
}

export function saveLabel(input: SaveInput<Label>): Promise<Label> {
  return save<Label>('/labels', input);
}

/** The answer is `{ affected_items }` without `data`. */
export function deleteLabel(id: string): Promise<{ affected_items: number }> {
  return del<{ affected_items: number }>(`/labels/${encodeURIComponent(id)}`);
}

/* -------------------------------------------------------------- relation types */

export function listRelationTypes(args: PageArgs = {}): Promise<Page<RelationType>> {
  return getPage<RelationType>('/relation-types', { ...args });
}

export function saveRelationType(input: SaveInput<RelationType>): Promise<RelationType> {
  return save<RelationType>('/relation-types', input);
}

/** The answer is `{ affected_relations }` without `data`; the built-in types cannot be deleted (409 `built_in`). */
export function deleteRelationType(id: string): Promise<{ affected_relations: number }> {
  return del<{ affected_relations: number }>(`/relation-types/${encodeURIComponent(id)}`);
}

/* ------------------------------------------------------------------ resolutions */

/** All resolutions, archived ones included. */
export function listResolutions(args: PageArgs = {}): Promise<Page<Resolution>> {
  return getPage<Resolution>('/resolutions', { ...args });
}

export function saveResolution(input: SaveInput<Resolution>): Promise<Resolution> {
  return save<Resolution>('/resolutions', input);
}

/** The answer is `{ outcome }` without `data`. */
export function deleteResolution(id: string): Promise<{ outcome: 'deleted' | 'archived' }> {
  return del<{ outcome: 'deleted' | 'archived' }>(`/resolutions/${encodeURIComponent(id)}`);
}
