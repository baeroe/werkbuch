/*
 * Relations between work items (spec 4.9). They may cross projects; a person who may not see one end sees it as a
 * "verborgenes Item", also in the history. Only "blockiert" does something (the blocked item shows a hint); the other
 * types are labels. The events of a relation hold the id of the other item, not its key: what a reader gets to see of
 * it is decided when they read (`listActivity`), and a renamed project does not leave old keys in the history.
 */

import type { Relation } from '@/types';
import { canSeeProject, requireWritable } from './access';
import { FieldErrors, newId, notFound, write } from './client';
import { notifyPeople, recordEvent } from './events';
import { projectOf } from './lookup';
import { requireItem } from './workItems';

export function addRelation(source_id: string, type_id: string, target_id: string): Promise<Relation> {
  return write((ctx) => {
    const { db, me, stamp } = ctx;
    const { item: source, project } = requireItem(db, me, source_id);
    const { item: target } = requireItem(db, me, target_id);
    requireWritable(db, me, project, 'member', 'Relationen ändern dürfen nur Member und Admins des Projekts.');

    const errors = new FieldErrors();
    const type = db.relation_types.find((entry) => entry.id === type_id);
    if (!type) errors.add('type_id', 'Diesen Relationstyp gibt es nicht.');
    if (source.id === target.id) errors.add('target_id', 'Ein Item kann nicht mit sich selbst in Relation stehen.');
    // the same pair with the same type twice is out; for a symmetric type the other direction counts as the same
    const twice = db.relations.some(
      (relation) =>
        relation.type_id === type_id &&
        ((relation.source_id === source.id && relation.target_id === target.id) ||
          (type?.inward_label === null && relation.source_id === target.id && relation.target_id === source.id)),
    );
    if (twice) errors.add('target_id', 'Diese Relation gibt es schon.');
    errors.throwIfAny();

    const relation: Relation = { id: newId('rel'), type_id, source_id: source.id, target_id: target.id };
    db.relations.push(relation);
    source.updated_at = stamp;
    target.updated_at = stamp;
    for (const [item, other, label] of [
      [source, target, type!.outward_label],
      [target, source, type!.inward_label ?? type!.outward_label],
    ] as const) {
      const event = recordEvent(ctx, {
        type: 'work_item.relation_added',
        actor_id: me.id,
        subject: { type: 'work_item', id: item.id },
        project_id: item.project_id,
        changes: { relation: { old: null, new: { label, item_id: other.id } } },
      });
      // a relation is one of the "sonstige Änderungen" (spec 4.14); the notification names no other item
      notifyPeople(ctx, { event: 'item_changed', item, actor_id: me.id, event_id: event.id, data: { fields: ['relation'] } });
    }
    return relation;
  });
}

export function removeRelation(id: string): Promise<void> {
  return write((ctx) => {
    const { db, me, stamp } = ctx;
    const relation = db.relations.find((entry) => entry.id === id);
    const source = relation && db.items.find((item) => item.id === relation.source_id);
    const target = relation && db.items.find((item) => item.id === relation.target_id);
    if (!relation || !source || !target || !canSeeProject(db, me, projectOf(db, source))) throw notFound('Die Relation');
    requireWritable(db, me, projectOf(db, source), 'member', 'Relationen ändern dürfen nur Member und Admins des Projekts.');

    const type = db.relation_types.find((entry) => entry.id === relation.type_id)!;
    db.relations = db.relations.filter((entry) => entry.id !== relation.id);
    source.updated_at = stamp;
    target.updated_at = stamp;
    for (const [item, other, label] of [
      [source, target, type.outward_label],
      [target, source, type.inward_label ?? type.outward_label],
    ] as const) {
      const event = recordEvent(ctx, {
        type: 'work_item.relation_removed',
        actor_id: me.id,
        subject: { type: 'work_item', id: item.id },
        project_id: item.project_id,
        changes: { relation: { old: { label, item_id: other.id }, new: null } },
      });
      notifyPeople(ctx, { event: 'item_changed', item, actor_id: me.id, event_id: event.id, data: { fields: ['relation'] } });
    }
  });
}
